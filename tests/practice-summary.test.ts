/**
 * 연습 시도 요약과 연구용 추출(논문 v12)의 순수 규칙 시험.
 *
 *   1. 앱 AI 5수준 = round_half_up(1 + 4 × 총점/100), 결측은 null
 *   2. 학생 × 문항 요약은 제출 순서를 지키고 원문·피드백을 바꾸지 않는다
 *   3. 문항 요약은 36문항을 모두 내고, 결측을 분포에 넣지 않는다
 *   4. 추출은 시드만으로 다시 만들어지고, 제외 행을 뽑지 않으며, 모자라면 채우지 않는다
 *   5. 동의가 없거나 철회한 학생은 연구 추출 대상이 아니다
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  FEEDBACK_SEPARATOR,
  NO_FEEDBACK_MARK,
  appLevelOf,
  appLevelRawOf,
  buildSampleCsv,
  caseIdOf,
  drawStratifiedSample,
  exclusionKey,
  isConsentDocActive,
  sampleInputProblem,
  summarizeQuestions,
  summarizeStudentQuestions,
  toPracticeAttempt,
  type PracticeAttempt,
  type StudentQuestionSummary,
} from '../src/server/export/practice-summary';

/* ────────────────── 보조 ────────────────── */

function doc(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schemaVersion: 'v7.0-practice-submission',
    submissionId: 'ps_1',
    researchId: 'R-001',
    classResearchId: '123456',
    sessionType: 'research_practice',
    questionId: 'L01',
    questionLevel: 1,
    lesson: 1,
    band: 'A',
    attemptNo: 1,
    text: '빨간 사과',
    startedAt: '2026-09-27T01:00:00.000Z',
    submittedAt: '2026-09-27T01:01:00.000Z',
    durationMs: 60000,
    responseStatus: 'submitted',
    missingReason: null,
    persistStatus: 'stored',
    imageHash: 'abc',
    cueVersion: 'cue',
    rubricVersion: 'rub',
    scoring: {
      result: { status: 'scored', score: 50, levels: { objectLevel: 3, specificityLevel: 3, contextLevel: null } },
      feedback: { text: '목표…\n현재…', status: 'verified' },
      modelId: 'googleai/gemini',
      promptHash: 'ph',
    },
    feedbackReview: null,
    ...over,
  };
}

function attempt(over: Record<string, unknown> = {}): PracticeAttempt {
  const a = toPracticeAttempt(String(over.submissionId ?? 'ps_1'), doc(over));
  assert.ok(a);
  return a!;
}

function row(researchId: string, questionId: string, finalAppLevel: number | null): StudentQuestionSummary {
  return {
    researchId,
    classResearchId: '123456',
    questionId,
    level: Number(questionId.slice(1)),
    chasi: 1,
    band: 'A',
    attemptCount: 1,
    firstSubmissionId: `ps_${researchId}_${questionId}`,
    finalSubmissionId: `ps_${researchId}_${questionId}`,
    firstPrompt: 'p',
    finalPrompt: `최종 ${researchId}`,
    firstTotalScore: null,
    firstAppLevel: finalAppLevel,
    finalTotalScore: null,
    finalAppLevel,
    finalAppLevelRaw: finalAppLevel,
    finalObjectLevel: null,
    finalSpecificityLevel: null,
    finalContextLevel: null,
    feedbacks: '',
    firstSubmittedAt: null,
    finalSubmittedAt: null,
    missingScoreCount: finalAppLevel === null ? 1 : 0,
    finalScoreMissing: finalAppLevel === null,
  };
}

/** 문항마다 수준 1~5에 학생을 고르게 배치한 표본 틀 */
function frame(questionIds: string[], perLevel: number): StudentQuestionSummary[] {
  const rows: StudentQuestionSummary[] = [];
  for (const q of questionIds) {
    for (let level = 1; level <= 5; level += 1) {
      for (let i = 0; i < perLevel; i += 1) rows.push(row(`R-${level}${String(i).padStart(2, '0')}`, q, level));
    }
  }
  return rows;
}

/* ────────────────── 1. 앱 AI 5수준 ────────────────── */

test('앱 AI 5수준은 가중 평균 수준을 반올림(0.5 올림)한 값이다', () => {
  assert.equal(appLevelOf(0), 1);
  assert.equal(appLevelOf(100), 5);
  assert.equal(appLevelOf(50), 3);
  assert.equal(appLevelOf(37.5), 3, '2.5는 3으로 올린다');
  assert.equal(appLevelOf(62.5), 4, '3.5는 4로 올린다');
  assert.equal(appLevelOf(12.4), 1);
  assert.equal(appLevelOf(12.5), 2);
  assert.equal(appLevelRawOf(37.5), 2.5, '반올림 전 값은 그대로 둔다');
  assert.equal(appLevelOf(null), null, '결측은 1수준이 아니다');
});

