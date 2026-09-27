import 'server-only';

/**
 * 연습 문항 이미지의 제작 프롬프트 — 서버 전용.
 *
 * 예전에는 src/lib/questions.ts가 이 문자열을 함께 들고 있었다. 그 파일은
 * 클라이언트 컴포넌트에서 import 되므로 화면에 렌더링하지 않아도 프롬프트가
 * 그대로 클라이언트 번들과 소스맵에 실려 나갔다. '화면에 안 보인다'는 것으로
 * 비공개를 대신할 수 없으므로 파일 단위로 분리한다.
 *
 * 제작 프롬프트는 정답 문장이 아니다. 이미지에 실제로 구현되지 않은 요구는
 * 채점 기준에서 제외하므로 이 문자열을 채점 단서로 모델에 보내지 않는다.
 * 채점에 쓰는 단서는 실제 JPG를 열어 보고 작성한 비공개 단서 팩에서 읽는다.
 *
 * 대응 문서: 프로그램_수정_프롬프트설계서_v7 §2
 */

import { practiceQuestionId } from './entries';

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

const SUBJECTS: { level: number; chasi: number; subject: string }[] = [
  { level:  1, chasi: 1, subject: 'A single glossy red apple, stem visible.' },
  { level:  2, chasi: 1, subject: 'A folded yellow umbrella lying flat.' },
  { level:  4, chasi: 1, subject: 'A blue metal watering can.' },
  { level:  5, chasi: 1, subject: 'A small round green cactus in a terracotta pot.' },
  { level:  6, chasi: 1, subject: 'A single silver key.' },
  { level:  7, chasi: 2, subject: 'Three orange balls of clearly different sizes in a row.' },
  { level:  9, chasi: 2, subject: 'One tall slim green glass bottle beside one short wide brown bottle.' },
  { level: 10, chasi: 2, subject: 'Five yellow star-shaped cookies arranged apart from each other.' },
  { level: 11, chasi: 2, subject: 'One large purple butterfly with wings fully open.' },
  { level: 13, chasi: 3, subject: 'A small brown puppy running on grass, legs mid-stride.' },
  { level: 14, chasi: 3, subject: 'A blue bird perched on a bare branch.' },
  { level: 16, chasi: 3, subject: 'A child sitting at a desk reading an open book.' },
  { level: 18, chasi: 3, subject: 'A child walking while holding an open umbrella.' },
  { level: 19, chasi: 4, subject: 'A fluffy white cat curled up asleep, individual fur strands visible.' },
  { level: 20, chasi: 4, subject: 'A polished metal kettle with bright specular highlights.' },
  { level: 21, chasi: 4, subject: 'A child crouching with knees bent and arms around the knees.' },
  { level: 22, chasi: 4, subject: 'The base of a thick tree trunk with deeply rough bark.' },
  { level: 23, chasi: 4, subject: 'A crumpled paper plane with sharp creases and folds.' },
  { level: 24, chasi: 4, subject: 'A soaked towel hanging limp and heavy, dripping.' },
  { level: 26, chasi: 5, subject: 'A window with rain streaks, grey daylight outside, calm quiet mood.' },
  { level: 29, chasi: 5, subject: 'A forest path in early morning fog, soft pale light.' },
  { level: 32, chasi: 6, subject: 'Two children sharing one umbrella in the rain, puddles around.' },
  { level: 34, chasi: 6, subject: 'Two children building a snowman on a snowy afternoon.' },
  { level: 35, chasi: 6, subject: 'One child choosing a book from a shelf in an afternoon library.' },
];

/**
 * 2026-09-27에 다시 만든 그림 12장의 실제 제작 프롬프트 — 보낸 문자열 그대로다.
 * 그림 모델 Nano Banana 2(정확한 모델 이름은 docs/practice-image-audit.md 8절), Batch API, 1:1·1K. 받은 그림을 1024×1024 JPEG로 저장했다.
 * 문항별 문장은 docs/practice-image-audit.md 2절, 공통 문구는 3절(STYLE-OBJECT·STYLE-SCENE)이다.
 * L12·L36은 첫 그림이 어긋나(달걀처럼 선 돌·얼룩 / 갈라진 그림자) 끝에 한 문장을 덧붙여 다시 만든 것을 썼다.
 * 이 문항들은 위 SUBJECTS·BG·STYLE(옛 제작 방식) 대신 이 값을 쓴다.
 */
const STYLE_OBJECT =
  'Children\'s educational illustration, soft digital painting with clearly visible surface texture, even neutral lighting, simple and unambiguous composition, the whole object visible with clear margin on every side, nothing cropped, no text, no letters, no numbers, no logos, no brand marks, no picture frame, no border, no white margin frame, no mat, high detail on the main subject.';

const STYLE_SCENE =
  'Children\'s educational illustration, soft digital painting with clearly visible surface texture, simple and unambiguous composition, the illustration fills the entire canvas edge to edge with no border, no frame, no white or coloured margin, no text, no letters, no numbers, no logos, no signage, no clocks, book covers show pictures only, not a real identifiable person, no violence, no blood-like stains, high detail on the main subject, every countable object clearly separate and fully visible.';

