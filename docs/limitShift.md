# Floating UI 깊이 읽기 — limitShift (한 줄 한 줄)

> `shift`가 floating을 시야 안으로 **무한정 밀** 때, `limitShift`는 "이 이상 밀면 reference에서 떨어진다"는 한계에서 **멈추게** 하는 limiter입니다.
>
> 이 글은 **(1) 멘탈 모델과 역할**을 먼저 잡고, **(2) `shift.ts`의 `limitShift` 부분(106–216행)을 한 줄 한 줄** 설명합니다. 선행 지식: [`shift.md`](shift.md)(특히 limiter 호출부 86행), `detectOverflow`.

---

## 1부. 멘탈 모델과 역할

### limitShift가 푸는 문제

`shift`는 넘침을 없애려고 floating을 모서리 따라 계속 밉니다. 그런데 reference가 화면 구석으로 많이 치우치면, shift가 floating을 **reference에서 완전히 떨어진 곳**까지 밀어버릴 수 있습니다.

```
   ❌ limitShift 없이 (shift가 끝까지 밀어버림):

   ┌──────────────── 화면 ────────────────┐
   │ ┌──────────────┐         [REFERENCE] │  ← 버튼은 오른쪽 끝
   │ │   TOOLTIP    │                      │  ← 툴팁은 시야 위해 왼쪽 끝까지 밀림
   │ └──────────────┘                      │     → 버튼과 완전히 분리! 허공을 가리킴
   └───────────────────────────────────────┘
```

`limitShift`는 "floating과 reference가 **겨우 한 점이라도 겹치는** 마지막 위치"를 계산해, shift가 그 너머로 밀려고 해도 거기서 잡습니다.

```
   ✅ limitShift 적용 (분리 직전에서 멈춤):

   ┌──────────────── 화면 ────────────────┐
   │              ┌──────────────┐ [REFERENCE]
   │              │   TOOLTIP    │└──┘       │  ← 끝자락이 겹치는 선까지만 밀림
   │              └──────────────┘           │     (살짝 잘려도 연결은 유지)
   └───────────────────────────────────────┘
```

### shift와 limitShift의 관계 — 책임 분리

