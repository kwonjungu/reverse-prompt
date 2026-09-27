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
import { ROUTE_MODES, checkMode, modeForPath, parseAppMode } from '@/server/lessons/mode-policy';
import { allowedModes, isModeAllowed, MODE_BLOCKED_MESSAGE } from '@/lib/research/session-modes';
import type { AppMode, ScoringRun, SessionType } from '@/lib/research/types';
import type { AreaLevel } from '@/lib/scoring';
import {
  PRACTICE_SUBMISSION_SCHEMA_VERSION,
  createLessonStore,
  createMemoryBackend,
  isLegacyPracticeRecord,
  storedAreaLevels,
  toOpenState,
  withoutUndefined,
  type LessonPaths,
  type LessonSessionRecord,
  type LessonStore,
  type PracticeSubmissionRecord,
} from '@/server/lessons/store-core';
import {
  LEGACY_SCORING_MESSAGE,
  NOT_OWNER_MESSAGE,
  REVIEW_NOTE_NOT_COLLECTED_MESSAGE,
  SCORING_MISSING_MESSAGE,
  deriveSubmissionId,
  viewOf,
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
  researchPrivacyHolds: 'test/research/privacy_holds',
  experiencePrivacyHolds: (classCode: string) => `test/classes/${classCode}/privacy_holds`,
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

/** 가짜 채점이 밝히는 실제 모델 이름(설정한 modelId와 다르다). */
const FAKE_SERVED_MODEL = 'fake-model-served-001';

/** 공통 루브릭 v12-2(3영역 4수준) 모양의 가짜 채점 결과. 실제 모델을 부르지 않는다. */
function scoredRun(objectLevel: AreaLevel = 3): ScoringRun {
  return {
    operationId: 'op-1',
    repeatIndex: 1,
    band: 'A',
    result: {
      status: 'scored',
      areas: {
        object: { level: objectLevel, evidence: '파란 상자', missing: [], evidenceMissing: [] },
        feature: {
          level: 2,
          evidence: '파란',
          missing: ['상자의 모양'],
          evidenceMissing: [],
        },
        relation: { level: 'not_applicable', evidence: null, missing: [], evidenceMissing: [] },
      },
      feedbackStatus: 'verified',
    },
    calls: [
      {
        callId: 'op-1:c1',
        retryIndex: 0,
        purpose: 'score',
        levels: { object: objectLevel, feature: 2, relation: 'not_applicable' },
        failureReason: null,
        servedModel: FAKE_SERVED_MODEL,
        startedAt: '2026-09-07T00:00:00.000Z',
        finishedAt: '2026-09-07T00:00:01.000Z',
        durationMs: 1000,
      },
    ],
    extraCall: false,
    feedback: {
      status: 'verified',
      text: '이번 목표(합성)\n[대상] 잘 쓴 점(합성)\n[특징] 다음 행동(합성)\n표현 제안(합성)',
      quote: '파란 상자',
      regenerated: false,
      strengthArea: 'object',
      nextArea: 'feature',
      nextTarget: '상자의 모양',
    },
    modelId: 'fake-model',
    servedModel: FAKE_SERVED_MODEL,
    modelConfig: { temperature: 0 },
    rubricVersion: 'v12-2',
    cueVersion: 'synthetic-cue',
    applicabilitySource: 'cue_pack',
    focusArea: null,
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
    .filter(([k]) => !k.startsWith(`${PATHS.lessonSessions}/`) && !k.includes('/privacy_holds/'))
    .map(([, v]) => v as PracticeSubmissionRecord);
}

function newHarness(options?: {
  objectLevel?: AreaLevel;
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
      return scoredRun(options?.objectLevel ?? 3);
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
  objectLevel?: AreaLevel;
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
  // 연구 세션은 '고쳐 쓰기' 연결만 남기므로(v12) revised로 확인한다.
  const intruder: SubmitSessionContext = { ...researchCtx, researchId: 'R-002', ownerKey: 'R-002' };
  const denied = await recordFeedbackReviewCore(
    { store: h.deps.store, now: h.deps.now },
    intruder,
    { submissionId, kind: 'revised' }
  );
  assert.equal(denied.ok, false);
  assert.equal(denied.message, NOT_OWNER_MESSAGE);

  // 본인은 기록할 수 있다.
  const mine = await recordFeedbackReviewCore(
    { store: h.deps.store, now: h.deps.now },
    researchCtx,
    { submissionId, kind: 'revised' }
  );
  assert.equal(mine.ok, true);
});

test('v12 연구 세션에서는 고치지 않은 까닭을 받지 않는다', async () => {
  const h = await newResearchHarness();
  const submitted = await submitPracticeCore(h.deps, researchCtx, baseInput);
  const submissionId = submitted.status === 'done' ? submitted.submissionId : '';

  const kept = await recordFeedbackReviewCore(
    { store: h.deps.store, now: h.deps.now },
    researchCtx,
    { submissionId, kind: 'kept', note: '이미 색을 적어서 그대로 두었어요' }
  );
  assert.equal(kept.ok, false);
  assert.equal(kept.message, REVIEW_NOTE_NOT_COLLECTED_MESSAGE);

  // 고쳐 쓰기 연결은 남지만, 함께 온 글은 저장하지 않는다.
  const revised = await recordFeedbackReviewCore(
    { store: h.deps.store, now: h.deps.now },
    researchCtx,
    { submissionId, kind: 'revised', note: '몰래 적은 까닭' }
  );
  assert.equal(revised.ok, true);
  const row = submissionRows(h).find((r) => r.submissionId === submissionId);
  assert.equal(row?.feedbackReview?.kind, 'revised');
  assert.equal(row?.feedbackReview?.note, null);
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
      kind: 'revised',
      // 클라이언트가 다른 학급을 지정해도 무시된다.
      experienceClassCode: '0000000_1-1',
    }
  );
  assert.equal(res.ok, true);
});

