/**
 * 연습 시도 요약과 연구용 추출(논문 v12, 공통 루브릭 v12-2)의 순수 규칙 시험.
 *
 *   1. 앱 종합 수준 = 해당 영역 평균(not_applicable 제외)의 round_half_up, 1~4. 결측은 null
 *   2. 학생 × 문항 요약은 제출 순서를 지키고 원문·피드백을 바꾸지 않는다
 *   3. 옛 v7 기록은 읽되 요약·추출에서 빼고 따로 센다
 *   4. 문항 요약은 36문항을 모두 내고, 단계는 현재 6단계 배치(L13=4단계, L19=3단계)를 따른다
 *   5. 추출은 문항 × 4수준 층, 기본 5개, 시드만으로 다시 만들어지며 모자라면 채우지 않는다
 *   6. CSV에서 not_applicable과 결측(NA)이 섞이지 않는다
 *   7. 동의가 없거나 철회한 학생은 연구 추출 대상이 아니다
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  APP_LEVELS,
  DEFAULT_PER_LEVEL,
  FEEDBACK_SEPARATOR,
  MAX_PER_LEVEL,
  NO_FEEDBACK_MARK,
  SAMPLE_SCHEMA_VERSION,
  buildAttemptCsv,
  buildLegacySampleCsv,
  buildQuestionSummaryCsv,
  buildSampleCsv,
  buildStudentQuestionCsv,
  caseIdOf,
  countLegacyAttempts,
  drawStratifiedSample,
  exclusionKey,
  isConsentDocActive,
  isLegacySampleDoc,
  sampleInputProblem,
  summarizeQuestions,
  summarizeStudentQuestions,
  toPracticeAttempt,
  type PracticeAttempt,
  type StudentQuestionSummary,
} from '../src/server/export/practice-summary';
import type { AreaLevel, AreaLevelValue } from '../src/lib/scoring';

/* ────────────────── 보조 ────────────────── */

type Lv = AreaLevelValue;

function area(level: Lv, evidence: string | null = null, missing: string[] = []) {
  return level === 'not_applicable'
    ? { level, evidence: null, missing: [], evidenceMissing: [] }
    : { level, evidence, missing, evidenceMissing: [] };
}

function scored(o: Lv, f: Lv, r: Lv) {
  return {
    result: {
      status: 'scored',
      areas: { object: area(o, '사과', ['개수']), feature: area(f), relation: area(r) },
      feedbackStatus: 'verified',
    },
    feedback: { text: '목표\n[대상] 잘 쓴 점\n[특징] 다음 행동\n제안', status: 'verified', quote: null, regenerated: false },
    calls: [],
    modelId: 'googleai/gemini-3.8-flash',
    servedModel: 'gemini-3.8-flash-001',
    promptHash: 'ph',
  };
}

const MISSING_SCORING = {
  result: { status: 'missing', areas: null, reason: 'model_error' },
  feedback: null,
  modelId: 'googleai/gemini-3.8-flash',
  servedModel: null,
  promptHash: 'ph',
};

/** 새 v12-2 연습 제출 문서 */
function doc(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schemaVersion: 'v12.2-practice-submission',
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
    rubricVersion: 'v12-2',
    scoring: scored(2, 3, 'not_applicable'),
    feedbackReview: null,
    ...over,
  };
}

/** 옛 v7 연습 제출 문서(축별 5수준·100점) */
function legacyDoc(over: Record<string, unknown> = {}): Record<string, unknown> {
  return doc({
    schemaVersion: 'v7.0-practice-submission',
    rubricVersion: 'v7-candidate',
    submissionId: 'ps_old',
    submittedAt: '2026-09-01T01:00:00.000Z',
    scoring: {
      result: { status: 'scored', score: 50, levels: { objectLevel: 3, specificityLevel: 2.5, contextLevel: null }, axisScores: {} },
      feedback: { text: '옛 피드백', status: 'verified' },
      modelId: 'googleai/gemini',
      promptHash: 'old',
    },
    ...over,
  });
}

function attempt(over: Record<string, unknown> = {}): PracticeAttempt {
  const a = toPracticeAttempt(String(over.submissionId ?? 'ps_1'), doc(over));
  assert.ok(a);
  return a!;
}