const REMADE: Record<string, string> = {
  L03: 'A single classic soccer ball with white hexagons and black pentagons, every black pentagon surrounded by white hexagons, round and clearly recognisable as a soccer ball, shown whole and centred with generous white space on all sides; no laces, no logo, no shadow. Pure flat white background. No shadow, no floor line, no background texture whatsoever.' + ' ' + STYLE_OBJECT,
  L08: 'One ceramic mug covered in bold horizontal stripes that alternate between exactly two colours, red and white, with a plain white handle on the right side, shown whole and centred with margin on all sides. Flat single-colour pale grey-blue background with no objects in it.' + ' ' + STYLE_OBJECT,
  L12: 'Exactly four smooth grey pebbles of clearly different sizes lying apart in one horizontal row across the middle of the picture, smallest on the left to largest on the right; every one clearly a rounded stone, none flat or square, plain surface without lines or cracks, all four shown whole. Flat single-colour pale yellow background with no objects in it.' + ' ' + STYLE_OBJECT + ' ' + 'Each pebble lies flat on its wider side and is clearly wider than it is tall, like flattened river stones with slightly irregular outlines; not egg-shaped, not standing upright. All four are the same plain uniform grey with no speckles, spots, veins or patterns.',
  L15: 'One orange fish swimming sideways underwater between two clumps of tall green water plants, a few small bubbles rising, a sandy bottom visible below, clearly inside the water. A simple underwater background that clearly shows the place, muted blue-green water.' + ' ' + STYLE_SCENE,
  L17: 'One grey cat leaping up from a garden lawn onto the top of a low wooden fence, front paws stretched forward, body in mid-air, the lawn and the fence making the place clear. A simple garden background that clearly indicates the place, no sun, no other animals.' + ' ' + STYLE_SCENE,
  L25: 'An empty sandy seashore at sunset, the orange sun touching the sea, long shadows; exactly two objects: one blue-and-white rowboat lying on the sand in the left foreground and one red-and-white striped lighthouse on rocks in the sea on the right. No people, no animals, no shells, no starfish, no pebbles. Full scene background in which the time of day and the mood are unmistakable.' + ' ' + STYLE_SCENE,
  L27: 'One child in a red knit hat and a green coat standing directly under a glowing street lamp on a snowy park path at night, holding out both mittened hands to catch falling snowflakes; one snow-covered bench beside the lamp. No other people, no animals. Full scene background in which the time of day (night) and the mood are unmistakable.' + ' ' + STYLE_SCENE,
  L28: 'An empty classroom with exactly six wooden desks and chairs in two rows facing a green blackboard, pale bright morning sunlight from two windows on the left casting long window-shaped patches across the desks, one globe on the teacher\'s desk. No people, no shelves, no toys, no posters, no maps, no clock, nothing written on the blackboard.' + ' ' + STYLE_SCENE,
  L30: 'An empty playground at dusk under a purple-pink sky: one swing frame with two still, empty swings, one blue slide, one sandbox; unlit street lamps, lonely quiet mood. No people, no animals, no rocking animals or spring riders, no rust stains, no red streaks on anything. Full scene background in which the time of day and the mood are unmistakable.' + ' ' + STYLE_SCENE,
  L31: 'One child in a red hoodie sitting on a wooden park bench reading a book whose cover shows only a simple picture, one golden dog sitting beside the child on the bench, the sun setting behind low hills; on the grass in front of the bench exactly three everyday objects: one yellow backpack, one blue water bottle, one green apple. Nothing else on the ground.' + ' ' + STYLE_SCENE,
  L33: 'One child sitting at a wooden kitchen table eating a slice of toast held in one hand, pale morning sunlight through a window behind; on the table exactly three everyday objects: one glass of milk, one white plate, one red apple. Plain wall behind, no sink, no plants, no jars, no books, no knives.' + ' ' + STYLE_SCENE,
  L36: 'One child standing in the middle of an empty dirt schoolyard at sunset, holding one red ball with both hands, a plain school building without any clock on the left, a low orange sun behind a fence, the long shadow of the child; around the child on the ground exactly three everyday objects: one blue backpack, one water bottle, one jump rope. No other balls, no bicycles, no tricycles, no watering can, no toys, no lines drawn on the ground.' + ' ' + STYLE_SCENE + ' ' + 'The child casts exactly one single connected shadow on the ground; no split or double shadows.',
};

/** questionId(L01~L36) → 제작 프롬프트. 다시 만든 문항은 REMADE를 쓴다. */
const BY_QUESTION_ID: Record<string, string> = Object.fromEntries(
  [
    ...SUBJECTS.map((q) => [practiceQuestionId(q.level), `${q.subject} ${BG[q.chasi]} ${STYLE}`] as const),
    ...Object.entries(REMADE),
  ].sort(([a], [b]) => a.localeCompare(b)),
);

/** 2026-09-27에 다시 만든 문항 ID(L03·L08·L12·…). */
export const REMADE_PRACTICE_QUESTIONS: readonly string[] = Object.keys(REMADE);

/** 없으면 null. 서버에서만 호출한다. */
export function practiceSourcePrompt(questionId: string): string | null {
  return BY_QUESTION_ID[questionId] ?? null;
}

export function practiceSourcePromptByLevel(level: number): string | null {
  return practiceSourcePrompt(practiceQuestionId(level));
}

/** 감수·기록용 전체 목록. 클라이언트로 그대로 내려보내지 않는다. */
export function allPracticeSourcePrompts(): { questionId: string; sourcePrompt: string }[] {
  return Object.entries(BY_QUESTION_ID).map(([questionId, sourcePrompt]) => ({ questionId, sourcePrompt }));
}
