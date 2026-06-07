# Floating UI 깊이 읽기 — offset 미들웨어 (한 줄 한 줄)

> `offset`은 floating을 reference로부터 **일정 거리 떨어뜨리거나(간격) 모서리를 따라 비끼는(skidding)** 가장 기본적인 보정입니다. 툴팁과 버튼 사이 8px 여백 같은 게 전부 이 미들웨어의 일입니다.
>
> 이 글은 **(1) 멘탈 모델과 역할** → **(2) `offset.ts` 한 줄 한 줄** → **(3) 흐름·설계 요약** 순서입니다. 선행 지식: [`shift.md`](shift.md), `computeCoordsFromPlacement`의 축/정렬/RTL 개념([computePosition-architecture.md](computePosition-architecture.md)).

---

## 1부. 멘탈 모델과 역할

### offset이 푸는 문제

순수 좌표 계산은 floating을 reference에 **딱 붙여** 놓습니다. 보통은 약간의 간격을 원합니다.

```
   offset 없음 (딱 붙음)            offset({mainAxis: 8})

   ┌──────────┐                    ┌──────────┐
   │ TOOLTIP  │                    │ TOOLTIP  │
   ├──────────┤  ← 붙음             └──────────┘
   │REFERENCE │                       ↕ 8px 간격
   └──────────┘                    ┌──────────┐
                                   │REFERENCE │
                                   └──────────┘
```

- **mainAxis** (간격/거리): reference에서 멀어지는 방향. `bottom`이면 아래로.
- **crossAxis** (skidding/비낌): 모서리를 따라 옆으로.
- **alignmentAxis**: crossAxis와 같은 축이지만 **정렬된 placement에만** 적용되고 `end` 정렬에서 부호가 뒤집힘.

### 핵심 특성

| 특성 | 설명 |
|---|---|
| 좌표 변경 | **직접** `x/y`에 더함 (shift처럼) |
| reset | ❌ 없음 — 좌표만 반환 |
| 실행 순서 | **가장 먼저** 두는 게 보통 (기준 좌표를 옮기므로 뒤 미들웨어가 그 위에서 동작) |
| 데이터 제공 | `middlewareData.offset` 생성 → **limitShift·arrow가 참조** |

> 🔑 offset은 placement도 rects도 안 건드리므로 reset이 필요 없습니다. 단지 좌표를 `diffCoords`만큼 옮길 뿐. 그래서 **미들웨어 배열 맨 앞**에 두어 "기준점 자체를 이동"시키고, flip/shift가 그 이동된 좌표 위에서 충돌을 처리하게 합니다.

### 핵심 멘탈 모델 (한 문장)

> `offset`은 **placement·축·정렬·RTL을 고려해 사용자가 준 거리값을 올바른 방향의 `{x, y}` 변위로 바꿔 좌표에 더하는** 미들웨어다. reset 없이 좌표만 옮기고, 그 변위를 `middlewareData.offset`으로 남겨 limitShift·arrow가 쓰게 한다.

---

## 2부. 코드 한 줄 한 줄

### import (1–10행)

```ts
import { type Coords, evaluate, getAlignment, getSide, getSideAxis } from '@floating-ui/utils';
import {originSides} from '../constants';
import type {Derivable, Middleware, MiddlewareState} from '../types';
```

- **1–7** 순수 utils: `getAlignment`(start/end 추출), `getSide`, `getSideAxis`.
- **9** `originSides` = `Set(['left','top'])` — 좌표 원점(작은 값) 쪽 변 판별용. mainAxis 부호 결정에 쓰임.
- **10** core는 타입만.

### offset 값 타입 (12–43행)

```ts
type OffsetValue =
  | number                            // 숫자 = mainAxis 거리 단축
  | { mainAxis?: number; crossAxis?: number; alignmentAxis?: number | null };

export type OffsetOptions = OffsetValue | Derivable<OffsetValue>;
```

- **13** 숫자면 mainAxis(간격) 단축.
- **21/27/38** 객체면 축별 세밀 지정. `alignmentAxis`(38)는 "crossAxis인데 정렬 placement 전용 + end에서 반전" — 주석대로 설정 시 crossAxis를 override.
- **43** Derivable도 허용.

### ⭐ convertValueToCoords — 방향 계산의 핵심 (45–76행)

```ts
export async function convertValueToCoords(state, options): Promise<Coords> {
  const {placement, platform, elements} = state;
  const rtl = await platform.isRTL?.(elements.floating);

  const side = getSide(placement);
  const alignment = getAlignment(placement);
  const isVertical = getSideAxis(placement) === 'y';
  const mainAxisMulti = originSides.has(side) ? -1 : 1;
  const crossAxisMulti = rtl && isVertical ? -1 : 1;
  const rawValue = evaluate(options, state);

  let {mainAxis, crossAxis, alignmentAxis} =
    typeof rawValue === 'number'
      ? {mainAxis: rawValue, crossAxis: 0, alignmentAxis: null}
      : { mainAxis: rawValue.mainAxis || 0, crossAxis: rawValue.crossAxis || 0,
          alignmentAxis: rawValue.alignmentAxis };

  if (alignment && typeof alignmentAxis === 'number') {
    crossAxis = alignment === 'end' ? alignmentAxis * -1 : alignmentAxis;
  }

  return isVertical
    ? {x: crossAxis * crossAxisMulti, y: mainAxis * mainAxisMulti}
    : {x: mainAxis * mainAxisMulti, y: crossAxis * crossAxisMulti};
}
```

