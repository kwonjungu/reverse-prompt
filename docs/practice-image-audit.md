# 연습 그림 36장 전수 점검과 수정 프롬프트 (2026-09-27)

36장(L01–L36)을 모두 열어 보고 다음 기준으로 판정했다.

- 제목과 제작 subject에 맞는가
- 핵심 대상을 11살이 흔한 이름으로 바로 부를 수 있는가
- 개수를 정확히 셀 수 있는가
- 단계 목적에 맞는가
- 관계 목록(`src/lib/question-areas.ts`)과 맞는가
- 금지 요소가 없는가(글자·테두리·잘림·AI 결함)
- 제목에 없는데 눈에 띄는 대상이 있는가
- 다른 그림과 헷갈리지 않는가

**2026-09-27에 2절의 12장(교체 7 + 다시 그리기 5)을 새 그림으로 바꿨다**(8절). 3절 선택 3장(L18·L20·L32)과 4절 제목만 고칠 것은 아직 하지 않았다.

## 1. 판정 요약

| 판정 | 문항 |
|---|---|
| 교체 필요 (7) | L03, L12, L15, L17 (이미 정함) · **L08, L33, L36** (새로 발견) |
| 다시 그리기 권장 (5) | L25, L27, **L28, L30, L31** |
| 선택 (3) | L18, L20, L32 |
| 제목만 고침 (그림은 그대로) | L11, L26, L29, L35 (L28은 다시 그릴 때 함께) |
| 그대로 (단서 팩에 적을 것만 있음) | L01, L02, L04, L05, L06, L07, L09, L10, L13, L14, L16, L19, L21, L22, L23, L24, L34 |

심각도 순서:

1. **L30** — 흔들 놀이기구 머리에서 흘러내린 적갈색 녹이 피처럼 보인다(직접 확인함). 아이들 연습 그림으로 부적절하다.
2. **L36** — 물건이 6개(6단계 '정확히 셋' 위반)이고 공이 둘이다. 학교 시계가 12시를 가리켜 노을과 모순된다.
3. **L33** — 물건 5개, 회색 테두리, 책 표지에 가짜 글자가 있다.
4. **L31** — 크림색 테두리가 있고 책 표지에 가짜 글자가 있다.
5. **L08** — 줄무늬 색이 네 가지(파랑·노랑·민트·살구)이고 순서가 불규칙하다. 필수 속성을 깔끔하게 정할 수 없다.

## 2. 교체·다시 그리기 문항

각 프롬프트 끝의 `[STYLE-OBJECT]`·`[STYLE-SCENE]` 자리에 3절의 공통 문구를 그대로 붙여 넣으면 완성형이 된다(Nano Banana 2).

| 문항 | 까닭 | 새 제목 |
|---|---|---|
| L03 | 끈으로 꿰맨 갈색 가죽 공이 축구공으로 보이지 않고 가장자리에 닿음 | 흰색과 검은색 축구공 |
| L08 | 줄무늬 색 넷, 순서 불규칙, 민트와 파랑이 비슷함 | 빨간색과 흰색 줄무늬 머그컵 하나 |
| L12 | 넷째가 네모난 판(타일처럼 보임), 크기 순서가 한 방향이 아님, 화면 아래에 몰림, 흰 금 | 크기가 다른 회색 조약돌 네 개 |
| L15 | 거품·물풀·바닥이 없어 물속인지 알 수 없음(장소 불명) | 물풀 사이를 헤엄치는 주황색 물고기 |
| L17 | 장소 없음, 노란 원이 해로 읽힘. 정한 안("잔디밭")은 L13과 겹쳐 뛰어오를 목표(울타리)를 넣음 | 정원 울타리로 뛰어오르는 회색 고양이 |
| L25 | 조개·불가사리·자갈이 많아 개수가 흐림('셋 이하' 초과) | (그대로) 노을 지는 저녁 바닷가 |
| L27 | 아이 둘이 가로등 불빛 밖에 있어 제목이 틀림, 한 명은 하는 일이 없음, L34(눈·두 아이)와 헷갈림 | 눈 내리는 밤 가로등 아래의 아이 |
| L28 | 책상 8쌍·책장·인형·지도 등 물건이 너무 많음, 금빛이라 아침인지 알 수 없음 | 햇살이 드는 빈 교실 |
| L30 | 피처럼 보이는 녹, 모양이 모호한 흔들 놀이기구 | (그대로) 해 질 무렵 텅 빈 놀이터 |
| L31 | 크림색 테두리, 책 표지 가짜 글자 | (그대로) |
| L33 | 물건 5개, 회색 테두리, 가짜 글자, 복잡한 부엌 | (그대로) 아침 부엌의 아이 |
| L36 | 물건 6개, 공 둘, 12시 시계, 세발자전거 | (그대로) 노을 지는 운동장의 아이 |

