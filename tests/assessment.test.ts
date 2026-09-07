/**
 * 검사 수집·사후 채점 시험 (수용시험 8·9·10)
 *
 * 실제 모델을 부르지 않는다. 채점 함수는 가짜 구현을 넣는다.
 * 레지스트리도 가짜를 넣어 candidate·frozen 상태를 각각 확인한다.
 */

import { test } from 'node:test';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';

import { SCHEMA_VERSION, type ScoringRun, type SubmissionRecord } from '@/lib/research/types';
import type { PublicQuestionView, RegistryEntry } from '@/server/registry/contract';
import type { GradingRequest } from '@/server/grading/contract';
import {
  EXPECTED_ASSESSMENT_ORDER,
  EXPECTED_ITEM_SECONDS,
  INTRO_SECONDS,
  CLOSING_SECONDS,
  TOTAL_ASSESSMENT_SECONDS,
  acceptsSubmission,
  isExpired,
  remainingSeconds,
  totalPlannedSeconds,
  verifyItemPlan,
} from '@/server/assessment/timing';
import {
  assessmentAssetFingerprint,
  buildAssessmentPlan,
  checkParticipation,
  checkResearchStartAllowed,
  findForbiddenPayloadKeys,
  toStudentItem,
  type AssessmentRegistryView,
} from '@/server/assessment/session';
import {
  checkSubmitGuards,
  guardFailureToMissingReason,
  isEmptyResponse,
  makeMissingRecord,
  makeSubmittedRecord,
  resolveSubmission,
  sanitizeResponseText,
  type SubmissionContext,
} from '@/server/assessment/submission';
import {
  cellIdOf,
  createInMemoryAssessmentStore,
  makeItemWindow,
  type AssessmentStore,
  type InspectableStore,
} from '@/server/assessment/store';
import {
  confirmTechnicalFailure,
  finalizeTimeouts,
  getAssessmentState,
  openAssessmentSession,
  reportTechnicalFailure,
  startAssessmentItem,
  submitAssessmentResponse,
  type CollectDeps,
} from '@/server/assessment/collect';
import {
  PRIMARY_REPEAT_INDEX,
  buildGraderPayload,
  buildScoringQueue,
  findForbiddenGraderFields,
  primaryRun,
  reliabilityRuns,
  runScoringJob,
  ScoringBlockedError,
} from '@/server/assessment/scoring-job';
import type { ConsentRecord } from '@/lib/research/types';
import type { Principal, Role } from '@/server/auth/contract';

/* ────────────────────── 가짜 레지스트리 ────────────────────── */

const IMAGE_HASH: Record<string, string> = {
  T1: 'f4734f7d626c58835c18d5c1a6f5362e7a23c9c9cd4b35b48c49971d5636755a',
  T2_v7: '629dcc35322913f73c5db308b9ab3d6ac1ce4f9b47a701ad736720307de685f7',
  T3: 'e5f3e07939c55e44ea33e4cca1f0f5a36573f62c01697a366ed29a94fbda5cb9',
};

const BANDS: Record<string, RegistryEntry['band']> = { T1: 'A', T2_v7: 'B', T3: 'C' };

function fakeEntry(questionId: string, status: RegistryEntry['status']): RegistryEntry {
  return {
    questionId,
    kind: 'assessment',
    band: BANDS[questionId],
    lesson: null,
    imageVersion: 'v7',
    imageSha256: IMAGE_HASH[questionId],
    cueVersion: 'v7-candidate',
    rubricVersion: 'v7-candidate',
    status,
    approvedAt: status === 'frozen' ? '2026-01-01T00:00:00.000Z' : null,
    allowedSessionTypes: ['research_assessment'],
    durationSeconds: EXPECTED_ITEM_SECONDS[questionId],
    cuesLoaded: status === 'frozen',
  };
}

function fakeRegistry(options?: {
  status?: RegistryEntry['status'];
  researchReady?: boolean;
  order?: string[];
}): AssessmentRegistryView {
  const status = options?.status ?? 'frozen';
  const order = options?.order ?? [...EXPECTED_ASSESSMENT_ORDER];
  const researchReady = options?.researchReady ?? status === 'frozen';
  return {
    assessmentOrder: () => [...order],
    getEntry: (questionId) => {
      if (!IMAGE_HASH[questionId]) throw new Error(`등록되지 않은 문항: ${questionId}`);
      return fakeEntry(questionId, status);
    },
    toPublicView: (entry): PublicQuestionView => ({
      questionId: entry.questionId,
      kind: entry.kind,
      lesson: entry.lesson,
      imageUrl: `/api/research/asset/${entry.questionId}`,
      durationSeconds: entry.durationSeconds,
      instruction: '그림을 보고, 무엇이 있고 어떻게 보이는지 자세히 써 봐요.',
    }),
    readiness: () =>
      researchReady
        ? { researchReady: true, blockers: [] }
        : { researchReady: false, blockers: ['전문가 확정 미완료'] },
  };
}

/* ────────────────────── 수용시험 8 ────────────────────── */

test('수용시험 8: 사전·사후가 같은 검사 파일 해시·순서·제한시간을 쓴다', () => {
  const registry = fakeRegistry();
  // 시점을 인자로 받지 않는 하나의 계획을 두 시점이 그대로 쓴다.
  const prePlan = buildAssessmentPlan(registry);
  const postPlan = buildAssessmentPlan(registry);

  assert.equal(assessmentAssetFingerprint(prePlan), assessmentAssetFingerprint(postPlan));
  assert.deepEqual(
    prePlan.items.map((i) => i.questionId),
    ['T1', 'T2_v7', 'T3']
  );
  assert.deepEqual(
    prePlan.items.map((i) => i.durationSeconds),
    [420, 480, 600]
  );
  assert.equal(prePlan.planCheck.ok, true);
});

test('수용시험 8: 단색 배경의 이전 T2는 검사 레지스트리에 없다', () => {
  const registry = fakeRegistry();
  assert.equal(registry.assessmentOrder().includes('T2'), false);
  assert.throws(() => registry.getEntry('T2'), /등록되지 않은 문항/);
});

