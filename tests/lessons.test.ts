/**
 * 차시 개방·모드 차단·연습 제출 저장의 시험.
 *
 * 대응: 프로그램_수정_프롬프트설계서_v7 §4·§6·§7, 수용시험 6·7·11
 *
 * 실제 모델·Firestore·네트워크를 부르지 않는다. 저장소는 메모리 가짜 구현을 주입하고
 * 채점기는 호출 횟수를 세는 가짜 함수를 넣는다. 문항·본문은 합성 대체이며 검사 문항의
 * 실제 단서·앵커를 쓰지 않는다.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import {
  LESSON_DENY_MESSAGE,
  closeLesson,
  decideLessonAccess,
  isScheduleControlled,
  openLesson,
  resolveEntryLesson,
  summarizeLessonProgress,
  visibleLessons,
  type LessonOpenState,
} from '@/server/lessons/policy';
import { checkMode, modeForPath, parseAppMode } from '@/server/lessons/mode-policy';
import { allowedModes, isModeAllowed, MODE_BLOCKED_MESSAGE } from '@/lib/research/session-modes';
import type { AppMode, ScoringRun, SessionType } from '@/lib/research/types';
import {
  createLessonStore,
  createMemoryBackend,
  toOpenState,
  type LessonPaths,
  type LessonSessionRecord,
  type LessonStore,
  type PracticeSubmissionRecord,
} from '@/server/lessons/store-core';
import {
  NOT_OWNER_MESSAGE,
  deriveSubmissionId,
  recordFeedbackReviewCore,
  resolveClassKey,
  submitPracticeCore,
  type PracticeQuestionEntry,
  type SubmitDeps,
  type SubmitSessionContext,
} from '@/server/lessons/submit-core';

const ROOT = process.cwd();
const readSource = (rel: string) => readFileSync(path.join(ROOT, rel), 'utf8');

/* ────────────────── 공통 픽스처(합성) ────────────────── */

/** 교사가 1차시만 연 연구 수업. */
const lesson1Open: LessonOpenState = {
  sessionType: 'research_practice',
  currentLesson: 1,
  allowedLessons: [1],
  closedAt: null,
  sessionVerified: true,
};

/** 다음 수업에서 교사가 2차시를 연 상태. */
const lesson2Open: LessonOpenState = {
  sessionType: 'research_practice',
  currentLesson: 2,
  allowedLessons: [1, 2],
  closedAt: null,
  sessionVerified: true,
};

/** 합성 대체 문항. 검사 문항의 실제 단서·앵커를 쓰지 않는다. */
const SYNTH_ENTRY: PracticeQuestionEntry = {
  questionId: 'L01',
  band: 'A',
  lesson: 1,
  imageSha256: 'synthetic-hash',
  cueVersion: 'synthetic-cue',
  rubricVersion: 'synthetic-rubric',
};

/** 합성 학생 문장. 검사 앵커 문장이 아니다. */
const SYNTH_TEXT = '파란 상자가 책상 위에 놓여 있다.';

const PATHS: LessonPaths = {
  lessonSessions: 'test/lesson_sessions',
  researchPracticeSubmissions: 'test/practice_submissions',
  experienceSubmissions: (classCode: string) => `test/classes/${classCode}/experience`,
};

function newStore(): { store: LessonStore; dump: () => Map<string, unknown> } {
  const backend = createMemoryBackend();
  const store = createLessonStore({
    backend,
    paths: PATHS,
    safeDocId: (value, label) => {
      if (!value || value.includes('/') || value === '.' || value === '..') {
        throw new Error(`${label} 값이 올바르지 않습니다.`);
      }
      return value;
    },
  });
  return { store, dump: backend.dump };
}

function scoredRun(score: number): ScoringRun {
  return {
    operationId: 'op-1',
    repeatIndex: 1,
    band: 'A',
    result: {
      status: 'scored',
      levels: { objectLevel: 3, specificityLevel: 3, contextLevel: null },
      score,
      axisScores: { object: score / 2, specificity: score / 2, context: null },
      feedbackStatus: 'verified',
    },
    calls: [],
    extraCall: false,
    feedback: { status: 'verified', text: '네 줄 피드백(합성)', quote: null, regenerated: false },
    modelId: 'fake-model',
    modelConfig: { temperature: 0 },
    rubricVersion: 'synthetic-rubric',
    cueVersion: 'synthetic-cue',
    imageHash: 'synthetic-hash',
    promptHash: 'synthetic-prompt-hash',
    codeCommit: 'test',
    scoredAt: '2026-09-07T00:00:00.000Z',
  };
}