이 함수가 offset의 두뇌입니다. "거리값(스칼라) → 방향 있는 변위(`{x,y}`)" 변환.

- **52–54** placement에서 side/alignment/축 추출.
- **55** ⭐ `mainAxisMulti = originSides.has(side) ? -1 : 1` — **간격의 방향 부호**. `top`/`left` 배치면 floating이 reference보다 **작은 좌표 쪽**에 있으므로, 멀어지려면 좌표를 **빼야**(−1) 함. `bottom`/`right`면 더함(+1).
  ```
     top 배치: 간격을 늘리려면 floating을 위(작은 y)로 → y에서 빼기 (−1)
     bottom 배치: 간격을 늘리려면 floating을 아래(큰 y)로 → y에 더하기 (+1)
  ```
- **56** `crossAxisMulti = rtl && isVertical ? -1 : 1` — **RTL + 세로 배치**일 때 cross(가로) 방향을 반전. (computeCoordsFromPlacement의 `rtl && isVertical` 부호 반전과 동일 논리.)
- **57–67** 값 정규화: 숫자면 `{mainAxis: 값}`, 객체면 누락 축 0.
- **69–71** ⭐ `alignmentAxis`가 숫자면 crossAxis를 대체하되, **`end` 정렬이면 부호 반전**. 정렬 기준 skidding을 직관적으로 다루기 위함.
- **73–75** ⭐ 축 매핑: **세로 배치(top/bottom)면 mainAxis=y, crossAxis=x**. 가로 배치(left/right)면 반대. 각 축에 곱셈자(부호)를 적용해 최종 `{x,y}` 변위 반환.

### offset 팩토리 + fn (85–110행)

```ts
export const offset = (options: OffsetOptions = 0): Middleware => ({
  name: 'offset',
  options,
  async fn(state) {
    const {x, y, placement, middlewareData} = state;
    const diffCoords = await convertValueToCoords(state, options);

    if (placement === middlewareData.offset?.placement &&
        middlewareData.arrow?.alignmentOffset) {
      return {};
    }

    return {
      x: x + diffCoords.x,
      y: y + diffCoords.y,
      data: { ...diffCoords, placement },
    };
  },
});
```

- **85** 기본값이 `0` (간격 없음).
- **90** `convertValueToCoords`로 변위 계산.
- **94–99** ⚠️ 가드: placement가 그대로이고 arrow가 alignmentOffset을 만든 상황이면 **재적용하지 않음** (flip의 arrow 가드와 같은 협조 — 중복 offset 방지).
- **101–108** ⭐ 반환:
  - **102–103** `x/y`에 변위를 **직접 더함** (reset 아님).
  - **104–107** ⭐ `data: {...diffCoords, placement}` — **변위(x,y)와 당시 placement**를 `middlewareData.offset`에 저장. limitShift(cross축 한계 계산)와 arrow가 이걸 참조. placement를 같이 저장하는 건 위 94행의 변경 감지에 쓰기 위함.

> 🔑 offset의 본체는 짧습니다. 복잡함은 전부 `convertValueToCoords`의 **"방향 부호 결정"**에 있습니다 — placement·RTL·정렬에 따라 거리값이 +x인지 −y인지가 달라지기 때문.

---

## 3부. 전체를 한 흐름으로

```
   computePosition 루프 ──fn(state)──▶ offset.fn (보통 맨 앞)
        │
        ▼
   ┌─────────────────── offset.fn ───────────────────┐
   │ ① convertValueToCoords:                          │
   │    거리값 → 방향 있는 {x,y} 변위                   │
   │    (mainAxisMulti, crossAxisMulti, 정렬/RTL 부호) │
   │ ② arrow alignmentOffset 가드                      │
   │ ③ x += diff.x, y += diff.y (직접 이동, reset 없음)│
   │ ④ data: { x, y, placement } 저장                  │
   └──────────────────────────────────────────────────┘
        │ reset 없음 → 다음 미들웨어가 "이동된 좌표" 위에서 동작
        ▼  (limitShift / arrow가 middlewareData.offset 참조)
```

### 설계 포인트
- **거리 → 방향 변환에 복잡함 집중** — placement·RTL·정렬에 따른 부호를 `convertValueToCoords`가 전담. 본체는 단순 덧셈.
- **reset 없는 기준 이동** — 맨 앞에서 좌표를 옮겨 뒤 미들웨어의 출발점을 바꿈.
- **데이터 버스 협력** — `middlewareData.offset`을 남겨 limitShift(분리 한계)·arrow가 간격을 인지. 미들웨어 직접 참조 없이 데이터로 소통.
- **순수 utils + platform(isRTL)만 의존**.

### 한 문장 요약
> `offset`은 **사용자가 준 거리값을 placement·정렬·RTL에 맞는 `{x,y}` 변위로 바꿔 좌표에 더하는** 기본 보정이다. reset 없이 기준점을 옮기고, 그 변위를 데이터로 남겨 다른 미들웨어가 활용한다.

---

## 다음에 볼 것
- [`shift.md`](shift.md) / [`limitShift.md`](limitShift.md) — `middlewareData.offset`을 소비하는 쪽
- [`arrow.md`](arrow.md) — alignmentOffset로 offset과 협조
- [`flip.md`](flip.md) — placement를 바꾸는 reset 보정

## 참고
- 소스: `packages/core/src/middleware/offset.ts`
- 함께 보기: [`limitShift.md`](limitShift.md), [`computePosition-architecture.md`](computePosition-architecture.md)
- 공식 문서: https://floating-ui.com/docs/offset