test('수용시험 8: candidate·미승인 레지스트리에서는 본연구를 시작할 수 없다', () => {
  const candidate = checkResearchStartAllowed(fakeRegistry({ status: 'candidate' }));
  assert.equal(candidate.allowed, false);
  assert.ok(candidate.blockers.some((b) => b.includes('candidate')));
  assert.ok(candidate.blockers.some((b) => b.includes('승인일')));

  // researchReady=false 만으로도 막힌다.
  const notReady = checkResearchStartAllowed(fakeRegistry({ status: 'frozen', researchReady: false }));
  assert.equal(notReady.allowed, false);

  // 합성 자료 모의 실행은 별도 플래그로만 허용한다.
  const dry = checkResearchStartAllowed(fakeRegistry({ status: 'candidate' }), {
    allowCandidate: true,
  });
  assert.equal(dry.allowed, true);
  assert.ok(dry.blockers.length > 0, '모의 실행이어도 미확정 사유는 남긴다');

  const frozen = checkResearchStartAllowed(fakeRegistry({ status: 'frozen' }));
  assert.equal(frozen.allowed, true);
  assert.deepEqual(frozen.blockers, []);
});

test('수용시험 8: 33분 계획 검산 — 안내 5분 + 7/8/10분 + 마무리 3분', () => {
  assert.equal(INTRO_SECONDS + 420 + 480 + 600 + CLOSING_SECONDS, TOTAL_ASSESSMENT_SECONDS);
  assert.equal(totalPlannedSeconds([420, 480, 600]), 33 * 60);

  // 순서가 바뀌거나 제한시간이 어긋나면 계획 검산이 실패한다.
  assert.equal(
    verifyItemPlan([
      { questionId: 'T1', durationSeconds: 420 },
      { questionId: 'T3', durationSeconds: 600 },
      { questionId: 'T2_v7', durationSeconds: 480 },
    ]).ok,
    false
  );
  assert.equal(
    verifyItemPlan([
      { questionId: 'T1', durationSeconds: 420 },
      { questionId: 'T2_v7', durationSeconds: 500 },
      { questionId: 'T3', durationSeconds: 600 },
    ]).ok,
    false
  );
});

/* ────────────────────── 수용시험 9 ────────────────────── */

const T0 = Date.parse('2026-03-02T01:00:00.000Z');

test('수용시험 9: 남은 시간은 서버 시각 기준이며 새로고침으로 초기화되지 않는다', () => {
  const win = { questionId: 'T1', startedAtMs: T0, durationSeconds: 420 };

  // 100초 지난 시점
  assert.equal(remainingSeconds(win, T0 + 100_000), 320);

  // 새로고침을 흉내 내어 같은 창(window)으로 다시 계산해도 값이 그대로다.
  const refreshed = { ...win };
  assert.equal(remainingSeconds(refreshed, T0 + 100_000), 320);
  assert.equal(remainingSeconds(refreshed, T0 + 200_000), 220);

  assert.equal(isExpired(win, T0 + 419_000), false);
  assert.equal(isExpired(win, T0 + 420_000), true);
  assert.equal(remainingSeconds(win, T0 + 500_000), 0);

  // 짧은 네트워크 지연은 허용 오차 안에서 받아 준다.
  assert.equal(acceptsSubmission(win, T0 + 420_500), true);
  assert.equal(acceptsSubmission(win, T0 + 430_000), false);
});

test('수용시험 9: 학생 payload에 점수·앵커·단서·모범답이 없다', () => {
  const plan = buildAssessmentPlan(fakeRegistry());
  const item = toStudentItem(
    plan.items[0],
    1,
    {
      questionId: 'T1',
      startedAt: new Date(T0).toISOString(),
      durationSeconds: 420,
      submitted: false,
    },
    T0 + 60_000
  );

  assert.deepEqual(Object.keys(item).sort(), [
    'durationSeconds',
    'imageUrl',
    'instruction',
    'order',
    'questionId',
    'remainingSeconds',
    'startedAt',
    'submitted',
  ]);
  assert.deepEqual(findForbiddenPayloadKeys(item), []);
  // 이미지 데이터 URI를 싣지 않고 인증 경로만 준다.
  assert.ok(item.imageUrl.startsWith('/api/'));
  assert.equal(item.imageUrl.startsWith('data:'), false);

  // 단서·앵커가 섞이면 그물에 걸린다.
  const leaky = { ...item, cues: { coreObjects: ['세모 블록'] }, score: 100 };
  const found = findForbiddenPayloadKeys(leaky);
  assert.ok(found.includes('$.cues'));
  assert.ok(found.includes('$.score'));
  assert.ok(found.includes('$.cues.coreObjects'));
});

const CTX: SubmissionContext = {
  submissionId: 'a'.repeat(32),
  researchId: 'R-0001',
  classResearchId: 'C-01',
  phase: 'pre',
  questionId: 'T1',
  band: 'A',
  imageHash: IMAGE_HASH.T1,
  cueVersion: 'v7-candidate',
  rubricVersion: 'v7-candidate',
  consentVersion: 'consent-v7',
  startedAt: new Date(T0).toISOString(),
  attemptNo: 1,
};

test('수용시험 9: 같은 submissionId 재요청은 최초 값을 바꾸지 않고 거절 기록만 남긴다', () => {
  const first = makeSubmittedRecord(CTX, '노란 세모 블록이 있다.', T0 + 60_000);
  const decision1 = resolveSubmission(null, first);
  assert.equal(decision1.outcome, 'stored');
  assert.equal(decision1.authoritative.text, '노란 세모 블록이 있다.');

  // 더블클릭·네트워크 재시도로 텍스트가 달라진 두 번째 요청이 왔다.
  const second = makeSubmittedRecord(CTX, '완전히 다른 글', T0 + 61_000);
  const decision2 = resolveSubmission(decision1.authoritative, second);

  assert.equal(decision2.outcome, 'rejected_duplicate');
  assert.equal(decision2.toStore, null);
  // 최초 값이 불변이다.
  assert.equal(decision2.authoritative.text, '노란 세모 블록이 있다.');
  assert.equal(decision2.authoritative.submittedAt, first.submittedAt);
  assert.equal(decision2.rejection?.persistStatus, 'rejected_duplicate');
});

