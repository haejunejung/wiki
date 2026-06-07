# Floating UI 깊이 읽기 — shift 미들웨어 (한 줄 한 줄)

> `detectOverflow`가 "얼마나 넘쳤는가"를 측정하는 **센서**라면, `shift`는 그 출력을 처음으로 *소비*해 **floating을 경계 안으로 밀어 넣는** 첫 번째 보정 미들웨어입니다.
>
> 이 글은 **(1) 멘탈 모델과 역할**을 먼저 잡고, **(2) `shift.ts`를 한 줄 한 줄** 설명합니다. 선행 지식: `computePosition`(미들웨어 루프·reset), `detectOverflow`(부호 규약 `+넘침/−여유`).

---

## 1부. 멘탈 모델과 역할

### shift가 푸는 문제

`bottom`에 놓인 툴팁이 reference를 따라가다 화면 오른쪽으로 삐져나갑니다.

```
   ┌──────────────── 화면 ────────────────┐
   │                      [REFERENCE]      │
   │                  ┌──────────────┬─────┼─── 오른쪽으로 넘침
   │                  │   TOOLTIP    │ ▒▒▒ │
   │                  └──────────────┴─────┼───
   └───────────────────────────────────────┘
```

`shift`는 placement(`bottom`)는 **그대로 둔 채**, 툴팁을 **모서리를 따라 옆으로 밀어** 화면 안에 넣습니다.

```
   ┌──────────────── 화면 ────────────────┐
   │                      [REFERENCE]      │
   │              ┌──────────────┐         │  ← 왼쪽으로 밀어 넣음
   │              │   TOOLTIP    │         │     (placement는 여전히 bottom)
   │              └──────────────┘         │
   └───────────────────────────────────────┘
```

### flip과의 결정적 차이

| | `shift` | `flip` |
|---|---|---|
| 무엇을 바꾸나 | **좌표(x/y)만** 민다 | **placement**를 반대편으로 뒤집는다 |
| reset 요청 | ❌ 안 함 (좌표만 반환) | ✅ `reset: { placement }` |
| 비유 | "같은 면에서 옆으로 미끄러뜨리기" | "반대 면으로 점프" |

> 🔑 shift는 placement를 안 바꾸므로 **순수 커널(computeCoordsFromPlacement)을 다시 부를 필요가 없습니다.** 그래서 reset 없이 `{x, y}`만 조정해 반환합니다. (computePosition 문서에서 본 "reset이 필요 없는 보정"의 대표 사례.)

### 핵심 멘탈 모델 (한 문장)

> `shift`는 **detectOverflow가 준 "넘친 양"만큼 floating의 좌표를 경계 안으로 `clamp`(가두기)하는** 미들웨어다. 넘쳤으면 그만큼 밀고, 여유가 있으면 그대로 둔다.

### 두 개의 축 — mainAxis vs crossAxis (헷갈림 주의)

shift는 축을 두 개로 나눠 다룹니다. **이름이 detectOverflow의 sideAxis/alignmentAxis와 반대 감각**이라 주의가 필요합니다.

```
   bottom 배치의 경우:

         ◄──── mainAxis (정렬 축, 모서리 따라 미끄러짐) ────►
        ┌─────────────────────┐
        │      FLOATING       │
        └─────────────────────┘
                  ▲
                  │  crossAxis (side 축, reference로부터의 거리)
                  ▼
              [REFERENCE]
```

- **mainAxis** = 정렬 축(모서리를 따라 미끄러지는 방향). bottom이면 `x`. **shift의 주 무대** → `checkMainAxis` 기본 `true`.
- **crossAxis** = side 축(reference에 가까워지거나 멀어지는 방향). bottom이면 `y`. 여길 밀면 reference에서 떨어지므로 → `checkCrossAxis` 기본 `false`.

> 💡 "main"인 이유: shift의 본업은 "모서리를 따라 옆으로 미끄러뜨려 시야에 유지"이기 때문. 그게 mainAxis입니다.

### limiter — 너무 밀어서 떨어지는 걸 막기

shift는 넘침을 없애려고 무한정 밉니다. 그러다 보면 floating이 reference에서 **완전히 떨어져** 엉뚱한 곳을 가리킬 수 있습니다. `limiter`(보통 `limitShift`를 넘김)는 "이 이상 밀면 분리된다"는 지점에서 멈추게 합니다. **`limitShift`는 별도 문서 [`limitShift.md`](limitShift.md)에서 한 줄씩 다룹니다.** (기본 limiter는 항등 함수라 제한 없음.)

