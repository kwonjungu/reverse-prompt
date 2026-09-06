/**
 * 연습 모드 문항의 단일 진실 공급원 — practice 페이지와 admin 감수 페이지가 공유.
 *
 * 이미지는 사전 제작·검수한 정적 파일(public/questions/L01.jpg ~ L36.jpg)을 쓴다.
 * 실행 중 생성하지 않으므로 학습자에게는 검수된 이미지만 제시된다.
 *
 * sourcePrompt는 그 이미지를 생성할 때 쓴 원 프롬프트다. 연구 자료로만 기록하며
 * 학습자에게 노출하지 않는다. 원 프롬프트는 정답 문장이 아니므로, 이미지에 실제로
 * 구현되지 않은 요구는 채점 기준에서 제외한다.
 *
 * 차시와 밴드 (논문 <표 III-5> 밴드 전환의 확정 명세)
 *   1차시 Lv.1~6   대상 명칭      A밴드
 *   2차시 Lv.7~12  색·모양·크기   A밴드
 *   3차시 Lv.13~18 배경·행동      B밴드
 *   4차시 Lv.19~24 질감·자세      B밴드
 *   5차시 Lv.25~30 시간대·분위기   C밴드
 *   6차시 Lv.31~36 3축 종합       C밴드
 *
 * 문항을 고치면 문항이미지_명세.json과 public/questions/ 이미지도 함께 갱신할 것.
 */

export type PracticeQuestion = {
  level: number;
  chasi: number;
  koreanTitle: string;
  sourcePrompt: string;
  rubric: string;
  imageUrl: string;
};

const GUIDE: Record<number, string> = {
  1: `이 그림을 한 번도 못 본 친구에게 문자로 보낸다면?

무엇이 있는지 이름을 정확하게 써 봐요. 그림 하나로 딱 정해지는 이름일수록 좋아요!`,
  2: `눈을 감고도 떠올릴 수 있게 설명해 봐요.

색깔, 모양, 크기, 개수까지 써 주면 그림이 하나로 좁혀져요.`,
  3: `어디에서 무엇을 하고 있는지까지 써 봐요.

대상의 이름과 색·모양에 더해, 배경과 행동을 함께 알려 주세요.`,
  4: `만져 본 느낌과 자세까지 말해 봐요.

반질반질한지 거친지, 어떤 자세인지, 배경은 어떤 곳인지 함께 써 주세요.`,
  5: `언제인지, 어떤 느낌인지 담아 써 봐요.

분위기를 쓸 때는 그림 속 무엇 때문에 그렇게 느꼈는지 근거도 함께 써 주세요.`,
  6: `지금까지 배운 것을 모두 넣어 써 봐요.

무엇이 있는지, 어떻게 생겼는지, 어디에서 언제 어떤 느낌인지 — 세 가지를 빠짐없이!`,
};

const STYLE =
  "Children's educational illustration, soft digital painting with clearly visible surface texture, " +
  'even neutral lighting, simple and unambiguous composition, no text, no letters, no numbers, ' +
  'no logos, no brand marks, no signage, not a real identifiable person, no violence, ' +
  'the illustration fills the entire canvas edge to edge, no picture frame, no border, no mat, ' +
  'not a photo of a framed painting, high detail on the main subject.';

const BG: Record<number, string> = {
  1: 'Pure flat white background. No shadow, no floor line, no background texture whatsoever.',
  2: 'Flat single-colour pastel background with no objects in it.',
  3: 'Very simple background suggesting one place, with at most two plain background shapes.',
  4: 'A simple background that clearly indicates one place with at most two plain background shapes, muted so that it does not compete with the subject texture.',
  5: 'Full scene background in which the time of day and the mood are unmistakable. Besides the setting itself the scene contains at most three clearly separable objects.',
  6: 'Full scene background with a clear time of day. Around the figure there are exactly three everyday objects and nothing else; keep the scene uncluttered.',
};

