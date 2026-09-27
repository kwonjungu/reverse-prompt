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
  // 연구 수업(처치)은 설명·연습만. 게임·타임어택·사전·사후 검사는 열리지 않는다.
  research_practice: ['guide', 'practice'],
  // 옛 v7 연구 검사(사전·사후) 반. 검사 화면만 열린다.
  // 논문 v12는 연습만 쓰므로 이 성격의 반은 새로 만들지 않는다(CREATABLE_SESSION_TYPES).
  // 이미 모은 검사 자료의 채점·내보내기 코드가 이 값을 읽으므로 표에서는 지우지 않는다.
  research_assessment: ['assessment'],
};

/**
 * 관리 화면에서 새로 만들 수 있는 반의 성격(논문 v12).
 * 연구 세션은 연습 모드만 연다 — 연구 수업(research_practice)만 만들 수 있고,
 * 사전·사후 검사가 열리는 연구 검사(research_assessment) 반은 만들 수 없다.
 * 반 만들기 server action이 이 표로 거절한다(화면에서 선택지를 숨긴 것만으로 막지 않는다).
 */
export const CREATABLE_SESSION_TYPES = ['experience', 'research_practice'] as const;
export type CreatableSessionType = (typeof CREATABLE_SESSION_TYPES)[number];

/** 새 반의 성격으로 받을 수 있는 값인가. 모르는 값·연구 검사는 null이다(체험으로 바꾸지 않는다). */
export function parseCreatableSessionType(value: unknown): CreatableSessionType | null {
  return typeof value === 'string' && (CREATABLE_SESSION_TYPES as readonly string[]).includes(value)
    ? (value as CreatableSessionType)
    : null;
}

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