test('수용시험 9: 저장 실패로 남은 자리는 같은 제출ID로 다시 쓰되 새 도전으로 세지 않는다', () => {
  const failed: SubmissionRecord = {
    ...makeSubmittedRecord(CTX, '첫 시도', T0 + 60_000),
    persistStatus: 'failed',
  };
  const retry = makeSubmittedRecord({ ...CTX, attemptNo: 9 }, '다시 시도', T0 + 62_000);
  const decision = resolveSubmission(failed, retry);

  assert.equal(decision.outcome, 'retried_after_failure');
  assert.equal(decision.authoritative.attemptNo, 1, 'attemptNo를 올리지 않는다');
  assert.equal(decision.authoritative.persistStatus, 'stored');
});

test('수용시험 9: 저장소가 같은 칸의 두 번째 쓰기를 거절한다', async () => {
  const store = createInMemoryAssessmentStore();
  const first = makeSubmittedRecord(CTX, '노란 세모 블록이 있다.', T0 + 60_000);
  await store.putSubmission(first);
  await assert.rejects(
    () => store.putSubmission(makeSubmittedRecord(CTX, '다른 글', T0 + 61_000)),
    /이미 있는 문서/
  );
  // 제출ID를 새로 지어내도 같은 칸이면 마찬가지다.
  await assert.rejects(
    () =>
      store.putSubmission(
        makeSubmittedRecord({ ...CTX, submissionId: 'b'.repeat(32) }, '또 다른 글', T0 + 62_000)
      ),
    /이미 있는 문서/
  );
  const stored = await store.getSubmissionForCell(CTX.researchId, CTX.phase, CTX.questionId);
  assert.equal(stored?.text, '노란 세모 블록이 있다.');
});

test('수용시험 9: 시간 종료 미제출은 timeout_unsubmitted이고 점수를 만들지 않는다', () => {
  const record = makeMissingRecord(CTX, 'timeout_unsubmitted', T0 + 500_000);

  assert.equal(record.responseStatus, 'missing');
  assert.equal(record.missingReason, 'timeout_unsubmitted');
  assert.equal(record.submittedAt, null);
  assert.equal(record.durationMs, null);
  assert.equal(record.text, '');
  // SubmissionRecord에는 점수 필드 자체가 없다. 빈 응답이 최저 점수가 될 자리가 없다.
  assert.equal('score' in record, false);
  assert.equal('levels' in record, false);
});

test('수용시험 9: 장애·철회·미동의는 서로 다른 상태다', () => {
  const reasons = ['timeout_unsubmitted', 'technical_failure', 'consent_withdrawn', 'not_consented'] as const;
  const made = reasons.map((r) => makeMissingRecord(CTX, r, T0));
  assert.deepEqual(
    made.map((m) => m.missingReason),
    [...reasons]
  );
  assert.equal(new Set(made.map((m) => m.missingReason)).size, 4);
});

test('수용시험 9: 결측 기록에 초안 텍스트를 넣을 자리가 없다', () => {
  // makeMissingRecord는 텍스트 인자를 받지 않는다. 타이핑 초안이 연구 응답이 되지 않는다.
  assert.equal(makeMissingRecord.length, 3);
  assert.equal(makeMissingRecord(CTX, 'timeout_unsubmitted', T0).text, '');
});

test('수용시험 9: 미동의·철회·마감 뒤 제출을 서버가 거부한다', () => {
  const base = {
    submissionId: 'a'.repeat(32),
    consentActive: true,
    consentWithdrawn: false,
    sessionOpen: true,
    itemStarted: true,
    withinDeadline: true,
    registryReady: true,
    hasText: true,
  };
  assert.deepEqual(checkSubmitGuards(base), { ok: true });
  assert.deepEqual(checkSubmitGuards({ ...base, consentActive: false }), {
    ok: false,
    reason: 'not_consented',
  });
  assert.deepEqual(checkSubmitGuards({ ...base, consentWithdrawn: true }), {
    ok: false,
    reason: 'consent_withdrawn',
  });
  assert.deepEqual(checkSubmitGuards({ ...base, withinDeadline: false }), {
    ok: false,
    reason: 'deadline_passed',
  });
  assert.deepEqual(checkSubmitGuards({ ...base, registryReady: false }), {
    ok: false,
    reason: 'registry_not_ready',
  });
  assert.deepEqual(checkSubmitGuards({ ...base, submissionId: 'short' }), {
    ok: false,
    reason: 'invalid_submission_id',
  });
  // 빈 응답은 유효 제출로 받지 않는다. 결측 칸도 만들지 않는다.
  assert.deepEqual(checkSubmitGuards({ ...base, hasText: false }), {
    ok: false,
    reason: 'empty_response',
  });
  assert.equal(guardFailureToMissingReason('empty_response'), null);
  // 열지 않은 문항에 온 제출도 받지 않는다.
  assert.deepEqual(checkSubmitGuards({ ...base, itemStarted: false }), {
    ok: false,
    reason: 'item_not_started',
  });
});

test('수용시험 9: 동의·승낙이 활성인 참가자만 검사 수집 대상이다', () => {
  const researchStart = { allowed: true, blockers: [] };
  const session = {
    assessmentSessionId: 's1',
    classResearchId: 'C-01',
    phase: 'pre' as const,
    openedAt: new Date(T0).toISOString(),
    closedAt: null,
    openedBy: 'teacher-1',
    registryVersion: 'v7',
  };
  const active = {
    researchId: 'R-0001',
    guardianConsent: 'granted' as const,
    studentAssent: 'granted' as const,
    consentVersion: 'consent-v7',
    updatedAt: '2026-01-01T00:00:00.000Z',
    withdrawnAt: null,
  };

  assert.deepEqual(checkParticipation({ consent: active, session, researchStart }), { ok: true });
  assert.deepEqual(
    checkParticipation({ consent: { ...active, studentAssent: 'declined' }, session, researchStart }),
    { ok: false, reason: 'not_consented' }
  );
  assert.deepEqual(
    checkParticipation({
      consent: { ...active, withdrawnAt: '2026-03-01T00:00:00.000Z' },
      session,
      researchStart,
    }),
    { ok: false, reason: 'consent_withdrawn' }
  );
  assert.deepEqual(checkParticipation({ consent: active, session: null, researchStart }), {
    ok: false,
    reason: 'session_not_open',
  });
  assert.deepEqual(
    checkParticipation({
      consent: active,
      session,
      researchStart: { allowed: false, blockers: ['후보 상태'] },
    }),
    { ok: false, reason: 'research_not_ready' }
  );
});

