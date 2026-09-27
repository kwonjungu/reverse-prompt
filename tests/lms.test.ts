/**
 * 교사 학생 현황(LMS) 집계의 순수 규칙 시험.
 *
 * 여기서 고정하는 것
 *   1. 일반 수업은 세션이 바뀌어도 같은 번호면 한 학생으로 묶는다
 *   2. 채점 결과는 공통 루브릭 v12-2의 영역별 수준과 종합 수준이다. 100점 점수는 없다
 *   3. 결측은 1수준도 0점도 아니다. 평균에 넣지 않는다
 *   4. 옛 v7 기록은 '옛 채점'(legacyScore)으로만 남고 v12-2 평균·최근 수준에 섞이지 않는다
 *   5. 연구 수업은 교사에게 AI 채점 결과·답안·시각을 보여 주지 않는다(블라인드 채점 보호)
 *   6. 저장에 실패했거나 제출되지 않은 기록은 세지 않는다
 *   7. 단계 열은 문항 번호로 지금 6단계 배치에서 정한다(옛 기록의 옛 차시 번호를 그대로 쓰지 않는다)
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  scoringViewOf,
  stageOfSubmission,
  summarizeClassProgress,
  toProgressSession,
  toProgressSubmission,
  toResearchRecordRow,
  type ProgressSession,
  type ProgressSubmission,
} from '../src/server/lms/progress';
import type { AreaLevels, AreaLevelValue } from '../src/lib/scoring';

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

function lv(object: AreaLevelValue, feature: AreaLevelValue, relation: AreaLevelValue): AreaLevels {
  return { object, feature, relation };
}

/** v12-2 채점 제출. levels가 null이면 채점 결측이다. */
function sub(
  ownerKey: string,
  questionId: string,
  levels: AreaLevels | null,
  at: string,
  extra: Partial<ProgressSubmission> = {}
): ProgressSubmission {
  const overall = levels ? scoringViewOf(areaDoc(levels)) : null;
  return {
    ownerKey,
    researchId: null,
    questionId,
    lesson: 1,
    attemptNo: 1,
    text: `${questionId} 답`,
    submittedAt: at,
    levels,
    overallLevel: overall && overall.kind === 'areas' ? overall.overallLevel : null,
    legacy: false,
    legacyScore: null,
    reviewed: false,
    ...extra,
  };
}

/** 옛 v7 채점 제출(100점). */
function legacySub(ownerKey: string, questionId: string, score: number | null, at: string): ProgressSubmission {
  return {
    ...sub(ownerKey, questionId, null, at),
    legacy: true,
    legacyScore: score,
  };
}

function judgment(level: AreaLevelValue) {
  return level === 'not_applicable'
    ? { level, evidence: null, missing: [], evidenceMissing: [] }
    : { level, evidence: null, missing: level < 4 ? ['무언가'] : [], evidenceMissing: [] };
}

/** 저장 문서 모양(v12-2). */
function areaDoc(levels: AreaLevels, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schemaVersion: 'v12.2-practice-submission',
    rubricVersion: 'v12-2',
    scoring: {
      result: {
        status: 'scored',
        areas: {
          object: judgment(levels.object),
          feature: judgment(levels.feature),
          relation: judgment(levels.relation),
        },
        feedbackStatus: 'verified',
      },
    },
    ...extra,
  };
}

