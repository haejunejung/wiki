# Floating UI 깊이 읽기 — inline 미들웨어 (한 줄 한 줄)

> 줄바꿈되는 링크나 텍스트 선택처럼 **여러 줄에 걸친 인라인 reference**는 사각형이 하나가 아니라 **여러 개의 ClientRect**입니다. `inline`은 그중 적절한 조각을 골라 툴팁이 올바른 줄을 가리키게 합니다.
>
> 이 글은 **(1) 멘탈 모델과 역할** → **(2) `inline.ts` 한 줄 한 줄** → **(3) 흐름·설계 요약** 순서입니다. 선행 지식: `computePosition`의 **reset 모양**([computePosition-architecture.md](computePosition-architecture.md)), `detectOverflow`의 **ClientRect**([detectOverflow-architecture.md](detectOverflow-architecture.md)).

---

## 1부. 멘탈 모델과 역할

### inline이 푸는 문제

링크가 두 줄에 걸쳐 줄바꿈되면, 그 reference는 **여러 개의 사각형**으로 이뤄집니다. 단일 bounding box로 위치를 잡으면 엉뚱한 빈 공간을 가리킵니다.

```
   ❌ bounding box 기준 (엉뚱한 중앙)        ✅ inline (커서가 있는 줄 조각 기준)

   ...some text [link first        │   ...some text [link first
   part] and second [link          │   part] and second [link
   continues] more text...         │   continues] more text...
              ▲                     │                ▲
        ┌─────┴─────┐               │          ┌─────┴─────┐
        │  TOOLTIP  │ ← 두 줄의      │          │  TOOLTIP  │ ← 실제 조각을 가리킴
        └───────────┘   bounding 중앙 │          └───────────┘
```

### 핵심 특성 — reset:{rects: 객체}

inline은 **새 reference rect를 직접 계산**해서 `reset:{rects: <계산한 객체>}`로 넘깁니다.

| 미들웨어 | reset 모양 | 의미 |
|---|---|---|
| **`inline`** | **`{ rects: 객체 }`** | "내가 새 reference rect를 이미 측정함 → 이 값 써라" |
| `size` | `{ rects: true }` | "크기 바뀜, 새 값 모름 → 플랫폼이 재측정해라" |
| `flip` | `{ placement }` | placement 변경 |

> 🔑 inline이 `true`가 아니라 **객체**를 넘기는 이유 두 가지: ① 이미 자기가 측정/계산을 끝냈으니 플랫폼 재측정은 **낭비**, ② 그냥 측정이 아니라 **특정 조각(줄)을 위한 커스텀 rect**가 필요하므로 그 값을 직접 줘야 함. ([computePosition-architecture.md](computePosition-architecture.md)의 `rects === true ? 재측정 : 객체` 분기 참고.)

### 옵션 개념
- **x, y** (커서 좌표): 어느 조각을 고를지 결정. 보통 마우스 이벤트의 clientX/Y.
- **padding** (기본 2): 조각 선택 시 여유. (마우스 좌표가 ClientRect 경계에서 최대 2px 벗어날 수 있어서.)

### 핵심 멘탈 모델 (한 문장)

> `inline`은 **인라인 reference의 여러 ClientRect를 줄 단위로 묶고, 커서(x,y)나 placement에 따라 적절한 조각의 사각형을 합성한 뒤, `reset:{rects: 그 객체}`로 그 조각 기준 재배치를 트리거하는** 미들웨어다.

---

## 2부. 코드 한 줄 한 줄

### import (1–12행)

```ts
import type {ClientRectObject, Padding} from '@floating-ui/utils';
import { evaluate, getPaddingObject, getSide, getSideAxis, max, min, rectToClientRect } from '@floating-ui/utils';
import type {Derivable, Middleware} from '../types';
```

- **2–10** 순수 utils: `rectToClientRect`(Rect→ClientRect), `min`/`max`, padding 정규화.
- **12** core는 타입만.

### getBoundingRect 헬퍼 (14–25행)

```ts
function getBoundingRect(rects: Array<ClientRectObject>) {
  const minX = min(...rects.map((rect) => rect.left));
  const minY = min(...rects.map((rect) => rect.top));
  const maxX = max(...rects.map((rect) => rect.right));
  const maxY = max(...rects.map((rect) => rect.bottom));
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}
```

- 여러 ClientRect를 **다 감싸는 최소 사각형**(bounding box) 계산. 폴백 및 줄 그룹의 합성에 쓰임.