test('제출 텍스트 정제는 제어문자만 없애고 내용을 고치지 않는다', () => {
  assert.equal(sanitizeResponseText('  노란 세모 블록  '), '노란 세모 블록');
  assert.equal(sanitizeResponseText('한 줄\r\n두 줄'), '한 줄\n두 줄');
  // 눈에 보이지 않는 제어문자는 없앤다.
  assert.equal(sanitizeResponseText('노란\u0000 세모 블록'), '노란 세모 블록');
  // 맞춤법을 고치거나 내용을 바꾸지 않는다.
  assert.equal(sanitizeResponseText('노란색 세모 블럭'), '노란색 세모 블럭');
  assert.equal(sanitizeResponseText('노란  세모 블록'), '노란  세모 블록');
});

/* ────────────────────── 수용시험 10 ────────────────────── */

function makeSubmission(
  id: string,
  phase: 'pre' | 'post',
  questionId: string,
  researchId: string
): SubmissionRecord {
  return makeSubmittedRecord(
    {
      ...CTX,
      submissionId: id,
      phase,
      questionId,
      band: BANDS[questionId],
      imageHash: IMAGE_HASH[questionId],
      researchId,
    },
    `${researchId} ${phase} ${questionId} 응답`,
    T0 + 60_000
  );
}

const SAMPLE: SubmissionRecord[] = [];
for (const researchId of ['R-0001', 'R-0002', 'R-0003']) {
  for (const phase of ['pre', 'post'] as const) {
    for (const questionId of EXPECTED_ASSESSMENT_ORDER) {
      SAMPLE.push(
        makeSubmission(
          `sub_${researchId}_${phase}_${questionId}`.padEnd(20, '0'),
          phase,
          questionId,
          researchId
        )
      );
    }
  }
}

test('수용시험 10: 채점자 payload에 시점·학생·학급·자동 점수가 없다', () => {
  const payload = buildGraderPayload(SAMPLE[0], 'op_1', 1);
  // 밴드도 보내지 않는다. 서버 레지스트리가 questionId로 확정한다.
  assert.deepEqual(Object.keys(payload).sort(), [
    'operationId',
    'questionId',
    'repeatIndex',
    'sessionType',
    'studentText',
    'wantFeedback',
  ]);
  assert.deepEqual(findForbiddenGraderFields(payload), []);
  assert.equal(payload.wantFeedback, false, '검사 채점에서는 피드백을 만들지 않는다');
  // operationId에 시점·학생 정보가 섞이지 않는다.
  assert.equal(/pre|post|R-000/.test(payload.operationId), false);
});

test('수용시험 10: 시점 혼합 순서는 시드로 재현되며 사전·사후가 섞인다', () => {
  const q1 = buildScoringQueue(SAMPLE, 'seed-2026');
  const q2 = buildScoringQueue([...SAMPLE].reverse(), 'seed-2026');
  const q3 = buildScoringQueue(SAMPLE, 'seed-다름');

  // 같은 시드는 입력 순서와 무관하게 같은 순서를 낸다.
  assert.deepEqual(
    q1.map((q) => q.submissionId),
    q2.map((q) => q.submissionId)
  );
  // 다른 시드는 다른 순서를 낸다.
  assert.notDeepEqual(
    q1.map((q) => q.submissionId),
    q3.map((q) => q.submissionId)
  );
  assert.equal(q1.length, SAMPLE.length);
  assert.deepEqual(
    q1.map((q) => q.orderIndex),
    SAMPLE.map((_, i) => i)
  );

  // 시점이 실제로 섞였는지 확인한다. 앞부분에 pre만 몰려 있지 않다.
  const byId = new Map(SAMPLE.map((s) => [s.submissionId, s]));
  const phases = q1.map((q) => byId.get(q.submissionId)!.phase);
  assert.ok(new Set(phases.slice(0, 6)).size > 1, '앞부분에 두 시점이 함께 있다');
});

test('수용시험 10: 결측 응답은 채점 큐에 들어가지 않는다', () => {
  const missing = makeMissingRecord(
    { ...CTX, submissionId: 'miss_0000000000000000' },
    'timeout_unsubmitted',
    T0
  );
  const queue = buildScoringQueue([...SAMPLE, missing], 'seed-2026');
  assert.equal(queue.some((q) => q.submissionId === missing.submissionId), false);
});

/** 가짜 채점 함수 — 실제 모델을 부르지 않는다. */
function fakeGrader(scoreByRepeat: Record<number, number>) {
  const calls: GradingRequest[] = [];
  const fn = async (req: GradingRequest): Promise<ScoringRun> => {
    calls.push(req);
    // 밴드는 payload가 아니라 서버 레지스트리에서 온다. 가짜 채점도 같은 방식으로 정한다.
    const band = BANDS[req.questionId];
    return {
      operationId: req.operationId,
      repeatIndex: req.repeatIndex,
      band,
      result: {
        status: 'scored',
        levels: { objectLevel: 3, specificityLevel: 3, contextLevel: band === 'A' ? null : 3 },
        score: scoreByRepeat[req.repeatIndex] ?? 50,
        axisScores: { object: 17.5, specificity: 17.5, context: band === 'A' ? null : 15 },
        feedbackStatus: 'not_requested',
      },
      calls: [],
      extraCall: false,
      feedback: null,
      modelId: 'fake-model',
      modelConfig: { temperature: 0.2 },
      rubricVersion: 'v7',
      cueVersion: 'v7',
      imageHash: IMAGE_HASH[req.questionId],
      promptHash: 'hash',
      codeCommit: 'test',
      scoredAt: new Date(T0).toISOString(),
    };
  };
  return { fn, calls };
}

test('수용시험 10: 후보 레지스트리에서는 채점 작업이 시작되지 않는다', async () => {
  const store = createInMemoryAssessmentStore();
  const grader = fakeGrader({ 1: 50 });
  await assert.rejects(
    () =>
      runScoringJob(
        {
          store,
          registry: fakeRegistry({ status: 'candidate' }),
          runOperationalScoring: grader.fn,
          isConsentActive: async () => true,
        },
        SAMPLE,
        { seed: 's', repeatIndex: 1 }
      ),
    ScoringBlockedError
  );
  assert.equal(grader.calls.length, 0, '막혔으면 모델을 한 번도 부르지 않는다');
});