test('E1 학생은 까닭을 적지 않는다 — 일반 체험에서도 kept·note를 받지 않는다', async () => {
  const h = newHarness();
  const submitted = await submitPracticeCore(h.deps, experienceCtx, baseInput);
  const submissionId = submitted.status === 'done' ? submitted.submissionId : '';
  const kept = await recordFeedbackReviewCore(
    { store: h.deps.store, now: h.deps.now },
    experienceCtx,
    { submissionId, kind: 'kept', note: '그대로 두었어요' }
  );
  assert.equal(kept.ok, false);
  assert.equal(kept.message, REVIEW_NOTE_NOT_COLLECTED_MESSAGE);
  // 고쳐 쓰기 연결은 남고, 함께 온 글은 저장하지 않는다.
  const revised = await recordFeedbackReviewCore(
    { store: h.deps.store, now: h.deps.now },
    experienceCtx,
    { submissionId, kind: 'revised', note: '몰래 적은 까닭' }
  );
  assert.equal(revised.ok, true);
  const json = JSON.stringify([...h.dump()]);
  assert.equal(json.includes('몰래 적은 까닭'), false, '까닭 글이 어딘가에 저장되었다');
  assert.equal(json.includes('그대로 두었어요'), false, '까닭 글이 어딘가에 저장되었다');
});