interface Harness {
  deps: SubmitDeps;
  gradeCalls: () => number;
  dump: () => Map<string, unknown>;
  store: LessonStore;
}

/** 저장소에 남은 제출 문서만 골라 낸다(차시 개방 기록은 뺀다). */
function submissionRows(h: Harness): PracticeSubmissionRecord[] {
  return [...h.dump().entries()]
    .filter(([k]) => !k.startsWith(`${PATHS.lessonSessions}/`))
    .map(([, v]) => v as PracticeSubmissionRecord);
}

function newHarness(options?: {
  score?: number;
  failSave?: boolean;
  gradeThrows?: boolean;
}): Harness {
  const { store, dump } = newStore();
  let calls = 0;
  const wrapped: LessonStore = options?.failSave
    ? {
        ...store,
        saveSubmission: async () => ({
          ok: false,
          duplicate: false,
          durable: false,
          error: '저장소 장애(합성)',
        }),
      }
    : store;
  const deps: SubmitDeps = {
    store: wrapped,
    requireEntry: (questionId) => {
      if (questionId !== SYNTH_ENTRY.questionId) throw new Error('unknown_question');
      return SYNTH_ENTRY;
    },
    checkPii: () => ({ decision: 'pass' }),
    grade: async () => {
      calls += 1;
      if (options?.gradeThrows) throw new Error('모델 호출 실패(합성)');
      return scoredRun(options?.score ?? 50);
    },
    newOperationId: () => `op-${calls}`,
    now: () => new Date('2026-09-07T00:10:00.000Z'),
    codeCommit: 'test-commit',
  };
  return { deps, gradeCalls: () => calls, dump, store: wrapped };
}

/**
 * 연구 수업 시험용 준비.
 * 연구 세션은 교사가 연 차시에서만 제출할 수 있으므로 1차시를 열어 둔다.
 */
async function newResearchHarness(options?: {
  score?: number;
  failSave?: boolean;
  gradeThrows?: boolean;
}): Promise<Harness> {
  const h = newHarness(options);
  await openLessonFor(h.store, 1, 'research_practice');
  return h;
}

const researchCtx: SubmitSessionContext = {
  sessionType: 'research_practice',
  classResearchId: 'CLS-AAA',
  classCode: null,
  researchId: 'R-001',
  ownerKey: 'R-001',
  consentActive: true,
  consentVersion: 'c-v7',
};

const experienceCtx: SubmitSessionContext = {
  sessionType: 'experience',
  classResearchId: null,
  classCode: '7531234_3-2',
  researchId: null,
  ownerKey: 'session:sid-1',
  consentActive: false,
  consentVersion: null,
};

const baseInput = {
  submissionId: 'client-uuid-1',
  questionId: SYNTH_ENTRY.questionId,
  lesson: 1,
  text: SYNTH_TEXT,
  startedAt: '2026-09-07T00:00:00.000Z',
};

/** 교사가 연구 학급의 차시를 연다. */
async function openLessonFor(store: LessonStore, lesson: number, sessionType: SessionType) {
  return store.openLessonSession({
    classResearchId: 'CLS-AAA',
    sessionType,
    lesson,
    openedBy: 'teacher-1',
    reason: null,
  });
}

/* ────────────────── 수용시험 6: 차시 개방 ────────────────── */

test('1차시를 2문항만 한 학생도 교사가 2차시를 열면 참여할 수 있다', () => {
  const lesson1QuestionIds = ['L01', 'L02', 'L03', 'L04', 'L05', 'L06'];
  const attempted = ['L01', 'L03'];
  const progress = summarizeLessonProgress(1, attempted, lesson1QuestionIds);
  assert.equal(progress.attempted, 2);
  assert.equal(progress.notAttempted, 4);

  assert.equal(decideLessonAccess(lesson1Open, 2).allowed, false);
  assert.deepEqual(decideLessonAccess(lesson2Open, 2), { allowed: true });
});

