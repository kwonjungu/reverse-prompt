/**
 * 세션 성격별 허용 모드. 화면 토글을 숨기는 것으로 차단을 대신하지 않고,
 * route·server action·API가 모두 이 표를 근거로 거부한다.
 *
 * 대응 문서: 프로그램_수정_프롬프트설계서_v7 §4, 수용시험 7
 */

import type { AppMode, SessionType } from '@/lib/research/types';

const ALLOWED: Record<SessionType, AppMode[]> = {
  // 일반 체험은 기존 의도를 유지한다. 연구 자료로 수집하지 않는다.
  experience: ['guide', 'practice', 'game', 'time-attack'],
  // 연구 수업(처치)은 설명·연습만.
  research_practice: ['guide', 'practice'],
  // 연구 검사 중에는 검사 화면만.
  research_assessment: ['assessment'],
};

export function isModeAllowed(sessionType: SessionType, mode: AppMode): boolean {
  return ALLOWED[sessionType].includes(mode);
}

export function allowedModes(sessionType: SessionType): AppMode[] {
  return [...ALLOWED[sessionType]];
}

/** 연구 세션인가 */
export function isResearchSession(sessionType: SessionType): boolean {
  return sessionType !== 'experience';
}

/** 차단 사유 문구 — 학생 화면에는 구현 용어를 쓰지 않는다. */
export const MODE_BLOCKED_MESSAGE = '지금은 선생님이 연 활동만 할 수 있어요.';