test('다시 들어와 세션이 바뀌어도 같은 번호면 한 줄이다 — 수준은 v12-2 종합 수준으로 센다', () => {
  const progress = summarizeClassProgress({
    sessionType: 'experience',
    sessions: [session('aaaa1111', 7, { revokedAt: '2026-09-26T01:30:00.000Z' }), session('bbbb2222', 7), session('cccc3333', 3)],
    submissions: [
      sub('session:aaaa1111', 'L01', lv(1, 2, 1), '2026-09-26T01:10:00.000Z'),
      sub('session:bbbb2222', 'L01', lv(4, 3, 3), '2026-09-26T02:10:00.000Z', { attemptNo: 2 }),
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
  // L01의 마지막 종합 수준은 (4+3+3)/3=3.33→3, L02는 결측이므로 평균은 3이다(1수준·0점으로 넣지 않는다).
  assert.equal(seven.averageLevel, 3);
  // 가장 최근 제출(L02)은 결측이므로 최근 수준은 그 앞의 3이다.
  assert.equal(seven.latestLevel, 3);
  assert.deepEqual(seven.latestLevels, lv(4, 3, 3));
  assert.equal(seven.recent[0].questionId, 'L02');
  assert.equal(seven.recent[0].levels, null);
  assert.equal(seven.recent[0].overallLevel, null);
  assert.equal(seven.recent[0].legacy, false);
  assert.equal(progress.detailVisible, true);
  assert.equal(progress.totals.online, 2);
  assert.equal(progress.totals.submissions, 3);
  assert.equal(progress.totals.averageLevel, 3);

  const three = progress.students[0];
  assert.equal(three.submissions, 0, '들어오기만 한 학생도 줄로 보인다');
  assert.equal(three.averageLevel, null);
  assert.equal(three.latestLevel, null);
  // 100점 점수 필드는 더 이상 없다.
  assert.equal('averageScore' in three, false);
  assert.equal('latestScore' in three, false);
  assert.equal('averageScore' in progress.totals, false);
});

test('평균 수준은 정수로 반올림하지 않고 소수 한 자리로 낸다', () => {
  const progress = summarizeClassProgress({
    sessionType: 'experience',
    sessions: [session('hhhh8888', 4)],
    submissions: [
      sub('session:hhhh8888', 'L01', lv(2, 2, 2), '2026-09-26T01:10:00.000Z'),
      sub('session:hhhh8888', 'L02', lv(3, 3, 3), '2026-09-26T01:20:00.000Z'),
      sub('session:hhhh8888', 'L03', lv(3, 3, 3), '2026-09-26T01:30:00.000Z'),
    ],
    now: NOW,
  });
  // (2+3+3)/3 = 2.666… → 2.7
  assert.equal(progress.students[0].averageLevel, 2.7);
  assert.equal(progress.totals.averageLevel, 2.7);
});

test('해당 없음 영역은 종합 수준 평균에서 빠진다', () => {
  const doc = areaDoc(lv(4, 'not_applicable', 3));
  const view = scoringViewOf(doc);
  assert.equal(view.kind, 'areas');
  if (view.kind !== 'areas') return;
  assert.deepEqual(view.levels, lv(4, 'not_applicable', 3));
  // (4+3)/2 = 3.5 → 반올림 4
  assert.equal(view.overallLevel, 4);
});

test('옛 v7 기록은 옛 채점으로만 남고 v12-2 평균·최근 수준에 섞이지 않는다', () => {
  const progress = summarizeClassProgress({
    sessionType: 'experience',
    sessions: [session('iiii9999', 9)],
    submissions: [
      sub('session:iiii9999', 'L01', lv(2, 2, 1), '2026-09-26T01:10:00.000Z'),
      // 옛 기록이 더 최근이어도 최근 수준은 v12-2 기록에서만 찾는다.
      legacySub('session:iiii9999', 'L02', 95, '2026-09-26T02:10:00.000Z'),
      legacySub('session:iiii9999', 'L03', null, '2026-09-26T02:20:00.000Z'),
    ],
    now: NOW,
  });
  const row = progress.students[0];
  // L01만 v12-2: (2+2+1)/3=1.67 → 2
  assert.equal(row.averageLevel, 2);
  assert.equal(row.latestLevel, 2);
  assert.equal(row.legacySubmissions, 2);
  assert.equal(progress.totals.legacySubmissions, 2);
  assert.equal(row.recent[0].legacy, true);
  assert.equal(row.recent[0].legacyScore, null);
  assert.equal(row.recent[1].legacy, true);
  assert.equal(row.recent[1].legacyScore, 95);
  assert.equal(row.recent[1].levels, null, '옛 기록에서 영역 수준을 지어내지 않는다');
});

test('연구 수업은 채점 결과·답안·시각을 교사에게 내보내지 않는다', () => {
  const progress = summarizeClassProgress({
    sessionType: 'research_practice',
    sessions: [session('dddd4444', null, { researchId: 'R-001' })],
    submissions: [
      sub('R-001', 'L01', lv(4, 3, 2), '2026-09-26T02:00:00.000Z', { researchId: 'R-001', text: '연구 답안' }),
      { ...legacySub('R-001', 'L02', 80, '2026-09-26T02:10:00.000Z'), researchId: 'R-001' },
    ],
    now: NOW,
  });
  assert.equal(progress.detailVisible, false);
  assert.equal(progress.totals.averageLevel, null);
  assert.equal(progress.totals.legacySubmissions, 0);
  const row = progress.students[0];
  assert.equal(row.label, 'R-001');
  assert.equal(row.submissions, 2);
  assert.equal(row.latestLevel, null);
  assert.equal(row.latestLevels, null);
  assert.equal(row.averageLevel, null);
  assert.equal(row.legacySubmissions, 0);
  assert.equal(row.lastActivityAt, null);
  assert.deepEqual(row.recent, []);
  const json = JSON.stringify(progress);
  assert.equal(json.includes('연구 답안'), false);
  assert.equal(json.includes('80'), false);
  assert.equal(json.includes('"object"'), false);
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

test('저장 실패·미제출 기록은 세지 않고 결측은 null이다', () => {
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

  // v12-2 결측: areas가 null이다. 1수준으로 채우지 않는다.
  const missing = toProgressSubmission({
    ...base,
    rubricVersion: 'v12-2',
    scoring: { result: { status: 'missing', areas: null, reason: 'schema_error' } },
  });
  assert.equal(missing?.levels, null);
  assert.equal(missing?.overallLevel, null);
  assert.equal(missing?.legacy, false);
  assert.equal(missing?.legacyScore, null);

  const scored = toProgressSubmission({
    ...base,
    ...areaDoc(lv(3, 2, 'not_applicable')),
    feedbackReview: { kind: 'kept' },
  });
  assert.deepEqual(scored?.levels, lv(3, 2, 'not_applicable'));
  // (3+2)/2 = 2.5 → 반올림 3
  assert.equal(scored?.overallLevel, 3);
  assert.equal(scored?.legacy, false);
  assert.equal(scored?.reviewed, true);
});

test('형식이 어긋난 v12-2 결과는 보정하지 않고 결측으로 본다', () => {
  const broken = areaDoc(lv(3, 2, 1));
  const areas = ((broken.scoring as Record<string, unknown>).result as Record<string, unknown>).areas as Record<
    string,
    Record<string, unknown>
  >;
  areas.feature.level = 2.5;
  assert.deepEqual(scoringViewOf(broken), { kind: 'missing' });
  areas.feature.level = 5;
  assert.deepEqual(scoringViewOf(broken), { kind: 'missing' });
});

test('옛 v7 문서는 결과 모양이나 rubricVersion으로 옛 기록이 된다', () => {
  const v7Scored = {
    schemaVersion: 'v7.0-practice-submission',
    rubricVersion: 'v7-candidate',
    scoring: {
      result: {
        status: 'scored',
        levels: { objectLevel: 4, specificityLevel: 3, contextLevel: null },
        score: 62.5,
        axisScores: { object: 37.5, specificity: 25, context: null },
      },
    },
  };
  assert.deepEqual(scoringViewOf(v7Scored), { kind: 'legacy', score: 62.5 });

  const v7Missing = {
    rubricVersion: 'v7-candidate',
    scoring: { result: { status: 'missing', levels: null, score: null, axisScores: null, reason: 'model_error' } },
  };
  assert.deepEqual(scoringViewOf(v7Missing), { kind: 'legacy', score: null });

  // 채점 전에 끝난 옛 기록(result null)도 rubricVersion으로 옛 기록이 된다.
  assert.deepEqual(scoringViewOf({ rubricVersion: 'v7-candidate', scoring: { result: null } }), {
    kind: 'legacy',
    score: null,
  });

  // scoring 없이 맨 위에 score만 있는 옛 연습 기록(classes/{code}/practice_attempts)
  assert.deepEqual(scoringViewOf({ score: 70 }), { kind: 'legacy', score: 70 });
  assert.deepEqual(scoringViewOf({ score: null }), { kind: 'legacy', score: null });
  // 아무 채점 정보도 없으면 결측이다.
  assert.deepEqual(scoringViewOf({}), { kind: 'missing' });

  const sub = toProgressSubmission({
    ownerKey: 'session:x',
    questionId: 'L05',
    lesson: 1,
    submittedAt: '2026-09-26T02:00:00.000Z',
    ...v7Scored,
  });
  assert.equal(sub?.legacy, true);
  assert.equal(sub?.legacyScore, 62.5);
  assert.equal(sub?.levels, null);
  assert.equal(sub?.overallLevel, null);
});

test('단계는 문항 번호로 지금 6단계 배치에서 정한다', () => {
  // L13~L18은 4단계(관계), L19~L24는 3단계(특징). 옛 기록의 lesson(옛 차시)을 그대로 쓰지 않는다.
  assert.equal(stageOfSubmission('L13', 3), 4);
  assert.equal(stageOfSubmission('L19', 4), 3);
  assert.equal(stageOfSubmission('L01', null), 1);
  assert.equal(stageOfSubmission('L36', 6), 6);
  // 연습 문항이 아니면 저장된 값을 쓴다.
  assert.equal(stageOfSubmission('game-01', 2), 2);
  assert.equal(stageOfSubmission('game-01', null), null);

  const s = toProgressSubmission({ ownerKey: 'session:x', questionId: 'L20', lesson: 4, submittedAt: NOW });
  assert.equal(s?.lesson, 3);
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

test('연구 자료 탭의 줄: 교사(blind)에게는 채점 결과·피드백 상태가 없다', () => {
  const doc: Record<string, unknown> = {
    id: 'doc-1',
    researchId: 'R-003',
    questionId: 'L14',
    lesson: 4,
    attemptNo: 2,
    responseStatus: 'submitted',
    text: '연구 답안',
    submittedAt: '2026-09-26T02:00:00.000Z',
    ...areaDoc(lv(3, 'not_applicable', 2)),
  };
  (doc.scoring as Record<string, unknown>).feedback = { status: 'verified', text: '네 문장' };

  const researcher = toResearchRecordRow(doc, { blind: false });
  assert.equal(researcher.stage, 4);
  assert.equal(researcher.legacy, false);
  assert.equal(researcher.feedbackStatus, 'verified');
  assert.deepEqual(researcher.scoring, { kind: 'areas', levels: lv(3, 'not_applicable', 2), overallLevel: 3 });

  const teacher = toResearchRecordRow(doc, { blind: true });
  assert.equal(teacher.scoring, null);
  assert.equal(teacher.feedbackStatus, null);
  assert.equal(teacher.researchId, 'R-003');
  const json = JSON.stringify(teacher);
  assert.equal(json.includes('연구 답안'), false, '학생 글은 줄에 담지 않는다');
  assert.equal(json.includes('2026-09-26'), false, '제출 시각은 줄에 담지 않는다');

  const old = toResearchRecordRow(
    {
      id: 'doc-2',
      researchId: 'R-003',
      questionId: 'L19',
      lesson: 4,
      rubricVersion: 'v7-candidate',
      scoring: { result: { status: 'scored', levels: {}, score: 55, axisScores: {} } },
    },
    { blind: false }
  );
  assert.equal(old.legacy, true);
  assert.equal(old.stage, 3, '옛 차시 번호(4)가 아니라 지금 단계(3)');
  assert.deepEqual(old.scoring, { kind: 'legacy', score: 55 });
});