test('완료 수는 차시 개방 조건이 아니다 — 한 문항도 내지 않은 학생이 다음 차시에 제출한다', async () => {
  // 예전 시험은 decideLessonAccess.length === 2만 확인했다. 인자 개수는 규칙의 근거가
  // 아니므로, 실제 저장소·제출 경로로 확인한다.
  const h = newHarness();
  await openLessonFor(h.store, 1, 'research_practice');

  // 1차시에 아무것도 제출하지 않았다.
  const before = await h.store.readStudentSubmissions('research_practice', 'CLS-AAA', 'R-001');
  assert.deepEqual(before.attemptsByQuestion, {});

  // 교사가 2차시를 열면 완료 수와 무관하게 제출이 받아들여진다.
  await openLessonFor(h.store, 2, 'research_practice');
  const entry2: PracticeQuestionEntry = { ...SYNTH_ENTRY, questionId: 'L07', lesson: 2 };
  const deps2: SubmitDeps = { ...h.deps, requireEntry: () => entry2 };
  const res = await submitPracticeCore(deps2, researchCtx, {
    ...baseInput,
    questionId: 'L07',
    lesson: 2,
  });
  assert.equal(res.status, 'done');
  assert.equal(res.status === 'done' && res.save.ok, true);

  // 열지 않은 3차시는 여전히 막힌다.
  const denied = await submitPracticeCore(deps2, researchCtx, {
    ...baseInput,
    questionId: 'L07',
    lesson: 3,
  });
  assert.equal(denied.status, 'blocked');
  assert.equal(denied.status === 'blocked' && denied.message, LESSON_DENY_MESSAGE.not_opened);
});

test('허용되지 않은 차시 진입은 거부한다', () => {
  const denied = decideLessonAccess(lesson2Open, 3);
  assert.equal(denied.allowed, false);
  assert.equal(denied.allowed === false && denied.message, LESSON_DENY_MESSAGE.not_opened);

  assert.equal(resolveEntryLesson(lesson2Open, 3), 2);

  for (const bad of [0, 7, 2.5, '2', null, undefined, NaN]) {
    const d = decideLessonAccess(lesson2Open, bad);
    assert.equal(d.allowed, false, `허용하면 안 되는 값: ${String(bad)}`);
  }

  assert.deepEqual(visibleLessons(lesson2Open), [1, 2]);
});

test('세션을 닫으면 어떤 차시에도 들어갈 수 없다', () => {
  const closed: LessonOpenState = { ...lesson2Open, closedAt: '2026-09-07T02:00:00.000Z' };
  const d = decideLessonAccess(closed, 2);
  assert.equal(d.allowed, false);
  assert.equal(d.allowed === false && d.reason, 'session_closed');
  assert.deepEqual(visibleLessons(closed), []);
  assert.equal(resolveEntryLesson(closed, 2), null);
});

test('일반 체험은 자율 진행을 유지한다', () => {
  const experience: LessonOpenState = {
    sessionType: 'experience',
    currentLesson: null,
    allowedLessons: [],
    closedAt: null,
    sessionVerified: true,
  };
  assert.equal(isScheduleControlled('experience'), false);
  assert.equal(isScheduleControlled('research_practice'), true);
  assert.equal(decideLessonAccess(experience, 5).allowed, true);
  assert.deepEqual(visibleLessons(experience), [1, 2, 3, 4, 5, 6]);
});

test('차시를 열어도 앞 차시는 닫지 않는다', () => {
  assert.deepEqual(openLesson([1], 2), [1, 2]);
  assert.deepEqual(openLesson([1, 2], 2), [1, 2]);
  assert.deepEqual(openLesson([2, 1], 3), [1, 2, 3]);
  assert.deepEqual(openLesson([1], 9), [1]);
  assert.deepEqual(closeLesson([1, 2, 3], 2), [1, 3]);
});

test('기록이 없으면 진입할 차시도 없다', () => {
  const none: LessonOpenState = {
    sessionType: 'research_practice',
    currentLesson: null,
    allowedLessons: [],
    closedAt: null,
    sessionVerified: true,
  };
  assert.equal(resolveEntryLesson(none, 1), null);
  assert.deepEqual(visibleLessons(none), []);
});

