# Floating UI 깊이 읽기 — hide 미들웨어 (한 줄 한 줄)

> `hide`는 floating과 reference의 **공간적 관계가 깨졌을 때**(reference가 스크롤되어 사라졌거나, floating이 reference 영역을 벗어났을 때) 이를 **감지**해 데이터로 알려줍니다. 좌표를 고치지 않고, "숨겨야 하는 상황"인지만 판단합니다.
>
> 이 글은 **(1) 멘탈 모델과 역할** → **(2) `hide.ts` 한 줄 한 줄** → **(3) 흐름·설계 요약** 순서입니다. 선행 지식: [`detectOverflow-architecture.md`](detectOverflow-architecture.md)의 **`elementContext` vs `altBoundary`** 교차 검사 절. (hide는 그 개념의 실물 사용처입니다.)

---

## 1부. 멘탈 모델과 역할

### hide가 푸는 문제

floating은 흔히 portal로 `document.body`에 렌더되어 **reference와 다른 클리핑 컨텍스트(방)**에 삽니다. 그래서 두 가지 어긋남이 생길 수 있습니다.

**① referenceHidden — 버튼이 스크롤되어 사라짐**
```
   ┌──── reference의 방 ────┐
   │  ░░░░░░░░░░░░░░░░  │ ← [REFERENCE]가 스크롤로 방 밖, 안 보임
   └─────────────────────┘
        ┌─────────────┐
        │  TOOLTIP    │  ← body에 있어 멀쩡히 보임 = 유령 툴팁
        └─────────────┘
```

**② escaped — 툴팁이 버튼 영역을 벗어남**
```
   ┌──── reference의 방 ────┐
   │  [REFERENCE]          │
   └───────────────────────┘
            ╎
       ┌─────────┐  ╎ ← TOOLTIP이 reference의 방을 완전히 벗어남
       │ TOOLTIP │  ╎    = 버튼과 동떨어진 허공 툴팁
       └─────────┘  ╎
```

`hide`는 이 둘을 **감지**해 `referenceHidden`/`escaped` 불리언을 제공합니다. 그러면 사용자가 floating을 숨길 수 있습니다.

### 핵심 특성 — 감지(detect), 수정(fix) 아님

| | `hide` | `shift`/`flip`/`size` |
|---|---|---|
| 좌표 변경 | ❌ 없음 | ✅ 있음 |
| reset | ❌ 없음 | 경우에 따라 |
| 반환 | **`data`만** (불리언 + offsets) | 좌표/reset |
| 역할 | "숨겨야 하나?" **판단** | 위치 **보정** |

> 🔑 hide는 **위치를 고치지 않습니다.** "관계가 깨졌다"는 사실만 `data`로 알리고, **실제 숨김은 사용자 코드**가 합니다:
> ```js
> if (middlewareData.hide?.referenceHidden) floatingEl.style.visibility = 'hidden';
> ```

### 두 전략과 detectOverflow의 두 축

hide의 두 전략은 [detectOverflow-architecture.md](detectOverflow-architecture.md)에서 본 **교차 검사**의 실물입니다:

| 전략 | 검사 대상(elementContext) | 기준 경계 | detectOverflow 옵션 |
|---|---|---|---|
| `referenceHidden` | reference | reference의 방 | `elementContext: 'reference'` |
| `escaped` | floating | **reference의 방** (altContext) | `altBoundary: true` |

### 핵심 멘탈 모델 (한 문장)

> `hide`는 **detectOverflow를 교차 검사 모드로 호출해 "reference가 가려졌는지(referenceHidden)" 또는 "floating이 reference 영역을 벗어났는지(escaped)"를 불리언으로 감지해 `data`로만 제공하는** 미들웨어다. 숨기는 행위는 사용자 몫.

---

## 2부. 코드 한 줄 한 줄

### import (1–5행)

```ts
import type {Rect, SideObject} from '@floating-ui/utils';
import {evaluate, sides} from '@floating-ui/utils';
import type {DetectOverflowOptions} from '../detectOverflow';
import type {Derivable, Middleware} from '../types';
```

- **2** `sides` = `['top','right','bottom','left']` 배열 (네 변 순회용). `evaluate`로 Derivable 지원.
- **4–5** core는 타입만.

### ⭐ getSideOffsets 헬퍼 (7–14행)

```ts
function getSideOffsets(overflow: SideObject, rect: Rect) {
  return {
    top: overflow.top - rect.height,
    right: overflow.right - rect.width,
    bottom: overflow.bottom - rect.height,
    left: overflow.left - rect.width,
  };
}
```

- ⭐ detectOverflow의 넘침 값에서 **요소 자신의 크기를 뺍니다.** 왜? "요소가 **완전히** 경계 밖으로 나갔는가"를 판단하기 위함.
  - `overflow.top`은 "위로 넘친 양". 거기서 요소 높이를 빼서 `>= 0`이면 → **요소 전체가** 위 경계 위로 사라졌다는 뜻.
  - 즉 "부분적으로 잘림"이 아니라 "완전히 가려짐"의 기준선으로 변환.

### isAnySideFullyClipped 헬퍼 (16–18행)

```ts
function isAnySideFullyClipped(overflow: SideObject) {
  return sides.some((side) => overflow[side] >= 0);
}
```

