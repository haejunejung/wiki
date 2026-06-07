# Floating UI 깊이 읽기 — autoPlacement 미들웨어 (한 줄 한 줄)

> `flip`이 "선호 placement가 잘리면 반대편으로 뒤집기"라면, `autoPlacement`는 **선호 placement 없이, 모든 후보를 시도해 가장 공간이 넓은 곳을 자동 선택**합니다. flip의 사촌이지만 선택 전략이 다릅니다.
>
> 이 글은 **(1) 멘탈 모델과 역할** → **(2) `autoPlacement.ts` 한 줄 한 줄** → **(3) 흐름·설계 요약** 순서입니다. 선행 지식: [`flip.md`](flip.md), `computePosition`의 **reset 루프·누적**([computePosition-architecture.md](computePosition-architecture.md)).

---

## 1부. 멘탈 모델과 역할

### autoPlacement가 푸는 문제

"어디에 둘지 미리 정하기 애매한" 경우, 모든 후보 placement를 돌며 **가장 잘 맞는 곳**을 고릅니다.

```
   후보들을 모두 시도 → 넘침 측정 → 최선 선택

         top
          │
   left ─[REF]─ right       각 방향(+정렬 변형)을 한 라운드씩 시도하며
          │                 넘침을 기록 → 가장 공간 넓은 곳으로 확정
        bottom
```

### flip과의 결정적 차이

| | `autoPlacement` | `flip` |
|---|---|---|
| 선호 placement | **없음** (모든 후보가 동등) | 있음 (선호 → 안 되면 반대) |
| 선택 기준 | **모든 후보 중 가장 공간 넓은 것** | 선호가 맞으면 유지, 아니면 반대/fallback |
| 공통점 | 둘 다 `reset:{placement}`로 후보 순회 + `middlewareData`에 넘침/index 누적 | 〃 |

> 🔑 두 미들웨어는 **메커니즘이 같습니다** — `reset:{placement}`로 라운드를 돌며 후보별 넘침을 누적하고, 마지막에 선택. 다른 건 **"무엇을 고르냐"**: flip은 "선호 우선", autoPlacement는 "최대 공간".

### 옵션 개념
- **allowedPlacements** (기본 전체): 후보 집합.
- **alignment** (기본 undefined): 특정 정렬(start/end)만 고를지.
- **autoAlignment** (기본 true): 선호 정렬이 안 맞으면 반대 정렬도 허용.
- **crossAxis** (기본 false): 점수 계산에 cross축 공간도 볼지.

### 핵심 멘탈 모델 (한 문장)

> `autoPlacement`는 **후보 placement들을 `reset:{placement}`로 하나씩 순회하며 각 후보의 넘침을 누적하고, 다 본 뒤 "모든 변이 들어맞는 것 우선, 없으면 공간 가장 넓은 것"을 선택하는** 미들웨어다.

---

## 2부. 코드 한 줄 한 줄

### import (1–12행)

```ts
import type {Alignment, Placement} from '@floating-ui/utils';
import { evaluate, getAlignment, getAlignmentSides, getOppositeAlignmentPlacement,
         getSide, placements as ALL_PLACEMENTS } from '@floating-ui/utils';
import type {DetectOverflowOptions} from '../detectOverflow';
import type {Derivable, Middleware} from '../types';
```

- **8** `ALL_PLACEMENTS` — 12개 전체 placement 배열 (기본 후보).
- **5–6** `getAlignmentSides`(정렬 축 두 변), `getOppositeAlignmentPlacement`(반대 정렬).
- **11–12** core는 타입만.

### ⭐ getPlacementList 헬퍼 (14–42행)

```ts
export function getPlacementList(alignment, autoAlignment, allowedPlacements) {
  const allowedPlacementsSortedByAlignment = alignment
    ? [ ...allowedPlacements.filter((p) => getAlignment(p) === alignment),
        ...allowedPlacements.filter((p) => getAlignment(p) !== alignment) ]
    : allowedPlacements.filter((p) => getSide(p) === p);   // 정렬 없는 순수 변만

  return allowedPlacementsSortedByAlignment.filter((placement) => {
    if (alignment) {
      return getAlignment(placement) === alignment ||
        (autoAlignment ? getOppositeAlignmentPlacement(placement) !== placement : false);
    }
    return true;
  });
}
```

