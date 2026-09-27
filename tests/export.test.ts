/**
 * 내보내기·완전성 점검 시험 (설계서 §7, 수용시험 10)
 *
 * CSV의 null 유지·수준 소수 유지·수식 주입 방지·한글 인코딩(BOM)과
 * 학생ID × 시점 × 문항의 중복·불완전 6응답 탐지를 확인한다.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { SCHEMA_VERSION, type ScoringRun, type SubmissionRecord } from '@/lib/research/types';
import type { LegacyScoringRun } from '@/lib/legacy-v7/types';
import {
  CSV_BOM,
  CSV_NULL_TOKEN,
  formatCsvCell,
  toCsv,
  toCsvBytes,
} from '@/server/export/csv';
import {
  buildCallCsv,
  buildSubmissionCsv,
  cellOf,
  submissionColumnKeys,
  type ExportRow,
} from '@/server/export/records';
import {
  ASSESSMENT_QUESTION_IDS,
  RESPONSES_PER_STUDENT,
  checkCompleteness,
  createSeededRandom,
  keepAllResponsesOfSampledStudents,
  pickStudentLevelSample,
} from '@/server/export/completeness';
import {
  GENERATIONS_PER_SENTENCE,
  GENERATION_SENTENCE_COUNT,
  GenerationNotAuthorizedError,
  requireGenerationAuthority,
  summarizeGenerationStatus,
  verifyGenerationRecord,
  type GenerationComparisonRecord,
} from '@/server/export/generation-sample';

/* ────────────────────── CSV 직렬화 ────────────────────── */

test('결측은 NA로 남기고 빈칸이나 0으로 바꾸지 않는다', () => {
  assert.equal(formatCsvCell(null), CSV_NULL_TOKEN);
  assert.equal(formatCsvCell(undefined), CSV_NULL_TOKEN);
  // 유효한 0점과 결측을 구분한다.
  assert.equal(formatCsvCell(0), '0');
  assert.notEqual(formatCsvCell(0), formatCsvCell(null));
  // 빈 문자열도 결측과 구분된다(따옴표가 붙는다).
  assert.equal(formatCsvCell(''), '""');
  assert.notEqual(formatCsvCell(''), CSV_NULL_TOKEN);
  // 유효하지 않은 수는 결측으로 쓴다. 0으로 바꾸지 않는다.
  assert.equal(formatCsvCell(Number.NaN), CSV_NULL_TOKEN);
  assert.equal(formatCsvCell(Number.POSITIVE_INFINITY), CSV_NULL_TOKEN);
});

test('수준의 반수준과 점수의 소수를 반올림하지 않는다', () => {
  assert.equal(formatCsvCell(2.5), '2.5');
  assert.equal(formatCsvCell(56.25), '56.25');
  assert.equal(formatCsvCell(3.5), '3.5');
  assert.equal(formatCsvCell(43.75), '43.75');
});

test('수식 주입을 막는다', () => {
  for (const dangerous of ['=1+1', '+1', '-1', '@SUM(A1)', '\t나쁜 값', '\r나쁜 값']) {
    const cell = formatCsvCell(dangerous);
    assert.equal(cell.startsWith(`"'`), true, `${JSON.stringify(dangerous)} 앞에 작은따옴표가 붙는다`);
  }
  // 위험하지 않은 값에는 붙이지 않는다.
  assert.equal(formatCsvCell('노란 세모 블록'), '"노란 세모 블록"');
  // 따옴표는 두 번 겹쳐 이스케이프한다.
  assert.equal(formatCsvCell('그는 "안녕"이라 했다'), '"그는 ""안녕""이라 했다"');
});

test('한글을 UTF-8 BOM과 함께 낸다', () => {
  const csv = toCsv([{ text: '노란 세모 블록' }], [{ key: 'text', get: (r) => r.text }]);
  assert.equal(csv.startsWith(CSV_BOM), true);
  const bytes = toCsvBytes(csv);
  // BOM 세 바이트
  assert.deepEqual([bytes[0], bytes[1], bytes[2]], [0xef, 0xbb, 0xbf]);
  // 한글이 UTF-8로 왕복한다.
  assert.equal(new TextDecoder().decode(bytes).includes('노란 세모 블록'), true);
});

