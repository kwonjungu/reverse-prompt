/**
 * 연구 자료 CSV의 열 구성 — 제출 기록과 채점 작업을 이어 붙인다.
 *
 * 설계서 §7의 필수 필드를 빠짐없이 열로 낸다.
 *  - 결측은 NA로 두고 0이나 빈칸으로 바꾸지 않는다.
 *  - 결합 수준의 반수준(2.5)과 축 점수의 소수를 반올림하지 않는다.
 *  - 기준 버전(schemaVersion·cueVersion·rubricVersion·codeCommit·promptHash)을 함께 낸다.
 *  - 주 자료(repeatIndex 1)와 신뢰도 반복(2·3)을 다른 파일로 낸다. 평균을 만들지 않는다.
 *
 * API 키·원시 인증토큰은 어떤 열에도 넣지 않는다.
 */

import type { ScoringRun, SubmissionRecord } from '@/lib/research/types';
import { toCsv, type CsvCell, type CsvColumn } from './csv';

/** 한 응답의 제출 기록과 그 응답에 대한 채점 작업 하나를 짝지은 것 */
export interface ExportRow {
  submission: SubmissionRecord;
  /** 이 행이 나타내는 채점 작업. 아직 채점하지 않았으면 null이다. */
  run: ScoringRun | null;
}

/** 채점 결과에서 값을 꺼낸다. 결측이면 null을 돌려주고 0으로 바꾸지 않는다. */
function scored<T>(run: ScoringRun | null, pick: (r: ScoringRun & { result: { status: 'scored' } }) => T): T | null {
  if (!run || run.result.status !== 'scored') return null;
  return pick(run as ScoringRun & { result: { status: 'scored' } });
}

export const SUBMISSION_COLUMNS: CsvColumn<ExportRow>[] = [
  // ── 제출 기록 ──
  { key: 'schema_version', get: (r) => r.submission.schemaVersion },
  { key: 'submission_id', get: (r) => r.submission.submissionId },
  { key: 'research_id', get: (r) => r.submission.researchId },
  { key: 'class_research_id', get: (r) => r.submission.classResearchId },
  { key: 'session_type', get: (r) => r.submission.sessionType },
  { key: 'phase', get: (r) => r.submission.phase },
  // 검사는 차시 활동이 아니므로 lesson이 null이다. 0으로 채우지 않는다.
  { key: 'lesson', get: (r) => r.submission.lesson },
  { key: 'question_id', get: (r) => r.submission.questionId },
  { key: 'band', get: (r) => r.submission.band },
  { key: 'image_hash', get: (r) => r.submission.imageHash },
  { key: 'cue_version', get: (r) => r.submission.cueVersion },
  { key: 'rubric_version', get: (r) => r.submission.rubricVersion },
  { key: 'text', get: (r) => r.submission.text },
  { key: 'started_at', get: (r) => r.submission.startedAt },
  { key: 'submitted_at', get: (r) => r.submission.submittedAt },
  { key: 'duration_ms', get: (r) => r.submission.durationMs },
  { key: 'attempt_no', get: (r) => r.submission.attemptNo },
  { key: 'consent_version', get: (r) => r.submission.consentVersion },
  { key: 'response_status', get: (r) => r.submission.responseStatus },
  { key: 'missing_reason', get: (r) => r.submission.missingReason },
  { key: 'persist_status', get: (r) => r.submission.persistStatus },

  // ── 채점 작업 ──
  { key: 'operation_id', get: (r) => r.run?.operationId ?? null },
  { key: 'repeat_index', get: (r) => r.run?.repeatIndex ?? null },
  { key: 'model_id', get: (r) => r.run?.modelId ?? null },
  {
    key: 'model_config',
    get: (r) => (r.run ? JSON.stringify(r.run.modelConfig) : null),
  },
  { key: 'code_commit', get: (r) => r.run?.codeCommit ?? null },
  { key: 'prompt_hash', get: (r) => r.run?.promptHash ?? null },
  // 채점에 실제로 보낸 이미지의 해시. 제출 기록의 image_hash와 달라지면 자료가 섞인 것이다.
  { key: 'scored_image_hash', get: (r) => r.run?.imageHash ?? null },
  { key: 'scored_at', get: (r) => r.run?.scoredAt ?? null },
  { key: 'result_status', get: (r) => r.run?.result.status ?? null },
  {
    key: 'model_missing_reason',
    get: (r) => (r.run && r.run.result.status === 'missing' ? r.run.result.reason : null),
  },

  // ── 수준과 점수 ── 반올림하지 않는다. A밴드의 맥락 축은 NA이며 0이 아니다.
  { key: 'object_level', get: (r) => scored(r.run, (x) => x.result.levels.objectLevel) },
  { key: 'specificity_level', get: (r) => scored(r.run, (x) => x.result.levels.specificityLevel) },
  { key: 'context_level', get: (r) => scored(r.run, (x) => x.result.levels.contextLevel) },
  { key: 'object_score', get: (r) => scored(r.run, (x) => x.result.axisScores.object) },
  { key: 'specificity_score', get: (r) => scored(r.run, (x) => x.result.axisScores.specificity) },
  { key: 'context_score', get: (r) => scored(r.run, (x) => x.result.axisScores.context) },
  { key: 'total_score', get: (r) => scored(r.run, (x) => x.result.score) },

  // ── 호출 이력 요약 ──
  { key: 'extra_call', get: (r) => r.run?.extraCall ?? null },
  { key: 'call_count', get: (r) => r.run?.calls.length ?? null },
  {
    key: 'failed_call_count',
    get: (r) => (r.run ? r.run.calls.filter((c) => c.levels === null).length : null),
  },

  // ── 피드백 ── 검사 채점에서는 만들지 않으므로 not_requested가 정상이다.
  { key: 'feedback_status', get: (r) => r.run?.feedback?.status ?? null },
  { key: 'feedback_text', get: (r) => r.run?.feedback?.text ?? null },
  { key: 'feedback_quote', get: (r) => r.run?.feedback?.quote ?? null },
  { key: 'feedback_regenerated', get: (r) => r.run?.feedback?.regenerated ?? null },
];

