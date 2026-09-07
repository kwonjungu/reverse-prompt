'use server';

/**
 * 차시 개방·연습 제출의 server action.
 *
 * 설계서 §4·§6·§7 대응.
 *   - 학생 클라이언트가 보낸 lesson·역할·학급·동의를 신뢰하지 않는다. 서버가 확정한다.
 *   - 교사만 차시를 연다. 점수·완료 수는 개방 조건이 아니다.
 *   - 제출은 서버가 저장한다. 클라이언트가 Firestore에 직접 쓰지 않는다.
 *   - 저장 실패를 성공 완료로 보고하지 않는다. 상태를 그대로 돌려준다.
 *   - 비허용 모드는 화면 표시와 무관하게 여기서 거절한다.
 */

import 'server-only';
import { randomUUID } from 'node:crypto';

import { CODE_COMMIT } from '@/server/config';
import { grading } from '@/server/grading';
import { registry } from '@/server/registry';
import { privacy } from '@/server/privacy';
import type { AppMode, SessionType } from '@/lib/research/types';

import { allowedModes } from '@/lib/research/session-modes';
import { requireTeacher, resolveStudentSession } from './auth-bridge';
import { assertModeAllowed, checkMode, parseAppMode } from './mode-policy';
import {
  decideLessonAccess,
  isScheduleControlled,
  isValidLessonNumber,
  resolveEntryLesson,
  visibleLessons,
} from './policy';
import {
  PRACTICE_SUBMISSION_SCHEMA_VERSION,
  attachFeedbackReview,
  closeLessonSession,
  openLessonSession,
  readLessonSession,
  readStudentSubmissions,
  saveSubmission,
  toOpenState,
  type FeedbackReview,
  type PracticeSubmissionRecord,
} from './store';

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

/**
 * 학생 화면이 쓰는 차시 상태.
 * requestedLesson은 URL 등에서 온 값이므로 판정을 통과할 때만 쓰인다.
 */
export async function getLessonStateAction(
  requestedLesson?: number | null
): Promise<LessonStateView> {
  const ctx = await resolveStudentSession();

  // 연습 화면 자체가 허용되지 않는 세션이면 차시를 알려 주지 않는다.
  const modeOk = checkMode(ctx.sessionType, 'practice');
  if (!modeOk.allowed) {
    return {
      sessionType: ctx.sessionType,
      verified: ctx.verified,
      scheduleControlled: isScheduleControlled(ctx.sessionType),
      currentLesson: null,
      allowedLessons: [],
      entryLesson: null,
      deniedMessage: modeOk.message,
      attemptsByQuestion: {},
      reviewedQuestionCount: 0,
    };
  }

  const session = ctx.classResearchId ? await readLessonSession(ctx.classResearchId) : null;
  const state = toOpenState(session, ctx.sessionType);

  const decision = decideLessonAccess(state, requestedLesson ?? null);
  const entryLesson = resolveEntryLesson(state, requestedLesson ?? null);

  let attemptsByQuestion: Record<string, number> = {};
  let reviewedQuestionCount = 0;
  if (ctx.classResearchId && ctx.researchId) {
    const summary = await readStudentSubmissions(
      ctx.sessionType,
      ctx.classResearchId,
      ctx.researchId
    );
    attemptsByQuestion = summary.attemptsByQuestion;
    reviewedQuestionCount = summary.reviewedQuestionCount;
  }

  return {
    sessionType: ctx.sessionType,
    verified: ctx.verified,
    scheduleControlled: isScheduleControlled(ctx.sessionType),
    currentLesson: state.currentLesson,
    allowedLessons: visibleLessons(state),
    entryLesson,
    deniedMessage:
      requestedLesson === undefined || requestedLesson === null || decision.allowed
        ? null
        : decision.message,
    attemptsByQuestion,
    reviewedQuestionCount,
  };
}

/**
 * 홈 화면이 쓰는 허용 모드 목록.
 *
 * 이 목록은 표시를 정하는 것이지 차단의 근거가 아니다. 실제 거부는
 * route(middleware)·페이지 가드·server action·API가 각각 다시 한다.
 */