| | `shift` | `limitShift` |
|---|---|---|
| 역할 | "넘침만큼 **민다**" | "너무 밀지 않게 **잡는다**" |
| 형태 | 미들웨어(`{name, fn}`) | limiter(`{options, fn}`) — shift의 옵션으로 주입 |
| 호출 | computePosition 루프가 부름 | **shift가 자기 안에서** 부름 ([shift.ts:86](../../packages/core/src/middleware/shift.ts#L86)) |
| 기본값 | — | shift 기본 limiter는 **항등 함수**(제한 없음). `limitShift()`를 명시해야 작동 |

> 🔑 "민다(shift)"와 "너무 밀지 마라(limitShift)"를 **다른 함수로 쪼갠** 게 설계의 핵심입니다. 단일 책임 + 합성: shift는 미는 로직만, limitShift는 한계 로직만. 사용자는 `shift({ limiter: limitShift() })`로 둘을 조립합니다.

### 핵심 멘탈 모델 (한 문장)

> `limitShift`는 **reference와 floating의 rect로 "둘이 겨우 겹치는 좌표 범위 [limitMin, limitMax]"를 계산하고, shift가 민 좌표를 그 범위로 가두는** limiter다. 범위를 벗어나면 한계값으로 고정해 분리를 막는다.

### "겹치는 마지막 위치"란 (그림)

mainAxis(미끄러짐 축)에서 floating이 reference와 겹칠 수 있는 좌표의 양 끝:

```
   limitMin: floating의 끝이 reference 시작에 겨우 닿음
     ┌──────────┐
     │ FLOATING │[REFERENCE]
     └──────────┘
     ↑ floating.x = reference.x − floating.width

   limitMax: floating의 시작이 reference 끝에 겨우 닿음
              [REFERENCE]┌──────────┐
                         │ FLOATING │
                         └──────────┘
              ↑ floating.x = reference.x + reference.width
```

이 두 좌표 사이에 있으면 "겹침 유지". 벗어나면 "분리" → 한계로 되돌림.

---

## 2부. 코드 한 줄 한 줄 (shift.ts 106–216행)

### offset 타입 (106–119행)

```ts
type LimitShiftOffset =
  | number
  | {
      mainAxis?: number;   // 정렬 축 한계 시작점 보정
      crossAxis?: number;  // side 축 한계 시작점 보정
    };
```

- **106–119** `offset`이 받을 수 있는 형태: **숫자**(mainAxis에만 적용) 또는 **객체**(축별 지정). "숫자 단축 + 객체 세밀제어"를 둘 다 허용하는 정규화 패턴 (detectOverflow의 padding, shift의 offset과 동일 철학).

### 옵션 인터페이스 (121–138행)

```ts
export interface LimitShiftOptions {
  offset?: LimitShiftOffset | Derivable<LimitShiftOffset>;
  mainAxis?: boolean;   // 정렬 축 제한 (기본 true)
  crossAxis?: boolean;  // side 축 제한 (기본 true)
}
```

- **128** `offset` — **제한이 시작되는 지점**을 옮김. 주석대로 `0`이면 "reference와 floating의 반대 변이 정렬될 때" 제한 시작. `+`면 더 일찍 멈추고(겹침을 더 많이 남김), `−`면 더 늦게 멈춤. Derivable도 허용.
- **133/137** main/cross 축 각각 제한 on/off. **둘 다 기본 켜짐**(shift의 checkCrossAxis 기본 꺼짐과 대비 — limiter는 양축 다 잡는 게 기본).

### limiter 객체 (143–150행)

```ts
export const limitShift = (
  options: LimitShiftOptions | Derivable<LimitShiftOptions> = {},
): {
  options: any;
  fn: (state: MiddlewareState) => Coords;
} => ({
  options,
  fn(state) {
```

- **143–144** `limitShift(options)` — limiter를 생성하는 **팩토리**. 옵션은 객체/Derivable, 기본 `{}`.
- **145–148** 반환 형태가 `{options, fn}` — 미들웨어(`{name, fn}`)와 **다른 모양**. limiter는 name이 없고, shift가 `limiter.fn(...)`으로 직접 부름.
- **149** `options` — 그대로 보관 (디버깅·재참조용).
- **150** `fn(state)` — [shift.ts:86](../../packages/core/src/middleware/shift.ts#L86)이 호출하는 함수. shift가 이미 클램핑한 좌표를 state에 담아 넘겨줌.

### 상태 추출 (151행)

```ts
const {x, y, placement, rects, middlewareData} = state;
```

- shift와 달리 **`rects`와 `middlewareData`**를 꺼냄:
  - `rects` — reference/floating의 크기·위치. **한계 계산의 핵심 재료.**
  - `middlewareData` — `offset` 미들웨어가 만든 간격 데이터를 참조하기 위함(아래 196/201행).
- (shift처럼 `platform`/`detectOverflow`는 안 씀 — limitShift는 넘침이 아니라 **기하학적 한계**만 계산하므로 측정이 불필요. 순수 산수.)

### 옵션 분해 (153–157행)

```ts
const {
  offset = 0,
  mainAxis: checkMainAxis = true,
  crossAxis: checkCrossAxis = true,
} = evaluate(options, state);
```

- **154** `offset` 기본 `0`.
- **155–156** 양축 제한 기본 켜짐.
- `evaluate(options, state)` — Derivable이면 먼저 실행.

### 축·좌표 초기화 (159–164행)

```ts
const coords = {x, y};
const crossAxis = getSideAxis(placement);
const mainAxis = getOppositeAxis(crossAxis);

let mainAxisCoord = coords[mainAxis];
let crossAxisCoord = coords[crossAxis];
```

- **160** `crossAxis = getSideAxis(placement)` — side 축(거리 축). bottom이면 `'y'`. (shift와 동일 정의.)
- **161** `mainAxis` — 반대(미끄러짐 축). bottom이면 `'x'`.
- **163–164** shift가 이미 민 좌표를 가변 변수로. 이제 이걸 한계 안으로 되돌릴 것.

### offset 정규화 (166–170행)

```ts
const rawOffset = evaluate(offset, state);
const computedOffset =
  typeof rawOffset === 'number'
    ? {mainAxis: rawOffset, crossAxis: 0}
    : {mainAxis: 0, crossAxis: 0, ...rawOffset};
```

- **166** offset이 Derivable이면 실행해 실제 값 추출.
- **167–170** 숫자면 `{mainAxis: 숫자, crossAxis: 0}`, 객체면 누락 축을 0으로 채워 `{mainAxis, crossAxis}`로 통일. (106행 타입의 두 형태를 단일 객체로 정규화.)

### ⭐ mainAxis 제한 (172–188행) — limitShift의 핵심

```ts
if (checkMainAxis) {
  const len = mainAxis === 'y' ? 'height' : 'width';
  const limitMin =
    rects.reference[mainAxis] - rects.floating[len] + computedOffset.mainAxis;
  const limitMax =
    rects.reference[mainAxis] + rects.reference[len] - computedOffset.mainAxis;

  if (mainAxisCoord < limitMin) {
    mainAxisCoord = limitMin;
  } else if (mainAxisCoord > limitMax) {
    mainAxisCoord = limitMax;
  }
}
```

- **172** mainAxis 제한이 켜져 있을 때만.
- **173** mainAxis가 `'x'`면 `len = 'width'` — 그 축 방향의 길이 속성.
- **174–177** `limitMin` = **floating 끝이 reference 시작에 겨우 닿는 좌표**.
  - `rects.reference[mainAxis]` = reference 시작 좌표(예: reference.x)
  - `− rects.floating[len]` = floating 길이만큼 왼쪽으로 → floating의 *오른쪽 끝*이 reference 시작과 일치하는 floating.x
  - `+ computedOffset.mainAxis` = 한계 시작점을 안쪽으로 당김(겹침 더 남김)
- **178–181** `limitMax` = **floating 시작이 reference 끝에 겨우 닿는 좌표**.
  - `reference 시작 + reference 길이` = reference 끝
  - `− offset` = 안쪽으로 당김
- **183–187** 수동 clamp — `mainAxisCoord`가 범위 밖이면 한계값으로 고정. (shift는 `clamp()` 함수를 썼지만, 여기선 if/else로 직접.)

> 🔑 limitMin/limitMax = 1부 그림의 "겹치는 마지막 두 위치". shift가 이 범위를 넘겨 밀었으면 → 범위 끝으로 되돌려 **분리 방지**. offset은 그 한계선을 앞당기거나 미룸.

### crossAxis 제한 (190–209행)

```ts
if (checkCrossAxis) {
  const len = mainAxis === 'y' ? 'width' : 'height';
  const isOriginSide = originSides.has(getSide(placement));
  const limitMin =
    rects.reference[crossAxis] -
    rects.floating[len] +
    (isOriginSide ? middlewareData.offset?.[crossAxis] || 0 : 0) +
    (isOriginSide ? 0 : computedOffset.crossAxis);
  const limitMax =
    rects.reference[crossAxis] +
    rects.reference[len] +
    (isOriginSide ? 0 : middlewareData.offset?.[crossAxis] || 0) -
    (isOriginSide ? computedOffset.crossAxis : 0);

  if (crossAxisCoord < limitMin) {
    crossAxisCoord = limitMin;
  } else if (crossAxisCoord > limitMax) {
    crossAxisCoord = limitMax;
  }
}
```

- **191** cross 축의 길이 속성. (mainAxis가 'y'면 cross는 'x'라 `len='width'`.)
- **192** `isOriginSide = originSides.has(getSide(placement))` — placement의 변이 **`left` 또는 `top`인가?** (`originSides = new Set(['left','top'])`, [constants.ts](../../packages/core/src/constants.ts).)
  - `left`/`top`은 좌표계 **원점(작은 값) 쪽** 변. `right`/`bottom`은 반대(큰 값) 쪽.
  - 이 방향 차이 때문에 offset과 `middlewareData.offset` 보정을 더할지/뺄지가 갈립니다. 그 비대칭을 삼항으로 처리.
- **193–197** `limitMin` — main축과 같은 골격(`reference 시작 − floating 길이`)에:
  - `isOriginSide`면 **offset 미들웨어가 만든 간격**(`middlewareData.offset?.[crossAxis]`)을 더하고,
  - 아니면 **사용자 offset**(`computedOffset.crossAxis`)을 더함.
- **198–202** `limitMax` — 대칭적으로 반대 항을 적용 (origin 여부에 따라 더하는 항이 뒤바뀜).
- **204–208** 수동 clamp.

> 💡 cross축이 main축보다 복잡한 이유: cross는 reference와의 *거리* 방향이라, **`offset` 미들웨어가 만든 간격**까지 한계 계산에 반영해야 정확합니다. (offset이 10px 띄웠으면 그만큼 한계도 이동.) origin 쪽/반대 쪽이 부호가 달라 삼항이 두 번 등장.

### 반환 (211–215행)

```ts
return {
  [mainAxis]: mainAxisCoord,
  [crossAxis]: crossAxisCoord,
} as Coords;
```

- 한계로 가둔 좌표를 `{x, y}`(계산된 키)로 반환 → [shift.ts:86](../../packages/core/src/middleware/shift.ts#L86)의 `limitedCoords`가 되어 shift의 최종 반환에 반영됨.

---

## 3부. 전체를 한 흐름으로

```
   shift.fn 내부 (clamp으로 1차로 밈)
        │  limiter.fn({ ...state, [축]: 클램핑된좌표 })
        ▼
   ┌──────────────────── limitShift.fn ────────────────────┐
   │ ① rects로 축 결정 (mainAxis/crossAxis)                  │
   │ ② offset 정규화                                         │
   │ ③ mainAxis: [limitMin, limitMax] 계산 → 벗어나면 고정    │
   │ ④ crossAxis: offset 미들웨어 간격까지 반영해 한계 계산    │
   │ ⑤ return { x, y } (분리 직전으로 되돌린 좌표)            │
   └────────────────────────────────────────────────────────┘
        │
        ▼  shift가 이 좌표를 최종 반환
```

### 설계 포인트
- **책임 분리** — "밀기(shift)"와 "한계(limitShift)"를 분리. shift는 limiter를 *주입*받아 합성 (Strategy 패턴).
- **순수 산수** — detectOverflow(측정) 없이 rects만으로 기하학적 한계 계산. → 빠르고 결정적.
- **opt-in** — 기본은 무제한(항등 limiter). 분리 방지가 필요할 때만 `limitShift()` 주입.
- **offset 인지** — cross축 한계가 `middlewareData.offset`을 참조해, offset 미들웨어와 협력(데이터 버스를 통한 디커플링된 통신).

### 한 문장 요약
> `limitShift`는 **reference/floating rect로 "둘이 겨우 겹치는 좌표 범위"를 구해, shift가 민 좌표를 그 범위로 가두는** opt-in limiter다. 시야 확보를 위해 미는 shift가 floating을 reference에서 떼어내지 않도록 잡아주는 균형추.

---

## 다음에 볼 것
- [`shift.md`](shift.md) — limitShift를 호출하는 본체
- [offset.ts](../../packages/core/src/middleware/offset.ts) — cross축 한계가 참조하는 `middlewareData.offset`을 만드는 쪽
- [flip.ts](../../packages/core/src/middleware/flip.ts) — `reset:{placement}` 보정

## 참고
- 소스: `packages/core/src/middleware/shift.ts` (`limitShift` export, 106–216행)
- 함께 보기: [`shift.md`](shift.md), `detectOverflow-architecture.md`, `computePosition-architecture.md`
- 공식 문서: https://floating-ui.com/docs/shift#limitshift
