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
  { level:  3, chasi: 1, subject: 'A brown leather ball with visible stitched seams.' },
  { level:  4, chasi: 1, subject: 'A blue metal watering can.' },
  { level:  5, chasi: 1, subject: 'A small round green cactus in a terracotta pot.' },
  { level:  6, chasi: 1, subject: 'A single silver key.' },
  { level:  7, chasi: 2, subject: 'Three orange balls of clearly different sizes in a row.' },
  { level:  8, chasi: 2, subject: 'One mug with bold horizontal stripes.' },
  { level:  9, chasi: 2, subject: 'One tall slim green glass bottle beside one short wide brown bottle.' },
  { level: 10, chasi: 2, subject: 'Five yellow star-shaped cookies arranged apart from each other.' },
  { level: 11, chasi: 2, subject: 'One large purple butterfly with wings fully open.' },
  { level: 12, chasi: 2, subject: 'Four grey stones of clearly different sizes.' },
  { level: 13, chasi: 3, subject: 'A small brown puppy running on grass, legs mid-stride.' },
  { level: 14, chasi: 3, subject: 'A blue bird perched on a bare branch.' },
  { level: 15, chasi: 3, subject: 'An orange fish swimming underwater, fins spread.' },
  { level: 16, chasi: 3, subject: 'A child sitting at a desk reading an open book.' },
  { level: 17, chasi: 3, subject: 'A grey cat leaping upward with front paws stretched.' },
  { level: 18, chasi: 3, subject: 'A child walking while holding an open umbrella.' },
  { level: 19, chasi: 4, subject: 'A fluffy white cat curled up asleep, individual fur strands visible.' },
  { level: 20, chasi: 4, subject: 'A polished metal kettle with bright specular highlights.' },
  { level: 21, chasi: 4, subject: 'A child crouching with knees bent and arms around the knees.' },
  { level: 22, chasi: 4, subject: 'The base of a thick tree trunk with deeply rough bark.' },
  { level: 23, chasi: 4, subject: 'A crumpled paper plane with sharp creases and folds.' },
  { level: 24, chasi: 4, subject: 'A soaked towel hanging limp and heavy, dripping.' },
  { level: 25, chasi: 5, subject: 'An empty seashore at sunset, warm orange sky, long shadows.' },
  { level: 26, chasi: 5, subject: 'A window with rain streaks, grey daylight outside, calm quiet mood.' },
  { level: 27, chasi: 5, subject: 'A street lamp at night with snow falling through its light.' },
  { level: 28, chasi: 5, subject: 'An empty classroom with bright morning sunlight across the desks.' },
  { level: 29, chasi: 5, subject: 'A forest path in early morning fog, soft pale light.' },
  { level: 30, chasi: 5, subject: 'An empty playground at dusk, swings still, lonely mood.' },
  { level: 31, chasi: 6, subject: 'One child sitting on a park bench reading, a dog beside, at dusk.' },
  { level: 32, chasi: 6, subject: 'Two children sharing one umbrella in the rain, puddles around.' },
  { level: 33, chasi: 6, subject: 'One child at a kitchen table in morning light, bread and a glass of milk.' },
  { level: 34, chasi: 6, subject: 'Two children building a snowman on a snowy afternoon.' },
  { level: 35, chasi: 6, subject: 'One child choosing a book from a shelf in an afternoon library.' },
  { level: 36, chasi: 6, subject: 'One child holding a ball on a schoolyard at sunset.' },
];

/** questionId(L01~L36) → 제작 프롬프트 */
const BY_QUESTION_ID: Record<string, string> = Object.fromEntries(
  SUBJECTS.map((q) => [practiceQuestionId(q.level), `${q.subject} ${BG[q.chasi]} ${STYLE}`]),
);

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