### 프롬프트

**L03**
```
A single classic soccer ball with white hexagons and black pentagons, every black pentagon surrounded by white hexagons, round and clearly recognisable as a soccer ball, shown whole and centred with generous white space on all sides; no laces, no logo, no shadow. Pure flat white background. No shadow, no floor line, no background texture whatsoever. [STYLE-OBJECT]
```

**L08**
```
One ceramic mug covered in bold horizontal stripes that alternate between exactly two colours, red and white, with a plain white handle on the right side, shown whole and centred with margin on all sides. Flat single-colour pale grey-blue background with no objects in it. [STYLE-OBJECT]
```

**L12**
```
Exactly four smooth grey pebbles of clearly different sizes lying apart in one horizontal row across the middle of the picture, smallest on the left to largest on the right; every one clearly a rounded stone, none flat or square, plain surface without lines or cracks, all four shown whole. Flat single-colour pale yellow background with no objects in it. [STYLE-OBJECT]
```

**L15**
```
One orange fish swimming sideways underwater between two clumps of tall green water plants, a few small bubbles rising, a sandy bottom visible below, clearly inside the water. A simple underwater background that clearly shows the place, muted blue-green water. [STYLE-SCENE]
```

**L17**
```
One grey cat leaping up from a garden lawn onto the top of a low wooden fence, front paws stretched forward, body in mid-air, the lawn and the fence making the place clear. A simple garden background that clearly indicates the place, no sun, no other animals. [STYLE-SCENE]
```

**L25**
```
An empty sandy seashore at sunset, the orange sun touching the sea, long shadows; exactly two objects: one blue-and-white rowboat lying on the sand in the left foreground and one red-and-white striped lighthouse on rocks in the sea on the right. No people, no animals, no shells, no starfish, no pebbles. Full scene background in which the time of day and the mood are unmistakable. [STYLE-SCENE]
```

**L27**
```
One child in a red knit hat and a green coat standing directly under a glowing street lamp on a snowy park path at night, holding out both mittened hands to catch falling snowflakes; one snow-covered bench beside the lamp. No other people, no animals. Full scene background in which the time of day (night) and the mood are unmistakable. [STYLE-SCENE]
```

**L28**
```
An empty classroom with exactly six wooden desks and chairs in two rows facing a green blackboard, pale bright morning sunlight from two windows on the left casting long window-shaped patches across the desks, one globe on the teacher's desk. No people, no shelves, no toys, no posters, no maps, no clock, nothing written on the blackboard. [STYLE-SCENE]
```

**L30**
```
An empty playground at dusk under a purple-pink sky: one swing frame with two still, empty swings, one blue slide, one sandbox; unlit street lamps, lonely quiet mood. No people, no animals, no rocking animals or spring riders, no rust stains, no red streaks on anything. Full scene background in which the time of day and the mood are unmistakable. [STYLE-SCENE]
```

**L31**
```
One child in a red hoodie sitting on a wooden park bench reading a book whose cover shows only a simple picture, one golden dog sitting beside the child on the bench, the sun setting behind low hills; on the grass in front of the bench exactly three everyday objects: one yellow backpack, one blue water bottle, one green apple. Nothing else on the ground. [STYLE-SCENE]
```

