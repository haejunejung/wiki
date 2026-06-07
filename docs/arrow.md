# Floating UI 깊이 읽기 — arrow 미들웨어 (한 줄 한 줄)

> `arrow`는 툴팁의 **화살표(꼬리)**를 reference 중심을 가리키도록 위치시키되, floating 밖으로 삐져나가지 않게 가둡니다. 좌표를 거의 안 바꾸고 **데이터만** 제공하는 게 보통이지만, 특수한 경우엔 `reset: true`(boolean)를 냅니다.
>
> 이 글은 **(1) 멘탈 모델과 역할** → **(2) `arrow.ts` 한 줄 한 줄** → **(3) 흐름·설계 요약** 순서입니다. 선행 지식: `computePosition`의 **reset 모양**([computePosition-architecture.md](computePosition-architecture.md)), `computeCoordsFromPlacement`의 정렬 축.

---

## 1부. 멘탈 모델과 역할

### arrow가 푸는 문제

화살표는 reference의 **중심을 가리켜야** 자연스럽습니다. 하지만 floating이 shift로 옆으로 밀리면, 화살표는 여전히 reference 쪽을 가리키도록 floating 안에서 위치를 조정해야 합니다. 또 화살표가 floating의 둥근 모서리를 뚫고 나가면 안 됩니다.

```
   화살표가 reference 중심을 가리킴 + floating 안에 갇힘

        ┌───────────────────┐
        │     TOOLTIP       │
        └─────────▼─────────┘   ← 화살표가 padding 안에서 clamp됨
              [REFERENCE]        ← reference 중심을 향함
```

### 핵심 특성 — reset이 boolean인 유일한 미들웨어

| 미들웨어 | reset 모양 | 의미 |
|---|---|---|
| `flip` | `{ placement }` | placement(전제) 변경 → 좌표 재계산 |
| `size` | `{ rects: true }` | 크기(전제) 변경 → 재측정 |
| `inline` | `{ rects: 객체 }` | reference rect 직접 교체 |
| **`arrow`** | **`true`** (boolean) | **전제 안 바뀜. 좌표만 살짝 건드렸으니 루프만 재실행** |

> 🔑 arrow의 `reset: true`는 **placement도 rects도 안 바꿉니다.** 단지 floating 좌표에 작은 보정(`alignmentOffset`)을 더했으니, **shift 같은 뒤 미들웨어가 그 보정을 반영해 다시 동작하도록 루프만 한 번 되감자**는 신호입니다. computePosition은 boolean reset이면 **좌표를 재계산하지 않고**(재계산하면 arrow의 보정이 날아감) `i = -1`만 합니다. ([computePosition-architecture.md](computePosition-architecture.md)의 "reset: true는 좌표 재계산 안 함" 참고.)

### 무엇을 반환하나
arrow는 주로 **`data`**를 채웁니다 (렌더링이 화살표를 실제로 배치할 때 씀):
- `data[axis]` — 정렬 축에서 화살표의 위치(offset)
- `centerOffset` — 화살표가 이상적 중심에서 얼마나 벗어났는지 (화살표를 숨길지 판단용)
- `alignmentOffset` — (특수 경우) floating 자체에 더한 보정

### 핵심 멘탈 모델 (한 문장)

> `arrow`는 **reference 중심을 가리키는 화살표 위치를 계산해 floating의 padding 안으로 `clamp`하고, 그 위치를 `data`로 제공하는** 미들웨어다. reference가 너무 작아 화살표가 허공을 가리키게 되면 floating 자체를 살짝 옮기고 `reset: true`로 한 번 재실행시킨다.

---

## 2부. 코드 한 줄 한 줄

### import (1–12행)

```ts
import type {Padding} from '@floating-ui/utils';
import { clamp, evaluate, getAlignment, getAlignmentAxis, getAxisLength,
         getPaddingObject, min as mathMin } from '@floating-ui/utils';
import type {Derivable, Middleware} from '../types';
```

- **3–10** 순수 utils: `clamp`(가두기), `getAlignmentAxis`(정렬 축 = 화살표가 움직이는 축), `getAxisLength`(그 축의 길이 속성), `getPaddingObject`(padding 정규화), `mathMin`.
- **12** core는 타입만.

### 옵션 (14–26행)

```ts
export interface ArrowOptions {
  element: any;          // 화살표 DOM 요소 (필수)
  padding?: Padding;     // 화살표와 floating 모서리 사이 여백 (둥근 모서리 대응)
}
```

- **19** `element` — 위치를 잡을 화살표 요소. 필수라 `Partial` 아님.
- **25** `padding` — 둥근 모서리에서 화살표가 코너에 끼지 않게 하는 여백.