test('수용시험 10: 최초 운영 점수가 주 자료로 잠기고 반복 2·3은 따로 저장된다', async () => {
  const store = createInMemoryAssessmentStore();
  const registry = fakeRegistry();
  const target = SAMPLE.slice(0, 3);

  const first = fakeGrader({ 1: 50 });
  const r1 = await runScoringJob(
    { store, registry, runOperationalScoring: first.fn, isConsentActive: async () => true },
    target,
    { seed: 'seed-2026', repeatIndex: 1 }
  );
  assert.equal(r1.scored.length, 3);

  // 같은 주 자료를 다시 채점해도 값을 바꾸지 않는다.
  const again = fakeGrader({ 1: 99 });
  const r1again = await runScoringJob(
    { store, registry, runOperationalScoring: again.fn, isConsentActive: async () => true },
    target,
    { seed: 'seed-2026', repeatIndex: 1 }
  );
  assert.equal(r1again.scored.length, 0);
  assert.equal(again.calls.length, 0);
  assert.deepEqual(
    r1again.skipped.map((s) => s.reason),
    ['already_scored_primary_locked', 'already_scored_primary_locked', 'already_scored_primary_locked']
  );

  // 신뢰도 반복 2·3은 따로 저장된다.
  const second = fakeGrader({ 2: 70 });
  await runScoringJob(
    { store, registry, runOperationalScoring: second.fn, isConsentActive: async () => true },
    target,
    { seed: 'seed-2026', repeatIndex: 2 }
  );
  const third = fakeGrader({ 3: 90 });
  await runScoringJob(
    { store, registry, runOperationalScoring: third.fn, isConsentActive: async () => true },
    target,
    { seed: 'seed-2026', repeatIndex: 3 }
  );

  const id = target[0].submissionId;
  const runs = [
    await store.getScoringRun(id, 1),
    await store.getScoringRun(id, 2),
    await store.getScoringRun(id, 3),
  ].filter((r): r is ScoringRun => r !== null);

  assert.equal(runs.length, 3);
  // 주 자료는 처음 값 그대로다. 세 반복의 평균(70)으로 덮이지 않았다.
  const primary = primaryRun(runs);
  assert.equal(primary?.repeatIndex, PRIMARY_REPEAT_INDEX);
  assert.equal(primary?.result.status === 'scored' ? primary.result.score : null, 50);
  assert.deepEqual(
    reliabilityRuns(runs).map((r) => r.repeatIndex),
    [2, 3]
  );
});

test('수용시험 10: 채점 묶음에 시드와 순서가 기록된다', async () => {
  const store = createInMemoryAssessmentStore();
  const grader = fakeGrader({ 1: 50 });
  const result = await runScoringJob(
    {
      store,
      registry: fakeRegistry(),
      runOperationalScoring: grader.fn,
      isConsentActive: async () => true,
    },
    SAMPLE,
    { seed: 'seed-2026', repeatIndex: 1 }
  );

  assert.equal(store.batches.length, 1);
  const batch = store.batches[0];
  assert.equal(batch.seed, 'seed-2026');
  assert.equal(batch.repeatIndex, 1);
  assert.equal(batch.schemaVersion, SCHEMA_VERSION);
  assert.deepEqual(batch.order, result.order);
  // 같은 시드로 다시 만들면 순서가 같다.
  assert.deepEqual(
    buildScoringQueue(SAMPLE, 'seed-2026').map((q) => q.submissionId),
    batch.order
  );
});

test('수용시험 10: 동의 철회 뒤에는 새 전송과 대기 작업이 취소된다', async () => {
  const store = createInMemoryAssessmentStore();
  const grader = fakeGrader({ 1: 50 });
  const withdrawn = new Set(['R-0002']);

  const result = await runScoringJob(
    {
      store,
      registry: fakeRegistry(),
      runOperationalScoring: grader.fn,
      // 큐에 넣은 뒤 철회한 학생을 전송 직전에 걸러 낸다.
      isConsentActive: async (researchId) => !withdrawn.has(researchId),
    },
    SAMPLE,
    { seed: 'seed-2026', repeatIndex: 1 }
  );

  assert.equal(result.cancelled.length, 6, '철회한 학생의 6응답이 모두 취소된다');
  assert.equal(result.scored.length, 12);
  // 철회한 학생의 응답은 모델로 전송되지 않았다.
  assert.equal(
    grader.calls.some((c) => c.studentText.includes('R-0002')),
    false
  );
});

/* ────────────────────── 수집 흐름(server action 본체) ──────────────────────
 *
 * actions.ts의 server action은 여기서 시험하는 collect.ts를 그대로 부른다.
 * 아래 시험은 인증·레지스트리·개인정보 점검·저장소에 가짜를 넣어 같은 코드를 돌린다.
 * 실제 모델·네트워크는 쓰지 않는다.
 */

const STUDENT: Principal = {
  uid: 'stu-1',
  role: 'student',
  classResearchIds: [],
  researchId: 'R-0001',
  classResearchId: 'C-01',
  sessionType: 'research_assessment',
};

const TEACHER: Principal = {
  uid: 'tea-1',
  role: 'teacher',
  classResearchIds: ['C-01'],
  researchId: null,
  classResearchId: null,
  sessionType: 'research_assessment',
};

const ACTIVE_CONSENT: ConsentRecord = {
  researchId: 'R-0001',
  guardianConsent: 'granted',
  studentAssent: 'granted',
  consentVersion: 'consent-v7',
  updatedAt: '2026-01-01T00:00:00.000Z',
  withdrawnAt: null,
};

function fakeRegistryPort(options?: { status?: RegistryEntry['status'] }) {
  const view = fakeRegistry(options);
  return {
    ...view,
    requireEntry: (questionId: string, sessionType: string) => {
      if (sessionType !== 'research_assessment') {
        throw new Error(`이 세션에서 쓸 수 없는 문항: ${questionId}`);
      }
      // 등록되지 않은 문항ID는 여기서 예외가 된다.
      return view.getEntry(questionId);
    },
  };
}

