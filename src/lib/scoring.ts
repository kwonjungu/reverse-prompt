/**
 * 채점 규칙 — 밴드, 배점, 수준·점수 환산
 *
 * 논문 대응:
 *   <표 Ⅲ-5> 밴드 전환의 확정 명세
 *   <표 Ⅲ-4> AI·교사 공통 5수준 루브릭과 환산 규칙
 *
 * 채점자(AI 또는 교사)는 축별 수준만 판정하고, 점수 환산은 이 모듈이 일괄 수행한다.
 * 서버 액션 파일과 분리해 두어 교사 화면 등에서도 그대로 재사용한다.
 */

export type Band = 'A' | 'B' | 'C';

/** 축별 수준(1~5). 맥락 축은 A밴드에서 적용하지 않으므로 null이 될 수 있다. */
export interface AxisLevels {
  objectLevel: number;
  specificityLevel: number;
  contextLevel: number | null;
}

/**
 * A: Lv.1~12  1·2차시  대상 50 / 구체성 50            (맥락 축 미적용)
 * B: Lv.13~24 3·4차시  대상 35 / 구체성 35 / 배경·행동 30
 * C: Lv.25~36 5·6차시  대상 35 / 구체성 35 / 맥락·분위기 30
 */
export const WEIGHTS: Record<Band, { object: number; specificity: number; context: number }> = {
  A: { object: 50, specificity: 50, context: 0 },
  B: { object: 35, specificity: 35, context: 30 },
  C: { object: 35, specificity: 35, context: 30 },
};

export function bandOf(level: number): Band {
  if (level <= 12) return 'A';
  if (level <= 24) return 'B';
  return 'C';
}

/**
 * 축 점수 = (수준 − 1) / 4 × 축 배점.
 * 중간 계산은 반올림하지 않는다. 보고할 때에만 소수 둘째 자리까지 표시한다.
 */
export function toScores(levels: AxisLevels, band: Band) {
  const w = WEIGHTS[band];
  const conv = (lv: number, weight: number) => ((lv - 1) / 4) * weight;
  const object = conv(levels.objectLevel, w.object);
  const specificity = conv(levels.specificityLevel, w.specificity);
  const context =
    band === 'A' || levels.contextLevel === null ? null : conv(levels.contextLevel, w.context);
  return { object, specificity, context, total: object + specificity + (context ?? 0) };
}

export const clampLevel = (n: unknown): number =>
  Math.max(1, Math.min(5, Math.round(typeof n === 'number' ? n : 1)));

const axisKeys = ['objectLevel', 'specificityLevel', 'contextLevel'] as const;

/** 두 호출의 적용 축 차이가 모두 1수준 이하인가 (<표 Ⅲ-7>) */
export function withinOneLevel(a: AxisLevels, b: AxisLevels): boolean {
  return axisKeys.every((k) => {
    const x = a[k];
    const y = b[k];
    if (x === null || y === null) return true;
    return Math.abs(x - y) <= 1;
  });
}

const mean = (xs: number[]) => xs.reduce((s, v) => s + v, 0) / xs.length;
const median = (xs: number[]) => {
  const s = [...xs].sort((p, q) => p - q);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};

/**
 * 호출들을 축별로 결합한다. 반수준을 유지하므로 반올림하지 않는다.
 * 두 호출이 1수준 이내이면 평균, 세 번째 호출을 추가하였으면 중앙값을 쓴다.
 */
export function combine(calls: AxisLevels[], useMedian: boolean): AxisLevels {
  const pick = (k: (typeof axisKeys)[number]) => {
    const vs = calls.map((c) => c[k]).filter((v): v is number => v !== null);
    if (!vs.length) return null;
    return useMedian ? median(vs) : mean(vs);
  };
  return {
    objectLevel: pick('objectLevel') ?? 1,
    specificityLevel: pick('specificityLevel') ?? 1,
    contextLevel: pick('contextLevel'),
  };
}
