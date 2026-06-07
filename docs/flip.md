# Floating UI 깊이 읽기 — flip 미들웨어 (한 줄 한 줄)

> `shift`가 placement는 그대로 둔 채 floating을 **옆으로 밀어** 시야에 넣는다면, `flip`은 floating이 잘릴 때 **placement 자체를 반대편으로 뒤집어** 더 잘 맞는 면으로 옮깁니다.
>
> 이 글은 **(1) 멘탈 모델과 역할** → **(2) `flip.ts` 한 줄 한 줄** → **(3) 흐름·설계 요약** 순서입니다. 선행 지식: [`shift.md`](shift.md), `computePosition`의 **reset 루프**([computePosition-architecture.md](computePosition-architecture.md)), `detectOverflow`의 **부호 규약**([detectOverflow-architecture.md](detectOverflow-architecture.md)).

---

## 1부. 멘탈 모델과 역할

### flip이 푸는 문제

`bottom`에 놓은 툴팁이 화면 아래에서 잘립니다. 옆으로 밀어봤자(shift) 아래 공간 자체가 없으니 소용없습니다. 이럴 땐 **위(top)로 통째로 뒤집어야** 합니다.

```
   ❌ 잘림 (bottom)                  ✅ flip (top으로 뒤집음)

   ┌──── 화면 ────┐                 ┌──── 화면 ────┐
   │  [REFERENCE] │                 │  ┌─────────┐ │
   │  ┌─────────┐ │                 │  │ TOOLTIP │ │
   │  │ TOOLTIP │ │                 │  └─────────┘ │
   └──┴─────────┴─┘ ▒▒ 잘림          │  [REFERENCE] │
      ▒▒▒▒▒▒▒▒▒▒▒                   └──────────────┘
```

### shift와의 결정적 차이

| | `flip` | `shift` |
|---|---|---|
| 무엇을 바꾸나 | **placement** (`bottom`→`top`) | 좌표(x/y)만 |
| reset 요청 | ✅ `reset: { placement }` | ❌ 안 함 |
| 좌표 재계산 | placement가 바뀌므로 `computeCoordsFromPlacement` **재호출됨** | 없음 |
| 비유 | "반대 면으로 점프" | "같은 면에서 옆으로 미끄러뜨리기" |

> 🔑 flip은 placement(순수 커널의 전제)를 바꾸므로 `reset: { placement }`를 반환합니다. computePosition은 이걸 받아 좌표를 다시 유도하고 미들웨어 루프를 처음부터 재실행합니다. flip은 그 재실행 라운드마다 **자기 데이터를 누적**하며 "다음 후보를 시도"합니다.

### 후보 순회와 누적 — flip은 한 번에 끝나지 않는다

flip의 동작은 **여러 라운드에 걸친 후보 순회**입니다:

```
   라운드 1: initialPlacement(bottom) 시도 → 넘침 측정 → 누적
       → reset:{placement: top}  (다음 후보로)
   라운드 2: top 시도 → 넘침 측정 → 누적
       → 맞으면 확정 / 다 넘치면 fallbackStrategy로 최적 선택
```

이게 가능한 건 `middlewareData.flip`에 **`overflows`(후보별 넘침 기록)와 `index`(현재 몇 번째 후보인지)**를 누적하기 때문입니다. reset을 해도 `middlewareData`는 보존되므로(merge에서 새 data가 이김), 라운드를 거치며 기록이 쌓입니다. ([computePosition-architecture.md](computePosition-architecture.md)의 "reset 누적" 참고.)

### 옵션 개념 정리

- **mainAxis** (`checkMainAxis`, 기본 `true`): side 축(잘리는 주 방향) 넘침을 검사해 뒤집을지 결정.
- **crossAxis** (`checkCrossAxis`, 기본 `true` | `'alignment'`): 정렬 축 넘침도 검사. `'alignment'`면 정렬 뒤집기에만 적용.
- **fallbackPlacements**: 선호 placement가 안 맞을 때 순서대로 시도할 후보들. 기본은 "반대편"(또는 정렬 확장).
- **fallbackStrategy** (`'bestFit'` | `'initialPlacement'`): 아무 후보도 안 맞을 때 — `'bestFit'`은 가장 덜 넘치는 것, `'initialPlacement'`는 원래대로.
- **fallbackAxisSideDirection** (`'none'`|`'start'`|`'end'`): 수직 축으로도 fallback 허용 여부(예: 위아래 다 막히면 좌우로).
- **flipAlignment** (기본 `true`): 정렬이 다른 placement로도 뒤집을지.