function row(researchId: string, questionId: string, finalAppLevel: AreaLevel | null): StudentQuestionSummary {
  const levels = finalAppLevel === null ? null : { object: finalAppLevel, feature: finalAppLevel, relation: finalAppLevel };
  return {
    researchId,
    classResearchId: '123456',
    questionId,
    level: Number(questionId.slice(1)),
    chasi: 1,
    band: 'A',
    attemptCount: 1,
    legacyAttemptCount: 0,
    firstSubmissionId: `ps_${researchId}_${questionId}`,
    finalSubmissionId: `ps_${researchId}_${questionId}`,
    firstPrompt: 'p',
    finalPrompt: `최종 ${researchId}`,
    firstLevels: levels,
    firstAppLevel: finalAppLevel,
    finalLevels: levels,
    finalAppLevel,
    finalAppLevelRaw: finalAppLevel,
    finalAreas: null,
    feedbacks: '',
    firstSubmittedAt: null,
    finalSubmittedAt: null,
    missingScoreCount: finalAppLevel === null ? 1 : 0,
    finalScoreMissing: finalAppLevel === null,
    finalRubricVersion: 'v12-2',
    finalModelId: null,
    finalServedModel: null,
  };
}

/** 문항마다 종합 1~4수준에 학생을 고르게 배치한 표본 틀 */
function frame(questionIds: string[], perLevel: number): StudentQuestionSummary[] {
  const rows: StudentQuestionSummary[] = [];
  for (const q of questionIds) {
    for (const level of APP_LEVELS) {
      for (let i = 0; i < perLevel; i += 1) rows.push(row(`R-${level}${String(i).padStart(2, '0')}`, q, level));
    }
  }
  return rows;
}

