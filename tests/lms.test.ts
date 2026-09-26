/**
 * 교사 학생 현황(LMS) 집계의 순수 규칙 시험.
 *
 * 여기서 고정하는 것
 *   1. 일반 수업은 세션이 바뀌어도 같은 번호면 한 학생으로 묶는다
 *   2. 결측 점수는 0점이 아니다. 평균에 넣지 않는다
 *   3. 연구 수업은 교사에게 AI 점수·답안·시각을 보여 주지 않는다(블라인드 채점 보호)
 *   4. 저장에 실패했거나 제출되지 않은 기록은 세지 않는다
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  summarizeClassProgress,
  toProgressSession,
  toProgressSubmission,
  type ProgressSession,
  type ProgressSubmission,
} from '../src/server/lms/progress';

const NOW = '2026-09-26T03:00:00.000Z';

function session(sid: string, studentNumber: number | null, extra: Partial<ProgressSession> = {}): ProgressSession {
  return {
    sid,
    studentNumber,
    researchId: null,
    issuedAt: '2026-09-26T01:00:00.000Z',
    expiresAt: '2026-09-26T04:00:00.000Z',
    revokedAt: null,
    ...extra,
  };
}

function sub(ownerKey: string, questionId: string, score: number | null, at: string, extra: Partial<ProgressSubmission> = {}): ProgressSubmission {
  return {
    ownerKey,
    researchId: null,
    questionId,
    lesson: 1,
    attemptNo: 1,
    text: `${questionId} 답`,
    submittedAt: at,
    score,
    reviewed: false,
    ...extra,
  };
}

test('다시 들어와 세션이 바뀌어도 같은 번호면 한 줄이다', () => {
  const progress = summarizeClassProgress({
    sessionType: 'experience',
    sessions: [session('aaaa1111', 7, { revokedAt: '2026-09-26T01:30:00.000Z' }), session('bbbb2222', 7), session('cccc3333', 3)],
    submissions: [
      sub('session:aaaa1111', 'L01', 40, '2026-09-26T01:10:00.000Z'),
      sub('session:bbbb2222', 'L01', 70, '2026-09-26T02:10:00.000Z', { attemptNo: 2 }),
      sub('session:bbbb2222', 'L02', null, '2026-09-26T02:20:00.000Z'),
    ],
    now: NOW,
  });
  assert.deepEqual(progress.students.map((s) => s.label), ['3번', '7번']);
  const seven = progress.students[1];
  assert.equal(seven.submissions, 3);
  assert.equal(seven.questionsAttempted, 2);
  assert.deepEqual(seven.attemptedByLesson, { 1: 2 });
  assert.equal(seven.online, true);
  // L01은 마지막 점수 70, L02는 결측이므로 평균은 70이다(0점으로 넣지 않는다).
  assert.equal(seven.averageScore, 70);
  // 가장 최근 제출(L02)은 결측이므로 최근 점수는 그 앞의 70이다.
  assert.equal(seven.latestScore, 70);
  assert.equal(seven.recent[0].questionId, 'L02');
  assert.equal(seven.recent[0].score, null);
  assert.equal(progress.detailVisible, true);
  assert.equal(progress.totals.online, 2);
  assert.equal(progress.totals.submissions, 3);

  const three = progress.students[0];
  assert.equal(three.submissions, 0, '들어오기만 한 학생도 줄로 보인다');
  assert.equal(three.averageScore, null);
});

test('연구 수업은 점수·답안·시각을 교사에게 내보내지 않는다', () => {
  const progress = summarizeClassProgress({
    sessionType: 'research_practice',
    sessions: [session('dddd4444', null, { researchId: 'R-001' })],
    submissions: [
      sub('R-001', 'L01', 80, '2026-09-26T02:00:00.000Z', { researchId: 'R-001', text: '연구 답안' }),
    ],
    now: NOW,
  });
  assert.equal(progress.detailVisible, false);
  assert.equal(progress.totals.averageScore, null);
  const row = progress.students[0];
  assert.equal(row.label, 'R-001');
  assert.equal(row.submissions, 1);
  assert.equal(row.latestScore, null);
  assert.equal(row.averageScore, null);
  assert.equal(row.lastActivityAt, null);
  assert.deepEqual(row.recent, []);
  assert.equal(JSON.stringify(progress).includes('연구 답안'), false);
  assert.equal(JSON.stringify(progress).includes('"score":80'), false);
});

test('연구 수업에서 번호는 쓰지 않는다', () => {
  const progress = summarizeClassProgress({
    sessionType: 'research_practice',
    sessions: [session('eeee5555', 12, { researchId: 'R-002' })],
    submissions: [],
    now: NOW,
  });
  assert.equal(progress.students[0].studentNumber, null);
  assert.equal(progress.students[0].label, 'R-002');
});

test('저장 실패·미제출 기록은 세지 않고 결측 점수는 null이다', () => {
  const base = {
    ownerKey: 'session:x',
    questionId: 'L03',
    lesson: 1,
    attemptNo: 1,
    text: '답',
    submittedAt: '2026-09-26T02:00:00.000Z',
    responseStatus: 'submitted',
    persistStatus: 'stored',
    feedbackReview: null,
  };
  assert.equal(toProgressSubmission({ ...base, persistStatus: 'failed' }), null);
  assert.equal(toProgressSubmission({ ...base, responseStatus: 'timeout_unsubmitted' }), null);
  assert.equal(toProgressSubmission({ ...base, questionId: '' }), null);

  const missing = toProgressSubmission({ ...base, scoring: { result: { status: 'missing', score: null } } });
  assert.equal(missing?.score, null);
  const scored = toProgressSubmission({
    ...base,
    scoring: { result: { status: 'scored', score: 62.5 } },
    feedbackReview: { kind: 'kept' },
  });
  assert.equal(scored?.score, 62.5);
  assert.equal(scored?.reviewed, true);
});

test('세션 문서에서 번호와 만료만 읽는다', () => {
  const s = toProgressSession('sid-1', {
    studentNumber: 5,
    researchId: null,
    issuedAt: '2026-09-26T01:00:00.000Z',
    expiresAt: '2026-09-26T04:00:00.000Z',
    revokedAt: null,
    classResearchId: '123456',
  });
  assert.deepEqual(s, {
    sid: 'sid-1',
    studentNumber: 5,
    researchId: null,
    issuedAt: '2026-09-26T01:00:00.000Z',
    expiresAt: '2026-09-26T04:00:00.000Z',
    revokedAt: null,
  });
});

test('만료되거나 끊긴 세션은 입장 중으로 세지 않는다', () => {
  const progress = summarizeClassProgress({
    sessionType: 'experience',
    sessions: [
      session('ffff6666', 1, { expiresAt: '2026-09-26T02:59:59.000Z' }),
      session('gggg7777', 2, { revokedAt: '2026-09-26T02:00:00.000Z' }),
    ],
    submissions: [],
    now: NOW,
  });
  assert.equal(progress.totals.online, 0);
});
