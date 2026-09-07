'use server';

/**
 * 차시 개방·연습 제출의 server action — 배선.
 *
 * 판정과 기록 규칙은 policy.ts·store-core.ts·submit-core.ts에 있고 여기서는
 * 인증·레지스트리·채점기·저장소를 붙인다.
 *
 * 설계서 §4·§6·§7 대응.
 *   - 모든 학생 경로가 서버 세션을 요구한다. 익명 요청이 모델 호출·저장에 닿지 못한다(감사 A-1).
 *   - 학급·학생 식별자는 서버 세션의 값만 쓴다. 클라이언트가 보낸 학급 키를 쓰지 않는다.
 *   - 교사만 차시를 연다. 점수·완료 수는 개방 조건이 아니다.
 *   - 학급의 세션 성격은 서버 기록이 정한다. 교사가 연구 학급을 체험으로 열 수 없다(감사 A-5).
 *   - 저장 실패를 성공 완료로 보고하지 않는다.
 */

import 'server-only';
import { randomUUID } from 'node:crypto';

import { CODE_COMMIT } from '@/server/config';
import { grading } from '@/server/grading';
import { registry } from '@/server/registry';
import { privacy } from '@/server/privacy';
import { AuthError } from '@/server/auth/contract';
import type { AppMode, SessionType } from '@/lib/research/types';

import { allowedModes } from '@/lib/research/session-modes';
import {
  NO_SESSION_MESSAGE,
  requireStudentSession,
  requireTeacher,
  resolveClassSessionType,
  resolveStudentSession,
  type StudentSessionContext,
} from './auth-bridge';
import { checkMode, parseAppMode } from './mode-policy';
import {
  decideLessonAccess,
  isScheduleControlled,
  isValidLessonNumber,
  resolveEntryLesson,
  visibleLessons,
} from './policy';
import { getLessonStore, toOpenState } from './store';
import {
  recordFeedbackReviewCore,
  resolveClassKey,
  submitPracticeCore,
  type RecordFeedbackReviewInput,
  type SubmitDeps,
  type SubmitPracticeInput,
  type SubmitPracticeResult,
  type SubmitSessionContext,
} from './submit-core';

export type {
  RecordFeedbackReviewInput,
  SubmitPracticeInput,
  SubmitPracticeResult,
} from './submit-core';

/** 서버 세션을 제출 처리용 맥락으로 옮긴다. 클라이언트 입력이 섞이지 않는다. */
function toSubmitContext(ctx: StudentSessionContext): SubmitSessionContext {
  return {
    sessionType: ctx.sessionType,
    classResearchId: ctx.classResearchId,
    classCode: ctx.classCode,
    researchId: ctx.researchId,
    ownerKey: ctx.ownerKey,
    consentActive: ctx.consentActive,
    consentVersion: ctx.consentVersion,
  };
}

function submitDeps(): SubmitDeps {
  return {
    store: getLessonStore(),
    requireEntry: (questionId, sessionType) => registry.requireEntry(questionId, sessionType),
    checkPii: (text) => privacy.checkBeforeSend(text),
    grade: (call) => grading.runOperationalScoring(call),
    newOperationId: () => randomUUID(),
    now: () => new Date(),
    codeCommit: CODE_COMMIT,
  };
}

/* ────────────────────────── 학생: 차시 상태 ────────────────────────── */

export interface LessonStateView {
  sessionType: SessionType;
  /** 서버가 세션을 확정했는가. false면 연구 저장을 하지 않는다. */
  verified: boolean;
  /** 교사 일정 통제를 받는 세션인가. */
  scheduleControlled: boolean;
  currentLesson: number | null;
  /** 열람 가능한 차시. 이 목록만이 근거다. */
  allowedLessons: number[];
  /** 진입할 차시. 요청한 차시가 허용되지 않으면 서버가 다시 정한다. */
  entryLesson: number | null;
  /** 요청한 차시가 거절되었을 때 학생에게 보여 줄 문구. */
  deniedMessage: string | null;
  /** questionId → 제출 횟수. 정보 표시용이며 잠금 근거가 아니다. */
  attemptsByQuestion: Record<string, number>;
  /** 피드백 검토를 남긴 문항 수. */
  reviewedQuestionCount: number;
}

