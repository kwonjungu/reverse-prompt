/**
 * 문항별로 코드가 정해 두는 영역 예외(논문 v12-2). 공개 정보만 둔다 — 문항 ID 목록뿐이며
 * 그림에 무엇이 있는지는 적지 않는다. 힌트(src/lib/practice-hints.ts)와 채점의 판정 영역
 * (src/lib/evaluation-prompt.ts의 applicabilityOf), 차시 상태(src/server/lessons/actions.ts)가 같은 목록을 쓴다.
 *
 *   RELATION_NOT_APPLICABLE_QUESTIONS  관계가 기본으로 해당 없음인 문항. 대상이 하나뿐인 A밴드 그림(L01–L04·L06·L08·L11)과
 *                                      장소를 알 수 없는 물건 그림(L20·L23, 추상 도형 배경).
 *                                      **단서 팩이 없을 때의 기본값이다. 단서 팩이 있으면 단서 팩이 우선한다**
 *                                      (필수 관계 requiredContext가 비면 해당 없음, 있으면 판정).
 *   STILL_SCENE_QUESTIONS              행동이 없는 사물·풍경 그림(B·C밴드: L22·L24·L25·L28·L30). 관계 질문을
 *                                      '어디에서 무엇을 하고 있는지' 대신 '무엇이 어디에 어떻게 놓여 있는지'로 묻는다
 *                                      (놓인 곳과 배치를 관계로 본다). L20·L23은 관계가 해당 없음이라 이 목록에 넣지 않는다.
 */

import type { AreaId } from '@/lib/scoring';

export const RELATION_NOT_APPLICABLE_QUESTIONS: readonly string[] = [
  'L01', 'L02', 'L03', 'L04', 'L06', 'L08', 'L11', 'L20', 'L23',
];

export const STILL_SCENE_QUESTIONS: readonly string[] = ['L22', 'L24', 'L25', 'L28', 'L30'];

/** 문항 번호(1~36) → 문항 ID(L01~L36) */
export const questionIdOfLevel = (level: number) => `L${String(level).padStart(2, '0')}`;

/** 단서 팩이 없을 때 이 문항에서 해당 없음으로 두는 영역(기본값). 단서 팩이 있으면 쓰지 않는다. */
export function defaultNotApplicableAreas(questionId: string): AreaId[] {
  return RELATION_NOT_APPLICABLE_QUESTIONS.includes(questionId) ? ['relation'] : [];
}

export function isStillScene(questionId: string): boolean {
  return STILL_SCENE_QUESTIONS.includes(questionId);
}