/* ────────────────── A-3: 세션 없는 요청을 체험으로 강등하지 않는다 ────────────────── */

test('A-3 세션을 확정하지 못한 요청은 일반 체험으로도 열리지 않는다', () => {
  const unverified: LessonOpenState = {
    sessionType: 'experience',
    currentLesson: null,
    allowedLessons: [],
    closedAt: null,
    sessionVerified: false,
  };
  const d = decideLessonAccess(unverified, 1);
  assert.equal(d.allowed, false);
  assert.equal(d.allowed === false && d.reason, 'session_unverified');
  assert.deepEqual(visibleLessons(unverified), []);

  // 연구 세션도 마찬가지다.
  const unverifiedResearch: LessonOpenState = { ...lesson2Open, sessionVerified: false };
  assert.equal(decideLessonAccess(unverifiedResearch, 2).allowed, false);
});

test('A-3 세션 해석기가 실패를 일반 체험으로 바꾸지 않는다', () => {
  const bridge = readSource('src/server/lessons/auth-bridge.ts');
  // 미확정 기본값(UNVERIFIED)으로 experience를 돌려주던 통로가 없어야 한다.
  assert.equal(/DEFAULT_SESSION_TYPE/.test(bridge), false, 'experience 기본값 강등이 남아 있다');
  assert.ok(bridge.includes("no_session"), '세션 없음을 별도 상태로 알려야 한다');
  assert.ok(
    bridge.includes('requireStudentSession'),
    '쓰기 경로가 쓸 수 있는 강제 함수가 있어야 한다'
  );

  const authIndex = readSource('src/server/auth/index.ts');
  // resolveSessionContext가 getPrincipal의 오류를 삼키지 않아야 한다.
  const body = authIndex.slice(authIndex.indexOf('async function resolveSessionContext'));
  const head = body.slice(0, body.indexOf('async function getClassSessionType'));
  assert.equal(/catch\s*{\s*return null;/.test(head), false, '오류를 삼켜 null로 바꾸고 있다');
});

/* ────────────────── A-5: 학급 기록이 학생 세션을 덮어쓰지 않는다 ────────────────── */

test('A-5 학급 기록의 sessionType이 학생 세션을 덮어쓰지 못한다', () => {
  const record: LessonSessionRecord = {
    classResearchId: 'CLS-AAA',
    // 교사가 실수로 체험으로 연 기록.
    sessionType: 'experience',
    currentLesson: 1,
    allowedLessons: [1],
    openedAt: '2026-09-07T00:00:00.000Z',
    closedAt: null,
    openedBy: 'teacher-1',
    reason: null,
    schemaVersion: 'v7.0-lesson-session',
    updatedAt: '2026-09-07T00:00:00.000Z',
  };
  // 학생의 서버 세션은 연구 수업이다.
  const state = toOpenState(record, 'research_practice', true);
  assert.equal(state.sessionType, 'research_practice');
  // 그러므로 열지 않은 3차시는 여전히 막힌다(예전에는 기록값 때문에 전부 열렸다).
  assert.equal(decideLessonAccess(state, 3).allowed, false);
  assert.equal(decideLessonAccess(state, 1).allowed, true);
});

test('A-5 교사가 보낸 sessionType으로 학급 성격을 바꾸지 못한다', () => {
  const actions = readSource('src/server/lessons/actions.ts');
  assert.ok(
    actions.includes('resolveClassSessionType'),
    '학급 성격을 서버 기록에서 읽어야 한다'
  );
  assert.equal(
    /sessionType:\s*input\.sessionType/.test(actions),
    false,
    '요청의 sessionType을 그대로 저장소에 넘기고 있다'
  );
  const route = readSource('src/app/api/lessons/open/route.ts');
  assert.equal(
    /body\?\.sessionType|raw\.sessionType/.test(route),
    false,
    'API가 클라이언트의 sessionType을 받고 있다'
  );
});

/* ────────────────── A-1·A-11: 학급 키는 서버 세션이 정한다 ────────────────── */

test('A-1 학급 키에 경로 구분자가 들어오면 저장하지 않는다', async () => {
  const { store } = newStore();
  const record = {
    ...baseRecord(),
    classResearchId: 'CLS-AAA/../../other',
    sessionType: 'experience' as SessionType,
  };
  const saved = await store.saveSubmission(record);
  assert.equal(saved.ok, false);
  assert.match(String(saved.error), /학급/);
});

test('A-1·A-11 클라이언트가 보낸 학급 코드를 쓰지 않는다', async () => {
  const h = newHarness();
  const res = await submitPracticeCore(h.deps, experienceCtx, {
    ...baseInput,
    // 화면이 옛 sessionStorage 값을 보내더라도 무시해야 한다.
    experienceClassCode: '9999999_9-9',
  });
  assert.equal(res.status, 'done');
  const rows = submissionRows(h);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].classResearchId, experienceCtx.classCode);
  assert.equal(resolveClassKey(experienceCtx), '7531234_3-2');
  // 옛 신원(출석번호·학교코드)을 기록의 소유 근거로 쓰지 않는다.
  assert.equal('attendanceNumber' in rows[0], false);
  assert.equal(rows[0].ownerKey, experienceCtx.ownerKey);
});