---

## 2부. 코드 한 줄 한 줄

### import 영역 (1–12행)

```ts
import {
  type Coords,
  clamp,
  evaluate,
  getOppositeAxis,
  getSide,
  getSideAxis,
} from '@floating-ui/utils';

import {originSides} from '../constants';
import type {DetectOverflowOptions} from '../detectOverflow';
import type {Derivable, Middleware, MiddlewareState} from '../types';
```

- **2** `type Coords` — `{x, y}` 타입 (타입이라 런타임 소멸).
- **3** `clamp` — `clamp(min, value, max)` = 값을 [min, max]로 가두는 순수 함수. **shift의 심장.**
- **4** `evaluate` — 옵션이 함수면 실행, 아니면 그대로 (Derivable 지원).
- **5** `getOppositeAxis` — `'x'↔'y'` 뒤집기.
- **6** `getSide` — placement에서 변 추출 (`'bottom-start'` → `'bottom'`).
- **7** `getSideAxis` — 변의 축 (`'bottom'` → `'y'`).
- **10** `originSides` — `new Set(['left','top'])`, 순수 데이터. (limitShift에서만 사용.)
- **11–12** 전부 `import type` — **타입만**. detectOverflow 함수 자체는 import하지 않음(= `platform` 경유). 미들웨어가 core 행위 모듈에 런타임 의존하지 않는다는 그 원칙.

### 옵션 타입 (14–35행)

```ts
export interface ShiftOptions extends DetectOverflowOptions {
  mainAxis?: boolean;   // 정렬 축 검사 여부 (기본 true)
  crossAxis?: boolean;  // side 축 검사 여부 (기본 false)
  limiter?: { fn: (state) => Coords; options?: any };
}
```

- **14** `extends DetectOverflowOptions` — shift 옵션은 detectOverflow 옵션(boundary, padding 등)을 **상속**. 사용자가 `shift({padding: 8})`처럼 주면 그게 detectOverflow로 흘러감.
- **20** `mainAxis` — 정렬 축(미끄러짐) 검사. 기본 켜짐.
- **26** `crossAxis` — side 축(거리) 검사. 기본 꺼짐(밀면 분리되니까).
- **31–34** `limiter` — 과도한 밀림 방지 훅. 기본은 "아무 제한 안 함"(아래 53행).

### 미들웨어 객체 (42–47행)

```ts
export const shift = (
  options: ShiftOptions | Derivable<ShiftOptions> = {},
): Middleware => ({
  name: 'shift',
  options,
  async fn(state) {
```

- **42–43** `shift(options)`가 **미들웨어를 생성하는 팩토리**. 옵션은 객체 또는 `Derivable`(상태 기반 함수). 기본 `{}`.
- **44** 반환은 `Middleware` 계약 — `{name, fn}`.
- **45** `name: 'shift'` — `middlewareData['shift']` 키로 쓰임.
- **47** `fn(state)` — computePosition 루프가 매 라운드 호출하는 본체. `state`에 현재 `x, y, placement, rects, platform...`이 들어옴.

### 상태·옵션 추출 (48–55행)

```ts
const {x, y, placement, platform} = state;

const {
  mainAxis: checkMainAxis = true,
  crossAxis: checkCrossAxis = false,
  limiter = {fn: ({x, y}: Coords) => ({x, y})},
  ...detectOverflowOptions
} = evaluate(options, state);
```

- **48** 현재 좌표(`x,y`), `placement`, `platform`을 state에서 꺼냄.
- **50–55** 옵션 분해 (`evaluate`로 Derivable 먼저 해석):
  - **51** `mainAxis`를 `checkMainAxis`로 별칭, 기본 `true`.
  - **52** `crossAxis`를 `checkCrossAxis`로 별칭, 기본 `false`.
  - **53** `limiter` 기본값 = **항등 함수**(`({x,y}) => ({x,y})`). 즉 기본은 **제한 없음**. `limitShift()`를 명시적으로 넘겨야 제한이 걸림.
  - **54** `...detectOverflowOptions` — shift 전용 옵션을 뺀 나머지(padding, boundary 등)를 모아 detectOverflow로 전달할 준비.

### 넘침 측정 + 축 결정 (57–63행)

```ts
const coords = {x, y};
const overflow = await platform.detectOverflow(state, detectOverflowOptions);
const crossAxis = getSideAxis(getSide(placement));
const mainAxis = getOppositeAxis(crossAxis);
```

