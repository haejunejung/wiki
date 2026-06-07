# Floating UI 깊이 읽기 — size 미들웨어 (한 줄 한 줄)

> `size`는 floating이 경계 안에 들어가도록 **쓸 수 있는 너비/높이(availableWidth/Height)**를 계산해 사용자에게 넘기고, 사용자가 크기를 바꾸면 `reset: { rects: true }`로 **재측정·재배치**를 트리거합니다.
>
> 이 글은 **(1) 멘탈 모델과 역할** → **(2) `size.ts` 한 줄 한 줄** → **(3) 흐름·설계 요약** 순서입니다. 선행 지식: `computePosition`의 **reset 모양**([computePosition-architecture.md](computePosition-architecture.md)), `detectOverflow`([detectOverflow-architecture.md](detectOverflow-architecture.md)).

---

## 1부. 멘탈 모델과 역할

### size가 푸는 문제

긴 드롭다운이 화면 아래로 넘칩니다. flip(위로 뒤집기)이나 shift(밀기)로도 안 되면, **크기 자체를 줄여** 남은 공간에 맞춰야 합니다.

```
   ❌ 넘침                          ✅ size (높이를 available에 맞춤)

   ┌──── 화면 ────┐                 ┌──── 화면 ────┐
   │ [REFERENCE]  │                 │ [REFERENCE]  │
   │ ┌─────────┐  │                 │ ┌─────────┐  │
   │ │ DROPDOWN│  │                 │ │ DROPDOWN│  │ ← availableHeight로 capped
   │ │         │  │                 │ │ (scroll)│  │
   └─┤         ├──┘ ▒▒ 넘침          └─┴─────────┴──┘
     │         │
     └─────────┘ ▒▒▒
```

### 핵심 특성 — apply 콜백 + reset:{rects:true}

size는 좌표를 직접 안 바꿉니다. 대신:
1. **availableWidth/Height를 계산**해서
2. 사용자 **`apply` 콜백**에 넘겨주면, 사용자가 그 값으로 floating의 CSS 크기를 바꿉니다 (side effect).
3. 크기가 실제로 바뀌었으면 **`reset: { rects: true }`**로 플랫폼에 **재측정**을 요청 → 새 크기 기준으로 좌표가 다시 계산됨.

| 미들웨어 | reset 모양 | 의미 |
|---|---|---|
| **`size`** | **`{ rects: true }`** | "크기를 바꿨는데 새 값을 내가 모름 → 플랫폼이 재측정해라" |
| `inline` | `{ rects: 객체 }` | "내가 새 reference rect를 이미 측정함 → 이 값 써라" |
| `flip` | `{ placement }` | placement 변경 |

> 🔑 size가 `rects: true`(객체가 아니라)인 이유: `apply`에서 사용자가 floating을 얼마로 바꿀지 size는 **알 수 없습니다.** 그래서 "내가 측정한 값을 줄게(객체)"가 아니라 "**네가 다시 재어라(true)**"라고 플랫폼에 위임합니다. ([computePosition-architecture.md](computePosition-architecture.md)의 `rects === true` 분기 참고.)

### 무한 루프 방지
`reset`은 **크기가 실제로 바뀌었을 때만** 발생합니다(121행). 안 바뀌면 `{}` 반환 → 루프 종료. 안 그러면 매 라운드 재측정으로 무한 반복하겠죠.

### 핵심 멘탈 모델 (한 문장)

> `size`는 **detectOverflow로 "경계까지 쓸 수 있는 너비/높이"를 계산해 `apply` 콜백에 넘기고, 사용자가 크기를 바꿨으면 `reset:{rects:true}`로 재측정·재배치시키는** 미들웨어다.

---

## 2부. 코드 한 줄 한 줄

### import + 옵션 (1–25행)

```ts
import { evaluate, getAlignment, getSide, getSideAxis, max, min } from '@floating-ui/utils';
import type {DetectOverflowOptions} from '../detectOverflow';
import type {Derivable, Middleware, MiddlewareState} from '../types';

export interface SizeOptions extends DetectOverflowOptions {
  apply?(args: MiddlewareState & { availableWidth: number; availableHeight: number }): void | Promise<void>;
}
```