test('A-1 제출 server action이 서버 세션을 요구한다', () => {
  const actions = readSource('src/server/lessons/actions.ts');
  const from = actions.indexOf('export async function submitPracticeAction');
  assert.ok(from > 0, 'submitPracticeAction이 있어야 한다');
  const body = actions.slice(from, from + 700);
  assert.ok(body.includes('requireStudentSession'), '신원 검증 없이 제출을 받고 있다');

  const review = actions.slice(actions.indexOf('export async function recordFeedbackReviewAction'));
  assert.ok(review.includes('requireStudentSession'));
});

/* ────────────────── A-2: 자격증명 관문 ────────────────── */

test('A-2 저장소가 firebase-admin을 직접 초기화하지 않는다', () => {
  const store = readSource('src/server/lessons/store.ts');
  assert.equal(/initializeApp/.test(store), false, '인자 없는 initializeApp 통로가 남아 있다');
  assert.equal(
    /from 'firebase-admin\/app'/.test(store),
    false,
    'firebase-admin/app을 직접 불러오고 있다'
  );
  assert.ok(store.includes('getAdminFirestore'), '자격증명 관문을 거쳐야 한다');
  assert.ok(store.includes('not_configured'), '자격증명이 없으면 실패해야 한다');
  // 자격증명이 없을 때 메모리로 조용히 내려가는 통로가 없어야 한다.
  assert.equal(/메모리 저장으로 내려/.test(store), false);
});

/* ────────────────── A-6: 남의 제출을 고치지 못한다 ────────────────── */

test('A-6 다른 학생의 제출에는 피드백 검토를 기록하지 못한다', async () => {
  const h = await newResearchHarness();
  const submitted = await submitPracticeCore(h.deps, researchCtx, baseInput);
  assert.equal(submitted.status, 'done');
  const submissionId = submitted.status === 'done' ? submitted.submissionId : '';

  // 같은 학급의 다른 학생이 같은 문서에 기록을 시도한다.
  const intruder: SubmitSessionContext = { ...researchCtx, researchId: 'R-002', ownerKey: 'R-002' };
  const denied = await recordFeedbackReviewCore(
    { store: h.deps.store, now: h.deps.now },
    intruder,
    { submissionId, kind: 'kept', note: '고치지 않았어요' }
  );
  assert.equal(denied.ok, false);
  assert.equal(denied.message, NOT_OWNER_MESSAGE);

  // 본인은 기록할 수 있다.
  const mine = await recordFeedbackReviewCore(
    { store: h.deps.store, now: h.deps.now },
    researchCtx,
    { submissionId, kind: 'kept', note: '이미 색을 적어서 그대로 두었어요' }
  );
  assert.equal(mine.ok, true);
});

test('A-6 피드백 검토의 학급도 서버 세션이 정한다', async () => {
  const h = newHarness();
  const submitted = await submitPracticeCore(h.deps, experienceCtx, baseInput);
  const submissionId = submitted.status === 'done' ? submitted.submissionId : '';
  const res = await recordFeedbackReviewCore(
    { store: h.deps.store, now: h.deps.now },
    experienceCtx,
    {
      submissionId,
      kind: 'kept',
      note: '그대로 두었어요',
      // 클라이언트가 다른 학급을 지정해도 무시된다.
      experienceClassCode: '0000000_1-1',
    }
  );
  assert.equal(res.ok, true);
});