- ⭐ 후보 목록을 만드는 헬퍼.
  - **19–28** `alignment`가 있으면 그 정렬 후보를 앞에 정렬, 없으면 **순수 변(top/right/bottom/left)만** (정렬 변형 제외).
  - **30–41** alignment 지정 시: 그 정렬이거나(autoAlignment면 반대 정렬도) 허용. 즉 "원하는 정렬 우선, autoAlignment면 반대도".

### 옵션 인터페이스 (44–68행)

위 "옵션 개념" 참고. `extends DetectOverflowOptions`로 padding 등 상속.

### 팩토리 + 후보 결정 (76–100행)

```ts
export const autoPlacement = (options = {}): Middleware => ({
  name: 'autoPlacement',
  options,
  async fn(state) {
    const {rects, middlewareData, placement, platform, elements} = state;
    const { crossAxis = false, alignment, allowedPlacements = ALL_PLACEMENTS,
            autoAlignment = true, ...detectOverflowOptions } = evaluate(options, state);

    const placements =
      alignment !== undefined || allowedPlacements === ALL_PLACEMENTS
        ? getPlacementList(alignment || null, autoAlignment, allowedPlacements)
        : allowedPlacements;

    const overflow = await platform.detectOverflow(state, detectOverflowOptions);
```

- **84–90** 옵션 분해.
- **92–95** ⭐ 후보 배열 `placements` 결정: alignment 지정됐거나 기본 전체면 `getPlacementList`로 가공, 아니면 사용자가 준 allowedPlacements 그대로.
- **97** `platform.detectOverflow`로 **현재** placement 넘침 측정.

### 현재 후보 + index (102–107행)

```ts
const currentIndex = middlewareData.autoPlacement?.index || 0;
const currentPlacement = placements[currentIndex];

if (currentPlacement == null) {
  return {};
}
```

- **102–103** ⭐ `middlewareData.autoPlacement.index`로 **지금 몇 번째 후보**인지 (누적 상태). 그 index의 후보가 `currentPlacement`.
- **105–107** 후보를 다 벗어났으면(null) 종료.

### ⭐ 시작점 정렬 (109–122행)

```ts
const alignmentSides = getAlignmentSides(currentPlacement, rects, await platform.isRTL?.(elements.floating));

// Make `computeCoords` start from the right place.
if (placement !== currentPlacement) {
  return { reset: { placement: placements[0] } };
}
```

- **109** 현재 후보의 정렬 축 두 변 계산.
- **116–122** ⚠️ 만약 실제 placement가 currentPlacement와 다르면(첫 진입 등) **첫 후보로 reset**해서 좌표 계산을 올바른 시작점에 맞춤. (순회를 placements[0]부터 일관되게 시작.)

### 넘침 누적 (124–133행)

```ts
const currentOverflows = [
  overflow[getSide(currentPlacement)],   // side 축 넘침
  overflow[alignmentSides[0]],           // 정렬 축 변1
  overflow[alignmentSides[1]],           // 정렬 축 변2
];

const allOverflows = [
  ...(middlewareData.autoPlacement?.overflows || []),     // ← 과거 누적
  {placement: currentPlacement, overflows: currentOverflows},  // ← 현재 추가
];
```

- **124–128** 현재 후보의 넘침 3종(side + 정렬 양변) 수집.
- **130–133** ⭐ 과거 누적 + 현재를 합쳐 `allOverflows`. (flip과 동일한 "데이터 버스 누적" 패턴.)

### ⭐ 다음 후보로 순회 (135–148행)

```ts
const nextPlacement = placements[currentIndex + 1];

if (nextPlacement) {
  return {
    data: { index: currentIndex + 1, overflows: allOverflows },
    reset: { placement: nextPlacement },
  };
}
```

- **135** 다음 후보.
- **138–148** ⭐ **첫 reset 지점**: 다음 후보가 있으면 `index+1`과 누적을 data에 담고 `reset:{placement: nextPlacement}` → 다음 라운드. **이게 "모든 후보 순회"의 엔진.**

### ⭐ 최종 선택 (150–190행)