test('CSV 줄바꿈은 CRLF이고 헤더가 첫 줄이다', () => {
  const csv = toCsv(
    [{ a: 1 }, { a: 2 }],
    [{ key: 'a', get: (r) => r.a }]
  );
  const body = csv.slice(CSV_BOM.length);
  assert.deepEqual(body.split('\r\n'), ['"a"', '1', '2', '']);
});

/* ────────────────────── 레코드 → CSV ────────────────────── */

const BASE_SUBMISSION: SubmissionRecord = {
  schemaVersion: SCHEMA_VERSION,
  submissionId: 'sub_0001',
  researchId: 'R-0001',
  classResearchId: 'C-01',
  sessionType: 'research_assessment',
  phase: 'pre',
  lesson: null,
  questionId: 'T1',
  band: 'A',
  imageHash: 'f4734f7d',
  cueVersion: 'v7-candidate',
  rubricVersion: 'v7-candidate',
  text: '노란 세모 블록이 있다.',
  startedAt: '2026-03-02T01:00:00.000Z',
  submittedAt: '2026-03-02T01:01:00.000Z',
  durationMs: 60000,
  attemptNo: 1,
  consentVersion: 'consent-v7',
  responseStatus: 'submitted',
  missingReason: null,
  persistStatus: 'stored',
};

const SCORED_RUN: ScoringRun = {
  operationId: 'op_1',
  repeatIndex: 1,
  band: 'A',
  result: {
    status: 'scored',
    // 공통 루브릭 v12-2: 영역별 정수 1~4 또는 not_applicable. 100점 환산은 없다.
    areas: {
      object: { level: 3, evidence: '노란 세모 블록', missing: [], evidenceMissing: [] },
      feature: {
        level: 2,
        evidence: '노란',
        // 모델이 낸 문구가 수식 문자로 시작해도 CSV에서 무력화되어야 한다.
        missing: ['=SUM(A1)', '블록의 크기'],
        evidenceMissing: [],
      },
      relation: { level: 'not_applicable', evidence: null, missing: [], evidenceMissing: [] },
    },
    feedbackStatus: 'not_requested',
  },
  calls: [
    {
      callId: 'c1',
      retryIndex: 0,
      purpose: 'score',
      levels: null,
      failureReason: 'schema_error: 형식 오류 영역: feature.level',
      servedModel: 'gemini-served-001',
      startedAt: '2026-03-02T02:00:00.000Z',
      finishedAt: '2026-03-02T02:00:01.000Z',
      durationMs: 1000,
    },
    {
      callId: 'c1',
      retryIndex: 1,
      purpose: 'score',
      levels: { object: 3, feature: 2, relation: 'not_applicable' },
      failureReason: null,
      servedModel: 'gemini-served-001',
      startedAt: '2026-03-02T02:00:01.000Z',
      finishedAt: '2026-03-02T02:00:02.500Z',
      durationMs: 1500,
    },
  ],
  extraCall: false,
  feedback: null,
  modelId: 'fake-model',
  servedModel: 'gemini-served-001',
  modelConfig: { temperature: 0.2 },
  rubricVersion: 'v12-2',
  cueVersion: 'v7-candidate',
  applicabilitySource: 'cue_pack',
  focusArea: null,
  // 채점에 실제로 보낸 이미지의 해시. 제출 기록의 imageHash와 따로 남긴다.
  imageHash: 'f4734f7d',
  promptHash: 'ph_1',
  codeCommit: 'abc1234',
  scoredAt: '2026-03-02T02:00:02.000Z',
};

/** 저장소에 남아 있는 옛 v7 채점 작업(축별 5수준·100점). 읽기만 한다. */
const LEGACY_RUN: LegacyScoringRun = {
  operationId: 'op_old',
  repeatIndex: 1,
  band: 'A',
  result: {
    status: 'scored',
    // A밴드의 맥락 축은 null이며 0이 아니다. 반수준을 유지한다.
    levels: { objectLevel: 2.5, specificityLevel: 4, contextLevel: null },
    score: 56.25,
    axisScores: { object: 18.75, specificity: 37.5, context: null },
    feedbackStatus: 'not_requested',
  },
  calls: [
    {
      callId: 'c1',
      retryIndex: 0,
      levels: { objectLevel: 2, specificityLevel: 4, contextLevel: null },
      failureReason: null,
      startedAt: '2026-03-02T02:00:00.000Z',
      finishedAt: '2026-03-02T02:00:01.000Z',
      durationMs: 1000,
    },
    {
      callId: 'c2',
      retryIndex: 0,
      levels: null,
      failureReason: 'schema_error',
      startedAt: '2026-03-02T02:00:00.000Z',
      finishedAt: '2026-03-02T02:00:01.500Z',
      durationMs: 1500,
    },
  ],
  extraCall: false,
  feedback: null,
  modelId: 'old-model',
  modelConfig: { temperature: 0.2 },
  rubricVersion: 'v7-candidate',
  cueVersion: 'v7-candidate',
  imageHash: 'f4734f7d',
  promptHash: 'ph_old',
  codeCommit: 'old1234',
  scoredAt: '2026-03-01T02:00:02.000Z',
};