/* ────────────────── A-7: 저장 상태를 사실대로 기록한다 ────────────────── */

test('A-7 저장에 성공하면 persistStatus가 stored로 남는다', async () => {
  const h = await newResearchHarness();
  const res = await submitPracticeCore(h.deps, researchCtx, baseInput);
  assert.equal(res.status === 'done' && res.save.ok, true);
  const rows = submissionRows(h);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].persistStatus, 'stored');
});

test('A-7 저장에 실패하면 성공 화면으로 바꾸지 않는다', async () => {
  const h = await newResearchHarness({ failSave: true });
  const res = await submitPracticeCore(h.deps, researchCtx, baseInput);
  assert.equal(res.status, 'done');
  assert.equal(res.status === 'done' && res.save.ok, false);
  assert.ok(res.status === 'done' && res.save.message);
  // 실패했으므로 저장된 제출 문서가 없다.
  assert.equal(submissionRows(h).length, 0);
});

/* ────────────────── A-8: 중복 판정을 채점보다 먼저 ────────────────── */

test('A-8 같은 제출을 다시 보내도 모델을 다시 부르지 않는다', async () => {
  const h = await newResearchHarness({ score: 50 });
  const first = await submitPracticeCore(h.deps, researchCtx, baseInput);
  const second = await submitPracticeCore(h.deps, researchCtx, baseInput);

  assert.equal(h.gradeCalls(), 1, '중복 요청에 모델을 다시 불렀다');
  assert.equal(second.status === 'done' && second.save.duplicate, true);
  // 저장된 결과를 그대로 돌려준다. 다른 점수를 만들지 않는다.
  assert.deepEqual(
    first.status === 'done' ? first.scoring : null,
    second.status === 'done' ? second.scoring : null
  );
  assert.equal(submissionRows(h).length, 1);
});

/* ────────────────── A-9: 재시도가 이중 저장을 만들지 않는다 ────────────────── */

test('A-9 통신 오류 뒤 새 제출ID로 재시도해도 문서가 하나다', async () => {
  const h = await newResearchHarness();
  const first = await submitPracticeCore(h.deps, researchCtx, {
    ...baseInput,
    submissionId: 'client-uuid-1',
  });
  const retry = await submitPracticeCore(h.deps, researchCtx, {
    ...baseInput,
    // 화면이 새 UUID를 만들어 다시 보냈다.
    submissionId: 'client-uuid-2',
  });
  assert.equal(submissionRows(h).length, 1, '재시도가 두 번째 문서를 만들었다');
  assert.equal(h.gradeCalls(), 1);
  assert.equal(
    first.status === 'done' && retry.status === 'done' && first.submissionId === retry.submissionId,
    true
  );
});

test('A-9 제출ID는 소유자·문항·시작시각·본문에서 서버가 만든다', () => {
  const a = deriveSubmissionId({
    ownerKey: 'R-001',
    questionId: 'L01',
    startedAt: baseInput.startedAt,
    text: SYNTH_TEXT,
  });
  const same = deriveSubmissionId({
    ownerKey: 'R-001',
    questionId: 'L01',
    startedAt: baseInput.startedAt,
    text: SYNTH_TEXT,
  });
  const otherStudent = deriveSubmissionId({
    ownerKey: 'R-002',
    questionId: 'L01',
    startedAt: baseInput.startedAt,
    text: SYNTH_TEXT,
  });
  const revised = deriveSubmissionId({
    ownerKey: 'R-001',
    questionId: 'L01',
    startedAt: '2026-09-07T00:20:00.000Z',
    text: `${SYNTH_TEXT} 뚜껑이 열려 있다.`,
  });
  assert.equal(a, same);
  assert.notEqual(a, otherStudent);
  assert.notEqual(a, revised);
  assert.equal(a.includes('/'), false, '문서 ID에 경로 구분자가 있으면 안 된다');
});

/* ────────────────── A-10: 컬렉션 경로의 단일 지점 ────────────────── */

