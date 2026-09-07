/**
 * 차시 개방 판정 — 순수 함수만 둔다.
 *
 * 설계서 §4 대응.
 *   - 차시는 교사가 서버에서 연다. 점수나 6문항 완료는 개방 조건이 아니다.
 *   - 1차시를 2문항만 한 학생도 교사가 2차시를 열면 입장한다.
 *   - 학생이 보낸 lesson 값·날짜·localStorage·URL은 판정 근거가 아니다.
 *   - 완료 수는 화면에 정보로만 표시한다.
 *
 * 이 파일은 저장소·인증·프레임워크에 의존하지 않는다. tests/lessons.test.ts가 그대로
 * 불러 쓴다. 저장과 권한은 store.ts와 actions.ts가 맡는다.
 */

import type { LessonSession, SessionType } from '@/lib/research/types';

/** 연습 모드의 차시 번호. 논문 <표 III-5> 밴드 전환 명세와 같은 구간이다. */
export const LESSON_NUMBERS = [1, 2, 3, 4, 5, 6] as const;

/** 한 차시에 배정된 문항 수. 완료 강제가 아니라 진행 정보 표시에만 쓴다. */
export const QUESTIONS_PER_LESSON = 6;

/**
 * 일정 통제를 받는 세션 성격.
 * 일반 체험(experience)은 자율 진행이므로 여기에 넣지 않는다.
 */
export const SCHEDULE_CONTROLLED_SESSION_TYPES: SessionType[] = [
  'research_practice',
  'research_assessment',
];

/**
 * 서버가 기록한 차시 개방 상태 가운데 판정에 쓰는 부분.
 *
 * sessionType은 **학생의 서버 세션**이 정한다. 학급 기록에 남은 sessionType은
 * 참고 값일 뿐이며 학생 세션을 덮어쓰지 않는다(감사 A-5).
 * sessionVerified는 서버가 이 요청의 학생 세션을 확정했는지를 뜻한다. 확정하지
 * 못한 요청을 일반 체험으로 강등해 열어 주지 않는다(감사 A-3).
 */
export interface LessonOpenState
  extends Pick<LessonSession, 'sessionType' | 'currentLesson' | 'allowedLessons' | 'closedAt'> {
  /** 서버가 학생 세션을 검증했는가. false면 어떤 차시도 열지 않는다. */
  sessionVerified: boolean;
}

export type LessonDenyReason =
  | 'unknown_lesson'
  | 'not_opened'
  | 'session_closed'
  | 'session_unverified';

export type LessonAccessDecision =
  | { allowed: true }
  | { allowed: false; reason: LessonDenyReason; message: string };

/** 학생 화면에 그대로 보여 줄 거절 문구. 구현 용어를 쓰지 않는다. */
export const LESSON_DENY_MESSAGE: Record<LessonDenyReason, string> = {
  unknown_lesson: '없는 단계예요. 선생님이 연 단계에서 시작해 보세요.',
  not_opened: '아직 선생님이 열지 않은 단계예요.',
  session_closed: '지금은 수업이 닫혀 있어요. 선생님께 여쭤보세요.',
  session_unverified: '먼저 선생님이 알려 준 수업 번호로 들어와 주세요.',
};

export function isValidLessonNumber(lesson: unknown): lesson is number {
  return (
    typeof lesson === 'number' &&
    Number.isInteger(lesson) &&
    (LESSON_NUMBERS as readonly number[]).includes(lesson)
  );
}

/** 이 세션이 교사 일정 통제를 받는가. 받지 않으면 자율 진행이다. */
export function isScheduleControlled(sessionType: SessionType): boolean {
  return SCHEDULE_CONTROLLED_SESSION_TYPES.includes(sessionType);
}

function isClosed(state: LessonOpenState): boolean {
  return state.closedAt !== null && state.closedAt !== undefined && state.closedAt !== '';
}

/**
 * 한 차시에 들어갈 수 있는지 판정한다.
 *
 * 인자는 서버 기록과 요청한 차시뿐이다. 학생의 완료 문항 수·점수·기기 저장값을
 * 인자로 받지 않는다. 완료 수를 개방 조건으로 쓸 수 없게 하려는 의도이다.
 */