export async function getAllowedModesAction(): Promise<{
  sessionType: SessionType;
  verified: boolean;
  modes: AppMode[];
}> {
  const ctx = await resolveStudentSession();
  return {
    sessionType: ctx.sessionType,
    verified: ctx.verified,
    modes: allowedModes(ctx.sessionType),
  };
}

/** 화면·경로 가드가 쓰는 모드 판정. 세션 성격은 서버가 정한다. */
export async function checkModeAction(
  mode: string
): Promise<{ allowed: boolean; message: string | null; sessionType: SessionType }> {
  const ctx = await resolveStudentSession();
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

/**
 * 교사가 차시를 연다.
 * 학생의 점수나 6문항 완료를 확인하지 않는다. 1차시를 2문항만 한 학생도 들어온다.
 */
export async function openLessonAction(input: {
  classResearchId: string;
  lesson: number;
  reason?: string | null;
  sessionType?: SessionType;
}): Promise<OpenLessonResult> {
  const fail = (error: string): OpenLessonResult => ({
    ok: false,
    allowedLessons: [],
    currentLesson: null,
    durable: false,
    error,
  });

  if (!input.classResearchId) return fail('학급을 지정해 주세요.');
  if (!isValidLessonNumber(input.lesson)) return fail('1~6차시만 열 수 있습니다.');

  let teacher;
  try {
    teacher = await requireTeacher(input.classResearchId);
  } catch (err) {
    return fail(err instanceof Error ? err.message : '권한을 확인하지 못했습니다.');
  }

  const sessionType: SessionType = input.sessionType ?? 'research_practice';
  const { session, durable } = await openLessonSession({
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
}

export async function closeLessonAction(input: {
  classResearchId: string;
  lesson?: number;
  reason?: string | null;
}): Promise<OpenLessonResult> {
  const fail = (error: string): OpenLessonResult => ({
    ok: false,
    allowedLessons: [],
    currentLesson: null,
    durable: false,
    error,
  });

  if (!input.classResearchId) return fail('학급을 지정해 주세요.');

  let teacher;
  try {
    teacher = await requireTeacher(input.classResearchId);
  } catch (err) {
    return fail(err instanceof Error ? err.message : '권한을 확인하지 못했습니다.');
  }

  const { session, durable } = await closeLessonSession({
    classResearchId: input.classResearchId,
    lesson: input.lesson,
    closedBy: teacher.uid,
    reason: input.reason ?? null,
  });
  if (!session) return fail('아직 연 차시가 없습니다.');

  return {
    ok: true,
    allowedLessons: session.allowedLessons,
    currentLesson: session.currentLesson,
    durable,
    error: null,
  };
}

/* ────────────────────────── 학생: 연습 제출 ────────────────────────── */

export interface SubmitPracticeInput {
  /** 클라이언트가 만든 제출ID. 같은 값으로 다시 보내면 이중 저장하지 않는다. */
  submissionId: string;
  questionId: string;
  /** 서버가 다시 판정한다. 클라이언트 값은 요청일 뿐이다. */
  lesson: number;
  text: string;
  startedAt: string;
  /**
   * 일반 체험에서만 쓰는 학급 구분값(학교코드_학년-반).
   * 연구 세션에서는 무시하고 서버가 확정한 학급 연구ID를 쓴다.
   */
  experienceClassCode?: string | null;
}

export type SubmitPracticeResult =
  | {
      status: 'blocked';
      message: string;
    }
  | {
      status: 'done';
      submissionId: string;
      /** 저장 상태. 실패를 성공 화면으로 바꾸지 않는다. */
      save: { ok: boolean; duplicate: boolean; durable: boolean; message: string | null };
      /** 채점 결과. 결측이면 점수를 만들지 않는다. */
      scoring:
        | { status: 'scored'; score: number; levels: unknown; axisScores: unknown; band: string }
        | { status: 'missing'; message: string };
      /** 화면에 보여 줄 피드백. 결측이면 null. */
      feedback: { text: string; status: string } | null;
      attemptNo: number;
    };

/** 학생 화면에 쓰는 결측 안내. 0점·수준1로 보이게 하지 않는다. */
const SCORING_MISSING_MESSAGE =
  '채점을 마치지 못했어요. 쓴 글은 그대로 저장했으니 선생님과 함께 확인해요.';

const PII_HOLD_MESSAGE =
  '이름이나 연락처처럼 보이는 말이 있어요. 지우고 다시 써 볼까요? 어려우면 선생님께 여쭤보세요.';

/** 연습 문항 ID(L01~L36)에서 문항 레벨을 얻는다. 형식이 다르면 0으로 둔다. */
function practiceLevelOf(questionId: string): number {
  const m = /^L(\d{2})$/.exec(questionId);
  return m ? Number(m[1]) : 0;
}

export async function submitPracticeAction(
  input: SubmitPracticeInput
): Promise<SubmitPracticeResult> {
  const ctx = await resolveStudentSession();

  // 1) 모드 차단 — 화면에서 무엇을 보여 주었든 여기서 다시 판정한다.
  try {
    assertModeAllowed(ctx.sessionType, 'practice');
  } catch (err) {
    return { status: 'blocked', message: err instanceof Error ? err.message : '' };
  }

  // 2) 차시 판정 — 클라이언트가 보낸 lesson을 그대로 믿지 않는다.
  const session = ctx.classResearchId ? await readLessonSession(ctx.classResearchId) : null;
  const state = toOpenState(session, ctx.sessionType);
  const decision = decideLessonAccess(state, input.lesson);
  if (!decision.allowed) {
    return { status: 'blocked', message: decision.message };
  }

  // 3) 문항 확인 — 등록되지 않은 questionId는 거부한다.
  let entry;
  try {
    entry = registry.requireEntry(input.questionId, ctx.sessionType);
  } catch (err) {
    return {
      status: 'blocked',
      message: '지금은 열 수 없는 문항이에요. 선생님께 여쭤보세요.',
    };
  }
  if (entry.lesson !== null && entry.lesson !== input.lesson) {
    return { status: 'blocked', message: '이 문항은 다른 단계의 문항이에요.' };
  }

  const text = input.text.trim();
  if (!text) {
    return { status: 'blocked', message: '설명을 먼저 써 주세요.' };
  }

  // 4) 연구 세션의 미동의자는 수집 단계에서 막는다.
  if (ctx.sessionType !== 'experience' && !ctx.consentActive) {
    return {
      status: 'blocked',
      message: '지금은 이 활동의 기록을 남길 수 없어요. 선생님께 여쭤보세요.',
    };
  }

  // 5) 전송 전 개인정보 점검. 의심되면 외부 전송을 멈춘다.
  const pii = privacy.checkBeforeSend(text);
  if (pii.decision === 'hold_for_teacher') {
    return { status: 'blocked', message: PII_HOLD_MESSAGE };
  }

  const submittedAt = new Date().toISOString();
  const startedAtMs = Date.parse(input.startedAt);
  const durationMs = Number.isFinite(startedAtMs)
    ? Math.max(0, Date.parse(submittedAt) - startedAtMs)
    : null;

  // 6) 시도 횟수는 서버의 이력으로 센다.
  let attemptNo = 1;
  const classKey = ctx.classResearchId ?? input.experienceClassCode ?? null;
  if (classKey && ctx.researchId) {
    const summary = await readStudentSubmissions(ctx.sessionType, classKey, ctx.researchId);
    attemptNo = (summary.attemptsByQuestion[input.questionId] ?? 0) + 1;
  }

  // 7) 채점. 채점 payload에 학생·학급·시점을 넣지 않는다.
  const operationId = randomUUID();
  let run: Awaited<ReturnType<typeof grading.runOperationalScoring>> | null = null;
  let gradingFailure: string | null = null;
  try {
    run = await grading.runOperationalScoring({
      questionId: input.questionId,
      band: entry.band,
      studentText: text,
      operationId,
      repeatIndex: 1,
      sessionType: ctx.sessionType,
      wantFeedback: true,
    });
  } catch (err) {
    gradingFailure = err instanceof Error ? err.message : String(err);
  }

  // 8) 저장. 같은 제출ID의 재요청은 새 응답으로 세지 않는다.
  const record: PracticeSubmissionRecord = {
    schemaVersion: PRACTICE_SUBMISSION_SCHEMA_VERSION,
    submissionId: input.submissionId,
    researchId: ctx.researchId,
    classResearchId: classKey,
    sessionType: ctx.sessionType,
    phase: null,
    lesson: input.lesson,
    questionId: entry.questionId,
    questionLevel: practiceLevelOf(entry.questionId),
    band: entry.band,
    imageHash: entry.imageSha256 || null,
    cueVersion: entry.cueVersion || null,
    rubricVersion: entry.rubricVersion || null,
    text,
    startedAt: input.startedAt,
    submittedAt,
    durationMs,
    attemptNo,
    consentVersion: ctx.consentVersion,
    responseStatus: 'submitted',
    missingReason: null,
    persistStatus: 'failed',
    scoring: {
      operationId,
      repeatIndex: 1,
      result: run ? run.result : null,
      calls: run ? run.calls : [],
      extraCall: run ? run.extraCall : null,
      feedback: run ? run.feedback : null,
      modelId: run ? run.modelId : null,
      modelConfig: run ? run.modelConfig : null,
      promptHash: run ? run.promptHash : null,
      codeCommit: run ? run.codeCommit : CODE_COMMIT,
      scoredAt: run ? run.scoredAt : null,
      failureReason: gradingFailure,
    },
    feedbackReview: null,
    createdAt: submittedAt,
  };

  const saved = await saveSubmission(record);
  record.persistStatus = saved.ok ? (saved.duplicate ? 'rejected_duplicate' : 'stored') : 'failed';

  const scored =
    run && run.result.status === 'scored'
      ? ({
          status: 'scored' as const,
          score: run.result.score,
          levels: run.result.levels,
          axisScores: run.result.axisScores,
          band: run.band,
        })
      : ({ status: 'missing' as const, message: SCORING_MISSING_MESSAGE });

  return {
    status: 'done',
    submissionId: input.submissionId,
    save: {
      ok: saved.ok,
      duplicate: saved.duplicate,
      durable: saved.durable,
      message: saved.ok
        ? saved.durable
          ? null
          : '기록을 임시로만 남겼어요. 선생님께 알려 주세요.'
        : '글을 저장하지 못했어요. 잠시 뒤 다시 눌러 주세요.',
    },
    scoring: scored,
    feedback:
      run && run.feedback ? { text: run.feedback.text, status: run.feedback.status } : null,
    attemptNo,
  };
}

/* ──────────────── 학생: 피드백 검토 기록 ──────────────── */

export interface RecordFeedbackReviewInput {
  submissionId: string;
  kind: 'revised' | 'kept';
  /** 고치지 않았다면 그 까닭을 짧게 적는다. */
  note?: string | null;
  /** 고쳐서 다시 냈다면 그 제출ID. */
  revisedSubmissionId?: string | null;
  experienceClassCode?: string | null;
}

export async function recordFeedbackReviewAction(
  input: RecordFeedbackReviewInput
): Promise<{ ok: boolean; message: string | null }> {
  const ctx = await resolveStudentSession();
  try {
    assertModeAllowed(ctx.sessionType, 'practice');
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : null };
  }

  const classKey = ctx.classResearchId ?? input.experienceClassCode ?? null;
  if (!classKey) {
    return { ok: false, message: '학급을 확인하지 못해 기록하지 못했어요.' };
  }
  if (input.kind === 'kept' && !input.note?.trim()) {
    return { ok: false, message: '고치지 않은 까닭을 한 줄만 적어 주세요.' };
  }

  const review: FeedbackReview = {
    kind: input.kind,
    note: input.note?.trim() || null,
    revisedSubmissionId: input.revisedSubmissionId ?? null,
    recordedAt: new Date().toISOString(),
  };

  const result = await attachFeedbackReview(
    ctx.sessionType,
    classKey,
    input.submissionId,
    review
  );
  return {
    ok: result.ok,
    message: result.ok ? null : '기록을 저장하지 못했어요. 다시 눌러 주세요.',
  };
}