/* ────────────────── 2. 시도 정규화·학생 × 문항 ────────────────── */

test('일반 체험·연구ID 없는 문서·연습 밖 문항은 연구 요약에 들어가지 않는다', () => {
  assert.equal(toPracticeAttempt('x', doc({ sessionType: 'experience' })), null);
  assert.equal(toPracticeAttempt('x', doc({ researchId: null })), null);
  assert.equal(toPracticeAttempt('x', doc({ questionId: 'T1' })), null);
  assert.equal(toPracticeAttempt('x', doc({ persistStatus: 'failed' })), null);
  assert.equal(toPracticeAttempt('x', doc({ responseStatus: 'missing' })), null);
});

test('옛 문서와 결측 점수를 있는 그대로 읽는다', () => {
  const old = toPracticeAttempt('old', doc({ questionLevel: undefined, band: undefined, questionId: 'L14', submissionId: undefined }));
  assert.equal(old?.level, 14);
  assert.equal(old?.band, 'B');
  assert.equal(old?.submissionId, 'old');

  const missing = attempt({ scoring: { result: { status: 'missing', score: null, levels: null }, feedback: null } });
  assert.equal(missing.scoreStatus, 'missing');
  assert.equal(missing.totalScore, null);
  assert.equal(missing.appLevel, null);
  assert.equal(missing.feedbackText, null);
});

test('학생 × 문항 요약은 제출 순서를 지키고 원문과 피드백을 바꾸지 않는다', () => {
  const second = attempt({
    submissionId: 'ps_2',
    attemptNo: 2,
    text: '꼭지가 달린 빨간 사과 한 개',
    submittedAt: '2026-09-27T01:05:00.000Z',
    scoring: { result: { status: 'scored', score: 100, levels: { objectLevel: 5, specificityLevel: 5, contextLevel: null } }, feedback: { text: '잘 썼어요', status: 'verified' } },
  });
  const middle = attempt({
    submissionId: 'ps_3',
    attemptNo: 3,
    text: '가운데',
    submittedAt: '2026-09-27T01:03:00.000Z',
    scoring: { result: { status: 'missing', score: null, levels: null }, feedback: null },
  });
  const first = attempt();
  const [summary] = summarizeStudentQuestions([second, middle, first]);
  assert.equal(summary.attemptCount, 3);
  assert.equal(summary.firstPrompt, '빨간 사과');
  assert.equal(summary.finalPrompt, '꼭지가 달린 빨간 사과 한 개');
  assert.equal(summary.firstAppLevel, 3);
  assert.equal(summary.finalAppLevel, 5);
  assert.equal(
    summary.feedbacks,
    ['목표…\n현재…', NO_FEEDBACK_MARK, '잘 썼어요'].join(FEEDBACK_SEPARATOR),
    '시도 순서대로, 원문 그대로'
  );
  assert.equal(summary.missingScoreCount, 1);
  assert.equal(summary.finalScoreMissing, false);
  assert.equal(summary.firstSubmittedAt, '2026-09-27T01:01:00.000Z');
  assert.equal(summary.finalSubmittedAt, '2026-09-27T01:05:00.000Z');
});

/* ────────────────── 3. 문항 요약 ────────────────── */

test('문항 요약은 36문항을 모두 내고 결측을 분포에 넣지 않는다', () => {
  const rows = [row('R-1', 'L01', 3), row('R-2', 'L01', 3), row('R-3', 'L01', null)];
  rows[0].attemptCount = 2;
  const summary = summarizeQuestions(rows);
  assert.equal(summary.length, 36);
  const l01 = summary[0];
  assert.equal(l01.students, 3);
  assert.equal(l01.meanAttempts, 4 / 3, '반올림하지 않는다');
  assert.deepEqual(l01.finalLevelCounts, [0, 0, 2, 0, 0]);
  assert.equal(l01.finalMissing, 1);
  assert.equal(summary[1].students, 0);
  assert.equal(summary[1].meanAttempts, null, '제출이 없으면 0이 아니라 null');
  assert.equal(summary[35].band, 'C');
});

/* ────────────────── 4. 추출 ────────────────── */

test('사례 ID는 {문항번호}-{수준}{순번} 형식이다', () => {
  assert.equal(caseIdOf('L01', 3, 1), '01-31');
  assert.equal(caseIdOf('L25', 5, 4), '25-54');
});