- **57** 작업용 좌표 복사본.
- **58–61** ⭐ **detectOverflow 호출** — `platform.detectOverflow`(core 함수를 직접 부르지 않고 주입된 platform 경유)로 `{top, right, bottom, left}` 넘침 값을 받음. 위에서 모은 detectOverflowOptions(padding 등) 전달.
- **62** `crossAxis = getSideAxis(getSide(placement))` — placement의 side 축. `bottom`이면 `'y'`. **이게 "거리 축(cross)".**
- **63** `mainAxis = getOppositeAxis(crossAxis)` — 그 반대. `bottom`이면 `'x'`. **이게 "미끄러짐 축(main)".**

### 좌표 초기화 (65–66행)

```ts
let mainAxisCoord = coords[mainAxis];
let crossAxisCoord = coords[crossAxis];
```

- 각 축의 현재 좌표값을 꺼내 가변 변수로. bottom이면 `mainAxisCoord = x`, `crossAxisCoord = y`. 이제 이 둘을 clamp로 조정할 것.

### ⭐ mainAxis 클램핑 (68–75행) — shift의 핵심

```ts
if (checkMainAxis) {
  const minSide = mainAxis === 'y' ? 'top' : 'left';
  const maxSide = mainAxis === 'y' ? 'bottom' : 'right';
  const min = mainAxisCoord + overflow[minSide];
  const max = mainAxisCoord - overflow[maxSide];

  mainAxisCoord = clamp(min, mainAxisCoord, max);
}
```

- **68** mainAxis 검사가 켜져 있을 때만(기본 켜짐).
- **69–70** mainAxis가 `'x'`(bottom 배치)면 `minSide='left'`, `maxSide='right'`. 즉 이 축의 양 끝 변을 고름.
- **71** `min = 현재좌표 + overflow.left`
- **72** `max = 현재좌표 − overflow.right`
- **74** `clamp(min, 현재좌표, max)` — 현재좌표를 [min, max]로 가둠.

#### 이 산수가 왜 "경계 안으로 밀기"가 되나 (부호 규약과 연결)

detectOverflow 부호: **`+` = 그 방향으로 넘침, `−` = 여유.** 이걸 대입해 봅니다 (mainAxis='x').

**경우 A: 오른쪽으로 20px 넘침** (`overflow.right = +20`, `overflow.left = -50` 여유)
```
   min = x + (−50) = x − 50   (왼쪽으로 50까지 가도 됨)
   max = x − (+20) = x − 20   (오른쪽 넘침 20 → 최대 x−20까지만)
   clamp(x−50, x, x−20) = x−20   ← x가 max보다 크므로 x−20으로 당겨짐
   → 왼쪽으로 20px 이동 = 넘친 만큼 정확히 밀어 넣음 ✓
```

**경우 B: 양쪽 다 여유** (`overflow.left=-30, overflow.right=-40`)
```
   min = x−30,  max = x+40
   clamp(x−30, x, x+40) = x   ← x가 범위 안 → 그대로 (안 움직임) ✓
```

**경우 C: 왼쪽으로 15px 넘침** (`overflow.left = +15`)
```
   min = x + 15   (최소 x+15까지 밀어야)
   clamp(x+15, x, ...) = x+15   ← x가 min보다 작으므로 x+15로 밀림
   → 오른쪽으로 15px 이동 ✓
```

> 🔑 **핵심:** `min = coord + overflow[minSide]`, `max = coord − overflow[maxSide]`. 넘친 쪽(양수)이 범위를 좁혀 좌표를 그 방향 반대로 밀고, 여유 쪽(음수)은 범위를 넓혀 자유를 줌. `clamp`가 "넘쳤으면 딱 그만큼 민다"를 한 줄로 표현.

### crossAxis 클램핑 (77–84행)

```ts
if (checkCrossAxis) {
  const minSide = crossAxis === 'y' ? 'top' : 'left';
  const maxSide = crossAxis === 'y' ? 'bottom' : 'right';
  const min = crossAxisCoord + overflow[minSide];
  const max = crossAxisCoord - overflow[maxSide];

  crossAxisCoord = clamp(min, crossAxisCoord, max);
}
```

- mainAxis와 **완전히 같은 로직**을 cross 축에 적용. 단 **기본 꺼짐**(77, checkCrossAxis 기본 false).
- 왜 기본 꺼짐? crossAxis는 reference와의 *거리* 방향이라, 여길 밀면 툴팁이 reference에서 떨어집니다. 보통 원치 않으므로 옵트인.

### limiter 적용 (86–90행)