**L33**
```
One child sitting at a wooden kitchen table eating a slice of toast held in one hand, pale morning sunlight through a window behind; on the table exactly three everyday objects: one glass of milk, one white plate, one red apple. Plain wall behind, no sink, no plants, no jars, no books, no knives. [STYLE-SCENE]
```

**L36**
```
One child standing in the middle of an empty dirt schoolyard at sunset, holding one red ball with both hands, a plain school building without any clock on the left, a low orange sun behind a fence, the long shadow of the child; around the child on the ground exactly three everyday objects: one blue backpack, one water bottle, one jump rope. No other balls, no bicycles, no tricycles, no watering can, no toys, no lines drawn on the ground. [STYLE-SCENE]
```

### 선택 (지금 그림으로도 쓸 수 있음)

**L18** — 장소가 '막연한 초록 비탈'이다. 빨간 우산과 노란 우비 조합이 L32와 같다. 새 제목: 비 오는 날 다리를 건너는 아이.
```
One child in a green raincoat holding an open red umbrella, walking across a small wooden bridge over a stream in the rain; the bridge and the stream make the place clear. No other people, no animals. [STYLE-SCENE]
```

**L20** — 파란 받침과 노란 면이 '탁자·벽'으로 읽혀 관계 해당 없음과 흔들린다. 해당 없음을 유지하려면 받침 없이 단색 배경으로 만든다.
```
One polished silver metal kettle with a black handle and a black lid knob, bright shiny highlights, shown whole and centred with margin. Flat single-colour pale yellow background with no objects in it, no table, no surface line. [STYLE-OBJECT]
```

**L32** — 흰 여백 테두리가 있다. 잘라 내면 쓸 수 있으나 해상도가 약 880px로 떨어진다. 다시 그릴 때:
```
Two children standing close on a wet sidewalk sharing one red umbrella in the rain, one in a blue raincoat, one in a yellow raincoat, puddles around; on the ground exactly three objects: one paper boat, one rubber duck, one fallen yellow flower. Nothing else on the ground. [STYLE-SCENE]
```

## 3. 공통 문구 (STYLE) — 옛 문구에서 바꾼 점

옛 공통 문구가 일으킨 문제는 셋이다.

- "fills the entire canvas edge to edge"가 물건 하나짜리 그림을 가장자리까지 키웠다(L03·L11).
- 테두리 금지를 어긴 그림이 나왔다(L31·L32·L33).
- 책 표지와 시계에 글자·숫자가 생겼다(L31·L33·L36).

물건 하나짜리와 장면을 나눈다.

**[STYLE-OBJECT]** (1·2단계, L20)
```
Children's educational illustration, soft digital painting with clearly visible surface texture, even neutral lighting, simple and unambiguous composition, the whole object visible with clear margin on every side, nothing cropped, no text, no letters, no numbers, no logos, no brand marks, no picture frame, no border, no white margin frame, no mat, high detail on the main subject.
```

**[STYLE-SCENE]** (3–6단계)
```
Children's educational illustration, soft digital painting with clearly visible surface texture, simple and unambiguous composition, the illustration fills the entire canvas edge to edge with no border, no frame, no white or coloured margin, no text, no letters, no numbers, no logos, no signage, no clocks, book covers show pictures only, not a real identifiable person, no violence, no blood-like stains, high detail on the main subject, every countable object clearly separate and fully visible.
```

- 4단계(L13–L18)는 옛 배경 문구 BG[3]("suggesting one place, at most two plain background shapes") 때문에 장소가 약했다. 위 프롬프트는 장소를 subject에 직접 적었다.
- 2단계 배경색은 무작위로 네 장이 보라 계열이 되었다. 새 프롬프트는 대상과 대비되는 색을 문항마다 적었다.

## 4. 제목만 고칠 것 (그림은 그대로)

