/**
 * 연구 자료 CSV의 열 구성 — 제출 기록과 채점 작업을 이어 붙인다.
 *
 * 설계서 §7의 필수 필드를 빠짐없이 열로 낸다.
 *  - 결측은 NA로 두고 0이나 빈칸으로 바꾸지 않는다.
 *  - 기준 버전(schemaVersion·cueVersion·rubricVersion·codeCommit·promptHash)을 함께 낸다.
 *  - 주 자료(repeatIndex 1)와 신뢰도 반복(2·3)을 다른 파일로 낸다. 평균을 만들지 않는다.
 *
 * 채점 열은 공통 루브릭 v12-2(3영역 4수준)를 따른다.
 *  - 영역 수준은 정수 1~4 또는 'not_applicable'이다. 결측(채점 안 함·운영 결측)은 NA다.
 *  - 앱 종합 수준(app_level)은 해당 영역 수준 평균을 반올림한 1~4이고, 반올림 전 값(app_level_raw)도 낸다.
 *  - 100점 환산·축 배점 열은 새 채점에 없다.
 *
 * 저장소에 남은 옛 v7 채점 작업(축별 5수준·100점)도 그대로 읽는다. 옛 작업은 legacy_rubric=true이고
 * v7_* 열에만 값이 있으며, 영역 열은 NA다. 옛 수준을 영역 수준으로 옮기거나 지어내지 않는다.
 *
 * API 키·원시 인증토큰은 어떤 열에도 넣지 않는다.
 */

import type { ScoringRun, SubmissionRecord } from '@/lib/research/types';
import type { LegacyScoringRun } from '@/lib/legacy-v7/types';
import {
  AREA_IDS,
  overallLevelOf,
  overallLevelRaw,
  type AreaId,
  type AreaJudgment,
  type AreaLevelValue,
  type AreaLevels,
} from '@/lib/scoring';
import { isLegacyScoringRun, type StoredScoringRun } from '@/server/assessment/store';
import { toCsv, type CsvCell, type CsvColumn } from './csv';

/** 한 응답의 제출 기록과 그 응답에 대한 채점 작업 하나를 짝지은 것 */
export interface ExportRow {
  submission: SubmissionRecord;
  /** 이 행이 나타내는 채점 작업. 아직 채점하지 않았으면 null이다. 옛 v7 작업일 수 있다. */
  run: StoredScoringRun | null;
}

/** 목록 칸을 한 셀로 합칠 때의 구분자. 학생 글에 흔한 쉼표·줄바꿈과 겹치지 않게 고른다. */
export const LIST_SEPARATOR = ' | ';

/* ────────────────────────── 채점 작업 읽기 ────────────────────────── */

/** v12-2 작업이면 그대로, 옛 v7 작업이나 채점 전이면 null. */
function v12Run(run: StoredScoringRun | null): ScoringRun | null {
  return run && !isLegacyScoringRun(run) ? run : null;
}

/** 옛 v7 작업이면 그대로, 아니면 null. */
function legacyRun(run: StoredScoringRun | null): LegacyScoringRun | null {
  return run && isLegacyScoringRun(run) ? run : null;
}

/** 채점된 v12-2 작업의 영역 판정. 결측·옛 작업은 null이다(0이나 1수준으로 바꾸지 않는다). */
function scoredAreas(run: StoredScoringRun | null): Record<AreaId, AreaJudgment> | null {
  const r = v12Run(run);
  if (!r || r.result.status !== 'scored' || !r.result.areas) return null;
  return r.result.areas;
}

function areaLevels(run: StoredScoringRun | null): AreaLevels | null {
  const areas = scoredAreas(run);
  if (!areas) return null;
  return {
    object: areas.object.level,
    feature: areas.feature.level,
    relation: areas.relation.level,
  };
}

function areaLevelCell(run: StoredScoringRun | null, area: AreaId): AreaLevelValue | null {
  return scoredAreas(run)?.[area]?.level ?? null;
}

function areaEvidenceCell(run: StoredScoringRun | null, area: AreaId): string | null {
  return scoredAreas(run)?.[area]?.evidence ?? null;
}

/**
 * 빠진 정보 목록을 한 셀로 합친다. 채점되지 않았으면 NA(null)이고,
 * 채점되었는데 빠진 것이 없으면 빈 문자열이다(결측과 구분한다).
 */
function areaListCell(
  run: StoredScoringRun | null,
  area: AreaId,
  pick: (j: AreaJudgment) => readonly string[] | undefined
): string | null {
  const judgment = scoredAreas(run)?.[area];
  if (!judgment) return null;
  return (pick(judgment) ?? []).join(LIST_SEPARATOR);
}

