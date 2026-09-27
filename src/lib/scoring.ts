/**
 * 채점 규칙 — 논문 공통 루브릭 v12-2(3영역 4수준). 밴드, 영역, 개별 호출 검증, 종합 수준.
 *
 * 영역 3개를 모든 밴드에서 같은 방식으로 판정한다.
 *   object   대상의 명확성
 *   feature  특징의 구체성
 *   relation 관계의 명확성
 * 각 영역은 정수 1~4 또는 'not_applicable'(과제가 그 영역을 요구하지 않을 때)이다.
 *
 * 100점 환산·밴드별 배점·반수준 결합은 쓰지 않는다(옛 v7 규칙은 src/lib/legacy-v7/, 게임·타임어택 전용).
 * 형식 오류를 유효한 값으로 바꾸지 않는다. 범위 밖·소수·숫자 문자열·임의 null은 형식 오류다.
 */

import { quoteAppearsInText } from '@/lib/quote';

/* ────────────────────────── 밴드 ────────────────────────── */

export type Band = 'A' | 'B' | 'C';

/** 밴드는 문항 번호로 정한다. A=L01–12, B=L13–24, C=L25–36(연구 표집의 A·B·C와 같다). */
export function bandOf(level: number): Band {
  if (level <= 12) return 'A';
  if (level <= 24) return 'B';
  return 'C';
}

/* ────────────────────────── 영역과 수준 ────────────────────────── */

export const AREA_IDS = ['object', 'feature', 'relation'] as const;
export type AreaId = (typeof AREA_IDS)[number];

/** 학생 화면·피드백 표시에 쓰는 짧은 이름 */
export const AREA_LABEL: Record<AreaId, string> = {
  object: '대상',
  feature: '특징',
  relation: '관계',
};

export const NOT_APPLICABLE = 'not_applicable' as const;
export type AreaLevel = 1 | 2 | 3 | 4;
export type AreaLevelValue = AreaLevel | typeof NOT_APPLICABLE;

export function isAreaId(v: unknown): v is AreaId {
  return typeof v === 'string' && (AREA_IDS as readonly string[]).includes(v);
}

/** 한 영역의 판정. 저장 문서의 scoring.result.areas.{영역} 형이다. */
export interface AreaJudgment {
  level: AreaLevelValue;
  /** 학생 글에서 근거가 된 부분(원문 그대로). 없으면 null. */
  evidence: string | null;
  /** 빠진 필수 정보 */
  missing: string[];
  /** 핵심 대상이 빠져 확인할 수 없는 그 대상의 속성·관계. 새 오류로 세지 않는다. */
  evidenceMissing: string[];
}

export type AreaJudgments = Record<AreaId, AreaJudgment>;
export type AreaLevels = Record<AreaId, AreaLevelValue>;

/**
 * 영역을 판정하는가. true=판정, false=not_applicable, null=모델이 정한다(단서 팩이 없을 때).
 * 대상 영역은 늘 판정한다.
 */
export type AreaApplicability = Record<AreaId, boolean | null>;

export function levelsOf(areas: AreaJudgments): AreaLevels {
  return {
    object: areas.object.level,
    feature: areas.feature.level,
    relation: areas.relation.level,
  };
}

/** 정수 1~4 또는 정확히 'not_applicable'만 통과한다. 그 밖은 null(형식 오류). */
export function parseAreaLevel(value: unknown): AreaLevelValue | null {
  if (value === NOT_APPLICABLE) return NOT_APPLICABLE;
  if (typeof value !== 'number') return null;
  if (!Number.isFinite(value) || !Number.isInteger(value)) return null;
  if (value < 1 || value > 4) return null;
  return value as AreaLevel;
}

/* ────────────────────────── 개별 호출 검증 ────────────────────────── */

export interface AreaSchemaError {
  error: 'schema_error';
  /** 어떤 영역이 왜 형식 오류인지. 학생 원문은 담지 않는다. */
  detail: string;
}

export function isAreaSchemaError(v: AreaJudgments | AreaSchemaError): v is AreaSchemaError {
  return (v as AreaSchemaError).error === 'schema_error';
}

function stringList(v: unknown): string[] | null {
  if (v === undefined) return [];
  if (!Array.isArray(v)) return null;
  const out: string[] = [];
  for (const item of v) {
    if (typeof item !== 'string') return null;
    const t = item.trim();
    if (t) out.push(t);
  }
  return out;
}

/**
 * 모델 1회 출력의 영역 판정을 검증한다.
 *   - level: 정수 1~4 또는 'not_applicable'. 대상 영역은 not_applicable일 수 없다.
 *   - 단서 팩이 정한 영역 판정 여부(applicability)와 어긋나면 형식 오류다.
 *   - evidence: 학생 글에 그대로 있는 표현이거나 null. 원문에 없으면 형식 오류다.
 *   - not_applicable 영역은 evidence가 null이고 missing이 비어 있어야 한다.
 *   - missing·evidence_missing: 문자열 배열.
 */