test('E1 학생 화면에 까닭 입력칸이 없다', () => {
  const src = readFileSync(path.join(process.cwd(), 'src', 'app', 'practice', 'page.tsx'), 'utf8');
  assert.equal(/kind:\s*'kept'/.test(src), false, '연습 화면이 kept를 보낸다');
  assert.equal(src.includes('까닭'), false, '연습 화면에 까닭 안내가 남아 있다');
  assert.equal(src.includes('keep-note'), false);
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
  const h = await newResearchHarness({ objectLevel: 3 });
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

test('다시 들어와 세션이 바뀌어도 소유 키를 여럿 주면 한 학생의 기록으로 합쳐 센다', async () => {
  const h = newHarness();
  await submitPracticeCore(h.deps, experienceCtx, { ...baseInput, submissionId: 'first-entry' });
  await submitPracticeCore(
    h.deps,
    { ...experienceCtx, ownerKey: 'session:sid-2' },
    { ...baseInput, submissionId: 'second-entry' }
  );
  const classKey = experienceCtx.classCode as string;
  const one = await h.store.readStudentSubmissions('experience', classKey, 'session:sid-2');
  assert.deepEqual(one.attemptsByQuestion, { L01: 1 });
  const both = await h.store.readStudentSubmissions('experience', classKey, [
    'session:sid-1',
    'session:sid-2',
    'session:sid-2',
  ]);
  assert.deepEqual(both.attemptsByQuestion, { L01: 2 });
  assert.deepEqual(
    (await h.store.readStudentSubmissions('experience', classKey, [])).attemptsByQuestion,
    {}
  );
});

test('수업 시작은 1~6차시를 한 번에 연다(단계를 하나씩 열지 않는다)', async () => {
  const h = newHarness();
  await openLessonFor(h.store, 2, 'experience');
  const { session } = await h.store.openLessonSession({
    classResearchId: 'CLS-AAA',
    sessionType: 'experience',
    lesson: 1,
    alsoOpen: [1, 2, 3, 4, 5, 6],
    openedBy: 'admin_console',
    reason: null,
  });
  assert.deepEqual(session.allowedLessons, [1, 2, 3, 4, 5, 6]);
  assert.equal(session.currentLesson, 1);
  assert.equal(session.closedAt, null);
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

test('F4 개인정보 보류는 보류 여부·유형·시각만 기록하고 글·학생은 남기지 않는다', async () => {
  const h = await newResearchHarness();
  const deps: SubmitDeps = {
    ...h.deps,
    checkPii: () => ({ decision: 'hold_for_teacher', matchedTypes: ['phone'], checkVersion: 'pii-test-1' }),
  };
  const res = await submitPracticeCore(deps, researchCtx, baseInput);
  assert.equal(res.status, 'blocked');
  assert.equal(h.gradeCalls(), 0);
  const holds = await h.store.listPrivacyHolds('research_practice', 'CLS-AAA');
  assert.equal(holds.length, 1);
  assert.deepEqual(holds[0], {
    schemaVersion: 'v12.2-privacy-hold',
    sessionType: 'research_practice',
    classKey: 'CLS-AAA',
    questionId: SYNTH_ENTRY.questionId,
    types: ['phone'],
    checkVersion: 'pii-test-1',
    heldAt: '2026-09-07T00:10:00.000Z',
  });
  const json = JSON.stringify([...h.dump()]);
  assert.equal(json.includes(SYNTH_TEXT), false, '보류된 글이 저장되었다');
  assert.equal(json.includes('R-001'), false, '보류 기록에 연구ID가 남았다');
  // 제출 문서는 생기지 않는다(모델로 보내지 않았으므로).
  assert.equal(submissionRows(h).length, 0);

  // 일반 체험도 같은 모양으로 반 아래에 남는다.
  const e = newHarness();
  const eDeps: SubmitDeps = { ...e.deps, checkPii: () => ({ decision: 'hold_for_teacher', matchedTypes: ['email'] }) };
  await submitPracticeCore(eDeps, experienceCtx, baseInput);
  const eHolds = await e.store.listPrivacyHolds('experience', experienceCtx.classCode!);
  assert.equal(eHolds.length, 1);
  assert.deepEqual(eHolds[0].types, ['email']);
  assert.equal(JSON.stringify([...e.dump()]).includes('sid-1'), false, '보류 기록에 세션이 남았다');
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

/* ────────────────── 공통 루브릭 v12-2: 화면 결과와 저장 ────────────────── */

test('v12-2 화면 결과는 영역별 수준만 담고 100점·종합 수준이 없다', async () => {
  const h = await newResearchHarness({ objectLevel: 3 });
  const res = await submitPracticeCore(h.deps, researchCtx, baseInput);
  assert.equal(res.status, 'done');
  if (res.status !== 'done') return;
  assert.deepEqual(res.scoring, {
    status: 'scored',
    levels: { object: 3, feature: 2, relation: 'not_applicable' },
    band: 'A',
  });
  for (const key of ['score', 'axisScores', 'overallLevel', 'appLevel', 'areas']) {
    assert.equal(key in res.scoring, false, `화면 결과에 ${key}가 있으면 안 된다`);
  }
  assert.equal(res.feedback?.status, 'verified');
  assert.equal(res.feedback?.text.split('\n').length, 4);
});

test('F1 시도마다 저장하는 필드(논문 Ⅲ.3.다) — 문장·피드백 원문·영역별 수준·근거·시각·모델·버전·이미지 해시', async () => {
  const h = await newResearchHarness({ objectLevel: 3 });
  await submitPracticeCore(h.deps, researchCtx, baseInput);
  const [row] = submissionRows(h) as unknown as Record<string, any>[];
  // 제출 문장
  assert.equal(row.text, SYNTH_TEXT);
  // 피드백 원문(네 줄)과 상태
  assert.equal(typeof row.scoring.feedback.text, 'string');
  assert.equal(row.scoring.feedback.text.split('\n').length, 4);
  assert.ok(['verified', 'regenerated', 'fallback'].includes(row.scoring.feedback.status));
  // 영역별 수준(해당 없음 포함)과 근거·빠진 정보·증거 부족
  for (const area of ['object', 'feature', 'relation']) {
    const a = row.scoring.result.areas[area];
    assert.ok('level' in a && 'evidence' in a && 'missing' in a && 'evidenceMissing' in a, area);
  }
  assert.equal(row.scoring.result.areas.relation.level, 'not_applicable');
  // 시작·제출 시각, 걸린 시간
  assert.equal(row.startedAt, baseInput.startedAt);
  assert.equal(typeof row.submittedAt, 'string');
  assert.equal(typeof row.durationMs, 'number');
  // 모델(설정값과 실제 응답 모델)·지시문 해시·루브릭·단서·스키마 버전·이미지 해시
  assert.equal(row.scoring.modelId, 'fake-model');
  assert.ok('servedModel' in row.scoring);
  assert.ok('promptHash' in row.scoring);
  assert.equal(row.rubricVersion, 'v12-2');
  assert.ok('cueVersion' in row);
  assert.equal(row.schemaVersion, 'v12.2-practice-submission');
  assert.ok('imageHash' in row);
  // 연구ID·학급·문항·밴드·시도 번호
  assert.equal(row.researchId, 'R-001');
  assert.equal(row.classResearchId, 'CLS-AAA');
  assert.equal(row.questionId, SYNTH_ENTRY.questionId);
  assert.equal(row.attemptNo, 1);
  assert.ok('band' in row);
  // 결측(자료 없음)은 수준 1이 아니라 areas: null로 남는다.
  const m = await newResearchHarness({ gradeThrows: true });
  await submitPracticeCore(m.deps, researchCtx, baseInput);
  const [missingRow] = submissionRows(m) as unknown as Record<string, any>[];
  assert.equal(missingRow.scoring.result, null);
  assert.equal(missingRow.responseStatus, 'submitted');
  // 이름·출석번호·학교는 없다.
  const json = JSON.stringify(row);
  for (const key of ['studentName', 'name', 'attendanceNumber', 'schoolName', 'studentNumber']) {
    assert.equal(key in row, false, `${key}가 저장되었다`);
  }
  assert.equal(json.includes('studentNumber'), false);
});

test('채점 기록에 설정 모델과 실제로 답한 모델을 함께 남긴다', async () => {
  const h = await newResearchHarness();
  await submitPracticeCore(h.deps, researchCtx, baseInput);
  const [row] = submissionRows(h);
  assert.equal(row.scoring.modelId, 'fake-model');
  assert.equal(row.scoring.servedModel, FAKE_SERVED_MODEL);
  assert.equal(row.scoring.extraCall, false, 'v12-2는 추가 호출이 없다');
  assert.equal(row.scoring.applicabilitySource, 'cue_pack');
  // 루브릭 버전은 레지스트리 값('synthetic-rubric')보다 채점 절차가 실제로 쓴 값을 먼저 쓴다.
  assert.equal(row.rubricVersion, 'v12-2');
  assert.equal(row.schemaVersion, PRACTICE_SUBMISSION_SCHEMA_VERSION);
  assert.ok(row.schemaVersion.startsWith('v12.2'));
  // 영역별 수준·근거·빠진 정보와 피드백 원문이 그대로 남는다.
  const result = row.scoring.result;
  assert.ok(result && 'areas' in result && result.status === 'scored');
  if (result && 'areas' in result && result.status === 'scored') {
    assert.equal(result.areas.object.level, 3);
    assert.equal(result.areas.feature.evidence, '파란');
    assert.deepEqual(result.areas.feature.missing, ['상자의 모양']);
    assert.equal(result.areas.relation.level, 'not_applicable');
  }
  assert.equal(row.scoring.feedback?.nextArea, 'feature');
  assert.ok(row.scoring.feedback?.text.includes('[특징]'));
  assert.equal(row.scoring.calls[0] && 'servedModel' in row.scoring.calls[0], true);
});

test('채점 전에 실패하면 실제 모델을 지어내지 않고 레지스트리의 루브릭 버전을 남긴다', async () => {
  const h = await newResearchHarness({ gradeThrows: true });
  await submitPracticeCore(h.deps, researchCtx, baseInput);
  const [row] = submissionRows(h);
  assert.equal(row.scoring.result, null);
  assert.equal(row.scoring.servedModel, null);
  assert.equal(row.scoring.modelId, null);
  assert.equal(row.scoring.extraCall, null);
  assert.equal(row.rubricVersion, SYNTH_ENTRY.rubricVersion);
});

/** 저장소에 남아 있는 옛 v7(축별 5수준·100점) 연습 기록. 새 필드(servedModel)가 없다. */
function legacyRecord(overrides?: Partial<PracticeSubmissionRecord>): PracticeSubmissionRecord {
  const base = baseRecord();
  const { servedModel: _dropped, ...oldScoring } = base.scoring;
  void _dropped;
  return {
    ...base,
    schemaVersion: 'v7.0-practice-submission',
    rubricVersion: 'v7-candidate',
    persistStatus: 'stored',
    scoring: {
      ...oldScoring,
      result: {
        status: 'scored',
        levels: { objectLevel: 4, specificityLevel: 3, contextLevel: null },
        score: 87.5,
        axisScores: { object: 50, specificity: 37.5, context: null },
        feedbackStatus: 'verified',
      },
      extraCall: false,
      feedback: { status: 'verified', text: '옛 피드백(합성)', quote: null, regenerated: false },
      modelId: 'old-model',
    } as PracticeSubmissionRecord['scoring'],
    ...overrides,
  };
}

test('옛 v7 연습 기록은 읽히되 영역 수준을 지어내지 않는다', () => {
  const view = viewOf(legacyRecord());
  assert.deepEqual(view.scoring, { status: 'missing', message: LEGACY_SCORING_MESSAGE });
  assert.equal('levels' in view.scoring, false);
  // 옛 기준의 피드백 문장은 새 화면에 보여 주지 않는다.
  assert.equal(view.feedback, null);

  // 옛 방식에서 채점하지 못한 기록도 수준 없이 읽힌다.
  const oldMissing = legacyRecord();
  oldMissing.scoring = {
    ...oldMissing.scoring,
    result: {
      status: 'missing',
      levels: null,
      score: null,
      axisScores: null,
      reason: 'required_call_failed',
    },
  };
  assert.equal(viewOf(oldMissing).scoring.status, 'missing');
});

test('옛 v7 기록을 같은 제출로 다시 보내도 모델을 부르지 않고 수준을 만들지 않는다', async () => {
  const h = await newResearchHarness();
  const submissionId = deriveSubmissionId({
    ownerKey: researchCtx.ownerKey,
    questionId: baseInput.questionId,
    startedAt: baseInput.startedAt,
    text: SYNTH_TEXT,
  });
  const saved = await h.store.saveSubmission(legacyRecord({ submissionId }));
  assert.equal(saved.ok, true);

  const res = await submitPracticeCore(h.deps, researchCtx, baseInput);
  assert.equal(h.gradeCalls(), 0, '저장된 제출이면 다시 채점하지 않는다');
  assert.equal(res.status, 'done');
  if (res.status !== 'done') return;
  assert.equal(res.save.duplicate, true);
  assert.deepEqual(res.scoring, { status: 'missing', message: LEGACY_SCORING_MESSAGE });
  assert.equal(res.feedback, null);
  // 옛 기록이 있어도 시도 횟수 집계는 그대로 된다.
  const summary = await h.store.readStudentSubmissions('research_practice', 'CLS-AAA', 'R-001');
  assert.equal(summary.attemptsByQuestion.L01, 1);
});

test('옛 기록 판정 — 결과 모양, 없으면 루브릭 버전, 그다음 스키마 버전', () => {
  const v12Missing = {
    rubricVersion: 'v12-2',
    scoring: { result: { status: 'missing', areas: null, reason: 'model_error' } },
  };
  assert.equal(isLegacyPracticeRecord(v12Missing), false);
  assert.equal(isLegacyPracticeRecord(legacyRecord()), true);
  // 채점 전 실패(result null)는 루브릭 버전으로 가른다.
  assert.equal(isLegacyPracticeRecord({ rubricVersion: 'v7-candidate', scoring: { result: null } }), true);
  assert.equal(isLegacyPracticeRecord({ rubricVersion: 'v12-2', scoring: { result: null } }), false);
  // 루브릭 버전도 없으면 스키마 버전을 본다. 알 수 없으면 옛 기록으로 보지 않는다.
  assert.equal(
    isLegacyPracticeRecord({ rubricVersion: null, schemaVersion: 'v7.0-practice-submission', scoring: null }),
    true
  );
  assert.equal(
    isLegacyPracticeRecord({ rubricVersion: null, schemaVersion: PRACTICE_SUBMISSION_SCHEMA_VERSION, scoring: null }),
    false
  );
});

test('저장된 영역 판정이 형식에 맞지 않으면 보정하지 않고 결측으로 읽는다', () => {
  const run = scoredRun(3);
  const broken = {
    ...run.result,
    areas: { ...(run.result as { areas: object }).areas, feature: { level: 5, evidence: null, missing: [] } },
  };
  assert.equal(storedAreaLevels(broken), null);
  assert.equal(storedAreaLevels({ status: 'scored', areas: { object: { level: 2 } } }), null);
  assert.equal(storedAreaLevels({ ...run.result, areas: { ...(run.result as { areas: object }).areas, object: { level: '3' } } }), null);
  assert.deepEqual(storedAreaLevels(run.result), { object: 3, feature: 2, relation: 'not_applicable' });

  const record = { ...baseRecord(), rubricVersion: 'v12-2', persistStatus: 'stored' as const };
  record.scoring = { ...record.scoring, result: broken as never };
  assert.deepEqual(viewOf(record).scoring, { status: 'missing', message: SCORING_MISSING_MESSAGE });
});

test('저장 전에 undefined 키만 빼고 null은 그대로 둔다', () => {
  const cleaned = withoutUndefined({
    a: 1,
    b: undefined,
    c: null,
    nested: { d: undefined, e: 'x', list: [{ f: undefined, g: null }] },
  });
  assert.deepEqual(cleaned, { a: 1, c: null, nested: { e: 'x', list: [{ g: null }] } });
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

test('연구 수업에서는 설명·연습만 열리고 사전·사후 검사도 열리지 않는다', async () => {
  assert.deepEqual(allowedModes('research_practice').sort(), ['guide', 'practice']);
  assert.equal(checkMode('research_practice', 'assessment').allowed, false);

  // 검사 세션으로는 연습 제출이 서버에서 막힌다(모델을 부르지 않는다).
  const h = await newResearchHarness();
  const res = await submitPracticeCore(
    h.deps,
    { ...researchCtx, sessionType: 'research_assessment' },
    baseInput
  );
  assert.equal(res.status, 'blocked');
  assert.equal(h.gradeCalls(), 0);
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
    'admin/audit': 'audit',
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
  // /admin은 학생 활동이 아니라 통합 관리 화면이다. 관리자 비밀번호 세션이 막는다.
  assert.equal(modeForPath('/admin'), null);
  assert.equal(modeForPath('/administrator'), null);

  // 연구 수업에서 막혀야 하는 경로는 실제로 막힌다.
  for (const p of ['/game', '/time-attack', '/admin/audit']) {
    const mode = modeForPath(p);
    assert.ok(mode);
    assert.equal(isModeAllowed('research_practice', mode as AppMode), false);
  }
});

test('검사 학생용 API도 모드 표에 있고 연구 수업(연습)·일반 체험에서는 막힌다', () => {
  for (const api of ['state', 'start', 'submit', 'failure']) {
    const p = `/api/assessment/${api}`;
    assert.equal(modeForPath(p), 'assessment', `${p} 경로가 모드 표에 없다`);
    assert.equal(isModeAllowed('research_practice', 'assessment'), false);
    assert.equal(isModeAllowed('experience', 'assessment'), false);
    assert.equal(isModeAllowed('research_assessment', 'assessment'), true);
  }
  // 연구자 내려받기는 학생 활동이 아니므로 모드 표 밖이다(권한은 server action이 다시 확인한다).
  assert.equal(modeForPath('/api/assessment/export'), null);
  // 비슷한 이름이 접두어로 잘못 걸리지 않는다.
  assert.equal(modeForPath('/api/assessment/statement'), null);
});

test('middleware matcher가 모드 표의 모든 경로를 잡는다', () => {
  // 표에만 있고 matcher에 없으면 edge 단계가 그 경로를 아예 보지 못한다.
  const source = readFileSync(path.join(ROOT, 'src', 'middleware.ts'), 'utf8');
  for (const { prefix } of ROUTE_MODES) {
    assert.ok(source.includes(`'${prefix}/:path*'`), `matcher에 ${prefix}가 없다`);
  }
});

test('연구 세션에서는 연습·설명만 열리고 게임·타임어택·검사·감수는 막힌다', () => {
  const research_practice: AppMode[] = ['guide', 'practice'];
  for (const mode of ['guide', 'practice', 'assessment', 'game', 'time-attack', 'audit', 'generate'] as AppMode[]) {
    assert.equal(
      isModeAllowed('research_practice', mode),
      research_practice.includes(mode),
      `research_practice / ${mode}`
    );
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
      servedModel: null,
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