/** 옛 v7 작업의 채점된 결과. 결측이면 null이다. */
function legacyScored(run: StoredScoringRun | null) {
  const r = legacyRun(run);
  if (!r || r.result.status !== 'scored') return null;
  return r.result;
}

/** 모델 결측 사유. 두 모양 모두 result.reason에 있다. */
function modelMissingReason(run: StoredScoringRun | null): string | null {
  if (!run || run.result.status !== 'missing') return null;
  return run.result.reason;
}

/** v12-2 작업에서 점수를 낸 호출 가운데 형식을 통과하지 못한 수. 피드백 호출은 세지 않는다. */
function failedScoreCallCount(run: StoredScoringRun): number {
  if (isLegacyScoringRun(run)) return run.calls.filter((c) => c.levels === null).length;
  return run.calls.filter((c) => c.purpose !== 'feedback' && c.levels === null).length;
}

/* ────────────────────────── 제출·채점 열 ────────────────────────── */

const areaColumns = (): CsvColumn<ExportRow>[] => [
  ...AREA_IDS.map((area) => ({ key: `${area}_level`, get: (r: ExportRow) => areaLevelCell(r.run, area) })),
  // 앱 종합 수준 = round_half_up(해당 영역 수준 평균). not_applicable은 평균에서 뺀다.
  { key: 'app_level', get: (r: ExportRow) => overallLevelOf(areaLevels(r.run)) },
  // 반올림 전 값. 소수를 반올림하지 않고 그대로 낸다.
  { key: 'app_level_raw', get: (r: ExportRow) => overallLevelRaw(areaLevels(r.run)) },
  ...AREA_IDS.map((area) => ({
    key: `${area}_evidence`,
    get: (r: ExportRow) => areaEvidenceCell(r.run, area),
  })),
  ...AREA_IDS.map((area) => ({
    key: `${area}_missing`,
    get: (r: ExportRow) => areaListCell(r.run, area, (j) => j.missing),
  })),
  ...AREA_IDS.map((area) => ({
    key: `${area}_evidence_missing`,
    get: (r: ExportRow) => areaListCell(r.run, area, (j) => j.evidenceMissing),
  })),
];

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
  // 수집 당시 레지스트리의 루브릭 버전. 실제 채점에 쓴 버전은 scored_rubric_version이다.
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
  // 채점 작업이 실제로 쓴 공통 문언의 버전(v12-2 또는 옛 v7).
  { key: 'scored_rubric_version', get: (r) => r.run?.rubricVersion ?? null },
  { key: 'scored_cue_version', get: (r) => r.run?.cueVersion ?? null },
  // 옛 v7 방식으로 채점된 작업인지. 채점 전이면 NA다. 옛 작업은 연구 추출에서 따로 다룬다.
  { key: 'legacy_rubric', get: (r) => (r.run ? isLegacyScoringRun(r.run) : null) },
  { key: 'model_id', get: (r) => r.run?.modelId ?? null },
  // 모델 API가 밝힌 실제 모델. 옛 작업과 결측 작업에는 없다(NA).
  { key: 'served_model', get: (r) => v12Run(r.run)?.servedModel ?? null },
  {
    key: 'model_config',
    get: (r) => (r.run ? JSON.stringify(r.run.modelConfig) : null),
  },
  { key: 'code_commit', get: (r) => r.run?.codeCommit ?? null },
  { key: 'prompt_hash', get: (r) => r.run?.promptHash ?? null },
  // 채점에 실제로 보낸 이미지의 해시. 제출 기록의 image_hash와 달라지면 자료가 섞인 것이다.
  { key: 'scored_image_hash', get: (r) => r.run?.imageHash ?? null },
  { key: 'scored_at', get: (r) => r.run?.scoredAt ?? null },
  // 영역 판정 여부의 근거('cue_pack' | 'model'). 옛 작업에는 없다.
  { key: 'applicability_source', get: (r) => v12Run(r.run)?.applicabilitySource ?? null },
  { key: 'focus_area', get: (r) => v12Run(r.run)?.focusArea ?? null },
  { key: 'result_status', get: (r) => r.run?.result.status ?? null },
  { key: 'model_missing_reason', get: (r) => modelMissingReason(r.run) },

  // ── 영역 판정(v12-2) ── 옛 작업·결측은 NA다. 해당 없음은 'not_applicable'로 낸다.
  ...areaColumns(),

  // ── 옛 v7 결과 ── 옛 작업에만 값이 있다. 반수준·소수를 반올림하지 않는다.
  { key: 'v7_object_level', get: (r) => legacyScored(r.run)?.levels.objectLevel ?? null },
  { key: 'v7_specificity_level', get: (r) => legacyScored(r.run)?.levels.specificityLevel ?? null },
  { key: 'v7_context_level', get: (r) => legacyScored(r.run)?.levels.contextLevel ?? null },
  { key: 'v7_total_score', get: (r) => legacyScored(r.run)?.score ?? null },

  // ── 호출 이력 요약 ──
  { key: 'extra_call', get: (r) => r.run?.extraCall ?? null },
  { key: 'call_count', get: (r) => r.run?.calls.length ?? null },
  { key: 'failed_call_count', get: (r) => (r.run ? failedScoreCallCount(r.run) : null) },
  {
    key: 'feedback_call_count',
    get: (r) => {
      const run = v12Run(r.run);
      return run ? run.calls.filter((c) => c.purpose === 'feedback').length : null;
    },
  },

  // ── 피드백 ── 검사 채점에서는 만들지 않으므로 not_requested가 정상이다.
  { key: 'feedback_status', get: (r) => r.run?.feedback?.status ?? null },
  { key: 'feedback_text', get: (r) => r.run?.feedback?.text ?? null },
  { key: 'feedback_quote', get: (r) => r.run?.feedback?.quote ?? null },
  { key: 'feedback_regenerated', get: (r) => r.run?.feedback?.regenerated ?? null },
  { key: 'feedback_strength_area', get: (r) => r.run?.feedback?.strengthArea ?? null },
  { key: 'feedback_next_area', get: (r) => r.run?.feedback?.nextArea ?? null },
  { key: 'feedback_next_target', get: (r) => r.run?.feedback?.nextTarget ?? null },
];

