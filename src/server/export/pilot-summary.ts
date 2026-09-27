/**
 * 실제 모델 예비 점검(논문 v12-2 Ⅲ.4.나 '예비 점검') — 결과 정리 규칙(순수).
 *
 * 연구자가 구성한 문장(대표 사진 3장 × 문항당 8개 = 24개)을 운영 채점기와 같은 설정으로 채점한 결과를
 * CSV 한 줄씩과 요약(결측률·fallback률·탈락 사유 수)으로 정리한다. 모델 호출과 파일 쓰기는
 * scripts/pilot-score.mjs가 한다. 결과는 로컬 파일로만 남고 연구 저장소에 쓰지 않는다.
 */

import { AREA_IDS, type AreaId } from '@/lib/scoring';
import type { ScoringRun } from '@/lib/research/types';
import { toCsv, type CsvColumn } from './csv';

/** 입력 한 줄: 문항 ID와 연구자가 구성한 문장 */
export interface PilotItem {
  id: string;
  questionId: string;
  text: string;
}

/**
 * 입력 JSON을 읽는다. 배열이거나 { items: [...] }. 각 항목은 questionId와 text(또는 sentence)가 있어야 한다.
 * id가 없으면 순번으로 매긴다. 문제가 있으면 던진다(일부만 채점하지 않는다).
 */
export function parsePilotInput(raw: unknown): PilotItem[] {
  const list = Array.isArray(raw)
    ? raw
    : raw && typeof raw === 'object' && Array.isArray((raw as { items?: unknown }).items)
      ? (raw as { items: unknown[] }).items
      : null;
  if (!list || !list.length) throw new Error('입력은 문항 ID와 문장의 배열이어야 합니다.');
  return list.map((v, i) => {
    const o = (v ?? {}) as Record<string, unknown>;
    const questionId = typeof o.questionId === 'string' ? o.questionId.trim().toUpperCase() : '';
    const text = typeof o.text === 'string' ? o.text : typeof o.sentence === 'string' ? o.sentence : '';
    if (!/^L(0[1-9]|[12]\d|3[0-6])$/.test(questionId)) throw new Error(`${i + 1}번째 항목의 문항 ID가 L01~L36이 아닙니다.`);
    if (!text.trim()) throw new Error(`${i + 1}번째 항목의 문장이 비어 있습니다.`);
    const id = typeof o.id === 'string' && o.id.trim() ? o.id.trim() : `P${String(i + 1).padStart(3, '0')}`;
    return { id, questionId, text };
  });
}

export interface PilotRow {
  item: PilotItem;
  run: ScoringRun;
}

/** 피드백 상태를 예비 점검 보고용으로 줄인다: 통과(ok, 다시 만들어 통과한 것 포함) / 고정 안내(fallback) / 없음 */
export function feedbackOutcome(run: ScoringRun): 'ok' | 'fallback' | 'none' {
  const status = run.feedback?.status ?? null;
  if (status === 'verified') return 'ok';
  if (status === 'fallback') return 'fallback';
  return 'none';
}

const areaCell = (run: ScoringRun, area: AreaId) =>
  run.result.status === 'scored' && run.result.areas ? run.result.areas[area] : null;

export const PILOT_COLUMNS: CsvColumn<PilotRow>[] = [
  { key: 'item_id', get: (r) => r.item.id },
  { key: 'question_id', get: (r) => r.item.questionId },
  { key: 'band', get: (r) => r.run.band },
  { key: 'text', get: (r) => r.item.text },
  { key: 'result_status', get: (r) => r.run.result.status },
  { key: 'missing_reason', get: (r) => (r.run.result.status === 'missing' ? r.run.result.reason : null) },
  ...AREA_IDS.flatMap((area) => [
    { key: `${area}_level`, get: (r: PilotRow) => areaCell(r.run, area)?.level ?? null },
    { key: `${area}_evidence`, get: (r: PilotRow) => areaCell(r.run, area)?.evidence ?? null },
  ]),
  { key: 'feedback_outcome', get: (r) => feedbackOutcome(r.run) },
  { key: 'feedback_status', get: (r) => r.run.feedback?.status ?? null },
  { key: 'feedback_rejections', get: (r) => (r.run.feedback?.rejections ?? []).join(' | ') || null },
  { key: 'feedback_text', get: (r) => r.run.feedback?.text ?? null },
  { key: 'call_count', get: (r) => r.run.calls.length },
  { key: 'failure_reasons', get: (r) => r.run.calls.map((c) => c.failureReason).filter(Boolean).join(' | ') || null },
  { key: 'model_id', get: (r) => r.run.modelId },
  { key: 'served_model', get: (r) => r.run.servedModel },
  { key: 'rubric_version', get: (r) => r.run.rubricVersion },
  { key: 'cue_version', get: (r) => r.run.cueVersion },
  { key: 'applicability_source', get: (r) => r.run.applicabilitySource },
  { key: 'prompt_hash', get: (r) => r.run.promptHash },
];

export const buildPilotCsv = (rows: readonly PilotRow[]) => toCsv(rows, PILOT_COLUMNS);

export interface PilotSummary {
  total: number;
  scored: number;
  missing: number;
  /** 결측률 = 결측 / 전체. 전체가 0이면 null */
  missingRate: number | null;
  /** 결측 사유별 수 */
  missingReasons: Record<string, number>;
  /** 피드백을 만든 사례(채점된 사례) 가운데 고정 안내로 끝난 비율 */
  fallback: number;
  fallbackRate: number | null;
  /** 피드백 검증에서 탈락한 사유별 수(재생성 전·후 모두) */
  rejectionReasons: Record<string, number>;
  /** 형식 오류·호출 실패로 다시 부른 사례 수 */
  retried: number;
}

export function summarizePilot(rows: readonly PilotRow[]): PilotSummary {
  const missingReasons: Record<string, number> = {};
  const rejectionReasons: Record<string, number> = {};
  let scored = 0;
  let fallback = 0;
  let withFeedback = 0;
  let retried = 0;
  for (const { run } of rows) {
    if (run.result.status === 'scored') scored += 1;
    else missingReasons[run.result.reason] = (missingReasons[run.result.reason] ?? 0) + 1;
    const outcome = feedbackOutcome(run);
    if (outcome !== 'none') withFeedback += 1;
    if (outcome === 'fallback') fallback += 1;
    for (const r of run.feedback?.rejections ?? []) rejectionReasons[r] = (rejectionReasons[r] ?? 0) + 1;
    if (run.calls.some((c) => c.purpose !== 'feedback' && c.retryIndex > 0)) retried += 1;
  }
  const total = rows.length;
  return {
    total,
    scored,
    missing: total - scored,
    missingRate: total ? (total - scored) / total : null,
    missingReasons,
    fallback,
    fallbackRate: withFeedback ? fallback / withFeedback : null,
    rejectionReasons,
    retried,
  };
}