const csvLines = (csv: string) => csv.replace(/^﻿/, '').split('\r\n').filter(Boolean);
const header = (csv: string) => csvLines(csv)[0].split(',').map((h) => h.replace(/"/g, ''));
function cellOf(csv: string, column: string, line = 1): string {
  // 이 시험의 값에는 쉼표가 든 문자열을 쓰지 않는 열만 본다.
  const idx = header(csv).indexOf(column);
  assert.ok(idx >= 0, `${column} 열이 없다`);
  return csvLines(csv)[line].split(',')[idx];
}

/* ────────────────── 1. 앱 종합 4수준 ────────────────── */

test('앱 종합 수준은 해당 영역 평균(해당 없음 제외)을 반올림(0.5 올림)한 1~4다', () => {
  const a = attempt({ scoring: scored(2, 3, 'not_applicable') });
  assert.equal(a.appLevelRaw, 2.5, '해당 없음은 평균에서 뺀다: (2+3)/2');
  assert.equal(a.appLevel, 3, '2.5는 3으로 올린다');
  assert.deepEqual([a.objectLevel, a.featureLevel, a.relationLevel], [2, 3, 'not_applicable']);

  const b = attempt({ scoring: scored(1, 2, 2) });
  assert.equal(b.appLevelRaw, 5 / 3);
  assert.equal(b.appLevel, 2);

  const c = attempt({ scoring: scored(3, 4, 'not_applicable') });
  assert.equal(c.appLevel, 4, '3.5는 4로 올린다');

  const d = attempt({ scoring: scored(1, 1, 2) });
  assert.equal(d.appLevel, 1, '1.33…은 1');

  const all4 = attempt({ scoring: scored(4, 4, 4) });
  assert.equal(all4.appLevel, 4);

  const onlyObject = attempt({ scoring: scored(2, 'not_applicable', 'not_applicable') });
  assert.equal(onlyObject.appLevel, 2, '대상만 판정해도 종합 수준이 있다');
});

test('결측은 1수준이 아니라 null이다', () => {
  const missing = attempt({ scoring: MISSING_SCORING });
  assert.equal(missing.scoreStatus, 'missing');
  assert.equal(missing.areas, null);
  assert.equal(missing.objectLevel, null);
  assert.equal(missing.appLevel, null);
  assert.equal(missing.appLevelRaw, null);
  assert.equal(missing.feedbackText, null);

  const noScoring = attempt({ scoring: null });
  assert.equal(noScoring.scoreStatus, 'missing');
  assert.equal(noScoring.appLevel, null);
});

test('형식이 어긋난 저장 결과를 유효한 수준으로 바꾸지 않는다', () => {
  for (const bad of [5, 0, 2.5, '3', null]) {
    const s = scored(2, 2, 2);
    (s.result.areas.feature as { level: unknown }).level = bad;
    const a = attempt({ scoring: s });
    assert.equal(a.scoreStatus, 'missing', `feature.level=${String(bad)}`);
    assert.equal(a.appLevel, null);
  }
});

test('영역별 근거·빠진 정보·설정 모델과 실제 모델을 그대로 읽는다', () => {
  const a = attempt();
  assert.equal(a.legacyRubric, false);
  assert.deepEqual(a.areas?.object, { level: 2, evidence: '사과', missing: ['개수'], evidenceMissing: [] });
  assert.deepEqual(a.areas?.relation, { level: 'not_applicable', evidence: null, missing: [], evidenceMissing: [] });
  assert.equal(a.modelId, 'googleai/gemini-3.8-flash');
  assert.equal(a.servedModel, 'gemini-3.8-flash-001');
  assert.equal(a.rubricVersion, 'v12-2');
  assert.equal(a.v7TotalScore, null, '새 기록에는 옛 값이 없다');
  assert.ok(a.feedbackText?.includes('[대상] 잘 쓴 점'), '피드백 원문(네 줄)을 바꾸지 않는다');
});

/* ────────────────── 2. 시도 정규화·학생 × 문항 ────────────────── */

test('일반 체험·연구ID 없는 문서·연습 밖 문항은 연구 요약에 들어가지 않는다', () => {
  assert.equal(toPracticeAttempt('x', doc({ sessionType: 'experience' })), null);
  assert.equal(toPracticeAttempt('x', doc({ researchId: null })), null);
  assert.equal(toPracticeAttempt('x', doc({ questionId: 'T1' })), null);
  assert.equal(toPracticeAttempt('x', doc({ questionId: 'game-01' })), null);
  assert.equal(toPracticeAttempt('x', doc({ persistStatus: 'failed' })), null);
  assert.equal(toPracticeAttempt('x', doc({ responseStatus: 'missing' })), null);
});

test('필드가 빠진 문서도 있는 그대로 읽는다', () => {
  const old = toPracticeAttempt('old', doc({ questionLevel: undefined, band: undefined, questionId: 'L14', submissionId: undefined }));
  assert.equal(old?.level, 14);
  assert.equal(old?.band, 'B');
  assert.equal(old?.submissionId, 'old');
});

test('학생 × 문항 요약은 제출 순서를 지키고 원문과 피드백을 바꾸지 않는다', () => {
  const second = attempt({
    submissionId: 'ps_2',
    attemptNo: 2,
    text: '꼭지가 달린 빨간 사과 한 개',
    submittedAt: '2026-09-27T01:05:00.000Z',
    scoring: { ...scored(4, 4, 'not_applicable'), feedback: { text: '다음 목표', status: 'verified' } },
  });
  const middle = attempt({
    submissionId: 'ps_3',
    attemptNo: 3,
    text: '가운데',
    submittedAt: '2026-09-27T01:03:00.000Z',
    scoring: MISSING_SCORING,
  });
  const first = attempt();
  const [summary] = summarizeStudentQuestions([second, middle, first]);
  assert.equal(summary.attemptCount, 3);
  assert.equal(summary.firstPrompt, '빨간 사과');
  assert.equal(summary.finalPrompt, '꼭지가 달린 빨간 사과 한 개');
  assert.deepEqual(summary.firstLevels, { object: 2, feature: 3, relation: 'not_applicable' });
  assert.equal(summary.firstAppLevel, 3);
  assert.deepEqual(summary.finalLevels, { object: 4, feature: 4, relation: 'not_applicable' });
  assert.equal(summary.finalAppLevel, 4);
  assert.equal(summary.finalAppLevelRaw, 4);
  assert.deepEqual(summary.finalAreas?.object.missing, ['개수']);
  assert.equal(
    summary.feedbacks,
    ['목표\n[대상] 잘 쓴 점\n[특징] 다음 행동\n제안', NO_FEEDBACK_MARK, '다음 목표'].join(FEEDBACK_SEPARATOR),
    '시도 순서대로, 원문 그대로'
  );
  assert.equal(summary.missingScoreCount, 1);
  assert.equal(summary.finalScoreMissing, false);
  assert.equal(summary.firstSubmittedAt, '2026-09-27T01:01:00.000Z');
  assert.equal(summary.finalSubmittedAt, '2026-09-27T01:05:00.000Z');
  assert.equal(summary.finalServedModel, 'gemini-3.8-flash-001');
});

/* ────────────────── 3. 옛 v7 기록 ────────────────── */

test('옛 v7 기록은 옛 값 그대로 읽고, 새 영역 수준을 지어내지 않는다', () => {
  const old = toPracticeAttempt('ps_old', legacyDoc());
  assert.ok(old);
  assert.equal(old!.legacyRubric, true);
  assert.equal(old!.scoreStatus, 'scored');
  assert.equal(old!.v7TotalScore, 50);
  assert.equal(old!.v7ObjectLevel, 3);
  assert.equal(old!.v7SpecificityLevel, 2.5, '옛 반수준을 그대로 둔다');
  assert.equal(old!.v7ContextLevel, null);
  assert.equal(old!.areas, null);
  assert.equal(old!.objectLevel, null);
  assert.equal(old!.appLevel, null, '옛 100점을 새 4수준으로 옮기지 않는다');

  // 채점 결과가 없어도 루브릭 버전으로 옛 기록임을 안다.
  const oldMissing = toPracticeAttempt('m', legacyDoc({ scoring: { result: null, feedback: null } }));
  assert.equal(oldMissing?.legacyRubric, true);
  assert.equal(oldMissing?.scoreStatus, 'missing');

  // 새 기록은 결측이어도 옛 기록이 아니다.
  assert.equal(attempt({ scoring: MISSING_SCORING }).legacyRubric, false);
});

test('옛 v7 시도는 요약·문항 요약·추출에서 빠지고 따로 센다', () => {
  const current = attempt({ submissionId: 'ps_new', submittedAt: '2026-09-27T01:00:00.000Z' });
  const old = toPracticeAttempt('ps_old', legacyDoc())!;
  const oldOnly = toPracticeAttempt('ps_old2', legacyDoc({ researchId: 'R-OLD', submissionId: 'ps_old2' }))!;
  const attempts = [old, current, oldOnly];

  assert.equal(countLegacyAttempts(attempts), 2);
  const rows = summarizeStudentQuestions(attempts);
  assert.equal(rows.length, 1, '옛 시도만 있는 학생 × 문항은 행이 없다');
  assert.equal(rows[0].researchId, 'R-001');
  assert.equal(rows[0].attemptCount, 1, '옛 시도는 시도 수에 들지 않는다');
  assert.equal(rows[0].legacyAttemptCount, 1);
  assert.equal(rows[0].firstPrompt, current.text, '첫 프롬프트도 v12-2 시도에서 고른다');
  assert.equal(rows[0].feedbacks.includes('옛 피드백'), false);

  const l01 = summarizeQuestions(rows)[0];
  assert.equal(l01.students, 1);

  const sample = drawStratifiedSample({ rows, questionIds: ['L01'], perLevel: 5, seed: 's', excludedKeys: new Set() });
  assert.equal(sample.cases.some((c) => c.row.researchId === 'R-OLD'), false);

  // 시도별 CSV에는 옛 시도가 legacy_rubric=true와 v7_* 열로 남는다.
  const csv = buildAttemptCsv([old, current]);
  assert.equal(cellOf(csv, 'legacy_rubric', 1), 'true');
  assert.equal(cellOf(csv, 'v7_total_score', 1), '50');
  assert.equal(cellOf(csv, 'v7_specificity_level', 1), '2.5');
  assert.equal(cellOf(csv, 'object_level', 1), 'NA');
  assert.equal(cellOf(csv, 'app_level', 1), 'NA');
  assert.equal(cellOf(csv, 'legacy_rubric', 2), 'false');
  assert.equal(cellOf(csv, 'v7_total_score', 2), 'NA');
  assert.equal(header(csv).includes('total_score'), false, '100점 열이 없다');
});

/* ────────────────── 4. 문항 요약·단계 ────────────────── */

test('문항 요약은 36문항을 모두 내고 결측을 분포에 넣지 않는다', () => {
  const rows = [row('R-1', 'L01', 3), row('R-2', 'L01', 3), row('R-3', 'L01', null), row('R-4', 'L01', 4)];
  rows[0].attemptCount = 2;
  const summary = summarizeQuestions(rows);
  assert.equal(summary.length, 36);
  const l01 = summary[0];
  assert.equal(l01.students, 4);
  assert.equal(l01.meanAttempts, 5 / 4, '반올림하지 않는다');
  assert.deepEqual(l01.finalLevelCounts, [0, 0, 2, 1]);
  assert.equal(l01.finalMissing, 1);
  assert.equal(summary[1].students, 0);
  assert.equal(summary[1].meanAttempts, null, '제출이 없으면 0이 아니라 null');
  assert.deepEqual(summary[1].finalAreaMeans, { object: null, feature: null, relation: null });
  assert.equal(summary[35].band, 'C');
});

test('영역별 평균은 해당 없음·결측을 빼고 반올림하지 않으며, 해당 없음은 따로 센다', () => {
  const a = row('R-1', 'L01', 2);
  a.finalLevels = { object: 2, feature: 3, relation: 'not_applicable' };
  const b = row('R-2', 'L01', 3);
  b.finalLevels = { object: 3, feature: 4, relation: 'not_applicable' };
  const c = row('R-3', 'L01', 2);
  c.finalLevels = { object: 2, feature: 2, relation: 1 };
  const d = row('R-4', 'L01', null);
  const [l01] = summarizeQuestions([a, b, c, d]);
  assert.equal(l01.finalAreaMeans.object, 7 / 3);
  assert.equal(l01.finalAreaMeans.feature, 3);
  assert.equal(l01.finalAreaMeans.relation, 1, '해당 없음 두 명을 빼고 한 명만');
  assert.deepEqual(l01.finalAreaNotApplicable, { object: 0, feature: 0, relation: 2 });

  const csv = buildQuestionSummaryCsv([l01]);
  assert.equal(cellOf(csv, 'final_relation_not_applicable'), '2');
  assert.equal(cellOf(csv, 'final_feature_mean'), '3');
  assert.ok(header(csv).includes('final_level_4'));
  assert.equal(header(csv).includes('final_level_5'), false, '5수준 열이 없다');
});

test('단계는 현재 6단계 배치를 따른다(L13은 4단계, L19는 3단계)', () => {
  const summary = summarizeQuestions([]);
  const byId = (id: string) => summary.find((q) => q.questionId === id)!;
  assert.equal(byId('L01').chasi, 1);
  assert.equal(byId('L12').chasi, 2);
  assert.equal(byId('L13').chasi, 4);
  assert.equal(byId('L18').chasi, 4);
  assert.equal(byId('L19').chasi, 3);
  assert.equal(byId('L24').chasi, 3);
  assert.equal(byId('L25').chasi, 5);
  assert.equal(byId('L36').chasi, 6);
  assert.equal(byId('L13').band, 'B', '밴드는 문항 번호로 정한다');
  assert.equal(byId('L19').band, 'B');

  const [r13] = summarizeStudentQuestions([attempt({ questionId: 'L13', questionLevel: 13, lesson: 4, band: 'B' })]);
  assert.equal(r13.chasi, 4);
  const [r19] = summarizeStudentQuestions([attempt({ questionId: 'L19', questionLevel: 19, lesson: 3, band: 'B' })]);
  assert.equal(r19.chasi, 3);
  // 시도 한 건은 저장된 차시를 그대로 둔다.
  assert.equal(attempt({ questionId: 'L13', questionLevel: 13, lesson: 3 }).chasi, 3);
});

/* ────────────────── 5. 추출 ────────────────── */

test('사례 ID는 {문항번호}-{수준}{순번} 형식이다', () => {
  assert.equal(caseIdOf('L01', 3, 1), '01-31');
  assert.equal(caseIdOf('L25', 4, 5), '25-45');
});

test('층은 문항 × 종합 1~4수준, 기본 5개이며 같은 시드면 문항 순서와 무관하게 같은 결과다', () => {
  assert.deepEqual([...APP_LEVELS], [1, 2, 3, 4]);
  assert.equal(DEFAULT_PER_LEVEL, 5);
  assert.equal(MAX_PER_LEVEL, 9);

  const rows = frame(['L01', 'L14', 'L25'], 8);
  const input = { rows, perLevel: DEFAULT_PER_LEVEL, seed: 'v12-2026', excludedKeys: new Set<string>() };
  const a = drawStratifiedSample({ ...input, questionIds: ['L01', 'L14', 'L25'] });
  const b = drawStratifiedSample({ ...input, questionIds: ['L25', 'L01', 'L14'] });
  const c = drawStratifiedSample({ ...input, questionIds: ['L14', 'L25', 'L01'] });
  const key = (x: typeof a) => x.cases.map((k) => [k.caseId, k.row.researchId]);
  assert.deepEqual(key(a), key(b));
  assert.deepEqual(key(a), key(c));
  assert.equal(a.cases.length, 60, '3문항 × 4수준 × 5');
  assert.equal(a.strata.length, 12);
  assert.deepEqual([...new Set(a.strata.map((s) => s.level))], [1, 2, 3, 4]);
  assert.ok(a.strata.every((s) => s.drawn === 5 && s.shortfall === 0 && s.candidates === 8));
  assert.ok(a.cases.every((k) => k.row.finalAppLevel === k.level && k.row.questionId === k.questionId));
  assert.ok(a.cases.some((k) => k.caseId === '14-45'));

  const other = drawStratifiedSample({ ...input, questionIds: ['L01', 'L14', 'L25'], seed: 'v12-다른시드' });
  assert.notDeepEqual(
    a.cases.map((k) => k.row.researchId),
    other.cases.map((k) => k.row.researchId),
    '시드가 다르면 다른 표본'
  );
});

test('한 문항의 층 결과는 함께 고른 다른 문항과 무관하다', () => {
  const rows = frame(['L01', 'L14', 'L25'], 8);
  const input = { rows, perLevel: 5, seed: 'fixed', excludedKeys: new Set<string>() };
  const alone = drawStratifiedSample({ ...input, questionIds: ['L14'] });
  const together = drawStratifiedSample({ ...input, questionIds: ['L01', 'L14', 'L25'] });
  assert.deepEqual(
    alone.cases.map((k) => [k.caseId, k.row.researchId]),
    together.cases.filter((k) => k.questionId === 'L14').map((k) => [k.caseId, k.row.researchId])
  );
});

test('제외 표시한 행은 뽑지 않고, 모자라면 다른 층에서 채우지 않고 shortfall로 남긴다', () => {
  const rows = [...frame(['L01'], 2), row('R-null', 'L01', null)];
  const excluded = new Set([exclusionKey('R-300', 'L01')]);
  const res = drawStratifiedSample({ rows, questionIds: ['L01'], perLevel: 5, seed: 's', excludedKeys: excluded });
  assert.equal(res.excludedCount, 1);
  assert.equal(res.unlevelledCount, 1, '결측은 어느 층에도 들지 않는다');
  assert.equal(res.cases.some((c) => c.row.researchId === 'R-300'), false);
  assert.deepEqual(
    res.strata.find((s) => s.level === 3),
    { questionId: 'L01', level: 3, candidates: 1, drawn: 1, shortfall: 4 }
  );
  assert.deepEqual(
    res.strata.find((s) => s.level === 1),
    { questionId: 'L01', level: 1, candidates: 2, drawn: 2, shortfall: 3 }
  );
  assert.equal(res.cases.length, 7, '1·2·4수준 2개씩 + 3수준 1개');
});

test('추출 입력을 검사한다', () => {
  assert.equal(sampleInputProblem({ questionIds: ['L01', 'L14', 'L25'], perLevel: 5, seed: 's' }), null);
  assert.ok(sampleInputProblem({ questionIds: [], perLevel: 5, seed: 's' }));
  assert.ok(sampleInputProblem({ questionIds: ['L01', 'L02', 'L03', 'L04'], perLevel: 5, seed: 's' }));
  assert.ok(sampleInputProblem({ questionIds: ['L01', 'L01'], perLevel: 5, seed: 's' }));
  assert.ok(sampleInputProblem({ questionIds: ['T1'], perLevel: 5, seed: 's' }));
  assert.ok(sampleInputProblem({ questionIds: ['L37'], perLevel: 5, seed: 's' }));
  assert.ok(sampleInputProblem({ questionIds: ['L01'], perLevel: 10, seed: 's' }), '순번이 두 자리가 되면 안 된다');
  assert.ok(sampleInputProblem({ questionIds: ['L01'], perLevel: 2.5, seed: 's' }));
  assert.ok(sampleInputProblem({ questionIds: ['L01'], perLevel: 5, seed: '  ' }));
  assert.throws(() =>
    drawStratifiedSample({ rows: [], questionIds: ['L01'], perLevel: 0, seed: 's', excludedKeys: new Set() })
  );
});

test('추출 CSV에 사례 ID·시드·표본 ID와 영역 수준이 들어간다', () => {
  const res = drawStratifiedSample({ rows: frame(['L01'], 1), questionIds: ['L01'], perLevel: 1, seed: 'seed-1', excludedKeys: new Set() });
  const csv = buildSampleCsv('sample-1', 'seed-1', res.cases);
  const [head, first] = csvLines(csv);
  assert.match(head, /^"case_id","question_id","band","app_level","sequence","research_id"/);
  assert.match(first, /^"01-11","L01","A",1,1,"R-100"/);
  assert.ok(first.includes('"sample-1"') && first.includes('"seed-1"'));
  assert.ok(header(csv).includes('final_feature_level'));
  assert.ok(header(csv).includes('final_relation_missing'));
  assert.equal(header(csv).some((h) => h.includes('total_score')), false, '100점 열이 없다');
});

test('옛 5수준 추출 기록은 그때의 열 그대로 다시 낸다', () => {
  assert.equal(SAMPLE_SCHEMA_VERSION, 'v12-2-extraction-1');
  assert.equal(isLegacySampleDoc({ schemaVersion: 'v12-extraction-1' }), true);
  assert.equal(isLegacySampleDoc({ schemaVersion: SAMPLE_SCHEMA_VERSION }), false);
  const oldCase = {
    caseId: '01-51',
    questionId: 'L01',
    level: 5,
    sequence: 1,
    row: { band: 'A', researchId: 'R-9', finalPrompt: '옛 글', finalTotalScore: 100, finalAppLevelRaw: 5, finalObjectLevel: 5, finalSpecificityLevel: 5, finalContextLevel: null, attemptCount: 2 },
  };
  const csv = buildLegacySampleCsv('S-old', 'seed-old', [oldCase]);
  assert.ok(header(csv).includes('final_total_score'));
  assert.equal(cellOf(csv, 'app_level'), '5', '옛 수준을 새 4수준으로 옮기지 않는다');
  assert.equal(cellOf(csv, 'final_total_score'), '100');
  assert.equal(cellOf(csv, 'final_context_level'), 'NA');
});

/* ────────────────── 6. CSV의 해당 없음과 결측 ────────────────── */

test('CSV에서 not_applicable은 "not_applicable", 결측은 NA로 갈린다', () => {
  const na = attempt({ scoring: scored(2, 3, 'not_applicable') });
  const missing = attempt({ submissionId: 'ps_m', scoring: MISSING_SCORING, submittedAt: '2026-09-27T02:00:00.000Z' });
  const csv = buildAttemptCsv([na, missing]);
  assert.equal(cellOf(csv, 'relation_level', 1), '"not_applicable"');
  assert.equal(cellOf(csv, 'object_level', 1), '2');
  assert.equal(cellOf(csv, 'app_level', 1), '3');
  assert.equal(cellOf(csv, 'app_level_raw', 1), '2.5', '반올림 전 값을 그대로 쓴다');
  assert.equal(cellOf(csv, 'relation_missing', 1), '"[]"', '해당 없음 영역의 빠진 정보는 빈 목록');
  assert.equal(cellOf(csv, 'served_model', 1), '"gemini-3.8-flash-001"');
  for (const col of ['object_level', 'feature_level', 'relation_level', 'app_level', 'object_missing']) {
    assert.equal(cellOf(csv, col, 2), 'NA', `결측의 ${col}은 NA`);
  }

  const [summaryRow] = summarizeStudentQuestions([na]);
  const sq = buildStudentQuestionCsv([summaryRow]);
  assert.equal(cellOf(sq, 'final_relation_level'), '"not_applicable"');
  assert.equal(cellOf(sq, 'first_relation_level'), '"not_applicable"');
  assert.equal(cellOf(sq, 'final_object_evidence'), '"사과"');
  assert.ok(csvLines(sq)[1].includes('"[""개수""]"'), '빠진 정보는 JSON 목록');
});

/* ────────────────── 7. 동의 ────────────────── */

test('보호자 동의와 학생 승낙이 모두 있고 철회하지 않은 학생만 연구 추출 대상이다', () => {
  assert.equal(isConsentDocActive('R-1', { guardianConsent: 'granted', studentAssent: 'granted' }), true);
  assert.equal(isConsentDocActive('R-1', { guardianConsent: 'granted', studentAssent: 'declined' }), false);
  assert.equal(
    isConsentDocActive('R-1', { guardianConsent: 'granted', studentAssent: 'granted', withdrawnAt: '2026-09-01T00:00:00Z' }),
    false
  );
  assert.equal(isConsentDocActive('R-1', null), false);
});