- **1–8** 순수 utils + `min`/`max`.
- **13** `extends DetectOverflowOptions` — padding 등 상속.
- **19–24** ⭐ `apply` — size의 핵심 인터페이스. state + availableWidth/Height를 받아 **사용자가 크기 조정**을 수행하는 콜백. 비동기 가능.

### 팩토리 + state/옵션 (33–49행)

```ts
export const size = (options = {}): Middleware => ({
  name: 'size',
  options,
  async fn(state) {
    const {placement, rects, platform, elements} = state;
    const {apply = () => {}, ...detectOverflowOptions} = evaluate(options, state);
    const overflow = await platform.detectOverflow(state, detectOverflowOptions);
    const side = getSide(placement);
    const alignment = getAlignment(placement);
    const isYAxis = getSideAxis(placement) === 'y';
    const {width, height} = rects.floating;
```

- **41** `apply` 기본값은 no-op. 나머지 옵션은 detectOverflow로.
- **46** `platform.detectOverflow`로 넘침 측정 (available 계산의 재료).
- **50–53** side/alignment/축, 현재 floating 크기 추출.

### 어느 변이 높이/너비를 제한하나 (55–68행)

```ts
let heightSide: 'top' | 'bottom';
let widthSide: 'left' | 'right';

if (side === 'top' || side === 'bottom') {
  heightSide = side;
  widthSide = alignment === ((await platform.isRTL?.(elements.floating)) ? 'start' : 'end') ? 'left' : 'right';
} else {
  widthSide = side;
  heightSide = alignment === 'end' ? 'top' : 'bottom';
}
```

- 배치 방향과 정렬·RTL에 따라 **floating이 어느 변 쪽으로 자랄지** 결정.
  - **58–64** 세로 배치(top/bottom): 높이는 그 side가 제한, 너비는 정렬(+RTL)에 따라 left/right.
  - **65–67** 가로 배치(left/right): 너비는 그 side, 높이는 정렬에 따라 top/bottom.

### ⭐ available 크기 계산 (70–92행)

```ts
const maximumClippingHeight = height - overflow.top - overflow.bottom;
const maximumClippingWidth = width - overflow.left - overflow.right;

const overflowAvailableHeight = min(height - overflow[heightSide], maximumClippingHeight);
const overflowAvailableWidth = min(width - overflow[widthSide], maximumClippingWidth);

const noShift = !state.middlewareData.shift;

let availableHeight = overflowAvailableHeight;
let availableWidth = overflowAvailableWidth;

if (state.middlewareData.shift?.enabled.x) {
  availableWidth = maximumClippingWidth;
}
if (state.middlewareData.shift?.enabled.y) {
  availableHeight = maximumClippingHeight;
}
```

- **70–71** ⭐ `maximumClippingHeight/Width` = 현재 크기에서 **양쪽 넘침을 다 뺀** 값 = 경계 안에 완전히 들어가는 최대 크기.
- **73–80** ⭐ `overflowAvailable...` = "자라는 쪽 변의 넘침만 뺀 값"과 "양쪽 다 뺀 값" 중 **작은 것**. 보통은 한 방향으로만 자라므로 한 변 기준이지만, clipping 전체를 넘지 않게 min.
- **82** shift가 돌았는지 확인.
- **87–92** ⭐ **shift가 그 축을 밀었으면** available을 `maximumClipping...`으로 교체. shift가 이미 위치를 조정했으니, size는 "경계 전체 폭"을 쓸 수 있게 됨 (shift와 size의 협조).

### shift 없고 정렬 없을 때의 대칭 보정 (94–115행)

```ts
if (noShift && !alignment) {
  const xMin = max(overflow.left, 0);
  const xMax = max(overflow.right, 0);
  const yMin = max(overflow.top, 0);
  const yMax = max(overflow.bottom, 0);

  if (isYAxis) {
    availableWidth = width - 2 * (xMin !== 0 || xMax !== 0 ? xMin + xMax : max(overflow.left, overflow.right));
  } else {
    availableHeight = height - 2 * (yMin !== 0 || yMax !== 0 ? yMin + yMax : max(overflow.top, overflow.bottom));
  }
}
```

