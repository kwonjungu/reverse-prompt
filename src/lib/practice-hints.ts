/**
 * 연습 문항별 힌트 — '목표 + 확인 기준'(설계 원리 1). 학생 화면에 그대로 나가는 공개 문구만 둔다.
 *
 * 힌트 = 목표 한 문장 + 확인 질문(영역마다 한 문장, 그 문항에서 판정하는 영역만).
 * 확인 질문은 공통 루브릭 v12-2의 4수준 기준을 학생 말로 옮긴 것이다. 정답 값(대상 이름·색 이름·개수)이나
 * 그림의 특정 부위를 짚지 않는다. 36문항 모두 아래 규칙으로 만든다(손으로 쓰지 않는다).
 *
 *   - 단계 초점 영역의 질문을 맨 앞에 둔다(2단계 대상, 3단계 특징, 4단계 관계). 1·5·6단계는 대상→특징→관계.
 *   - 관계 질문은 A밴드(L01–L12)는 공간 관계, B·C밴드는 장소·행동이다.
 *   - C밴드(L25–L36)는 시간대·분위기에 관한 선택 안내를 덧붙인다(필수 아님).
 *   - 비공개 단서 팩에서 해당 없음(not_applicable)인 영역의 질문은 서버가 알려 준 대로 화면에서 뺀다
 *     (withoutAreas). 단서 팩 내용은 이 파일에 두지 않는다.
 *
 * 검수
 *   REVIEWED_QUESTIONS에 들어간 문항의 힌트만 학생 화면에 나간다. 아니면 단계 공통 안내를 쓴다.
 *   검수표: docs/practice-hints-review.md (npm run hints:table). 예전 초안 문구는 검수표의 참고 열로 남긴다
 *   (scripts/print-practice-hints.mjs — 그림의 부위를 짚는 문구라 학생 번들에 싣지 않는다).
 */

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

/** 목표 문장(공통) */
export const HINT_GOAL = '이 그림을 못 본 친구가 똑같이 떠올릴 수 있게 써요.';

/** 확인 질문 — 루브릭 4수준 기준을 학생 말로 */
export const HINT_CHECK = {
  object: '무엇이 몇 개 있는지 빠짐없이 썼나요?',
  feature: '색과 모양이 어느 것의 것인지 알 수 있게 썼나요?',
  relationA: '서로 어디에 있는지(위·아래·왼쪽·오른쪽) 썼나요?',
  relationBC: '어디에서 무엇을 하고 있는지 썼나요?',
} as const;

/** C밴드 선택 안내 */
export const HINT_C_OPTIONAL =
  '언제인지 알 수 있다면 써도 좋아요. 분위기를 쓸 때는 무엇을 보고 그렇게 느꼈는지도 써요.';

/** 문항 번호(1~36)로 확인 질문을 만든다. 단계 초점 영역을 맨 앞에 둔다. */
export function buildHintChecks(level: number): HintCheck[] {
  const band = bandOf(level);
  const text: Record<AreaId, string> = {
    object: HINT_CHECK.object,
    feature: HINT_CHECK.feature,
    relation: band === 'A' ? HINT_CHECK.relationA : HINT_CHECK.relationBC,
  };
  const focus = stageFocusArea(chasiOfLevel(level));
  const order: AreaId[] = focus ? [focus, ...AREA_IDS.filter((a) => a !== focus)] : [...AREA_IDS];
  const checks: HintCheck[] = order.map((area) => ({ area, text: text[area] }));
  if (band === 'C') checks.push({ area: null, text: HINT_C_OPTIONAL });
  return checks;
}

/** 연구자가 검수를 마친 문항(L01~L36). 검수표를 보고 여기에 문항 ID를 더한다. */
export const REVIEWED_QUESTIONS: readonly string[] = [];

const questionIdOf = (level: number) => `L${String(level).padStart(2, '0')}`;

/** questionId(L01~L36) → 힌트 초안 */
export const PRACTICE_HINTS: Record<string, PracticeHintDraft> = Object.fromEntries(
  Array.from({ length: 36 }, (_, i) => i + 1).map((level) => {
    const id = questionIdOf(level);
    return [id, { goal: HINT_GOAL, checks: buildHintChecks(level), reviewed: REVIEWED_QUESTIONS.includes(id) }];
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