/** 호출 하나를 한 행으로 낸다. 원문 프롬프트·개인정보는 담지 않는다. */
export interface CallExportRow {
  submissionId: string;
  operationId: string;
  repeatIndex: number;
  callId: string;
  retryIndex: number;
  objectLevel: number | null;
  specificityLevel: number | null;
  contextLevel: number | null;
  failureReason: string | null;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
}

export const CALL_COLUMNS: CsvColumn<CallExportRow>[] = [
  { key: 'submission_id', get: (r) => r.submissionId },
  { key: 'operation_id', get: (r) => r.operationId },
  { key: 'repeat_index', get: (r) => r.repeatIndex },
  { key: 'call_id', get: (r) => r.callId },
  { key: 'retry_index', get: (r) => r.retryIndex },
  { key: 'object_level', get: (r) => r.objectLevel },
  { key: 'specificity_level', get: (r) => r.specificityLevel },
  { key: 'context_level', get: (r) => r.contextLevel },
  { key: 'failure_reason', get: (r) => r.failureReason },
  { key: 'started_at', get: (r) => r.startedAt },
  { key: 'finished_at', get: (r) => r.finishedAt },
  { key: 'duration_ms', get: (r) => r.durationMs },
];

export function toCallRows(rows: readonly ExportRow[]): CallExportRow[] {
  const out: CallExportRow[] = [];
  for (const row of rows) {
    if (!row.run) continue;
    for (const call of row.run.calls) {
      out.push({
        submissionId: row.submission.submissionId,
        operationId: row.run.operationId,
        repeatIndex: row.run.repeatIndex,
        callId: call.callId,
        retryIndex: call.retryIndex,
        // 형식 검증에 실패한 호출은 수준이 없다. 1로 채우지 않는다.
        objectLevel: call.levels?.objectLevel ?? null,
        specificityLevel: call.levels?.specificityLevel ?? null,
        contextLevel: call.levels?.contextLevel ?? null,
        failureReason: call.failureReason,
        startedAt: call.startedAt,
        finishedAt: call.finishedAt,
        durationMs: call.durationMs,
      });
    }
  }
  return out;
}

/** 응답·채점 CSV 본문 */
export function buildSubmissionCsv(rows: readonly ExportRow[]): string {
  return toCsv(rows, SUBMISSION_COLUMNS);
}

/** 호출 이력 CSV 본문 */
export function buildCallCsv(rows: readonly ExportRow[]): string {
  return toCsv(toCallRows(rows), CALL_COLUMNS);
}

/**
 * 내보내기 열 목록을 문서로 낼 때 쓴다. 열 이름이 바뀌면 분석 스크립트가 깨지므로
 * manifest에 함께 남긴다.
 */
export function submissionColumnKeys(): string[] {
  return SUBMISSION_COLUMNS.map((c) => c.key);
}

/** 열 하나의 값을 직접 꺼낼 때 쓴다(점검 도구용). */
export function cellOf(row: ExportRow, key: string): CsvCell {
  const col = SUBMISSION_COLUMNS.find((c) => c.key === key);
  return col ? col.get(row) : null;
}
