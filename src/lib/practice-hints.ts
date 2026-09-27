/**
 * 연습 문항별 힌트 — '목표 + 확인 기준'(설계 원리 1). 학생 화면에 그대로 나가는 공개 문구만 둔다.
 *
 * 힌트 = 목표(공통 문장 + 단계별 둘째 문장) + 확인 질문(영역마다 한 문장, 그 문항에서 판정하는 영역만).
 * 확인 질문은 공통 루브릭 v12-2의 4수준 기준을 학생 말로 옮긴 것이다. 정답 값(대상 이름·색 이름·개수)이나
 * 그림의 특정 부위를 짚지 않는다. 36문항 모두 아래 규칙으로 만든다(손으로 쓰지 않는다).
 *
 *   - 단계 초점 영역의 질문을 맨 앞에 둔다(2단계 대상, 3단계 특징, 4단계 관계). 1·5·6단계는 대상→특징→관계.
 *   - 특징 질문은 3단계(L19–L24)만 겉모습(매끈한지·거친지)까지 묻는다.
 *   - 관계 질문은 문항별 예외 목록(src/lib/question-areas.ts)으로 고른다.
 *       A밴드(L01–L12)            서로 어디에 있는지(위·아래·옆·안)
 *       물건·풍경(STILL_SCENE)    무엇이 어디에 어떻게 놓여 있는지
 *       그 밖의 B·C밴드(사람·동물) 어디에서 무엇을 하고 있는지
 *   - C밴드(L25–L36)는 시간대·분위기에 관한 선택 안내를 덧붙인다(필수 아님).
 *   - 해당 없음(not_applicable)인 영역의 질문은 화면에서 뺀다(screenHintOf → withoutAreas).
 *     해당 없음은 단서 팩이 있으면 단서 팩이, 없으면 코드의 기본 목록(RELATION_NOT_APPLICABLE_QUESTIONS —
 *     L01–L04·L06·L08·L11·L20·L23의 관계)이 정한다. 서버가 차시 상태로 영역 이름만 알려 준다.
 *     초안(PRACTICE_HINTS)에는 세 영역 질문이 모두 있다(단서 팩이 관계를 요구하면 그 질문이 나가야 하므로).
 *     단서 팩 내용은 이 파일에 두지 않는다.
 *
 * 검수
 *   REVIEWED_QUESTIONS에 들어간 문항의 힌트만 학생 화면에 나간다. 아니면 단계 공통 안내를 쓴다.
 *   검수표: docs/practice-hints-review.md (npm run hints:table). 예전 초안 문구는 검수표의 참고 열로 남긴다
 *   (scripts/print-practice-hints.mjs — 그림의 부위를 짚는 문구라 학생 번들에 싣지 않는다).
 */

import { defaultNotApplicableAreas, isStillScene, questionIdOfLevel } from '@/lib/question-areas';
import { AREA_IDS, bandOf, type AreaId } from '@/lib/scoring';
import { chasiOfLevel, stageFocusArea } from '@/lib/stages';

/** 확인 질문 하나. area가 null이면 영역에 딸리지 않은 선택 안내다(C밴드). */
export interface HintCheck {
  area: AreaId | null;
  text: string;
}

/** 학생 화면에 나가는 힌트 */
export interface PracticeHint {
  goal: string;
  checks: HintCheck[];
}

export interface PracticeHintDraft extends PracticeHint {
  /** 연구자가 검수를 마쳤는가. 마치기 전에는 학생 화면에 나가지 않는다. */
  reviewed: boolean;
}

/** 목표 첫 문장(공통) */
export const HINT_GOAL = '이 그림을 못 본 친구가 똑같이 떠올릴 수 있게 써요.';

/** 목표 둘째 문장(단계별) */
export const STAGE_GOAL: Record<number, string> = {
  1: '쓴 다음에는 받은 피드백을 읽어 봐요.',
  2: '이번에는 무엇이 몇 개인지를 가장 정확하게 써요.',
  3: '이번에는 생김새가 어느 것의 것인지 드러나게 써요.',
  4: '이번에는 어디에서 무엇을 하고 있는지를 꼭 써요.',
  5: '피드백을 그림과 견주어 보고 맞는 것만 받아들여 고쳐 써요.',
  6: '세 가지(무엇이 몇 개·생김새·어디에서 무엇을)를 모두 담아 써요.',
};

/** 문항 번호(1~36)의 목표 = 공통 문장 + 그 단계의 둘째 문장 */
export function hintGoalOf(level: number): string {
  const second = STAGE_GOAL[chasiOfLevel(level) ?? 0];
  return second ? `${HINT_GOAL} ${second}` : HINT_GOAL;
}

/** 확인 질문 — 루브릭 4수준 기준을 학생 말로 */
export const HINT_CHECK = {
  object: '무엇이 몇 개 있는지 빠짐없이 썼나요?',
  feature: '색과 모양이 어느 것의 것인지 알 수 있게 썼나요?',
  /** 3단계(특징, L19–L24) */
  featureStage3: '색·모양·겉모습(매끈한지, 거친지 등)이 어느 것의 것인지 알 수 있게 썼나요?',
  /** A밴드(L01–L12) */
  relationA: '서로 어디에 있는지(위·아래·옆·안) 썼나요?',
  /** 사람·동물이 없는 물건·풍경(STILL_SCENE_QUESTIONS) */
  relationStill: '무엇이 어디에 어떻게 놓여 있는지 썼나요?',
  /** 그 밖의 B·C밴드(사람·동물) */
  relationBC: '어디에서 무엇을 하고 있는지 썼나요?',
} as const;