test('A-10 연구 자료는 주입된 연구 경로에만 쓴다', async () => {
  const h = await newResearchHarness();
  await submitPracticeCore(h.deps, researchCtx, baseInput);
  const keys = [...h.dump().keys()];
  assert.ok(keys.some((k) => k.startsWith(`${PATHS.researchPracticeSubmissions}/`)), keys.join(','));
  assert.ok(keys.some((k) => k.startsWith(`${PATHS.lessonSessions}/`)));
  // 학급 연구ID는 경로에 끼워 넣지 않는다.
  assert.equal(
    keys.some((k) => k.includes('CLS-AAA/')),
    false
  );
});

test('A-10 컬렉션 이름을 모듈이 직접 적지 않는다', () => {
  const store = readSource('src/server/lessons/store.ts');
  assert.ok(store.includes('RESEARCH_COLLECTIONS.lessonSessions'));
  assert.ok(store.includes('RESEARCH_COLLECTIONS.practiceSubmissions'));
  assert.ok(store.includes('researchPath('));
  for (const legacy of ['research_practice_submissions', 'class_research/', "'lesson_sessions'"]) {
    assert.equal(store.includes(legacy), false, `옛 경로가 남아 있다: ${legacy}`);
  }
  const core = readSource('src/server/lessons/store-core.ts');
  assert.equal(/'research\//.test(core), false, '순수 핵심이 컬렉션 이름을 만들고 있다');

  const classData = readSource('src/server/auth/class-data-actions.ts');
  assert.equal(
    /(?<!RESEARCH_)COLLECTIONS\.(researchSubmissions|teacherBlindScores)/.test(classData),
    false,
    '없는 컬렉션 상수를 참조하고 있다'
  );
  assert.ok(classData.includes('researchPath(RESEARCH_COLLECTIONS.practiceSubmissions)'));
  assert.ok(classData.includes('researchPath(RESEARCH_COLLECTIONS.teacherBlindScores)'));
});

/* ────────────────── 제출 이력·요약 ────────────────── */

test('제출 이력은 소유 키로 찾는다. 기기를 바꿔도 복원된다', async () => {
  const h = await newResearchHarness();
  await submitPracticeCore(h.deps, researchCtx, baseInput);
  const summary = await h.store.readStudentSubmissions('research_practice', 'CLS-AAA', 'R-001');
  assert.deepEqual(summary.attemptsByQuestion, { L01: 1 });

  // 다른 학생의 이력이 섞이지 않는다.
  const other = await h.store.readStudentSubmissions('research_practice', 'CLS-AAA', 'R-002');
  assert.deepEqual(other.attemptsByQuestion, {});
});

test('미동의 연구 학생의 제출은 수집 단계에서 막는다', async () => {
  const h = await newResearchHarness();
  const res = await submitPracticeCore(
    h.deps,
    { ...researchCtx, consentActive: false },
    baseInput
  );
  assert.equal(res.status, 'blocked');
  assert.equal(h.gradeCalls(), 0, '미동의 학생의 글을 모델에 보냈다');
  assert.equal(submissionRows(h).length, 0);
});

test('개인정보가 의심되면 모델에 보내지 않는다', async () => {
  const h = await newResearchHarness();
  const deps: SubmitDeps = { ...h.deps, checkPii: () => ({ decision: 'hold_for_teacher' }) };
  const res = await submitPracticeCore(deps, researchCtx, baseInput);
  assert.equal(res.status, 'blocked');
  assert.equal(h.gradeCalls(), 0);
});

test('채점이 실패해도 글은 저장하고 점수를 만들지 않는다', async () => {
  const h = await newResearchHarness({ gradeThrows: true });
  const res = await submitPracticeCore(h.deps, researchCtx, baseInput);
  assert.equal(res.status, 'done');
  assert.equal(res.status === 'done' && res.scoring.status, 'missing');
  const rows = submissionRows(h);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].persistStatus, 'stored');
  assert.equal(rows[0].scoring.result, null);
  assert.ok(rows[0].scoring.failureReason);
});

/* ────────────────── 수용시험 7: 모드 차단 ────────────────── */