interface Harness {
  deps: CollectDeps;
  store: InspectableStore;
  setNow: (ms: number) => void;
  consent: { value: ConsentRecord | null };
}

function makeHarness(options?: {
  status?: RegistryEntry['status'];
  store?: InspectableStore;
}): Harness {
  const store = options?.store ?? createInMemoryAssessmentStore();
  let now = T0;
  const consent = { value: ACTIVE_CONSENT as ConsentRecord | null };

  const deps: CollectDeps = {
    auth: {
      async requirePrincipal() {
        return STUDENT;
      },
      async requireClassAccess(classResearchId: string, ..._roles: Role[]) {
        void _roles;
        if (!TEACHER.classResearchIds.includes(classResearchId)) {
          throw new Error('배정되지 않은 학급');
        }
        return TEACHER;
      },
      async getConsent() {
        return consent.value;
      },
    },
    registry: fakeRegistryPort({ status: options?.status }),
    privacy: {
      checkBeforeSend: () => ({
        decision: 'pass' as const,
        matchedTypes: [],
        checkVersion: 'test',
        notice: '',
      }),
      assertNoSecrets: () => undefined,
    },
    store,
    now: () => now,
    consentVersion: 'consent-v7',
  };

  return {
    deps,
    store,
    setNow: (ms) => {
      now = ms;
    },
    consent,
  };
}

/** 교사가 pre 세션을 열고 학생이 문항을 차례로 여는 데까지 진행한다. */
async function openSessionAndItems(h: Harness, itemCount: number): Promise<string> {
  const opened = await openAssessmentSession(h.deps, 'C-01', 'pre');
  assert.equal(opened.ok, true, opened.blockers?.join(' / '));
  for (let i = 0; i < itemCount; i += 1) {
    await startAssessmentItem(h.deps, null);
  }
  return opened.assessmentSessionId as string;
}

test('C1: 같은 칸에 새 제출ID로 다시 내도 최초 제출만 남는다', async () => {
  const h = makeHarness();
  await openSessionAndItems(h, 1);

  const first = await submitAssessmentResponse(h.deps, {
    submissionId: 'a'.repeat(32),
    questionId: 'T1',
    text: '노란 세모 블록이 있다.',
  });
  assert.equal(first.stored, true);
  assert.equal(first.duplicate, false);

  // 두 번째 탭·두 번째 기기는 새 제출ID를 만든다. 제출ID만 보던 판정은 이것을 통과시켰다.
  const second = await submitAssessmentResponse(h.deps, {
    submissionId: 'b'.repeat(32),
    questionId: 'T1',
    text: '완전히 다른 글',
  });
  assert.equal(second.duplicate, true);

  const stored = await h.store.listSubmissions({ classResearchId: 'C-01' });
  const valid = stored.filter((r) => r.responseStatus === 'submitted');
  assert.equal(valid.length, 1, '한 칸에 유효 제출은 하나뿐이다');
  assert.equal(valid[0].text, '노란 세모 블록이 있다.', '최초 값이 불변이다');
  assert.equal(h.store.rejections.length, 1);
  assert.equal(h.store.rejections[0].persistStatus, 'rejected_duplicate');

  // 같은 칸에 repeatIndex 1 ScoringRun이 둘 생기지 않는다.
  assert.equal(buildScoringQueue(stored, 'seed-2026').length, 1);
});

test('C1: 같은 제출ID의 더블클릭도 최초 값을 바꾸지 않는다', async () => {
  const h = makeHarness();
  await openSessionAndItems(h, 1);
  const id = 'c'.repeat(32);
  await submitAssessmentResponse(h.deps, { submissionId: id, questionId: 'T1', text: '첫 글' });
  const again = await submitAssessmentResponse(h.deps, {
    submissionId: id,
    questionId: 'T1',
    text: '고친 글',
  });
  assert.equal(again.duplicate, true);
  const stored = await h.store.getSubmissionForCell('R-0001', 'pre', 'T1');
  assert.equal(stored?.text, '첫 글');
});

test('C2: 열지 않은 문항에 기술 실패를 보내도 유령 창이 생기지 않는다', async () => {
  const h = makeHarness();
  await openSessionAndItems(h, 1); // T1만 열렸다

  const reported = await reportTechnicalFailure(h.deps, { questionId: 'T3', reason: 'network' });
  assert.equal(reported.ok, false);
  assert.equal(reported.recorded, false);
  assert.equal(await h.store.getItemWindow(cellIdOf('R-0001', 'pre', 'T3')), null);

  // 시작 시각 없는 창이 생기지 않았으므로 순서대로 T2_v7 → T3로 들어갈 수 있다.
  const next = await startAssessmentItem(h.deps, null);
  assert.equal(next.nextQuestionId, 'T3');
  const last = await startAssessmentItem(h.deps, null);
  assert.equal(last.nextQuestionId, null);
  const t3 = await h.store.getItemWindow(cellIdOf('R-0001', 'pre', 'T3'));
  assert.ok(t3 && Number.isFinite(Date.parse(t3.startedAt)), 'T3 창에 시작 시각이 있다');
});

test('C2: 등록되지 않은 문항ID로는 기술 실패를 남길 수 없다', async () => {
  const h = makeHarness();
  await openSessionAndItems(h, 1);
  await assert.rejects(() =>
    reportTechnicalFailure(h.deps, { questionId: 'T1/../hack', reason: 'network' })
  );
});