/** C밴드 선택 안내 */
export const HINT_C_OPTIONAL =
  '언제인지 알 수 있다면 써도 좋아요. 분위기를 쓸 때는 무엇을 보고 그렇게 느꼈는지도 써요.';

/** 관계 질문 문구(문항별 예외 목록으로 고른다) */
export function relationCheckOf(level: number): string {
  if (bandOf(level) === 'A') return HINT_CHECK.relationA;
  return isStillScene(questionIdOfLevel(level)) ? HINT_CHECK.relationStill : HINT_CHECK.relationBC;
}

/** 문항 번호(1~36)로 확인 질문을 만든다. 단계 초점 영역을 맨 앞에 둔다. 해당 없음은 화면에서 뺀다(screenHintOf). */
export function buildHintChecks(level: number): HintCheck[] {
  const band = bandOf(level);
  const chasi = chasiOfLevel(level);
  const text: Record<AreaId, string> = {
    object: HINT_CHECK.object,
    feature: chasi === 3 ? HINT_CHECK.featureStage3 : HINT_CHECK.feature,
    relation: relationCheckOf(level),
  };
  const focus = stageFocusArea(chasi);
  const order: AreaId[] = focus ? [focus, ...AREA_IDS.filter((a) => a !== focus)] : [...AREA_IDS];
  const checks: HintCheck[] = order.map((area) => ({ area, text: text[area] }));
  if (band === 'C') checks.push({ area: null, text: HINT_C_OPTIONAL });
  return checks;
}

/**
 * 연구자가 검수를 마친 문항(L01~L36). 여기 든 문항만 문항별 힌트가 학생 화면에 나간다.
 *
 * 2026-09-27 — 36문항 모두 승인(연구자가 판단을 맡김, 99-1 C4를 뒤집음). 논문 v12-2에 맞춰 확인한 것:
 *   - 목표 한 문장과 루브릭 영역별 확인 질문으로 이루어진다(Ⅳ.1 설계 원리 1, 부록 2 가).
 *   - 확인 질문은 M02 전문가 의견의 쉬운 말 그대로다('무엇이 몇 개 있는지 빠짐없이 썼나요?',
 *     '색과 모양이 어느 것의 것인지 알 수 있게 썼나요?', 부록 2 마의 '어디에서 무엇이 어떻게 놓여 있는지').
 *   - 정답 값(대상 이름·색·개수)과 특정 부위를 말하지 않는다(tests/hints.test.ts가 36문항 전수 대조).
 *   - 그림이 요구하지 않는 영역의 질문은 화면에서 뺀다(단서 팩, 없으면 기본 목록 — screenHintOf).
 *   - 1단계는 대상·특징을 고루, 관계는 대상이 둘 이상일 때만. 2~4단계는 그 영역을 맨 앞에. 5·6단계는 세 영역(Ⅳ.2.가).
 *   - 새 그림 12장(2026-09-27)도 관계 질문 종류가 그림과 맞는다(L03·L08 해당 없음, L25·L28·L30 놓인 모양).
 * 문항을 빼려면 이 목록에서 지운다. 검수표: docs/practice-hints-review.md(npm run hints:table).
 */
export const REVIEWED_QUESTIONS: readonly string[] = [
  'L01', 'L02', 'L03', 'L04', 'L05', 'L06', 'L07', 'L08', 'L09', 'L10', 'L11', 'L12', 'L13', 'L14', 'L15', 'L16', 'L17', 'L18', 'L19', 'L20', 'L21', 'L22', 'L23', 'L24', 'L25', 'L26', 'L27', 'L28', 'L29', 'L30', 'L31', 'L32', 'L33', 'L34', 'L35', 'L36',
];

/** questionId(L01~L36) → 힌트 초안 */
export const PRACTICE_HINTS: Record<string, PracticeHintDraft> = Object.fromEntries(
  Array.from({ length: 36 }, (_, i) => i + 1).map((level) => {
    const id = questionIdOfLevel(level);
    return [id, { goal: hintGoalOf(level), checks: buildHintChecks(level), reviewed: REVIEWED_QUESTIONS.includes(id) }];
  })
);

/** 해당 없음인 영역의 질문을 뺀다. 영역에 딸리지 않은 선택 안내는 남긴다. */
export function withoutAreas(hint: PracticeHint, skip: readonly AreaId[]): PracticeHint {
  if (!skip.length) return hint;
  return { goal: hint.goal, checks: hint.checks.filter((c) => c.area === null || !skip.includes(c.area)) };
}

/** 학생 화면에 낼 힌트. 검수를 마친 것만 돌려주고, 아니면 null(단계 공통 안내를 쓴다). */
export function reviewedHintOf(questionId: string): PracticeHint | null {
  const draft = PRACTICE_HINTS[questionId];
  return draft && draft.reviewed ? { goal: draft.goal, checks: draft.checks } : null;
}

/**
 * 학생 화면에 실제로 내는 힌트. 검수를 마친 것만, 해당 없음 영역의 질문을 뺀 채로 돌려준다.
 *   notApplicable  서버가 차시 상태로 알려 준 이 문항의 해당 없음 영역(단서 팩 우선, 없으면 기본 목록).
 *                  서버 값이 없으면(undefined) 코드의 기본 목록을 쓴다.
 */
export function screenHintOf(questionId: string, notApplicable?: readonly AreaId[]): PracticeHint | null {
  const hint = reviewedHintOf(questionId);
  if (!hint) return null;
  return withoutAreas(hint, notApplicable ?? defaultNotApplicableAreas(questionId));
}