```ts
const limitedCoords = limiter.fn({
  ...state,
  [mainAxis]: mainAxisCoord,
  [crossAxis]: crossAxisCoord,
});
```

- 클램핑한 좌표를 state에 덮어써서 `limiter.fn`에 넘김.
- 기본 limiter는 항등 함수(53행)라 **그대로 통과**. `limitShift()`를 넘겼다면 여기서 "너무 밀려 분리됐는지" 추가 제한이 걸림.
- `[mainAxis]: ...` 계산된 키 — `mainAxis`가 `'x'`면 `{x: mainAxisCoord, y: crossAxisCoord}`가 됨.

### 반환 (92–102행)

```ts
return {
  ...limitedCoords,
  data: {
    x: limitedCoords.x - x,
    y: limitedCoords.y - y,
    enabled: {
      [mainAxis]: checkMainAxis,
      [crossAxis]: checkCrossAxis,
    },
  },
};
```

- **93** `...limitedCoords` — 최종 `{x, y}`를 반환 → computePosition이 `x = nextX ?? x`로 반영.
- **94–101** `data` — `middlewareData.shift`에 저장됨:
  - **95–96** `x: limitedCoords.x - x` — **얼마나 밀었는지(delta)**. 원래 좌표 대비 이동량. arrow 등 다른 미들웨어가 "shift가 얼마나 밀었나"를 참고할 때 씀.
  - **97–100** `enabled` — 각 축 검사가 켜졌는지 기록.
- ⭐ **`reset`이 없음** — placement도 rects도 안 건드렸으니 좌표만 반환. computePosition은 reset이 없으니 다음 미들웨어로 진행. (flip과의 핵심 차이.)

---

## 3부. 전체를 한 흐름으로

```
   computePosition 루프
        │  fn(state) 호출
        ▼
   ┌─────────────────────── shift.fn ───────────────────────┐
   │ ① platform.detectOverflow → { top,right,bottom,left }   │
   │ ② mainAxis/crossAxis 결정 (placement 기반)               │
   │ ③ checkMainAxis:  clamp(coord, 넘친 만큼)  ← 핵심         │
   │ ④ checkCrossAxis: (옵션) 같은 방식                        │
   │ ⑤ limiter.fn (limitShift): 분리되기 직전에서 멈춤         │
   │ ⑥ return { x, y, data:{ 이동량, enabled } }  (reset 없음) │
   └─────────────────────────────────────────────────────────┘
        │
        ▼  reset 없음 → 다음 미들웨어로
```

### 설계 포인트 요약
- **detectOverflow 출력의 첫 소비자** — 부호 규약(`+넘침/−여유`)이 `clamp`의 min/max로 자연스럽게 번역됨.
- **reset 없는 보정** — 좌표만 조정 → 순수 커널 재호출 불필요 (flip과 대비).
- **clamp = shift의 본질** — "넘쳤으면 그만큼만, 여유면 그대로". 단 두 줄(min/max)에 압축.
- **limiter 분리** — "민다"와 "너무 밀지 마라"를 다른 함수로 쪼갬 (단일 책임 + 합성). 기본은 무제한, `limitShift`로 옵트인.
- **순수 utils + platform만 의존** — core 행위 모듈 import 없음(detectOverflow도 platform 경유).

### 한 문장 요약
> `shift`는 **detectOverflow가 준 넘침 값을 `clamp`의 경계로 삼아, placement는 그대로 둔 채 floating을 모서리 따라 시야 안으로 밀어 넣는** 미들웨어다. `limitShift`는 그 밀림이 reference에서 분리될 만큼 과해지지 않게 잡아준다.

---

## 다음에 볼 것
1. [`limitShift.md`](limitShift.md) — shift에 넘기는 분리 방지 limiter (같은 파일 `shift.ts`에 정의)
2. [flip.ts](../../packages/core/src/middleware/flip.ts) — shift와 대비되는 `reset:{placement}` 보정. computePosition의 reset 루프가 살아 움직이는 걸 봄
3. [offset.ts](../../packages/core/src/middleware/offset.ts) — limitShift가 참조하던 `middlewareData.offset`을 만드는 쪽
4. [size.ts](../../packages/core/src/middleware/size.ts) — `reset:{rects:true}`

## 참고
- 소스: `packages/core/src/middleware/shift.ts` (`shift` export, 1–104행)
- 함께 보기: [`limitShift.md`](limitShift.md), `detectOverflow-architecture.md`(센서), `computePosition-architecture.md`(루프·reset)
- 공식 문서: https://floating-ui.com/docs/shift