test('C2: 학생 신고만으로 결측 사유가 technical_failure가 되지 않는다', async () => {
  const h = makeHarness();
  const sessionId = await openSessionAndItems(h, 2); // T1, T2_v7

  // 학생이 T1에 장애를 신고한다. 기록은 남지만 사유를 확정하지 않는다.
  const reported = await reportTechnicalFailure(h.deps, { questionId: 'T1', reason: 'network' });
  assert.equal(reported.recorded, true);
  const t1 = await h.store.getItemWindow(cellIdOf('R-0001', 'pre', 'T1'));
  assert.equal(t1?.studentReportedFailureReason, 'network');
  assert.equal(t1?.delivery, 'delivered', '학생 신고가 전달 상태를 바꾸지 않는다');

  // 교사가 확인한 T2_v7만 기술 실패로 확정된다.
  const confirmed = await confirmTechnicalFailure(h.deps, {
    classResearchId: 'C-01',
    researchId: 'R-0001',
    phase: 'pre',
    questionId: 'T2_v7',
    reason: '기기 고장 확인',
  });
  assert.equal(confirmed.ok, true);

  h.setNow(T0 + 40 * 60_000);
  const finalized = await finalizeTimeouts(h.deps, sessionId, ['R-0001']);
  assert.equal(finalized.created, 3);

  const byQuestion = new Map(
    (await h.store.listSubmissions({ classResearchId: 'C-01' })).map((r) => [r.questionId, r])
  );
  assert.equal(byQuestion.get('T1')?.missingReason, 'timeout_unsubmitted');
  assert.equal(byQuestion.get('T2_v7')?.missingReason, 'technical_failure');
  assert.equal(byQuestion.get('T3')?.missingReason, 'absent');
});

test('C4: 빈 응답을 유효 제출로 받지 않는다', async () => {
  const h = makeHarness();
  await openSessionAndItems(h, 1);

  const empty = await submitAssessmentResponse(h.deps, {
    submissionId: 'd'.repeat(32),
    questionId: 'T1',
    text: '   \n\t ',
  });
  assert.equal(empty.stored, false);
  assert.equal(empty.duplicate, false);
  assert.equal((await h.store.listSubmissions({ classResearchId: 'C-01' })).length, 0);

  // 학생은 남은 시간에 다시 쓸 수 있고, 그때는 정상으로 저장된다.
  const later = await submitAssessmentResponse(h.deps, {
    submissionId: 'd'.repeat(32),
    questionId: 'T1',
    text: '노란 세모 블록이 있다.',
  });
  assert.equal(later.stored, true);
  assert.equal(isEmptyResponse('  '), true);
  assert.equal(isEmptyResponse('가'), false);
});

test('C4: 빈 텍스트가 저장돼 있어도 채점 큐에 넣지 않는다', () => {
  const emptyStored = makeSubmittedRecord({ ...CTX, submissionId: 'e'.repeat(32) }, '', T0 + 1000);
  assert.equal(emptyStored.responseStatus, 'submitted');
  assert.equal(buildScoringQueue([emptyStored], 'seed-2026').length, 0);
});

test('C7: dryRun은 합성 자료에만 적용되고 실데이터 채점을 열지 않는다', async () => {
  const registry = fakeRegistry({ status: 'candidate' });
  // 합성 표식은 SubmissionRecord에 없는 필드다. 수집 경로가 절대 만들지 않는다.
  const synthetic = SAMPLE.slice(0, 3).map(
    (r) => ({ ...r, synthetic: true }) as unknown as SubmissionRecord
  );

  const base = () => ({
    store: createInMemoryAssessmentStore(),
    registry,
    isConsentActive: async () => true,
  });

  // 1) 합성 표식이 없는 기록은 dataSource를 synthetic이라 밝혀도 모의 실행되지 않는다.
  const g1 = fakeGrader({ 1: 50 });
  await assert.rejects(
    () =>
      runScoringJob(
        { ...base(), runOperationalScoring: g1.fn, dataSource: 'synthetic' },
        SAMPLE.slice(0, 3),
        { seed: 's', repeatIndex: 1, dryRun: true }
      ),
    ScoringBlockedError
  );
  assert.equal(g1.calls.length, 0, '막혔으면 모델을 한 번도 부르지 않는다');

  // 2) 자료 성격을 밝히지 않으면 합성 표식이 있어도 모의 실행되지 않는다.
  const g2 = fakeGrader({ 1: 50 });
  await assert.rejects(
    () =>
      runScoringJob({ ...base(), runOperationalScoring: g2.fn }, synthetic, {
        seed: 's',
        repeatIndex: 1,
        dryRun: true,
      }),
    ScoringBlockedError
  );

  // 3) 연구 저장소에 쓰는 저장소로는 모의 실행하지 않는다.
  const g3 = fakeGrader({ 1: 50 });
  await assert.rejects(
    () =>
      runScoringJob(
        {
          ...base(),
          runOperationalScoring: g3.fn,
          dataSource: 'synthetic',
          storeIsPersistent: true,
        },
        synthetic,
        { seed: 's', repeatIndex: 1, dryRun: true }
      ),
    ScoringBlockedError
  );

  // 4) 합성 자료임을 밝히고 비영속 저장소일 때만 돈다. 그래도 미확정 값은 그대로 남는다.
  const g4 = fakeGrader({ 1: 50 });
  const ok = await runScoringJob(
    { ...base(), runOperationalScoring: g4.fn, dataSource: 'synthetic' },
    synthetic,
    { seed: 's', repeatIndex: 1, dryRun: true }
  );
  assert.equal(ok.scored.length, 3);
  assert.ok(
    ok.unresolvedBlockers.length > 0,
    '모의 실행이어도 미확정 값을 해결한 것처럼 보고하지 않는다'
  );
});

test('C7: 본채점 대상에 합성 기록이 섞이면 막는다', async () => {
  const g = fakeGrader({ 1: 50 });
  await assert.rejects(
    () =>
      runScoringJob(
        {
          store: createInMemoryAssessmentStore(),
          registry: fakeRegistry(),
          runOperationalScoring: g.fn,
          isConsentActive: async () => true,
        },
        [
          ...SAMPLE.slice(0, 2),
          { ...SAMPLE[2], synthetic: true } as unknown as SubmissionRecord,
        ],
        { seed: 's', repeatIndex: 1 }
      ),
    ScoringBlockedError
  );
  assert.equal(g.calls.length, 0);
});

/* ────────────────────── 저장소 두 구현의 동작 일치 ────────────────────── */

interface FakeDoc {
  path: string;
  data: Record<string, unknown>;
}

/**
 * 가짜 Firestore. 실제 Firestore의 두 성질을 흉내 낸다.
 *  - create는 문서가 이미 있으면 실패한다.
 *  - update는 문서가 없으면 실패한다(merge-set과 달리 문서를 만들지 않는다).
 * 이 두 성질이 메모리 저장소와 어긋나면 결함이 시험에 잡히지 않는다.
 */