```ts
const placementsSortedByMostSpace = allOverflows
  .map((d) => {
    const alignment = getAlignment(d.placement);
    return [
      d.placement,
      alignment && crossAxis
        ? d.overflows.slice(0, 2).reduce((acc, v) => acc + v, 0)  // side + cross
        : d.overflows[0],                                         // side만
      d.overflows,
    ] as const;
  })
  .sort((a, b) => a[1] - b[1]);     // 넘침 적은 순 (공간 넓은 순)

const placementsThatFitOnEachSide = placementsSortedByMostSpace.filter(
  (d) => d[2].slice(0, getAlignment(d[0]) ? 2 : 3).every((v) => v <= 0),
);

const resetPlacement =
  placementsThatFitOnEachSide[0]?.[0] || placementsSortedByMostSpace[0][0];

if (resetPlacement !== placement) {
  return {
    data: { index: currentIndex + 1, overflows: allOverflows },
    reset: { placement: resetPlacement },
  };
}
return {};
```

- **150–163** ⭐ 모든 후보를 **넘침이 적은(=공간 넓은) 순으로 정렬**. crossAxis 옵션이면 점수에 cross축 넘침도 합산, 아니면 side축만.
- **165–175** ⭐ `placementsThatFitOnEachSide` — **모든 검사 변이 안 넘치는(`<= 0`) 후보**만 필터. (정렬 있으면 2변, 없으면 3변 검사.)
- **177–178** ⭐ 최종 선택: **완전히 맞는 후보가 있으면 그중 1순위(공간 최대), 없으면 전체 중 가장 공간 넓은 것**.
- **180–189** ⭐ **둘째 reset 지점**: 최종 선택이 현재와 다르면 `reset:{placement: resetPlacement}`로 확정 이동. 같으면(192) 종료.

> 🔑 flip과 같은 **두 reset 지점 구조**: 첫째(139)는 "다음 후보 순회 중", 둘째(181)는 "다 보고 최선 확정". 차이는 선택 로직 — autoPlacement는 "완전히 맞는 것 중 공간 최대, 없으면 공간 최대".

---

## 3부. 전체를 한 흐름으로

```
   computePosition 루프 ──fn(state)──▶ autoPlacement.fn
        │
        ▼
   ┌─────────────────── autoPlacement.fn ───────────────────┐
   │ ① 후보 목록 placements 구성 (getPlacementList)          │
   │ ② index로 currentPlacement 결정                         │
   │ ③ detectOverflow → 현재 후보 넘침 측정 + 누적            │
   │ ④ 다음 후보 있음 → reset:{placement:다음} (순회)         │
   │ ⑤ 다 봄 → 넘침 적은 순 정렬 → "모두 맞는 것 중 최대공간,  │
   │    없으면 전체 최대공간" 선택                            │
   │ ⑥ 최종 ≠ 현재 → reset:{placement:최종} (확정)           │
   └─────────────────────────────────────────────────────────┘
        │ reset:{placement} → 좌표 재계산 + 루프 재시작 (라운드 반복)
        ▼
```

### 설계 포인트
- **flip과 메커니즘 공유, 선택 전략만 차이** — 둘 다 reset:{placement} 순회 + 누적. "선호 우선(flip)" vs "최대 공간(autoPlacement)".
- **두 단계 선택** — "완전히 맞는 후보 우선, 없으면 공간 최대"로 항상 최선 보장.
- **index/overflows 누적** — reset 보존 데이터 버스로 순회 상태 기억.
- **순수 utils + platform(detectOverflow/isRTL)만 의존**.

### 한 문장 요약
> `autoPlacement`는 **선호 없이 후보 placement들을 `reset:{placement}`로 순회·누적한 뒤, 모든 변이 맞는 것 중 가장 공간 넓은(없으면 전체 중 최대 공간) placement를 자동 선택하는** 미들웨어다. flip의 "선호 우선"과 대비되는 "최대 공간 우선".

---

## 다음에 볼 것
- [`flip.md`](flip.md) — 같은 메커니즘, "선호 우선" 전략 (직접 대조)
- [`shift.md`](shift.md) — placement 확정 후 미세 위치 보정
- [`computePosition-architecture.md`](computePosition-architecture.md) — reset 순회·누적 원리

## 참고
- 소스: `packages/core/src/middleware/autoPlacement.ts`
- 함께 보기: [`flip.md`](flip.md), [`detectOverflow-architecture.md`](detectOverflow-architecture.md)
- 공식 문서: https://floating-ui.com/docs/autoPlacement
