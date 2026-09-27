/**
 * 추출 사례의 반복 채점(논문 v12-2 Ⅲ.4.나 반복 안정성) — 순수 규칙.
 *
 * 추출한 사례(최종 시도)를 운영 채점기와 같은 설정으로 두 번 더 채점해 repeatIndex 2·3으로 따로 저장한다.
 * 1회차는 제출 문서에 저장된 운영 채점(주 자료)이며 건드리지 않는다.
 * 여기에는 저장 문서의 모양, 세 번 모두 같은 수준인 비율(영역별), CSV 열만 둔다. 배선은
 * src/server/admin/research-actions.ts가 한다.
 *
 * 비율 규칙
 *   - 영역마다, 세 번 모두 1~4 수준으로 채점된 사례만 분모에 넣는다(완전 사례).
 *   - 세 번 모두 해당 없음이면 수준 판정이 아니므로(단서 팩이 정함) 분모에서 빼고 따로 센다.
 *   - 한 번이라도 결측이거나 해당 없음과 수준이 섞이면 분모에서 빼고 따로 센다(결측을 1수준으로 채우지 않는다).
 *   - 비율은 반올림하지 않는다. 완전 사례가 없으면 null(NA).
 */

import { AREA_IDS, NOT_APPLICABLE, type AreaId, type AreaLevels, type AreaLevelValue } from '@/lib/scoring';
import type { ScoringRun } from '@/lib/research/types';
import { toCsv, type CsvColumn } from './csv';

export const REPEAT_SCORE_SCHEMA_VERSION = 'v12.2-sample-repeat-1';

/** 반복 채점 회차. 1회차는 주 자료(제출 문서)다. */
export const REPEAT_INDEXES = [2, 3] as const;
export type RepeatIndex = (typeof REPEAT_INDEXES)[number];

export function isRepeatIndex(v: unknown): v is RepeatIndex {
  return v === 2 || v === 3;
}

/**
 * research/v7.0/sample_repeat_scores/{sampleId}__{caseId}__r{n} 문서.
 *   status  scored  채점함(run.result가 scored 또는 missing — 결측도 채점 시도의 결과로 남긴다)
 *           skipped_consent  동의가 지금 유효하지 않아 부르지 않음(철회 뒤 추가 채점 금지)
 *           skipped_missing_submission  최종 제출 문서를 찾지 못함
 */
export interface RepeatScoreDoc {
  schemaVersion: string;
  sampleId: string;
  caseId: string;
  questionId: string;
  finalSubmissionId: string;
  repeatIndex: RepeatIndex;
  status: 'scored' | 'skipped_consent' | 'skipped_missing_submission';
  /** 운영 채점기가 돌려준 채점 작업 그대로(영역 판정·호출 이력·modelId·servedModel·promptHash·imageHash). */
  run: ScoringRun | null;
  scoredAt: string;
}

export function repeatDocId(sampleId: string, caseId: string, repeatIndex: RepeatIndex): string {
  return `${sampleId}__${caseId}__r${repeatIndex}`;
}

/** 채점 작업에서 영역 수준을 읽는다. 결측이면 null. */
export function levelsOfRun(run: ScoringRun | null | undefined): AreaLevels | null {
  if (!run || run.result.status !== 'scored' || !run.result.areas) return null;
  const a = run.result.areas;
  return { object: a.object.level, feature: a.feature.level, relation: a.relation.level };
}

/** 사례 하나의 세 회차 수준 */
export interface RepeatCaseRow {
  caseId: string;
  questionId: string;
  finalSubmissionId: string;
  /** 1회차(주 자료), 2회차, 3회차. 결측·미채점이면 null */
  levels: [AreaLevels | null, AreaLevels | null, AreaLevels | null];
}

export interface AreaAgreement {
  area: AreaId;
  /** 사례 수 */
  cases: number;
  /** 세 번 모두 1~4 수준으로 채점된 사례 */
  complete: number;
  /** 그 가운데 세 번 모두 같은 수준 */
  allSame: number;
  /** allSame / complete. 완전 사례가 없으면 null */
  rate: number | null;
  /** 세 번 모두 해당 없음(분모에서 뺌) */
  notApplicable: number;
  /** 결측이 있거나 해당 없음과 수준이 섞임(분모에서 뺌) */
  incomplete: number;
}

const isLevel = (v: AreaLevelValue | undefined): v is 1 | 2 | 3 | 4 =>
  v === 1 || v === 2 || v === 3 || v === 4;

export function agreementByArea(rows: readonly RepeatCaseRow[]): AreaAgreement[] {
  return AREA_IDS.map((area) => {
    let complete = 0;
    let allSame = 0;
    let notApplicable = 0;
    let incomplete = 0;
    for (const row of rows) {
      const vals = row.levels.map((l) => (l ? l[area] : undefined));
      if (vals.every((v) => v === NOT_APPLICABLE)) {
        notApplicable += 1;
      } else if (vals.every(isLevel)) {
        complete += 1;
        if (vals[0] === vals[1] && vals[1] === vals[2]) allSame += 1;
      } else {
        incomplete += 1;
      }
    }
    return { area, cases: rows.length, complete, allSame, rate: complete ? allSame / complete : null, notApplicable, incomplete };
  });
}

const levelCell = (v: AreaLevelValue | null | undefined) => v ?? null;

export const REPEAT_CASE_COLUMNS: CsvColumn<RepeatCaseRow>[] = [
  { key: 'case_id', get: (r) => r.caseId },
  { key: 'question_id', get: (r) => r.questionId },
  { key: 'final_submission_id', get: (r) => r.finalSubmissionId },
  ...AREA_IDS.flatMap((area) =>
    ([0, 1, 2] as const).map((i) => ({
      key: `r${i + 1}_${area}_level`,
      get: (r: RepeatCaseRow) => levelCell(r.levels[i]?.[area]),
    }))
  ),
];

export const AGREEMENT_COLUMNS: CsvColumn<AreaAgreement>[] = [
  { key: 'area', get: (r) => r.area },
  { key: 'cases', get: (r) => r.cases },
  { key: 'complete_cases', get: (r) => r.complete },
  { key: 'all_three_same', get: (r) => r.allSame },
  { key: 'agreement_rate', get: (r) => r.rate },
  { key: 'all_not_applicable', get: (r) => r.notApplicable },
  { key: 'incomplete_cases', get: (r) => r.incomplete },
];

export const buildRepeatCaseCsv = (rows: readonly RepeatCaseRow[]) => toCsv(rows, REPEAT_CASE_COLUMNS);
export const buildAgreementCsv = (rows: readonly RepeatCaseRow[]) => toCsv(agreementByArea(rows), AGREEMENT_COLUMNS);