/** 세션이 없거나 모드가 막힌 상태. 일반 체험으로 강등하지 않는다. */
function closedState(sessionType: SessionType, message: string, verified: boolean): LessonStateView {
  return {
    sessionType,
    verified,
    scheduleControlled: isScheduleControlled(sessionType),
    currentLesson: null,
    allowedLessons: [],
    entryLesson: null,
    deniedMessage: message,
    attemptsByQuestion: {},
    reviewedQuestionCount: 0,
  };
}

/**
 * 학생 화면이 쓰는 차시 상태.
 * requestedLesson은 URL 등에서 온 값이므로 판정을 통과할 때만 쓰인다.
 */
export async function getLessonStateAction(
  requestedLesson?: number | null
): Promise<LessonStateView> {
  const resolved = await resolveStudentSession();
  if (resolved.status !== 'ok') {
    // 세션이 없으면 어떤 차시도 알려 주지 않는다(감사 A-3).
    return closedState('research_practice', resolved.message, false);
  }
  const ctx = resolved.ctx;

  // 연습 화면 자체가 허용되지 않는 세션이면 차시를 알려 주지 않는다.
  const modeOk = checkMode(ctx.sessionType, 'practice');
  if (!modeOk.allowed) {
    return closedState(ctx.sessionType, modeOk.message ?? '', true);
  }

  const store = getLessonStore();
  const session = ctx.classResearchId ? await store.readLessonSession(ctx.classResearchId) : null;
  // 세션 성격은 학생 세션이 정한다. 학급 기록의 값이 덮어쓰지 않는다(감사 A-5).
  const state = toOpenState(session, ctx.sessionType, true);

  const decision = decideLessonAccess(state, requestedLesson ?? null);
  const entryLesson = resolveEntryLesson(state, requestedLesson ?? null);

  const classKey = resolveClassKey(toSubmitContext(ctx));
  const summary = classKey
    ? await store.readStudentSubmissions(ctx.sessionType, classKey, ctx.ownerKey)
    : { attemptsByQuestion: {}, reviewedQuestionCount: 0 };

  return {
    sessionType: ctx.sessionType,
    verified: true,
    scheduleControlled: isScheduleControlled(ctx.sessionType),
    currentLesson: state.currentLesson,
    allowedLessons: visibleLessons(state),
    entryLesson,
    deniedMessage:
      requestedLesson === undefined || requestedLesson === null || decision.allowed
        ? null
        : decision.message,
    attemptsByQuestion: summary.attemptsByQuestion,
    reviewedQuestionCount: summary.reviewedQuestionCount,
  };
}

/**
 * 홈 화면이 쓰는 허용 모드 목록.
 *
 * 이 목록은 표시를 정하는 것이지 차단의 근거가 아니다. 실제 거부는
 * route(middleware)·페이지 가드·server action·API가 각각 다시 한다.
 * 세션이 없으면 빈 목록이다. 일반 체험으로 채워 주지 않는다.
 */
export async function getAllowedModesAction(): Promise<{
  sessionType: SessionType;
  verified: boolean;
  modes: AppMode[];
  message: string | null;
}> {
  const resolved = await resolveStudentSession();
  if (resolved.status !== 'ok') {
    return {
      sessionType: 'research_practice',
      verified: false,
      modes: [],
      message: resolved.message,
    };
  }
  return {
    sessionType: resolved.ctx.sessionType,
    verified: true,
    modes: allowedModes(resolved.ctx.sessionType),
    message: null,
  };
}

/** 화면·경로 가드가 쓰는 모드 판정. 세션 성격은 서버가 정한다. */
export async function checkModeAction(
  mode: string
): Promise<{ allowed: boolean; message: string | null; sessionType: SessionType }> {
  const resolved = await resolveStudentSession();
  if (resolved.status !== 'ok') {
    // 세션이 없으면 어떤 모드도 열지 않는다. 체험으로 강등하지 않는다(감사 A-3).
    return { allowed: false, message: NO_SESSION_MESSAGE, sessionType: 'research_practice' };
  }
  const ctx = resolved.ctx;
  const parsed: AppMode | null = parseAppMode(mode);
  if (!parsed) {
    return { allowed: false, message: '없는 활동이에요.', sessionType: ctx.sessionType };
  }
  const decision = checkMode(ctx.sessionType, parsed);
  return { ...decision, sessionType: ctx.sessionType };
}