- ⭐ 네 변 중 **하나라도** `>= 0`이면 true = "어느 한 방향으로 요소가 완전히 가려졌다". getSideOffsets 결과를 받아 "숨김 여부" 불리언으로.

### 옵션 (20–25행)

```ts
export interface HideOptions extends DetectOverflowOptions {
  strategy?: 'referenceHidden' | 'escaped';
}
```

- **24** `strategy` — 두 전략 중 선택. 기본은 `referenceHidden`(40행).

### 팩토리 + 전략 분기 (32–45행)

```ts
export const hide = (options = {}): Middleware => ({
  name: 'hide',
  options,
  async fn(state) {
    const {rects, platform} = state;
    const {strategy = 'referenceHidden', ...detectOverflowOptions} = evaluate(options, state);
    switch (strategy) {
```

- **38** `rects`(요소 크기, getSideOffsets에 필요)와 `platform` 추출.
- **40** `strategy` 기본값 + 나머지 옵션은 detectOverflow로.
- **45** 전략별 분기.

### ⭐ referenceHidden 전략 (46–58행)

```ts
case 'referenceHidden': {
  const overflow = await platform.detectOverflow(state, {
    ...detectOverflowOptions,
    elementContext: 'reference',
  });
  const offsets = getSideOffsets(overflow, rects.reference);
  return {
    data: {
      referenceHiddenOffsets: offsets,
      referenceHidden: isAnySideFullyClipped(offsets),
    },
  };
}
```

- **47–50** ⭐ `elementContext: 'reference'`로 detectOverflow 호출 → **reference가 자기 방에서** 얼마나 넘쳤는지 측정. ("가구"를 reference로 지정.)
- **51** `getSideOffsets(overflow, rects.reference)` — reference 크기를 빼서 "완전히 가려짐" 기준으로 변환.
- **52–57** `data`만 반환: `referenceHidden` 불리언 + 상세 offsets. **좌표·reset 없음.**

### ⭐ escaped 전략 (59–71행)

```ts
case 'escaped': {
  const overflow = await platform.detectOverflow(state, {
    ...detectOverflowOptions,
    altBoundary: true,
  });
  const offsets = getSideOffsets(overflow, rects.floating);
  return {
    data: {
      escapedOffsets: offsets,
      escaped: isAnySideFullyClipped(offsets),
    },
  };
}
```

- **60–63** ⭐ `altBoundary: true`로 호출 → **floating을 *reference의* 방 기준으로** 측정. (검사 대상은 floating(기본 elementContext), 경계는 altContext=reference.) 이게 "floating이 reference 영역을 벗어났는가"를 재는 교차 검사.
- **64** 이번엔 `rects.floating`(floating 크기)을 빼서 "floating이 완전히 벗어났는지" 기준으로.
- **65–70** `data`만: `escaped` 불리언 + offsets.

### default (72–74행)

```ts
default: { return {}; }
```

- 알 수 없는 전략이면 아무것도 안 함.

---

## 3부. 전체를 한 흐름으로

```
   computePosition 루프 ──fn(state)──▶ hide.fn
        │
        ▼
   ┌──────────────────── hide.fn ────────────────────┐
   │ strategy === 'referenceHidden':                  │
   │   detectOverflow({elementContext:'reference'})   │
   │   → getSideOffsets(_, rects.reference)            │
   │   → data:{ referenceHidden: bool }               │
   │                                                  │
   │ strategy === 'escaped':                          │
   │   detectOverflow({altBoundary:true})             │
   │   → getSideOffsets(_, rects.floating)             │
   │   → data:{ escaped: bool }                        │
   └──────────────────────────────────────────────────┘
        │ 좌표·reset 없음 → 다음 미들웨어로
        ▼
   사용자: if (middlewareData.hide?.referenceHidden) → 숨김
```

### 설계 포인트
- **감지 전용 (detect, not fix)** — 위치를 안 고치고 불리언만 제공. 숨김 정책은 사용자에게 위임 (유연성 + 단일 책임).
- **detectOverflow의 두 축 활용** — `elementContext`/`altBoundary`로 "무엇을 / 무엇에 대해" 검사할지 바꿔 두 전략 구현. (그 개념의 실물 사용처.)
- **"완전히 가려짐" 기준** — getSideOffsets가 요소 크기를 빼 부분 잘림이 아닌 완전 소실을 판정.
- **데이터 버스로 소통** — `middlewareData.hide`에 결과만 남김.
- **순수 함수 + platform(detectOverflow)만 의존**.

### 한 문장 요약
> `hide`는 **detectOverflow를 교차 검사 모드(elementContext/altBoundary)로 호출해 reference 가림(referenceHidden)이나 floating 이탈(escaped)을 불리언으로 감지하고 `data`로만 제공하는** 감지 미들웨어다. 실제 숨김은 사용자가 한다.

---

## 다음에 볼 것
- [`detectOverflow-architecture.md`](detectOverflow-architecture.md) — elementContext/altBoundary 교차 검사의 원리 (hide의 토대)
- [`shift.md`](shift.md) / [`flip.md`](flip.md) — 위치를 "고치는" 보정과의 대비

## 참고
- 소스: `packages/core/src/middleware/hide.ts`
- 함께 보기: [`detectOverflow-architecture.md`](detectOverflow-architecture.md)
- 공식 문서: https://floating-ui.com/docs/hide