| 문항 | 지금 제목 | 제안 | 까닭 |
|---|---|---|---|
| L11 | 커다란 보라색 나비 한 마리 | 날개를 활짝 편 보라색 나비 한 마리 | 비교 대상이 없어 '커다란'을 확인할 수 없음 |
| L26 | 비 오는 날 창가 | 비 오는 날 창가에서 자는 고양이 | 주인공(고양이)이 제목에 없음 |
| L29 | 안개 낀 이른 아침 숲길 | 안개 낀 아침 숲길의 토끼 | 주인공(토끼)이 제목에 없음 |
| L35 | 오후 도서관의 아이 | 도서관에서 책을 꺼내는 아이 | '오후'를 그림으로 확인할 수 없음 |
| (선택) L02 | 접힌 노란 우산 | 닫힌 노란 우산 | '접이식'으로 읽힐 수 있음 |

제목은 학생 화면에 나오지 않는다(교사·관리 화면의 표시 이름). 다만 연구자가 보는 이름이라 그림과 맞춘다. 제작 subject(`practice-source-prompts.ts`)도 L26·L27·L29는 실제 그림과 다르므로 함께 고친다.

## 5. 그대로 쓰는 그림 — 단서 팩에 적을 것

그림을 바꾸지 않아도 되지만, 단서 팩을 실제 그림을 보고 써야 판정이 흔들리지 않는다.

- **색 이름 허용 범위** — 제목과 그림의 색이 조금씩 다르다.

  | 문항 | 허용할 색 이름 |
  |---|---|
  | L04 | 하늘색·파란색 |
  | L05 화분 | 주황·갈색 |
  | L06 | 은색·회색 |
  | L10 | 연노랑·베이지 |
  | L22 | 갈색·회갈색·회색 |
  | L24 | 초록·연두·민트 |

- **이름 허용 범위**

  | 문항 | 정할 것 |
  |---|---|
  | L07 | 공·구슬은 인정하고 오렌지는 불인정 |
  | L09 | 병·유리병, 술병 인정 여부 |
  | L19 | 방석·쿠션·매트 |
  | L23 | 줄 있는 종이 |
  | 새 L03 | '공'만 써도 되는지 |

- **자세 수준의 행동도 행동으로 인정** — L14 앉아 있음, L19 잠, L21 무릎을 감싸고 앉음, L29 길에 앉아 있음.
- **제목에 없지만 학생이 쓸 만한 것은 선택 속성으로** — 써도 벌점 없음, 안 써도 감점 없음.
  - L01 노란 기운, L02 갈색 손잡이, L05 흰 점·흙, L11 눈·흰 점
  - L16 화분·부엉이 표지, L21 옷 여러 가지, L22 이끼
  - L35 빈백 3개
- **L21 필수 속성** — '갈색 골덴 바지(줄 결)'와 '파란 니트 후드' 가운데 하나로 정하고, 다른 옷을 쓴 것도 인정하는지 적는다.
- **시간대** — 그림으로 확인할 수 없는 것(L26·L28·L32·L34·L35)은 필수 정보에 넣지 않는다(시간대는 원래 선택).
- **그림자** — 장소가 아니다. A밴드 관계는 대상끼리의 위치로만 본다.

## 6. 여러 그림에 걸친 점

- **풀밭이 많다.** 교체안까지 합치면 L13·L17·L18·L21·L22가 풀밭이라 4단계(관계)에서 '잔디밭에서'가 틀처럼 굳을 수 있다. 그래서 L17은 울타리 위, L18은 다리로 바꾸자고 제안했다.
- **노을이 많다.** L25·L30·L31·L36 네 장이 노을·해 질 무렵이다. '노을'만으로는 그림을 가를 수 없지만, 시간대는 선택 정보라 채점에는 영향이 적다.
- **같은 소품·같은 아이가 반복된다.** 먹다 만 사과, 물뿌리개, 가방이 여러 그림에 나오고, 같은 곱슬머리 아이가 L31·L33·L35·L36에 나온다. 한 그림 안에서 모호해지지는 않는다.
- **L16과 L31** — 둘 다 아이가 책을 읽는 그림이지만 장소가 달라 관계 연습에는 좋은 대비다.