const raw: { level: number; chasi: number; koreanTitle: string; subject: string }[] = [
  { level:  1, chasi: 1, koreanTitle: "빨간 사과 한 개", subject: "A single glossy red apple, stem visible." },
  { level:  2, chasi: 1, koreanTitle: "접힌 노란 우산", subject: "A folded yellow umbrella lying flat." },
  { level:  3, chasi: 1, koreanTitle: "갈색 가죽 축구공", subject: "A brown leather ball with visible stitched seams." },
  { level:  4, chasi: 1, koreanTitle: "파란 물뿌리개", subject: "A blue metal watering can." },
  { level:  5, chasi: 1, koreanTitle: "초록 선인장 화분", subject: "A small round green cactus in a terracotta pot." },
  { level:  6, chasi: 1, koreanTitle: "은색 열쇠 하나", subject: "A single silver key." },
  { level:  7, chasi: 2, koreanTitle: "크기가 다른 주황색 공 세 개", subject: "Three orange balls of clearly different sizes in a row." },
  { level:  8, chasi: 2, koreanTitle: "줄무늬 머그컵 하나", subject: "One mug with bold horizontal stripes." },
  { level:  9, chasi: 2, koreanTitle: "길쭉한 초록 병과 짧은 갈색 병", subject: "One tall slim green glass bottle beside one short wide brown bottle." },
  { level: 10, chasi: 2, koreanTitle: "별 모양 쿠키 다섯 개", subject: "Five yellow star-shaped cookies arranged apart from each other." },
  { level: 11, chasi: 2, koreanTitle: "커다란 보라색 나비 한 마리", subject: "One large purple butterfly with wings fully open." },
  { level: 12, chasi: 2, koreanTitle: "크고 작은 회색 돌 네 개", subject: "Four grey stones of clearly different sizes." },
  { level: 13, chasi: 3, koreanTitle: "잔디밭에서 뛰는 갈색 강아지", subject: "A small brown puppy running on grass, legs mid-stride." },
  { level: 14, chasi: 3, koreanTitle: "나뭇가지에 앉은 파란 새", subject: "A blue bird perched on a bare branch." },
  { level: 15, chasi: 3, koreanTitle: "헤엄치는 주황색 물고기", subject: "An orange fish swimming underwater, fins spread." },
  { level: 16, chasi: 3, koreanTitle: "책상에 앉아 책을 읽는 아이", subject: "A child sitting at a desk reading an open book." },
  { level: 17, chasi: 3, koreanTitle: "공중으로 뛰어오르는 회색 고양이", subject: "A grey cat leaping upward with front paws stretched." },
  { level: 18, chasi: 3, koreanTitle: "우산을 쓰고 걷는 아이", subject: "A child walking while holding an open umbrella." },
  { level: 19, chasi: 4, koreanTitle: "웅크리고 자는 흰 고양이", subject: "A fluffy white cat curled up asleep, individual fur strands visible." },
  { level: 20, chasi: 4, koreanTitle: "반질반질한 금속 주전자", subject: "A polished metal kettle with bright specular highlights." },
  { level: 21, chasi: 4, koreanTitle: "무릎을 굽히고 앉은 아이", subject: "A child crouching with knees bent and arms around the knees." },
  { level: 22, chasi: 4, koreanTitle: "거친 나무껍질의 나무 밑동", subject: "The base of a thick tree trunk with deeply rough bark." },
  { level: 23, chasi: 4, koreanTitle: "구겨진 종이비행기", subject: "A crumpled paper plane with sharp creases and folds." },
  { level: 24, chasi: 4, koreanTitle: "젖어서 축 늘어진 수건", subject: "A soaked towel hanging limp and heavy, dripping." },
  { level: 25, chasi: 5, koreanTitle: "노을 지는 저녁 바닷가", subject: "An empty seashore at sunset, warm orange sky, long shadows." },
  { level: 26, chasi: 5, koreanTitle: "비 오는 날 창가", subject: "A window with rain streaks, grey daylight outside, calm quiet mood." },
  { level: 27, chasi: 5, koreanTitle: "눈 내리는 밤 가로등 아래", subject: "A street lamp at night with snow falling through its light." },
  { level: 28, chasi: 5, koreanTitle: "아침 햇살이 드는 교실", subject: "An empty classroom with bright morning sunlight across the desks." },
  { level: 29, chasi: 5, koreanTitle: "안개 낀 이른 아침 숲길", subject: "A forest path in early morning fog, soft pale light." },
  { level: 30, chasi: 5, koreanTitle: "해 질 무렵 텅 빈 놀이터", subject: "An empty playground at dusk, swings still, lonely mood." },
  { level: 31, chasi: 6, koreanTitle: "저녁 공원 벤치의 아이와 강아지", subject: "One child sitting on a park bench reading, a dog beside, at dusk." },
  { level: 32, chasi: 6, koreanTitle: "비 오는 날 우산을 나눠 쓴 두 아이", subject: "Two children sharing one umbrella in the rain, puddles around." },
  { level: 33, chasi: 6, koreanTitle: "아침 부엌의 아이", subject: "One child at a kitchen table in morning light, bread and a glass of milk." },
  { level: 34, chasi: 6, koreanTitle: "눈사람을 만드는 두 아이", subject: "Two children building a snowman on a snowy afternoon." },
  { level: 35, chasi: 6, koreanTitle: "오후 도서관의 아이", subject: "One child choosing a book from a shelf in an afternoon library." },
  { level: 36, chasi: 6, koreanTitle: "노을 지는 운동장의 아이", subject: "One child holding a ball on a schoolyard at sunset." },
];

export const PRACTICE_QUESTIONS: PracticeQuestion[] = raw.map((q) => ({
  level: q.level,
  chasi: q.chasi,
  koreanTitle: q.koreanTitle,
  sourcePrompt: `${q.subject} ${BG[q.chasi]} ${STYLE}`,
  rubric: GUIDE[q.chasi],
  imageUrl: `/questions/L${String(q.level).padStart(2, '0')}.jpg`,
}));

/** 차시별 문항 구간. 프로그램 운영과 분석에서 함께 쓴다. */
export const CHASI_RANGE: Record<number, [number, number]> = {
  1: [1, 6], 2: [7, 12], 3: [13, 18], 4: [19, 24], 5: [25, 30], 6: [31, 36],
};