### 핵심 멘탈 모델 (한 문장)

> `flip`은 **선호 placement가 잘리면 `reset:{placement}`로 다음 후보를 순서대로 시도하며 후보별 넘침을 누적하고, 맞는 걸 찾으면 확정 / 다 안 맞으면 fallbackStrategy로 최선을 고르는** 미들웨어다.

---

## 2부. 코드 한 줄 한 줄

### import (1–13행)

```ts
import type {Placement} from '@floating-ui/utils';
import {
  evaluate, getAlignmentSides, getExpandedPlacements,
  getOppositeAxisPlacements, getOppositePlacement, getSide, getSideAxis,
} from '@floating-ui/utils';
import type {DetectOverflowOptions} from '../detectOverflow';
import type {Derivable, Middleware} from '../types';
```

- **2–10** 순수 utils: `getOppositePlacement`(반대편 계산), `getExpandedPlacements`(정렬 변형 후보), `getOppositeAxisPlacements`(수직 축 후보), `getAlignmentSides`(정렬 축의 두 변).
- **12–13** core에서는 **타입만** import (detectOverflow 함수는 `platform` 경유). shift와 동일한 의존성 규율.

### 옵션 인터페이스 (15–53행)

`extends DetectOverflowOptions` — flip 옵션은 detectOverflow 옵션(padding 등)을 상속. 위 "옵션 개념 정리" 참고. **30** `crossAxis`가 `boolean | 'alignment'` 3-상태인 점에 주의.

### 미들웨어 객체 + state 추출 (61–84행)

```ts
export const flip = (options = {}): Middleware => ({
  name: 'flip',
  options,
  async fn(state) {
    const { placement, middlewareData, rects, initialPlacement, platform, elements } = state;
    const {
      mainAxis: checkMainAxis = true,
      crossAxis: checkCrossAxis = true,
      fallbackPlacements: specifiedFallbackPlacements,
      fallbackStrategy = 'bestFit',
      fallbackAxisSideDirection = 'none',
      flipAlignment = true,
      ...detectOverflowOptions
    } = evaluate(options, state);
```

- **68** `placement` = **현재** placement(reset으로 바뀔 수 있음), `initialPlacement` = **원래** 선호 placement. flip은 둘을 구분해서 씀.
- **76–84** 옵션 분해, 나머지는 detectOverflow로 전달.

### ⚠️ arrow 가드 (86–92행)

```ts
if (middlewareData.arrow?.alignmentOffset) {
  return {};
}
```