### ⭐ getRectsByLine 헬퍼 (27–41행)

```ts
export function getRectsByLine(rects: Array<ClientRectObject>) {
  const sortedRects = rects.slice().sort((a, b) => a.y - b.y);
  const groups = [];
  let prevRect: ClientRectObject | null = null;
  for (let i = 0; i < sortedRects.length; i++) {
    const rect = sortedRects[i];
    if (!prevRect || rect.y - prevRect.y > prevRect.height / 2) {
      groups.push([rect]);            // 새 줄 시작
    } else {
      groups[groups.length - 1].push(rect);  // 같은 줄에 추가
    }
    prevRect = rect;
  }
  return groups.map((rect) => rectToClientRect(getBoundingRect(rect)));
}
```

- ⭐ 여러 ClientRect를 **줄(line) 단위로 묶는** 핵심 헬퍼.
  - **28** y좌표로 정렬(위→아래).
  - **33** ⭐ `rect.y - prevRect.y > prevRect.height / 2` — y 차이가 줄 높이 절반보다 크면 **새 줄**로 판단. (조각들이 같은 줄인지 다른 줄인지 구분.)
  - **40** 각 줄 그룹을 하나의 bounding rect로 합쳐 반환 → "줄별 사각형" 배열.

### 옵션 (43–59행)

위 "옵션 개념" 참고. **58** `padding` 기본 2 — 마우스 좌표 오차 보정.

### 팩토리 + ClientRect 수집 (66–84행)

```ts
export const inline = (options = {}): Middleware => ({
  name: 'inline',
  options,
  async fn(state) {
    const {placement, elements, rects, platform, strategy} = state;
    const {padding = 2, x, y} = evaluate(options, state);

    const nativeClientRects = Array.from((await platform.getClientRects?.(elements.reference)) || []);
    const clientRects = getRectsByLine(nativeClientRects);
    const fallback = rectToClientRect(getBoundingRect(nativeClientRects));
    const paddingObject = getPaddingObject(padding);
```

- **76** `padding`, `x`, `y` 옵션 추출.
- **78–80** ⭐ `platform.getClientRects`로 reference의 **모든 ClientRect** 수집(인라인이면 여러 개). → `getRectsByLine`으로 줄별로 묶음. `fallback`은 전체 bounding box.

### ⭐ getBoundingClientRect — 조각 선택 로직 (86–159행)

이 내부 함수가 inline의 두뇌입니다. "어느 조각을 reference로 쓸지" 결정.

```ts
function getBoundingClientRect() {
  // 경우 ①: 두 조각이 떨어져 있고 커서 좌표가 있음
  if (clientRects.length === 2 &&
      clientRects[0].left > clientRects[1].right &&
      x != null && y != null) {
    return clientRects.find((rect) =>
      x > rect.left - paddingObject.left && x < rect.right + paddingObject.right &&
      y > rect.top - paddingObject.top && y < rect.bottom + paddingObject.bottom,
    ) || fallback;
  }
```

- **88–104** ⭐ **경우 ①**: 두 줄이 떨어져 있고(disjoined) 커서 좌표가 있으면, **커서가 들어 있는 조각**을 찾음(padding 여유 포함). 못 찾으면 fallback. (예: 첫 줄 끝과 둘째 줄 시작이 떨어진 링크에서 마우스 위치로 선택.)

```ts
  // 경우 ②: 2개 이상의 연결된 조각
  if (clientRects.length >= 2) {
    if (getSideAxis(placement) === 'y') {     // 세로 배치(top/bottom)
      const firstRect = clientRects[0];
      const lastRect = clientRects[clientRects.length - 1];
      const isTop = getSide(placement) === 'top';
      const top = firstRect.top;
      const bottom = lastRect.bottom;
      const left = isTop ? firstRect.left : lastRect.left;
      const right = isTop ? firstRect.right : lastRect.right;
      // ... width/height
      return { top, bottom, left, right, width, height, x: left, y: top };
    }
    // 가로 배치(left/right)
    const isLeftSide = getSide(placement) === 'left';
    const maxRight = max(...clientRects.map((r) => r.right));
    const minLeft = min(...clientRects.map((r) => r.left));
    const measureRects = clientRects.filter((rect) =>
      isLeftSide ? rect.left === minLeft : rect.right === maxRight);
    // ... top/bottom/left/right
    return { ... };
  }
  return fallback;
}
```