export function validateAreaCall(
  raw: unknown,
  context: { studentText: string; applicability: AreaApplicability }
): AreaJudgments | AreaSchemaError {
  if (raw === null || typeof raw !== 'object') {
    return { error: 'schema_error', detail: '출력이 객체가 아님' };
  }
  const r = raw as Record<string, unknown>;
  const bad: string[] = [];
  const out: Partial<AreaJudgments> = {};

  for (const area of AREA_IDS) {
    const a = r[area];
    if (a === null || typeof a !== 'object') {
      bad.push(`${area}(없음)`);
      continue;
    }
    const block = a as Record<string, unknown>;
    const level = parseAreaLevel(block.level);
    if (level === null) {
      bad.push(`${area}.level`);
      continue;
    }
    const expected = area === 'object' ? true : context.applicability[area];
    if (level === NOT_APPLICABLE && expected === true) {
      bad.push(`${area}.level(판정해야 하는 영역)`);
      continue;
    }
    if (level !== NOT_APPLICABLE && expected === false) {
      bad.push(`${area}.level(해당 없음이어야 하는 영역)`);
      continue;
    }

    let evidence: string | null = null;
    if (block.evidence !== null && block.evidence !== undefined) {
      if (typeof block.evidence !== 'string') {
        bad.push(`${area}.evidence`);
        continue;
      }
      const e = block.evidence.trim();
      if (e) {
        if (!quoteAppearsInText(context.studentText, e)) {
          bad.push(`${area}.evidence(원문에 없음)`);
          continue;
        }
        evidence = e;
      }
    }

    const missing = stringList(block.missing);
    const evidenceMissing = stringList(block.evidence_missing);
    if (missing === null || block.missing === undefined) {
      bad.push(`${area}.missing`);
      continue;
    }
    if (evidenceMissing === null) {
      bad.push(`${area}.evidence_missing`);
      continue;
    }
    if (level === NOT_APPLICABLE && (evidence !== null || missing.length || evidenceMissing.length)) {
      bad.push(`${area}(해당 없음인데 근거·누락이 있음)`);
      continue;
    }
    out[area] = { level, evidence, missing, evidenceMissing };
  }

  if (bad.length) return { error: 'schema_error', detail: `형식 오류 영역: ${bad.join(', ')}` };
  return out as AreaJudgments;
}

/* ────────────────────────── 종합 수준 ────────────────────────── */

/**
 * 앱 종합 수준 = 해당 영역 수준의 평균(not_applicable 제외)을 반올림(0.5는 올림)한 1~4.
 * 연구 표집의 층을 나누는 값이다. 학생 화면에는 보이지 않는다.
 */
export const APP_LEVEL_RULE =
  '앱 종합 수준 = round_half_up(해당 영역 수준의 평균). not_applicable 영역은 평균에서 뺀다. 결과는 1~4.';

export function overallLevelRaw(levels: AreaLevels | null | undefined): number | null {
  if (!levels) return null;
  const vs = AREA_IDS.map((a) => levels[a]).filter((v): v is AreaLevel => typeof v === 'number');
  if (!vs.length) return null;
  return vs.reduce((s, v) => s + v, 0) / vs.length;
}

export function overallLevelOf(levels: AreaLevels | null | undefined): AreaLevel | null {
  const raw = overallLevelRaw(levels);
  if (raw === null) return null;
  // 부동소수 오차로 2.4999…가 2가 되지 않게 아주 작은 값을 더한다.
  return Math.min(4, Math.max(1, Math.floor(raw + 0.5 + 1e-9))) as AreaLevel;
}

/* ────────────────────────── 다음 행동의 영역 ────────────────────────── */

/**
 * 피드백 3문장(다음 행동)이 다룰 영역.
 * 해당 영역 가운데 수준이 가장 낮은 영역. 같으면 단계 초점 영역, 그다음 대상 → 특징 → 관계 순.
 * 모든 해당 영역이 4수준이면 null(고칠 것이 없다).
 */
export function nextActionArea(levels: AreaLevels, focus: AreaId | null): AreaId | null {
  const candidates = AREA_IDS.filter((a) => {
    const v = levels[a];
    return typeof v === 'number' && v < 4;
  });
  if (!candidates.length) return null;
  const min = Math.min(...candidates.map((a) => levels[a] as number));
  const lowest = candidates.filter((a) => levels[a] === min);
  if (focus && lowest.includes(focus)) return focus;
  return lowest[0];
}