export function decideLessonAccess(
  state: LessonOpenState,
  requestedLesson: unknown
): LessonAccessDecision {
  // 세션을 확정하지 못한 요청은 어떤 차시도 열지 않는다.
  // 예전에는 여기서 곧바로 '일반 체험이면 무조건 허용'으로 내려갔기 때문에,
  // 쿠키를 지워 세션을 없앤 요청이 체험으로 강등되어 통과하였다(감사 A-3).
  if (!state.sessionVerified) {
    return {
      allowed: false,
      reason: 'session_unverified',
      message: LESSON_DENY_MESSAGE.session_unverified,
    };
  }

  if (!isValidLessonNumber(requestedLesson)) {
    return {
      allowed: false,
      reason: 'unknown_lesson',
      message: LESSON_DENY_MESSAGE.unknown_lesson,
    };
  }

  // 일반 체험은 자율 진행이다. 기존 의도를 그대로 둔다.
  // 다만 위에서 sessionVerified를 먼저 확인하므로, '명시적으로 체험으로 들어온'
  // 세션에만 해당한다. 세션 없는 요청은 여기에 오지 못한다.
  if (!isScheduleControlled(state.sessionType)) {
    return { allowed: true };
  }

  if (isClosed(state)) {
    return {
      allowed: false,
      reason: 'session_closed',
      message: LESSON_DENY_MESSAGE.session_closed,
    };
  }

  if (!state.allowedLessons.includes(requestedLesson)) {
    return {
      allowed: false,
      reason: 'not_opened',
      message: LESSON_DENY_MESSAGE.not_opened,
    };
  }

  return { allowed: true };
}

/** 화면의 단계 선택에 표시할 차시. 자율 진행이면 전부, 연구 세션이면 서버가 연 것만. */
export function visibleLessons(state: LessonOpenState): number[] {
  if (!state.sessionVerified) return [];
  if (!isScheduleControlled(state.sessionType)) {
    return [...LESSON_NUMBERS];
  }
  if (isClosed(state)) return [];
  return [...LESSON_NUMBERS].filter((n) => state.allowedLessons.includes(n));
}

/**
 * 처음 열 차시를 정한다. 학생이 URL로 요청한 값은 서버 판정을 통과할 때만 쓴다.
 * 통과하지 못하면 교사가 진행 중이라고 표시한 차시, 그다음 허용 목록의 첫 차시를 쓴다.
 */
export function resolveEntryLesson(
  state: LessonOpenState,
  requestedLesson?: unknown
): number | null {
  if (decideLessonAccess(state, requestedLesson).allowed) {
    return requestedLesson as number;
  }
  if (state.currentLesson !== null && decideLessonAccess(state, state.currentLesson).allowed) {
    return state.currentLesson;
  }
  const open = visibleLessons(state);
  return open.length ? open[0] : null;
}

/**
 * 교사가 차시를 열었을 때의 다음 허용 목록.
 * 이미 연 차시는 닫지 않는다. 앞 차시를 계속 다듬을 수 있어야 한다.
 */
export function openLesson(allowedLessons: number[], lesson: number): number[] {
  if (!isValidLessonNumber(lesson)) return [...allowedLessons];
  const next = new Set(allowedLessons.filter(isValidLessonNumber));
  next.add(lesson);
  return [...next].sort((a, b) => a - b);
}

/** 교사가 특정 차시만 다시 닫을 때. 세션 전체 종료는 closedAt으로 따로 기록한다. */
export function closeLesson(allowedLessons: number[], lesson: number): number[] {
  return allowedLessons.filter((n) => n !== lesson).sort((a, b) => a - b);
}

/**
 * 진행 정보 표시용 요약. 잠금 근거가 아니다.
 * 수행하지 않은 문항은 0점이 아니라 미수행이므로 점수를 만들지 않는다.
 */
export interface LessonProgressSummary {
  lesson: number;
  attempted: number;
  total: number;
  /** 아직 한 번도 제출하지 않은 문항 수. 0점이 아니라 미수행이다. */
  notAttempted: number;
}

export function summarizeLessonProgress(
  lesson: number,
  attemptedQuestionIds: readonly string[],
  lessonQuestionIds: readonly string[]
): LessonProgressSummary {
  const set = new Set(attemptedQuestionIds);
  const attempted = lessonQuestionIds.filter((id) => set.has(id)).length;
  return {
    lesson,
    attempted,
    total: lessonQuestionIds.length,
    notAttempted: lessonQuestionIds.length - attempted,
  };
}