- **107–130** ⭐ **경우 ② 세로 배치**: placement가 top이면 **첫 줄**, bottom이면 **마지막 줄** 기준으로 사각형 합성. (위로 띄우면 첫 줄 위, 아래로 띄우면 마지막 줄 아래를 가리키게.)
- **132–156** **경우 ② 가로 배치**: left면 가장 왼쪽 조각들, right면 가장 오른쪽 조각들 기준으로 합성.
- **158** 그 외(조각 1개 등)는 fallback(전체 bounding box).

### ⭐ 재측정 + reset:{rects: 객체} (161–180행)

```ts
const resetRects = await platform.getElementRects({
  reference: {getBoundingClientRect},     // ← 위에서 만든 커스텀 rect 함수 주입
  floating: elements.floating,
  strategy,
});

if (
  rects.reference.x !== resetRects.reference.x ||
  rects.reference.y !== resetRects.reference.y ||
  rects.reference.width !== resetRects.reference.width ||
  rects.reference.height !== resetRects.reference.height
) {
  return {
    reset: { rects: resetRects },
  };
}
return {};
```

- **161–165** ⭐ `platform.getElementRects`를 **커스텀 reference**(`{getBoundingClientRect}` — 위에서 만든 조각 선택 함수)로 호출 → 선택한 조각 기준의 새 rects를 얻음. **inline이 직접 측정을 끝냄.**
- **167–172** ⚠️ **변경 감지 가드**: 새 reference rect가 기존과 실제로 다를 때만.
- **173–177** ⭐ 다르면 `reset:{rects: resetRects}` — **이미 계산한 객체를 직접** 넘김(`true` 아님). computePosition이 이 rects로 좌표 재계산 + 루프 재실행. **재측정 위임이 아니라 결과 제공.**
- **180** 안 바뀌었으면 종료 (무한 루프 방지).

> 🔑 size(`rects:true`)와의 결정적 대비: size는 "사용자가 얼마로 바꿨는지 몰라 플랫폼에 재측정 위임", inline은 "내가 특정 조각의 rect를 이미 계산했으니 그 객체를 직접 제공". 둘 다 rects를 바꾸지만 **누가 측정 주체인가**가 다릅니다.

---

## 3부. 전체를 한 흐름으로

```
   computePosition 루프 ──fn(state)──▶ inline.fn
        │
        ▼
   ┌─────────────────── inline.fn ───────────────────┐
   │ ① platform.getClientRects → 모든 조각 수집        │
   │ ② getRectsByLine → 줄 단위로 묶음                 │
   │ ③ getBoundingClientRect():                        │
   │    - 떨어진 두 조각 + 커서 → 커서가 든 조각        │
   │    - 연결된 조각 + 세로 배치 → 첫/마지막 줄         │
   │    - 그 외 → fallback (전체 bounding)              │
   │ ④ 커스텀 reference로 getElementRects → resetRects │
   │ ⑤ reference rect 바뀜? → reset:{rects: resetRects}│
   │    안 바뀜 → {}                                   │
   └──────────────────────────────────────────────────┘
        │ reset:{rects:객체} → 그 조각 기준 좌표 재계산 + 루프 재시작
        ▼
```

### 설계 포인트
- **여러 ClientRect → 한 조각 선택** — 인라인 reference의 본질(다중 사각형)을 줄 그룹핑 + 커서/placement 기반 선택으로 해결.
- **rects:객체 = "측정 결과 직접 제공"** — 이미 계산했으니 재측정 위임(`true`) 대신 객체 전달. 낭비 방지 + 커스텀 geometry 필요.
- **변경 시에만 reset** — 무한 루프 방지.
- **순수 utils + platform(getClientRects/getElementRects)만 의존**.

### 한 문장 요약
> `inline`은 **여러 줄에 걸친 인라인 reference의 ClientRect들을 줄 단위로 묶어 커서·placement에 맞는 조각을 합성하고, 그 커스텀 rect를 `reset:{rects: 객체}`로 직접 넘겨 해당 조각 기준으로 재배치시키는** 미들웨어다.

---

## 다음에 볼 것
- [`size.md`](size.md) — `reset:{rects: true}` (inline의 객체 reset과 대비)
- [`shift.md`](shift.md) — 조각 확정 후 위치 보정
- [`computePosition-architecture.md`](computePosition-architecture.md) — rects reset의 두 형태

## 참고
- 소스: `packages/core/src/middleware/inline.ts`
- 함께 보기: [`detectOverflow-architecture.md`](detectOverflow-architecture.md), [`size.md`](size.md)
- 공식 문서: https://floating-ui.com/docs/inline