- arrow가 alignmentOffset을 추가해 reset을 유발한 경우엔 flip이 개입하지 않고 즉시 종료. 두 미들웨어가 서로의 reset을 무한히 유발하는 걸 막는 협조 장치. (issue #2549.)

### 후보 목록 구성 (94–118행)

```ts
const side = getSide(placement);
const initialSideAxis = getSideAxis(initialPlacement);
const isBasePlacement = getSide(initialPlacement) === initialPlacement;
const rtl = await platform.isRTL?.(elements.floating);

const fallbackPlacements =
  specifiedFallbackPlacements ||
  (isBasePlacement || !flipAlignment
    ? [getOppositePlacement(initialPlacement)]
    : getExpandedPlacements(initialPlacement));

const hasFallbackAxisSideDirection = fallbackAxisSideDirection !== 'none';

if (!specifiedFallbackPlacements && hasFallbackAxisSideDirection) {
  fallbackPlacements.push(
    ...getOppositeAxisPlacements(initialPlacement, flipAlignment, fallbackAxisSideDirection, rtl),
  );
}

const placements = [initialPlacement, ...fallbackPlacements];
```

- **96** `isBasePlacement` — 초기 placement에 정렬이 없는 순수 변(`top` 등)인지.
- **99–103** fallback 후보 결정: 사용자가 지정했으면 그걸, 아니면 **base이거나 flipAlignment off면 "반대편 하나"**, 아니면 **정렬 변형 확장**.
- **107–116** `fallbackAxisSideDirection`가 켜졌으면 **수직 축 후보**도 추가 (위아래 다 막히면 좌우로 갈 수 있게).
- **118** ⭐ `placements` = `[초기, ...fallback]` — 순회할 전체 후보 배열. **index가 이 배열을 가리킴.**

### 넘침 측정 + 누적 (120–137행)

```ts
const overflow = await platform.detectOverflow(state, detectOverflowOptions);

const overflows = [];
let overflowsData = middlewareData.flip?.overflows || [];   // ← 과거 누적 읽기

if (checkMainAxis) {
  overflows.push(overflow[side]);                            // side 축 넘침
}
if (checkCrossAxis) {
  const sides = getAlignmentSides(placement, rects, rtl);
  overflows.push(overflow[sides[0]], overflow[sides[1]]);    // 정렬 축 양변 넘침
}

overflowsData = [...overflowsData, {placement, overflows}];  // ← 현재를 덧붙여 누적
```

- **120** `platform.detectOverflow`로 현재 placement의 넘침 측정.
- **126** ⭐ `middlewareData.flip?.overflows`로 **이전 라운드까지의 누적**을 읽음.
- **128–135** 검사할 넘침 값 수집: mainAxis면 side 변, crossAxis면 정렬 축 두 변. `overflows[0]`이 주로 side 축 넘침이 됨.
- **137** ⭐ 과거 + 현재를 합쳐 `overflowsData` 갱신 → 반환 시 data로 저장됨 → 다음 라운드에서 다시 읽힘. (shift.md에서 본 "최신 data가 이긴다" 누적 패턴.)

### ⭐ 핵심 분기: 넘치면 다음 후보로 (139–171행)

```ts
if (!overflows.every((side) => side <= 0)) {       // 한 변이라도 넘침(>0)
  const nextIndex = (middlewareData.flip?.index || 0) + 1;
  const nextPlacement = placements[nextIndex];

  if (nextPlacement) {
    const ignoreCrossAxisOverflow =
      checkCrossAxis === 'alignment'
        ? initialSideAxis !== getSideAxis(nextPlacement)
        : false;

    if (
      !ignoreCrossAxisOverflow ||
      overflowsData.every((d) =>
        getSideAxis(d.placement) === initialSideAxis ? d.overflows[0] > 0 : true,
      )
    ) {
      return {
        data: { index: nextIndex, overflows: overflowsData },
        reset: { placement: nextPlacement },
      };
    }
  }
  // ... (아래 fallback)
```

- **140** `!overflows.every(side <= 0)` = "하나라도 넘쳤다"(부호 규약: 양수면 넘침).
- **141–142** ⭐ `index + 1`로 **다음 후보** 계산. `placements[nextIndex]`가 그 후보.
- **145–148** `crossAxis === 'alignment'`일 때, 축이 다른 후보로 넘어가는 경우 cross축 넘침을 무시할지 결정 (정렬 뒤집기 전용 모드).
- **150–159** 조건이 맞으면 ⭐ **첫 번째 reset 지점**: `reset:{placement: nextPlacement}` + `index`/`overflows` 누적을 data로. → computePosition이 좌표 재계산 + 루프 재실행. **이게 "후보 순회"의 핵심.**

### 후보 소진 후 최적 선택 (173–225행)

```ts
  // First, find the candidates that fit on the mainAxis side...
  let resetPlacement = overflowsData
    .filter((d) => d.overflows[0] <= 0)                       // main축이 안 넘친 후보들
    .sort((a, b) => a.overflows[1] - b.overflows[1])[0]?.placement; // cross축 덜 넘치는 순

  if (!resetPlacement) {                                       // 그래도 없으면 fallback
    switch (fallbackStrategy) {
      case 'bestFit': {
        const placement = overflowsData
          .filter((d) => { /* fallbackAxisSideDirection 편향 처리 */ })
          .map((d) => [d.placement, d.overflows.filter(o => o > 0).reduce((a,o)=>a+o,0)])
          .sort((a, b) => a[1] - b[1])[0]?.[0];               // 총 넘침 최소 후보
        if (placement) resetPlacement = placement;
        break;
      }
      case 'initialPlacement':
        resetPlacement = initialPlacement;
        break;
    }
  }

  if (placement !== resetPlacement) {
    return { reset: { placement: resetPlacement } };
  }
}
return {};
```

- **175–177** ⭐ 1순위 선택: **main축이 안 넘친(`overflows[0] <= 0`) 후보 중, cross축이 가장 덜 넘치는** 것. "일단 주 방향에 맞고, 그다음 정렬 방향 최선".
- **180–216** 그런 후보가 없으면 `fallbackStrategy`:
  - **182–210** `'bestFit'`: 모든 후보의 **양수 넘침 합계**를 구해 최소인 것 선택. (185–195에서 `fallbackAxisSideDirection` 켜졌으면 같은 축/세로축으로 편향.)
  - **211–212** `'initialPlacement'`: 그냥 원래 placement로 복귀.
- **218–224** ⭐ **두 번째 reset 지점**: 최종 선택이 현재와 다르면 `reset:{placement: resetPlacement}`로 확정 이동. 같으면(227) `{}` 반환 → flip 종료, 루프 계속.

> 🔑 **두 reset 지점의 차이:** 첫 번째(161)는 "아직 후보가 남았으니 다음 걸 시도"(순회 중), 두 번째(219)는 "후보를 다 봤고 최선을 골랐으니 거기로 확정"(순회 종료). 둘 다 `reset:{placement}`지만 의미가 다릅니다.

---

## 3부. 전체를 한 흐름으로

```
   computePosition 루프 ──fn(state)──▶ flip.fn
        │
        ▼
   ┌──────────────────────── flip.fn ────────────────────────┐
   │ ① arrow alignmentOffset 가드 → 있으면 {} 반환             │
   │ ② 후보 목록 placements = [초기, ...fallback] 구성         │
   │ ③ detectOverflow로 현재 placement 넘침 측정 + 누적         │
   │ ④ 넘침 있고 다음 후보 있음 → reset:{placement:다음} (순회) │
   │ ⑤ 후보 소진 → main축 맞는 것 중 cross축 최선 선택          │
   │    없으면 fallbackStrategy(bestFit/initial)               │
   │ ⑥ 최종 ≠ 현재 → reset:{placement:최종} (확정)             │
   │    같으면 {} 반환                                          │
   └──────────────────────────────────────────────────────────┘
        │ reset:{placement} → 좌표 재계산 + 루프 재시작 (라운드 반복)
        ▼
```

### 설계 포인트
- **reset:{placement}로 "후보 순회"** — 한 번에 안 끝나고, 라운드마다 다음 후보를 시도하는 수렴 과정. computePosition의 재진입 루프가 이걸 가능케 함.
- **middlewareData.flip에 overflows/index 누적** — reset해도 보존되는 데이터 버스로 "어디까지 봤나"를 기억.
- **두 단계 선택** — 우선 "main축 맞고 cross축 최선", 안 되면 fallbackStrategy. 완벽히 맞는 게 없어도 "최선"을 보장.
- **arrow와의 협조 가드** — 서로의 reset 무한 유발 방지.
- **순수 utils + platform만 의존** — core 행위 모듈 import 없음.

### 한 문장 요약
> `flip`은 **선호 placement가 잘리면 후보들을 `reset:{placement}`로 순서대로 시도하며 넘침을 누적하고, 맞으면 확정 / 다 안 맞으면 가장 덜 넘치는 곳을 고르는** placement 전환 미들웨어다. shift가 "옆으로 밀기"라면 flip은 "반대 면으로 점프".

---

## 다음에 볼 것
- [`shift.md`](shift.md) — placement는 그대로 두고 좌표만 미는 대비 사례
- [`autoPlacement.md`](autoPlacement.md) — flip의 사촌. "반대편으로 뒤집기"가 아니라 "모든 후보 중 최선 선택"
- [`computePosition-architecture.md`](computePosition-architecture.md) — reset 루프와 누적의 원리

## 참고
- 소스: `packages/core/src/middleware/flip.ts`
- 함께 보기: [`shift.md`](shift.md), [`detectOverflow-architecture.md`](detectOverflow-architecture.md)
- 공식 문서: https://floating-ui.com/docs/flip