## 7. 그림을 받으면 한 커밋에서 바꿀 파일

1. `public/questions/Lxx.jpg` — 교체 그림(1024×1024, 테두리·잘림 없는지 확인)
2. `src/lib/questions.ts` — `koreanTitle`
3. `src/server/registry/practice-source-prompts.ts` — subject(위 프롬프트의 대상 부분), 필요하면 공통 문구를 3절로
4. `scripts/print-practice-hints.mjs` — `A_RELATION`(L12)·`NOTES`(L03·L12·L17·L20·L23·L27·L28·L30 등)·예전 초안 → `npm run hints:table`
5. `src/lib/lecture-questions.ts` — 연수 20문항에 든 문항이면 제목 확인
6. 비공개 단서 팩 — 새 그림을 직접 보고 해당 문항을 다시 쓰고 `cueVersion`을 올린다
7. 시험 — 제목·해시를 고정한 시험(`tests/hints.test.ts`의 제목 낱말 전수 점검은 자동으로 새 제목을 본다)

관계 목록은 바뀌지 않는다. L20은 해당 없음 그대로(선택안이면 더 분명해진다), L22·L24·L25·L28·L30은 사물·풍경 그대로다.

## 8. 교체 결과 (2026-09-27)

2절의 12장을 새로 만들어 바꿨다: L03, L08, L12, L15, L17, L25, L27, L28, L30, L31, L33, L36.

**만든 방법**
- 모델: `gemini-3.1-flash-image`(Nano Banana 2). 응답의 `modelVersion`도 같았다.
- Gemini Batch API로 요청했다(표준가의 50%). 1:1, 1K로 받아 1024×1024 progressive JPEG로 저장했다.
- 프롬프트: 2절 문장 + 3절 공통 문구 그대로다. 실제로 보낸 문자열은 `src/server/registry/practice-source-prompts.ts`의 `REMADE`에 있다.
  `tests/practice-images.test.ts`가 그 기록이 이 문서와 같은지 확인한다.
- 한 장씩 만들어 직접 확인하고, 어긋난 두 장만 끝에 한 문장을 덧붙여 다시 만들었다.
  - L12: 첫 그림은 돌이 달걀처럼 세워져 있고, 가장 작은 돌에 얼룩무늬가 있어 메추리알처럼 보였다. → "납작하게 누운, 무늬 없는 회색" 문장을 덧붙였다.
  - L36: 첫 그림은 아이 그림자가 두 갈래로 갈라져 있었다. → "그림자 하나" 문장을 덧붙였다.
- 비용: 14장, 배치 기준 약 $0.6.

**확인한 것(그림마다)**
- 제목과 맞는가
- 개수: 6단계는 물건 정확히 셋, L28은 책상 여섯 쌍
- 글자·숫자·테두리·잘림이 없는가
- 시계가 없는가
- 핏자국처럼 보이는 얼룩이 없는가
- 장소가 보이는가: L15 물속, L17 정원 울타리

**남은 작은 점** (쓰는 데 문제는 없다고 봤다)
- L17: 오른쪽 위 집 벽에 갈색으로 얼룩진 판자가 있다.
- L25: 등대 바위 오른쪽 끝에 작은 방파제 일부가 보인다.
- L28: 교탁 뒤에 의자가 하나 더 있다(책상·의자 여섯 쌍과 별도).
- L30: 뒤쪽 건물 창문에 불이 켜져 있다(가로등은 꺼짐).
- L36: 땅에 바퀴 자국과 작은 자갈이 조금 있다. 그림자는 두 다리 그림자가 몸 그림자로 이어진다.

**아직 할 것**
- 비공개 단서 팩: 12문항을 새 그림을 직접 보고 다시 쓰고 `cueVersion`을 올린다(7절 6).
- 4절 제목만 고칠 것(L11·L26·L29·L35)과 3절 선택(L18·L20·L32).