test('같은 시드면 같은 결과, 문항을 고른 순서와 무관하다', () => {
  const rows = frame(['L01', 'L14', 'L25'], 8);
  const input = { rows, perLevel: 4, seed: 'v12-2026', excludedKeys: new Set<string>() };
  const a = drawStratifiedSample({ ...input, questionIds: ['L01', 'L14', 'L25'] });
  const b = drawStratifiedSample({ ...input, questionIds: ['L25', 'L01', 'L14'] });
  assert.deepEqual(
    a.cases.map((c) => [c.caseId, c.row.researchId]),
    b.cases.map((c) => [c.caseId, c.row.researchId])
  );
  assert.equal(a.cases.length, 60, '3문항 × 5수준 × 4');
  assert.ok(a.strata.every((s) => s.drawn === 4 && s.shortfall === 0));
  // 층마다 같은 수준의 행만 뽑힌다.
  assert.ok(a.cases.every((c) => c.row.finalAppLevel === c.level && c.row.questionId === c.questionId));

  const other = drawStratifiedSample({ ...input, questionIds: ['L01', 'L14', 'L25'], seed: 'v12-다른시드' });
  assert.notDeepEqual(
    a.cases.map((c) => c.row.researchId),
    other.cases.map((c) => c.row.researchId),
    '시드가 다르면 다른 표본'
  );
});

test('제외 표시한 행은 뽑지 않고, 모자라면 다른 층에서 채우지 않는다', () => {
  const rows = [
    ...frame(['L01'], 2),
    row('R-null', 'L01', null),
  ];
  const excluded = new Set([exclusionKey('R-300', 'L01')]);
  const res = drawStratifiedSample({ rows, questionIds: ['L01'], perLevel: 4, seed: 's', excludedKeys: excluded });
  assert.equal(res.excludedCount, 1);
  assert.equal(res.unlevelledCount, 1);
  assert.equal(res.cases.some((c) => c.row.researchId === 'R-300'), false);
  const level3 = res.strata.find((s) => s.level === 3);
  assert.deepEqual(level3, { questionId: 'L01', level: 3, candidates: 1, drawn: 1, shortfall: 3 });
  assert.equal(res.cases.length, 9, '1·2·4·5수준 2개씩 + 3수준 1개');
});

test('추출 입력을 검사한다', () => {
  assert.equal(sampleInputProblem({ questionIds: ['L01', 'L14', 'L25'], perLevel: 4, seed: 's' }), null);
  assert.ok(sampleInputProblem({ questionIds: [], perLevel: 4, seed: 's' }));
  assert.ok(sampleInputProblem({ questionIds: ['L01', 'L02', 'L03', 'L04'], perLevel: 4, seed: 's' }));
  assert.ok(sampleInputProblem({ questionIds: ['L01', 'L01'], perLevel: 4, seed: 's' }));
  assert.ok(sampleInputProblem({ questionIds: ['T1'], perLevel: 4, seed: 's' }));
  assert.ok(sampleInputProblem({ questionIds: ['L37'], perLevel: 4, seed: 's' }));
  assert.ok(sampleInputProblem({ questionIds: ['L01'], perLevel: 10, seed: 's' }), '순번이 두 자리가 되면 안 된다');
  assert.ok(sampleInputProblem({ questionIds: ['L01'], perLevel: 4, seed: '  ' }));
  assert.throws(() =>
    drawStratifiedSample({ rows: [], questionIds: ['L01'], perLevel: 0, seed: 's', excludedKeys: new Set() })
  );
});

test('추출 CSV에 사례 ID·시드·표본 ID가 들어간다', () => {
  const res = drawStratifiedSample({ rows: frame(['L01'], 1), questionIds: ['L01'], perLevel: 1, seed: 'seed-1', excludedKeys: new Set() });
  const csv = buildSampleCsv('sample-1', 'seed-1', res.cases);
  const [header, first] = csv.replace(/^﻿/, '').split('\r\n');
  assert.match(header, /^"case_id","question_id","band","app_level"/);
  assert.match(first, /^"01-11","L01","A",1,1,"R-100"/);
  assert.ok(first.includes('"sample-1"') && first.includes('"seed-1"'));
});

/* ────────────────── 5. 동의 ────────────────── */

test('보호자 동의와 학생 승낙이 모두 있고 철회하지 않은 학생만 연구 추출 대상이다', () => {
  assert.equal(isConsentDocActive('R-1', { guardianConsent: 'granted', studentAssent: 'granted' }), true);
  assert.equal(isConsentDocActive('R-1', { guardianConsent: 'granted', studentAssent: 'declined' }), false);
  assert.equal(
    isConsentDocActive('R-1', { guardianConsent: 'granted', studentAssent: 'granted', withdrawnAt: '2026-09-01T00:00:00Z' }),
    false
  );
  assert.equal(isConsentDocActive('R-1', null), false);
});