/** CSV 본문을 헤더와 값 줄로 나눈다(BOM 제외). */
function parseCsv(csv: string): { header: string[]; rows: string[][] } {
  const lines = csv.slice(CSV_BOM.length).trimEnd().split('\r\n');
  return {
    header: splitCsvLine(lines[0]).map((h) => h.replace(/"/g, '')),
    rows: lines.slice(1).map(splitCsvLine),
  };
}

test('내보내기 행이 기준 버전과 결측 구분을 그대로 담는다', () => {
  const scoredRow: ExportRow = { submission: BASE_SUBMISSION, run: SCORED_RUN };

  // 기준 버전이 열로 나온다. 수집 당시 버전과 실제 채점에 쓴 버전을 따로 낸다.
  assert.equal(cellOf(scoredRow, 'schema_version'), SCHEMA_VERSION);
  assert.equal(cellOf(scoredRow, 'cue_version'), 'v7-candidate');
  assert.equal(cellOf(scoredRow, 'rubric_version'), 'v7-candidate');
  assert.equal(cellOf(scoredRow, 'scored_rubric_version'), 'v12-2');
  assert.equal(cellOf(scoredRow, 'code_commit'), 'abc1234');
  assert.equal(cellOf(scoredRow, 'prompt_hash'), 'ph_1');
  // 설정한 모델과 실제로 답한 모델을 함께 낸다.
  assert.equal(cellOf(scoredRow, 'model_id'), 'fake-model');
  assert.equal(cellOf(scoredRow, 'served_model'), 'gemini-served-001');
  assert.equal(cellOf(scoredRow, 'applicability_source'), 'cue_pack');
  assert.equal(cellOf(scoredRow, 'legacy_rubric'), false);

  // 영역별 수준. 해당 없음은 NA가 아니라 not_applicable로 구분한다.
  assert.equal(cellOf(scoredRow, 'object_level'), 3);
  assert.equal(cellOf(scoredRow, 'feature_level'), 2);
  assert.equal(cellOf(scoredRow, 'relation_level'), 'not_applicable');
  // 앱 종합 수준 = round_half_up((3+2)/2) = 3. 반올림 전 값 2.5를 그대로 낸다.
  assert.equal(cellOf(scoredRow, 'app_level'), 3);
  assert.equal(cellOf(scoredRow, 'app_level_raw'), 2.5);
  // 근거는 학생 원문 그대로, 없으면 NA.
  assert.equal(cellOf(scoredRow, 'object_evidence'), '노란 세모 블록');
  assert.equal(cellOf(scoredRow, 'relation_evidence'), null);
  // 빠진 정보는 ' | '로 잇는다. 빠진 것이 없으면 빈 문자열이다(결측 NA와 다르다).
  assert.equal(cellOf(scoredRow, 'feature_missing'), '=SUM(A1) | 블록의 크기');
  assert.equal(cellOf(scoredRow, 'object_missing'), '');
  // 옛 v7 열은 새 작업에서 비어 있다.
  assert.equal(cellOf(scoredRow, 'v7_object_level'), null);
  assert.equal(cellOf(scoredRow, 'v7_total_score'), null);
  // 100점 환산 열은 없다.
  assert.equal(cellOf(scoredRow, 'total_score'), null);
  assert.equal(submissionColumnKeys().includes('total_score'), false);
  assert.equal(submissionColumnKeys().includes('specificity_level'), false);
  // 형식 오류로 다시 부른 호출은 실패 호출로 센다.
  assert.equal(cellOf(scoredRow, 'call_count'), 2);
  assert.equal(cellOf(scoredRow, 'failed_call_count'), 1);
  assert.equal(cellOf(scoredRow, 'extra_call'), false);
  // 검사는 차시 활동이 아니므로 lesson은 null이다.
  assert.equal(cellOf(scoredRow, 'lesson'), null);

  const missingRow: ExportRow = {
    submission: {
      ...BASE_SUBMISSION,
      submissionId: 'sub_0002',
      text: '',
      submittedAt: null,
      durationMs: null,
      responseStatus: 'missing',
      missingReason: 'timeout_unsubmitted',
    },
    run: null,
  };
  assert.equal(cellOf(missingRow, 'object_level'), null);
  assert.equal(cellOf(missingRow, 'app_level'), null);
  assert.equal(cellOf(missingRow, 'object_missing'), null);
  assert.equal(cellOf(missingRow, 'legacy_rubric'), null);
  assert.equal(cellOf(missingRow, 'missing_reason'), 'timeout_unsubmitted');

  const modelMissingRow: ExportRow = {
    submission: BASE_SUBMISSION,
    run: {
      ...SCORED_RUN,
      servedModel: null,
      result: { status: 'missing', areas: null, reason: 'required_call_failed' },
    },
  };
  // 운영 결측은 최저 수준이 아니다. 모든 영역·종합 수준이 NA다.
  for (const key of ['object_level', 'feature_level', 'relation_level', 'app_level', 'app_level_raw']) {
    assert.equal(cellOf(modelMissingRow, key), null, key);
  }
  assert.equal(cellOf(modelMissingRow, 'model_missing_reason'), 'required_call_failed');
  assert.equal(cellOf(modelMissingRow, 'served_model'), null);
});

test('옛 v7 채점 작업은 legacy_rubric=true와 v7 열로만 읽히고 영역 수준을 지어내지 않는다', () => {
  const legacyRow: ExportRow = { submission: BASE_SUBMISSION, run: LEGACY_RUN };
  assert.equal(cellOf(legacyRow, 'legacy_rubric'), true);
  assert.equal(cellOf(legacyRow, 'scored_rubric_version'), 'v7-candidate');
  // 반수준과 소수 점수를 그대로 낸다. A밴드의 맥락 축은 null이다.
  assert.equal(cellOf(legacyRow, 'v7_object_level'), 2.5);
  assert.equal(cellOf(legacyRow, 'v7_specificity_level'), 4);
  assert.equal(cellOf(legacyRow, 'v7_context_level'), null);
  assert.equal(cellOf(legacyRow, 'v7_total_score'), 56.25);
  // 새 영역 열은 모두 NA다.
  for (const key of [
    'object_level',
    'feature_level',
    'relation_level',
    'app_level',
    'app_level_raw',
    'object_evidence',
    'object_missing',
    'served_model',
    'applicability_source',
  ]) {
    assert.equal(cellOf(legacyRow, key), null, key);
  }
  assert.equal(cellOf(legacyRow, 'failed_call_count'), 1);

  const legacyMissing: ExportRow = {
    submission: BASE_SUBMISSION,
    run: {
      ...LEGACY_RUN,
      result: { status: 'missing', levels: null, score: null, axisScores: null, reason: 'model_error' },
    },
  };
  assert.equal(cellOf(legacyMissing, 'legacy_rubric'), true);
  assert.equal(cellOf(legacyMissing, 'v7_total_score'), null);
  assert.equal(cellOf(legacyMissing, 'model_missing_reason'), 'model_error');
});

test('제출·채점 CSV에 결측이 NA로, 해당 없음이 문자열로, 반올림 전 종합 수준이 소수로 나온다', () => {
  const csv = buildSubmissionCsv([
    { submission: BASE_SUBMISSION, run: SCORED_RUN },
    { submission: { ...BASE_SUBMISSION, submissionId: 'sub_old' }, run: LEGACY_RUN },
  ]);
  const { header, rows } = parseCsv(csv);
  const [v12, old] = rows;
  const at = (row: string[], key: string) => row[header.indexOf(key)];

  for (const key of [
    'rubric_version',
    'scored_rubric_version',
    'object_level',
    'feature_level',
    'relation_level',
    'app_level',
    'app_level_raw',
    'object_evidence',
    'feature_evidence',
    'relation_evidence',
    'object_missing',
    'feature_missing',
    'relation_missing',
    'served_model',
    'legacy_rubric',
    'v7_object_level',
    'v7_specificity_level',
    'v7_context_level',
    'v7_total_score',
    'feedback_status',
    'feedback_text',
  ]) {
    assert.ok(header.includes(key), `${key} 열이 없다`);
  }
  assert.equal(new Set(header).size, header.length, '열 이름이 겹치면 안 된다');

  assert.equal(at(v12, 'relation_level'), '"not_applicable"');
  assert.equal(at(v12, 'app_level_raw'), '2.5');
  assert.equal(at(v12, 'relation_evidence'), CSV_NULL_TOKEN);
  assert.equal(at(v12, 'legacy_rubric'), 'false');
  assert.equal(at(v12, 'v7_total_score'), CSV_NULL_TOKEN);
  // 모델이 낸 문구도 수식 주입을 막는다(학생 원문과 같은 규칙).
  assert.equal(at(v12, 'feature_missing'), `"'=SUM(A1) | 블록의 크기"`);

  assert.equal(at(old, 'legacy_rubric'), 'true');
  assert.equal(at(old, 'v7_object_level'), '2.5');
  assert.equal(at(old, 'v7_total_score'), '56.25');
  // A밴드의 옛 맥락 축이 NA로 나오고 0으로 바뀌지 않는다.
  assert.equal(at(old, 'v7_context_level'), CSV_NULL_TOKEN);
  assert.equal(at(old, 'object_level'), CSV_NULL_TOKEN);
  assert.equal(at(old, 'app_level'), CSV_NULL_TOKEN);
});

test('호출 이력 CSV는 실패 호출의 수준을 1로 채우지 않고 실제 모델을 남긴다', () => {
  const csv = buildCallCsv([{ submission: BASE_SUBMISSION, run: SCORED_RUN }]);
  const { header, rows } = parseCsv(csv);
  assert.equal(rows.length, 2, '호출 2줄');
  const at = (row: string[], key: string) => row[header.indexOf(key)];
  const [failed, ok] = rows;
  assert.equal(at(failed, 'object_level'), CSV_NULL_TOKEN);
  assert.equal(at(failed, 'failure_reason'), '"schema_error: 형식 오류 영역: feature.level"');
  assert.equal(at(failed, 'purpose'), '"score"');
  assert.equal(at(failed, 'served_model'), '"gemini-served-001"');
  assert.equal(at(ok, 'object_level'), '3');
  assert.equal(at(ok, 'relation_level'), '"not_applicable"');
  assert.equal(at(ok, 'legacy_rubric'), 'false');
  assert.equal(at(ok, 'v7_object_level'), CSV_NULL_TOKEN);
});

test('옛 v7 작업의 호출 이력은 v7 열에만 수준이 있고 용도를 지어내지 않는다', () => {
  const csv = buildCallCsv([{ submission: BASE_SUBMISSION, run: LEGACY_RUN }]);
  const { header, rows } = parseCsv(csv);
  const at = (row: string[], key: string) => row[header.indexOf(key)];
  assert.equal(rows.length, 2);
  const [first, failed] = rows;
  assert.equal(at(first, 'legacy_rubric'), 'true');
  assert.equal(at(first, 'v7_object_level'), '2');
  assert.equal(at(first, 'v7_context_level'), CSV_NULL_TOKEN);
  assert.equal(at(first, 'object_level'), CSV_NULL_TOKEN);
  assert.equal(at(first, 'purpose'), CSV_NULL_TOKEN);
  assert.equal(at(first, 'served_model'), CSV_NULL_TOKEN);
  assert.equal(at(failed, 'v7_object_level'), CSV_NULL_TOKEN);
  assert.equal(at(failed, 'failure_reason'), '"schema_error"');
});

test('학생 원문에 든 수식 문자가 CSV에서 무력화된다', () => {
  const csv = buildSubmissionCsv([
    { submission: { ...BASE_SUBMISSION, text: '=cmd|calc' }, run: null },
  ]);
  assert.ok(csv.includes(`"'=cmd|calc"`));
  assert.equal(csv.includes(',"=cmd'), false);
});

/** 따옴표 안의 쉼표를 지키며 CSV 한 줄을 나눈다(시험용 간이 파서). */
function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQuote = false;
  for (let i = 0; i < line.length; i += 1) {
    const c = line[i];
    if (c === '"') {
      if (inQuote && line[i + 1] === '"') {
        cur += '""';
        i += 1;
      } else {
        inQuote = !inQuote;
        cur += c;
      }
    } else if (c === ',' && !inQuote) {
      out.push(cur);
      cur = '';
    } else {
      cur += c;
    }
  }
  out.push(cur);
  return out;
}

/* ────────────────────── 중복·완전성 ────────────────────── */

type Row = Parameters<typeof checkCompleteness>[0][number];

function fullRows(researchId: string): Row[] {
  const rows: Row[] = [];
  for (const phase of ['pre', 'post'] as const) {
    for (const questionId of ASSESSMENT_QUESTION_IDS) {
      rows.push({
        researchId,
        phase,
        questionId,
        submissionId: `${researchId}_${phase}_${questionId}`,
        responseStatus: 'submitted',
      });
    }
  }
  return rows;
}

test('6응답이 모두 있는 학생을 완전으로 센다', () => {
  const report = checkCompleteness([...fullRows('R-0001'), ...fullRows('R-0002')]);
  assert.equal(report.studentCount, 2);
  assert.equal(report.completeStudentCount, 2);
  assert.deepEqual(report.issues, []);
  assert.equal(RESPONSES_PER_STUDENT, 6);
});

test('같은 학생·시점·문항의 유효 제출 중복을 잡는다', () => {
  const rows = [
    ...fullRows('R-0001'),
    {
      researchId: 'R-0001',
      phase: 'pre' as const,
      questionId: 'T1',
      submissionId: 'dup_1',
      responseStatus: 'submitted',
    },
  ];
  const report = checkCompleteness(rows);
  const dup = report.issues.filter((i) => i.kind === 'duplicate');
  assert.equal(dup.length, 1);
  assert.equal(dup[0].questionId, 'T1');
  assert.equal(dup[0].submissionIds.length, 2);
});

test('거절 기록은 중복으로 세지 않는다', () => {
  const rows = [
    ...fullRows('R-0001'),
    {
      researchId: 'R-0001',
      phase: 'pre' as const,
      questionId: 'T1',
      submissionId: 'R-0001_pre_T1',
      responseStatus: 'rejected_duplicate',
    },
  ];
  const report = checkCompleteness(rows);
  assert.equal(report.issues.filter((i) => i.kind === 'duplicate').length, 0);
  assert.equal(report.completeStudentCount, 1);
});

test('불완전 6응답과 결측 사유를 구분해 보고한다', () => {
  const rows = fullRows('R-0001').filter((r) => !(r.phase === 'post' && r.questionId === 'T3'));
  rows.push({
    researchId: 'R-0001',
    phase: 'post',
    questionId: 'T2_v7',
    submissionId: 'miss_1',
    responseStatus: 'missing',
    missingReason: 'timeout_unsubmitted',
  });
  // 같은 칸의 정상 제출을 뺀다.
  const filtered = rows.filter(
    (r) => !(r.phase === 'post' && r.questionId === 'T2_v7' && r.responseStatus === 'submitted')
  );

  const report = checkCompleteness(filtered);
  assert.equal(report.completeStudentCount, 0);
  const student = report.students[0];
  assert.equal(student.submittedCount, 4);
  assert.equal(student.missingCount, 1);
  assert.equal(student.absentCount, 1);
  assert.ok(report.issues.some((i) => i.kind === 'absent' && i.questionId === 'T3'));
  assert.ok(
    report.issues.some((i) => i.kind === 'not_submitted' && i.detail.includes('timeout_unsubmitted'))
  );
});

test('기록이 하나도 없는 학생의 결손도 잡는다', () => {
  const report = checkCompleteness(fullRows('R-0001'), {
    expectedResearchIds: ['R-0001', 'R-0002'],
  });
  assert.equal(report.studentCount, 2);
  assert.equal(report.completeStudentCount, 1);
  assert.equal(report.issues.filter((i) => i.researchId === 'R-0002' && i.kind === 'absent').length, 6);
});

test('레지스트리에 없는 문항ID를 잡는다', () => {
  const rows = [
    ...fullRows('R-0001'),
    {
      researchId: 'R-0001',
      phase: 'pre' as const,
      // 단색 배경의 이전 T2는 검사 문항이 아니다.
      questionId: 'T2',
      submissionId: 'old_t2',
      responseStatus: 'submitted',
    },
  ];
  const report = checkCompleteness(rows);
  assert.equal(report.issues.filter((i) => i.kind === 'unknown_question').length, 1);
});

/* ────────────────────── 표집 ────────────────────── */

test('표집은 학생 단위이며 뽑힌 학생의 6응답이 그대로 남는다', () => {
  const ids = Array.from({ length: 60 }, (_, i) => `R-${String(i + 1).padStart(4, '0')}`);
  const sample = pickStudentLevelSample(ids, 36, 'seed-2026');

  assert.equal(sample.length, 36);
  assert.equal(new Set(sample).size, 36);
  // 같은 시드는 같은 표본을 낸다.
  assert.deepEqual(sample, pickStudentLevelSample(ids, 36, 'seed-2026'));
  assert.notDeepEqual(sample, pickStudentLevelSample(ids, 36, 'seed-다름'));

  const allRows = ids.flatMap((id) => fullRows(id));
  const kept = keepAllResponsesOfSampledStudents(allRows, sample);
  assert.equal(kept.length, 36 * RESPONSES_PER_STUDENT);
  for (const id of sample) {
    assert.equal(kept.filter((r) => r.researchId === id).length, RESPONSES_PER_STUDENT);
  }
});

test('시드 난수는 재현 가능하고 0 이상 1 미만이다', () => {
  const a = createSeededRandom('s');
  const b = createSeededRandom('s');
  for (let i = 0; i < 20; i += 1) {
    const v = a();
    assert.equal(v, b());
    assert.ok(v >= 0 && v < 1);
  }
});

/* ────────────────────── 생성 결과 대조 ────────────────────── */

test('생성 대조는 12명 × 6응답 = 72문장이며 문장마다 3개를 모두 남긴다', () => {
  assert.equal(GENERATION_SENTENCE_COUNT, 72);
  assert.equal(GENERATIONS_PER_SENTENCE, 3);

  const record: GenerationComparisonRecord = {
    schemaVersion: SCHEMA_VERSION,
    submissionId: 'sub_0001',
    questionId: 'T1',
    attempts: [1, 2, 3].map((attemptIndex) => ({
      attemptIndex,
      status: attemptIndex === 3 ? 'technical_failure' : 'generated',
      imageSha256: attemptIndex === 3 ? null : `hash${attemptIndex}`,
      failureReason: attemptIndex === 3 ? 'timeout' : null,
      modelId: 'fake-image-model',
      modelConfig: {},
      createdAt: '2026-03-02T02:00:00.000Z',
    })),
    complete: false,
  };

  assert.deepEqual(verifyGenerationRecord(record), { ok: true });
  // 실패를 재현 0인 정상 이미지로 만들지 않는다. 상태가 그대로 남는다.
  const summary = summarizeGenerationStatus([record]);
  assert.equal(summary.generated, 2);
  assert.equal(summary.technical_failure, 1);
  assert.equal(summary.attempts, 3);

  // 하나라도 빠지면 완료로 보고하지 않는다.
  assert.equal(verifyGenerationRecord({ ...record, attempts: record.attempts.slice(0, 2) }).ok, false);
});

test('생성 도구는 승인된 연구자 작업에서만 허용된다', () => {
  // 수업·검사 세션에서는 언제나 막는다.
  assert.throws(
    () =>
      requireGenerationAuthority({
        role: 'researcher',
        sessionType: 'research_assessment',
        grantedScopes: ['research:generate_comparison'],
      }),
    GenerationNotAuthorizedError
  );
  assert.throws(
    () =>
      requireGenerationAuthority({
        role: 'teacher',
        sessionType: 'experience',
        grantedScopes: ['research:generate_comparison'],
      }),
    GenerationNotAuthorizedError
  );
  // 범위가 승인되지 않으면 연구자여도 막힌다.
  assert.throws(
    () =>
      requireGenerationAuthority({ role: 'researcher', sessionType: 'experience', grantedScopes: [] }),
    GenerationNotAuthorizedError
  );
  assert.doesNotThrow(() =>
    requireGenerationAuthority({
      role: 'researcher',
      sessionType: 'experience',
      grantedScopes: ['research:generate_comparison'],
    })
  );
});