function createFakeFirestore() {
  const docs = new Map<string, FakeDoc>();
  let autoId = 0;

  const matchDocs = (path: string, filters: [string, unknown][]) =>
    [...docs.values()].filter(
      (d) =>
        d.path === path &&
        filters.every(([field, value]) => (d.data as Record<string, unknown>)[field] === value)
    );

  const makeQuery = (path: string, filters: [string, unknown][], take: number | null) => ({
    where(field: string, _op: string, value: unknown) {
      void _op;
      return makeQuery(path, [...filters, [field, value]], take);
    },
    limit(n: number) {
      return makeQuery(path, filters, n);
    },
    async get() {
      const all = matchDocs(path, filters);
      const matched = take === null ? all : all.slice(0, take);
      return {
        empty: matched.length === 0,
        docs: matched.map((d) => ({ exists: true, data: () => d.data })),
      };
    },
  });

  const db = {
    collection(path: string) {
      return {
        ...makeQuery(path, [], null),
        doc(id: string) {
          const key = `${path}/${id}`;
          return {
            async get() {
              return { exists: docs.has(key), data: () => docs.get(key)?.data };
            },
            async create(data: Record<string, unknown>) {
              if (docs.has(key)) throw new Error('ALREADY_EXISTS');
              docs.set(key, { path, data });
            },
            async set(data: Record<string, unknown>, options?: { merge?: boolean }) {
              const prev = docs.get(key);
              docs.set(key, {
                path,
                data: options?.merge ? { ...(prev?.data ?? {}), ...data } : data,
              });
            },
            async update(data: Record<string, unknown>) {
              const prev = docs.get(key);
              // 없는 문서를 만들지 않는다. 실제 Firestore의 update와 같다.
              if (!prev) throw new Error('NOT_FOUND');
              docs.set(key, { path, data: { ...prev.data, ...data } });
            },
          };
        },
        async add(data: Record<string, unknown>) {
          autoId += 1;
          docs.set(`${path}/auto_${autoId}`, { path, data });
        },
      };
    },
  };

  return {
    db,
    countIn: (needle: string) => [...docs.values()].filter((d) => d.path.includes(needle)).length,
    size: () => docs.size,
  };
}

/** server-only를 빈 모듈로 바꾼다. 스크립트 preload와 같은 방법이다. */
function stubServerOnly(): void {
  const req = createRequire(import.meta.url);
  try {
    const resolved = req.resolve('server-only');
    (req.cache as unknown as Record<string, unknown>)[resolved] = {
      id: resolved,
      filename: resolved,
      loaded: true,
      children: [],
      paths: [],
      exports: {},
    };
  } catch {
    // 없으면 아무것도 하지 않는다.
  }
}

async function firestoreStoreFor(db: unknown): Promise<AssessmentStore> {
  stubServerOnly();
  const mod = await import('@/server/assessment/firestore-store');
  return mod.createFirestoreAssessmentStore({ db: db as never });
}

test('저장소 일치: 두 구현 모두 같은 칸의 두 번째 제출을 거절한다', async () => {
  const fake = createFakeFirestore();
  const stores: AssessmentStore[] = [
    createInMemoryAssessmentStore(),
    await firestoreStoreFor(fake.db),
  ];

  for (const store of stores) {
    const first = makeSubmittedRecord(CTX, '노란 세모 블록이 있다.', T0 + 60_000);
    const d1 = await store.claimSubmission(first);
    assert.equal(d1.outcome, 'stored');

    const second = makeSubmittedRecord(
      { ...CTX, submissionId: 'z'.repeat(32) },
      '완전히 다른 글',
      T0 + 61_000
    );
    const d2 = await store.claimSubmission(second);
    assert.equal(d2.outcome, 'rejected_duplicate');
    assert.equal(d2.toStore, null);
    assert.equal(d2.authoritative.text, '노란 세모 블록이 있다.');

    const stored = await store.getSubmissionForCell(CTX.researchId, 'pre', CTX.questionId);
    assert.equal(stored?.text, '노란 세모 블록이 있다.');
  }

  // Firestore 쪽에도 제출 문서는 하나뿐이다.
  assert.equal(fake.countIn('assessment_submissions'), 1);
});

test('저장소 일치: 두 구현 모두 없는 문항 창을 만들지 않는다', async () => {
  const fake = createFakeFirestore();
  const windowId = cellIdOf('R-0001', 'pre', 'T3');
  const stores: AssessmentStore[] = [
    createInMemoryAssessmentStore(),
    await firestoreStoreFor(fake.db),
  ];

  for (const store of stores) {
    const patched = await store.patchItemWindow(windowId, {
      studentReportedFailureReason: 'network',
      studentReportedFailureAt: new Date(T0).toISOString(),
    });
    assert.equal(patched, false, '없는 창을 만들지 않고 실패로 알린다');
    assert.equal(await store.getItemWindow(windowId), null);
  }
  assert.equal(fake.size(), 0, 'merge-set으로 유령 문서를 만들지 않는다');
});

test('저장소 일치: 이미 열린 창에는 학생 신고를 남긴다', async () => {
  const fake = createFakeFirestore();
  const win = makeItemWindow({
    researchId: 'R-0001',
    classResearchId: 'C-01',
    phase: 'pre',
    questionId: 'T1',
    startedAt: new Date(T0).toISOString(),
    durationSeconds: EXPECTED_ITEM_SECONDS.T1,
  });
  const stores: AssessmentStore[] = [
    createInMemoryAssessmentStore(),
    await firestoreStoreFor(fake.db),
  ];

  for (const store of stores) {
    await store.createItemWindowIfAbsent(win);
    // 두 번 열어도 시작 시각이 바뀌지 않는다.
    const again = await store.createItemWindowIfAbsent({
      ...win,
      startedAt: new Date(T0 + 120_000).toISOString(),
    });
    assert.equal(again.startedAt, win.startedAt);

    assert.equal(
      await store.patchItemWindow(win.windowId, { studentReportedFailureReason: 'network' }),
      true
    );
    const stored = await store.getItemWindow(win.windowId);
    assert.equal(stored?.studentReportedFailureReason, 'network');
    assert.equal(stored?.delivery, 'delivered');
  }
});