test('연구 수업에서는 게임·타임어택·감수·생성을 거부한다', () => {
  const blocked: AppMode[] = ['game', 'time-attack', 'audit', 'generate'];
  for (const mode of blocked) {
    const d = checkMode('research_practice', mode);
    assert.equal(d.allowed, false, `연구 수업에서 허용되면 안 되는 모드: ${mode}`);
    assert.equal(d.message, MODE_BLOCKED_MESSAGE);
  }
  assert.equal(checkMode('research_practice', 'guide').allowed, true);
  assert.equal(checkMode('research_practice', 'practice').allowed, true);
});

test('연구 검사 중에는 검사 화면만 열린다', () => {
  const other: AppMode[] = ['guide', 'practice', 'game', 'time-attack', 'audit', 'generate'];
  for (const mode of other) {
    assert.equal(
      checkMode('research_assessment', mode).allowed,
      false,
      `검사 중 허용되면 안 되는 모드: ${mode}`
    );
  }
  assert.equal(checkMode('research_assessment', 'assessment').allowed, true);
});

test('일반 체험의 기존 의도는 그대로 둔다', () => {
  assert.deepEqual(allowedModes('experience').sort(), ['game', 'guide', 'practice', 'time-attack']);
  assert.equal(isModeAllowed('experience', 'game'), true);
  assert.equal(isModeAllowed('experience', 'time-attack'), true);
  assert.equal(isModeAllowed('experience', 'audit'), false);
  assert.equal(isModeAllowed('experience', 'generate'), false);
});

test('실제로 있는 제한 경로가 모두 모드 표에 있다', () => {
  // 예전 시험은 없는 경로(/api/generate)를 확인해 통과했다. 저장소에 실제로 있는
  // 화면 경로를 훑어 표의 누락을 잡는다.
  const restricted: Record<string, AppMode> = {
    game: 'game',
    'time-attack': 'time-attack',
    admin: 'audit',
    assessment: 'assessment',
    practice: 'practice',
    guide: 'guide',
  };
  for (const [dir, mode] of Object.entries(restricted)) {
    const page = path.join(ROOT, 'src', 'app', dir, 'page.tsx');
    let exists = true;
    try {
      readFileSync(page);
    } catch {
      exists = false;
    }
    if (!exists) continue;
    assert.equal(modeForPath(`/${dir}`), mode, `${dir} 경로가 모드 표에 없다`);
    assert.equal(modeForPath(`/${dir}/anything`), mode);
  }
  assert.equal(modeForPath('/teacher'), null);

  // 연구 수업에서 막혀야 하는 경로는 실제로 막힌다.
  for (const p of ['/game', '/time-attack', '/admin']) {
    const mode = modeForPath(p);
    assert.ok(mode);
    assert.equal(isModeAllowed('research_practice', mode as AppMode), false);
  }
});

test('모르는 모드 이름은 허용하지 않는다', () => {
  assert.equal(parseAppMode('game'), 'game');
  assert.equal(parseAppMode('games'), null);
  assert.equal(parseAppMode(''), null);
  assert.equal(parseAppMode(null), null);
  assert.equal(parseAppMode(123), null);
});

/* ────────────────── 보조 ────────────────── */

function baseRecord(): PracticeSubmissionRecord {
  return {
    schemaVersion: 'v7.0-practice-submission',
    submissionId: 'ps_test',
    clientSubmissionId: 'client-uuid-1',
    ownerKey: 'R-001',
    researchId: 'R-001',
    classResearchId: 'CLS-AAA',
    sessionType: 'research_practice',
    phase: null,
    lesson: 1,
    questionId: 'L01',
    questionLevel: 1,
    band: 'A',
    imageHash: 'synthetic-hash',
    cueVersion: 'synthetic-cue',
    rubricVersion: 'synthetic-rubric',
    text: SYNTH_TEXT,
    startedAt: baseInput.startedAt,
    submittedAt: '2026-09-07T00:10:00.000Z',
    durationMs: 600000,
    attemptNo: 1,
    consentVersion: 'c-v7',
    responseStatus: 'submitted',
    missingReason: null,
    persistStatus: 'failed',
    scoring: {
      operationId: 'op-1',
      repeatIndex: 1,
      result: null,
      calls: [],
      extraCall: null,
      feedback: null,
      modelId: null,
      modelConfig: null,
      promptHash: null,
      codeCommit: 'test',
      scoredAt: null,
      failureReason: null,
    },
    feedbackReview: null,
    createdAt: '2026-09-07T00:10:00.000Z',
  };
}