### 팩토리 + state/옵션 (33–47행)

```ts
export const arrow = (options): Middleware => ({
  name: 'arrow',
  options,
  async fn(state) {
    const {x, y, placement, rects, platform, elements, middlewareData} = state;
    const {element, padding = 0} = evaluate(options, state) || {};
    if (element == null) {
      return {};
    }
    const paddingObject = getPaddingObject(padding);
```

- **41** 옵션 평가, `|| {}`로 null 방어.
- **43–45** ⚠️ 화살표 요소가 없으면 즉시 종료(아무것도 안 함).
- **47** padding을 `{top,right,bottom,left}`로 정규화.

### 축·치수 준비 (48–55행)

```ts
const coords = {x, y};
const axis = getAlignmentAxis(placement);     // 화살표가 움직이는 축
const length = getAxisLength(axis);           // 그 축의 길이 속성 ('width'/'height')
const arrowDimensions = await platform.getDimensions(element);
const isYAxis = axis === 'y';
const minProp = isYAxis ? 'top' : 'left';
const maxProp = isYAxis ? 'bottom' : 'right';
const clientProp = isYAxis ? 'clientHeight' : 'clientWidth';
```

- **49** ⭐ `axis = getAlignmentAxis(placement)` — 화살표는 **정렬 축**을 따라 움직임. `bottom` 배치면 화살표는 가로(x)로 이동.
- **50** 그 축의 길이 속성(`'width'`/`'height'`).
- **51** `platform.getDimensions`로 화살표 크기 측정 (platform 경유 — 측정 위임).
- **53–55** 축에 따라 쓸 변(min/max prop)과 client 크기 속성 선택.

### reference 대비 위치 계산 (57–72행)

```ts
const endDiff = rects.reference[length] + rects.reference[axis] - coords[axis] - rects.floating[length];
const startDiff = coords[axis] - rects.reference[axis];

const arrowOffsetParent = await platform.getOffsetParent?.(element);
let clientSize = arrowOffsetParent ? arrowOffsetParent[clientProp] : 0;
if (!clientSize || !(await platform.isElement?.(arrowOffsetParent))) {
  clientSize = elements.floating[clientProp] || rects.floating[length];
}

const centerToReference = endDiff / 2 - startDiff / 2;
```

- **57–62** `endDiff`/`startDiff` — floating의 양 끝과 reference 양 끝 사이 간격. floating이 reference 대비 얼마나 어긋났는지.
- **64–70** `clientSize` — 화살표가 들어갈 컨테이너(floating)의 안쪽 크기. offsetParent에서 얻되, window거나 없으면 floating 요소/rect로 폴백.
- **72** ⭐ `centerToReference = endDiff/2 − startDiff/2` — **reference 중심이 floating 중심에서 얼마나 벗어났는지**. 화살표를 이만큼 옮겨야 reference 중심을 가리킴.

### ⭐ padding 보정 + clamp (74–87행)

```ts
const largestPossiblePadding = clientSize / 2 - arrowDimensions[length] / 2 - 1;
const minPadding = mathMin(paddingObject[minProp], largestPossiblePadding);
const maxPadding = mathMin(paddingObject[maxProp], largestPossiblePadding);

const min = minPadding;
const max = clientSize - arrowDimensions[length] - maxPadding;
const center = clientSize / 2 - arrowDimensions[length] / 2 + centerToReference;
const offset = clamp(min, center, max);
```

- **76–79** padding이 너무 커서 화살표를 못 중앙에 두는 경우를 막기 위해 padding을 `largestPossiblePadding`으로 제한.
- **83–84** ⭐ 화살표가 floating 안에 있을 수 있는 좌표 범위 `[min, max]`.
- **85** `center` — 화살표의 이상적 위치 (floating 중앙 + reference 보정).
- **87** ⭐ `offset = clamp(min, center, max)` — **이상적 위치를 floating 경계 안으로 가둠.** floating이 많이 밀려서 reference가 가장자리에 있으면, 화살표는 끝까지 가되 밖으론 안 나감.

### ⭐ shouldAddOffset — 허공을 가리키는 경우 (89–105행)

```ts
const shouldAddOffset =
  !middlewareData.arrow &&                        // 이번 라운드에 처음
  getAlignment(placement) != null &&              // 정렬된 placement
  center !== offset &&                            // clamp로 이상점에서 밀림 = 화살표가 못 닿음
  rects.reference[length] / 2 - (center < min ? minPadding : maxPadding) - arrowDimensions[length] / 2 < 0;

const alignmentOffset = shouldAddOffset
  ? center < min ? center - min : center - max
  : 0;
```