/* ────────────────────────── 교사: 차시 개방 ────────────────────────── */

export interface OpenLessonResult {
  ok: boolean;
  allowedLessons: number[];
  currentLesson: number | null;
  /** 재시작해도 남는 저장소에 기록되었는가. false면 연구 운영에 쓸 수 없다. */
  durable: boolean;
  error: string | null;
}

const failOpen = (error: string): OpenLessonResult => ({
  ok: false,
  allowedLessons: [],
  currentLesson: null,
  durable: false,
  error,
});

/**
 * 교사가 차시를 연다.
 * 학생의 점수나 6문항 완료를 확인하지 않는다. 1차시를 2문항만 한 학생도 들어온다.
 * 세션 성격은 서버의 학급 기록이 정한다. 요청에 담긴 값으로 바꾸지 못한다(감사 A-5).
 */
export async function openLessonAction(input: {
  classResearchId: string;
  lesson: number;
  reason?: string | null;
  /** @deprecated 서버 학급 기록이 정한다. 다른 값을 보내면 거절한다. */
  sessionType?: SessionType;
}): Promise<OpenLessonResult> {
  if (!input.classResearchId) return failOpen('학급을 지정해 주세요.');
  if (!isValidLessonNumber(input.lesson)) return failOpen('1~6차시만 열 수 있습니다.');

  try {
    const teacher = await requireTeacher(input.classResearchId);
    const sessionType = await resolveClassSessionType(input.classResearchId);
    if (input.sessionType && input.sessionType !== sessionType) {
      return failOpen('이 학급의 수업 성격은 서버 기록으로만 바꿀 수 있습니다.');
    }

    const { session, durable } = await getLessonStore().openLessonSession({
      classResearchId: input.classResearchId,
      sessionType,
      lesson: input.lesson,
      openedBy: teacher.uid,
      reason: input.reason ?? null,
    });

    return {
      ok: true,
      allowedLessons: session.allowedLessons,
      currentLesson: session.currentLesson,
      durable,
      error: durable ? null : '서버 저장소에 기록하지 못해 임시로만 남았습니다.',
    };
  } catch (err) {
    return failOpen(errorMessage(err));
  }
}

export async function closeLessonAction(input: {
  classResearchId: string;
  lesson?: number;
  reason?: string | null;
}): Promise<OpenLessonResult> {
  if (!input.classResearchId) return failOpen('학급을 지정해 주세요.');

  try {
    const teacher = await requireTeacher(input.classResearchId);
    const { session, durable } = await getLessonStore().closeLessonSession({
      classResearchId: input.classResearchId,
      lesson: input.lesson,
      closedBy: teacher.uid,
      reason: input.reason ?? null,
    });
    if (!session) return failOpen('아직 연 차시가 없습니다.');

    return {
      ok: true,
      allowedLessons: session.allowedLessons,
      currentLesson: session.currentLesson,
      durable,
      error: null,
    };
  } catch (err) {
    return failOpen(errorMessage(err));
  }
}

function errorMessage(err: unknown): string {
  if (err instanceof AuthError) return err.message;
  return err instanceof Error ? err.message : '권한을 확인하지 못했습니다.';
}

/* ────────────────────────── 학생: 연습 제출 ────────────────────────── */

/**
 * 연습 제출.
 * 서버 세션이 없으면 모델 호출·저장에 닿기 전에 끊는다(감사 A-1).
 */
export async function submitPracticeAction(
  input: SubmitPracticeInput
): Promise<SubmitPracticeResult> {
  let ctx: StudentSessionContext;
  try {
    ctx = await requireStudentSession();
  } catch (err) {
    return { status: 'blocked', message: errorMessage(err) };
  }
  return submitPracticeCore(submitDeps(), toSubmitContext(ctx), input);
}

/* ──────────────── 학생: 피드백 검토 기록 ──────────────── */

export async function recordFeedbackReviewAction(
  input: RecordFeedbackReviewInput
): Promise<{ ok: boolean; message: string | null }> {
  let ctx: StudentSessionContext;
  try {
    ctx = await requireStudentSession();
  } catch (err) {
    return { ok: false, message: errorMessage(err) };
  }
  const deps = submitDeps();
  return recordFeedbackReviewCore(
    { store: deps.store, now: deps.now },
    toSubmitContext(ctx),
    input
  );
}