/* ────────────────────────── 호출 이력 ────────────────────────── */

/** 호출 하나를 한 행으로 낸다. 원문 프롬프트·개인정보는 담지 않는다. */
export interface CallExportRow {
  submissionId: string;
  operationId: string;
  repeatIndex: number;
  callId: string;
  retryIndex: number;
  /** 옛 v7 작업의 호출인지 */
  legacyRubric: boolean;
  /** 'score' | 'feedback'. 옛 호출에는 이 구분이 없어 null이다. */
  purpose: 'score' | 'feedback' | null;
  objectLevel: AreaLevelValue | null;
  featureLevel: AreaLevelValue | null;
  relationLevel: AreaLevelValue | null;
  v7ObjectLevel: number | null;
  v7SpecificityLevel: number | null;
  v7ContextLevel: number | null;
  servedModel: string | null;
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
  { key: 'legacy_rubric', get: (r) => r.legacyRubric },
  { key: 'purpose', get: (r) => r.purpose },
  { key: 'object_level', get: (r) => r.objectLevel },
  { key: 'feature_level', get: (r) => r.featureLevel },
  { key: 'relation_level', get: (r) => r.relationLevel },
  { key: 'v7_object_level', get: (r) => r.v7ObjectLevel },
  { key: 'v7_specificity_level', get: (r) => r.v7SpecificityLevel },
  { key: 'v7_context_level', get: (r) => r.v7ContextLevel },
  { key: 'served_model', get: (r) => r.servedModel },
  { key: 'failure_reason', get: (r) => r.failureReason },
  { key: 'started_at', get: (r) => r.startedAt },
  { key: 'finished_at', get: (r) => r.finishedAt },
  { key: 'duration_ms', get: (r) => r.durationMs },
];

export function toCallRows(rows: readonly ExportRow[]): CallExportRow[] {
  const out: CallExportRow[] = [];
  for (const row of rows) {
    const run = row.run;
    if (!run) continue;
    const base = {
      submissionId: row.submission.submissionId,
      operationId: run.operationId,
      repeatIndex: run.repeatIndex,
    };
    // 형식 검증에 실패한 호출과 피드백 호출은 수준이 없다. 1로 채우지 않는다.
    if (isLegacyScoringRun(run)) {
      for (const call of run.calls) {
        out.push({
          ...base,
          callId: call.callId,
          retryIndex: call.retryIndex,
          legacyRubric: true,
          purpose: null,
          objectLevel: null,
          featureLevel: null,
          relationLevel: null,
          v7ObjectLevel: call.levels?.objectLevel ?? null,
          v7SpecificityLevel: call.levels?.specificityLevel ?? null,
          v7ContextLevel: call.levels?.contextLevel ?? null,
          servedModel: null,
          failureReason: call.failureReason,
          startedAt: call.startedAt,
          finishedAt: call.finishedAt,
          durationMs: call.durationMs,
        });
      }
      continue;
    }
    for (const call of run.calls) {
      out.push({
        ...base,
        callId: call.callId,
        retryIndex: call.retryIndex,
        legacyRubric: false,
        purpose: call.purpose ?? null,
        objectLevel: call.levels?.object ?? null,
        featureLevel: call.levels?.feature ?? null,
        relationLevel: call.levels?.relation ?? null,
        v7ObjectLevel: null,
        v7SpecificityLevel: null,
        v7ContextLevel: null,
        servedModel: call.servedModel ?? null,
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