- **93–100** ⭐ `shouldAddOffset` — **reference가 너무 작아 화살표가 reference를 못 가리키는** 상황 감지:
  - **94** 아직 arrow 데이터 없음(무한 보정 방지).
  - **95** 정렬된 placement일 때만.
  - **96** `center !== offset` = clamp가 화살표를 이상점에서 밀어냄 = "화살표가 reference 중심에 못 닿음".
  - **97–100** reference 절반 길이가 padding+화살표 절반보다 작음 = reference가 너무 작아 화살표가 허공을 가리키게 됨.
- **101–105** ⭐ `alignmentOffset` — 그 경우 **floating 자체를** 화살표가 reference에 닿도록 옮길 보정량.

### 반환 (107–115행)

```ts
return {
  [axis]: coords[axis] + alignmentOffset,
  data: {
    [axis]: offset,
    centerOffset: center - offset - alignmentOffset,
    ...(shouldAddOffset && {alignmentOffset}),
  },
  reset: shouldAddOffset,
};
```

- **108** floating 좌표(정렬 축)에 `alignmentOffset`을 더함 (대개 0, 특수 경우만 ≠0).
- **110** ⭐ `data[axis] = offset` — 렌더링이 화살표를 실제로 놓을 위치. (예: `data.x`로 `arrow.style.left` 설정.)
- **111** `centerOffset` — 화살표가 이상적 중심에서 벗어난 양. **0이 아니면 화살표가 reference 중심을 못 가리킨다는 뜻** → 사용자가 화살표를 숨길 수 있음.
- **112** `shouldAddOffset`일 때만 `alignmentOffset`을 data에 포함 (flip/offset이 이걸 보고 협조 가드 작동).
- **114** ⭐ `reset: shouldAddOffset` — **boolean reset**. floating을 옮겼을 때만 `true` → shift가 다시 반응하도록 루프 재실행. 좌표 재계산은 안 함(arrow 보정 보존).

---

## 3부. 전체를 한 흐름으로

```
   computePosition 루프 ──fn(state)──▶ arrow.fn (보통 뒤쪽)
        │
        ▼
   ┌──────────────────── arrow.fn ────────────────────┐
   │ ① element 없으면 {} 반환                           │
   │ ② 정렬 축·치수·clientSize 준비                     │
   │ ③ centerToReference: reference 중심 보정량 계산    │
   │ ④ offset = clamp(center, [min, max]) ← floating 안 │
   │ ⑤ shouldAddOffset? (reference 너무 작아 허공 가리킴)│
   │ ⑥ return { 좌표+alignmentOffset,                  │
   │           data:{offset, centerOffset}, reset:bool} │
   └────────────────────────────────────────────────────┘
        │ reset:true면 좌표 재계산 없이 루프만 재시작
        ▼  (shift가 다시 반응)
```

### 설계 포인트
- **데이터 제공자** — 좌표는 거의 안 바꾸고 `data`(화살표 위치/centerOffset)를 제공. 실제 화살표 DOM 배치는 사용자(렌더) 몫.
- **clamp로 경계 가두기** — shift와 같은 도구(clamp)로 "이상점을 floating 안으로".
- **boolean reset의 대표** — 전제 안 바꾸고 좌표만 미세 조정 → 좌표 재계산 없이 루프만 재실행. flip/size/inline의 object reset과 명확히 대비.
- **협조 가드** — `alignmentOffset`을 data에 남겨 flip/offset이 중복 작동을 피함.
- **순수 utils + platform(getDimensions/getOffsetParent/isElement)만 의존**.

### 한 문장 요약
> `arrow`는 **reference 중심을 가리키는 화살표 위치를 `clamp`로 floating 안에 가두어 `data`로 제공하고, reference가 너무 작아 화살표가 허공을 가리키면 floating을 살짝 옮긴 뒤 `reset: true`로 한 번 더 돌리는** 데이터 중심 미들웨어다.

---

## 다음에 볼 것
- [`shift.md`](shift.md) — arrow의 reset:true가 다시 반응시키는 대상
- [`offset.md`](offset.md) — alignmentOffset로 arrow와 협조
- [`computePosition-architecture.md`](computePosition-architecture.md) — boolean vs object reset의 차이

## 참고
- 소스: `packages/core/src/middleware/arrow.ts`
- 함께 보기: [`flip.md`](flip.md), [`computePosition-architecture.md`](computePosition-architecture.md)
- 공식 문서: https://floating-ui.com/docs/arrow