- ⭐ shift도 없고 **가운데 정렬**일 때, floating은 중앙 정렬되어 있으므로 **양쪽 대칭으로 줄여야** 중심이 유지됨. 그래서 넘친 쪽의 2배를 빼서 대칭성 보존. (한쪽만 넘쳐도 반대쪽도 같이 줄여 중앙 유지.)

### ⭐ apply 호출 + reset 판단 (117–129행)

```ts
await apply({...state, availableWidth, availableHeight});

const nextDimensions = await platform.getDimensions(elements.floating);

if (width !== nextDimensions.width || height !== nextDimensions.height) {
  return {
    reset: { rects: true },
  };
}

return {};
```

- **117** ⭐ 계산한 available 값을 사용자 `apply`에 전달 → **사용자가 floating 크기를 변경**(side effect).
- **119** ⭐ apply 후 floating을 **다시 측정**.
- **121–127** ⭐ **크기가 실제로 바뀌었으면** `reset:{rects:true}` → 플랫폼이 rects 재측정 → 새 크기 기준 좌표 재계산 + 루프 재실행. 위에서 말한 **무한 루프 방지**가 이 조건(`width !== next.width || ...`)에 담겨 있음.
- **129** 안 바뀌었으면 `{}` → size 종료.

---

## 3부. 전체를 한 흐름으로

```
   computePosition 루프 ──fn(state)──▶ size.fn
        │
        ▼
   ┌──────────────────── size.fn ────────────────────┐
   │ ① detectOverflow로 넘침 측정                      │
   │ ② 자라는 변(heightSide/widthSide) 결정            │
   │ ③ availableWidth/Height 계산                      │
   │    (shift 협조 / 가운데 정렬 대칭 보정)           │
   │ ④ apply({availableWidth, availableHeight})        │
   │    → 사용자가 floating 크기 변경 (side effect)    │
   │ ⑤ 재측정 → 크기 바뀜? → reset:{rects:true}        │
   │    안 바뀜 → {}                                   │
   └──────────────────────────────────────────────────┘
        │ reset:{rects:true} → 플랫폼 재측정 + 좌표 재계산 + 루프 재시작
        ▼
```

### 설계 포인트
- **계산은 라이브러리, 적용은 사용자** — size는 available을 계산만, 실제 크기 변경은 `apply` 콜백(사용자). 관심사 분리 + 유연성(width 맞추기, height capping 등 자유).
- **rects:true = "재측정 위임"** — 사용자가 얼마로 바꿀지 모르니 플랫폼에 재측정을 맡김. inline의 object reset과 대비.
- **변경 시에만 reset** — 무한 루프 방지의 핵심 가드.
- **shift·정렬과 협조** — `middlewareData.shift`와 alignment를 보고 available 계산을 조정.
- **순수 utils + platform(detectOverflow/getDimensions/isRTL)만 의존**.

### 한 문장 요약
> `size`는 **경계까지 쓸 수 있는 너비/높이를 계산해 `apply` 콜백으로 사용자에게 넘기고, 사용자가 크기를 바꿨으면 `reset:{rects:true}`로 플랫폼 재측정·재배치를 트리거하는** 크기 조정 미들웨어다.

---

## 다음에 볼 것
- [`flip.md`](flip.md) — size 전에 "뒤집기"로 공간 확보를 먼저 시도
- [`shift.md`](shift.md) — size의 available 계산이 협조하는 대상
- [`inline.md`](inline.md) — `reset:{rects: 객체}` (size의 `true`와 대비)
- [`computePosition-architecture.md`](computePosition-architecture.md) — rects reset의 두 형태

## 참고
- 소스: `packages/core/src/middleware/size.ts`
- 함께 보기: [`detectOverflow-architecture.md`](detectOverflow-architecture.md)
- 공식 문서: https://floating-ui.com/docs/size
