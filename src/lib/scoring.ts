/**
 * 채점 규칙 — 밴드, 배점, 수준·점수 환산, 개별 호출 검증
 *
 * 논문 대응:
 *   <표 Ⅲ-5> 밴드 전환의 확정 명세
 *   <표 Ⅲ-4> AI·교사 공통 5수준 루브릭과 환산 규칙
 *   <표 Ⅲ-7> 운영 채점 1회의 결합 규칙
 *
 * 채점자(AI 또는 교사)는 축별 수준만 판정하고, 점수 환산은 이 모듈이 일괄 수행한다.
 * 서버 액션 파일과 분리해 두어 교사 화면 등에서도 그대로 재사용한다.
 *
 * 모델 호출 1회의 출력 스키마와 운영 결합 출력의 스키마를 분리한다.
 *   개별 호출: 적용 축은 정수 1~5. A밴드 contextLevel은 반드시 null, B·C밴드는 반드시 정수.
 *   결합 결과: 반수준(0.5)을 허용한다.
 * 범위 밖·소수·숫자 문자열·NaN·Infinity·임의 null은 형식 오류이며 최저 수행으로 바꾸지 않는다.
 */

export type Band = 'A' | 'B' | 'C';

/** 축별 수준. 맥락 축은 A밴드에서 적용하지 않으므로 null이 될 수 있다. */
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

/**
 * 개별 호출의 축 수준을 검증한다. 정수 1~5만 통과한다.
 * 숫자 문자열('4'), NaN, Infinity, 소수(2.5), 범위 밖(0·6)은 모두 null(형식 오류)이다.
 * clamp·반올림으로 오류를 유효한 값으로 바꾸지 않는다.
 */
export function parseAxisLevel(value: unknown): number | null {
  if (typeof value !== 'number') return null;
  if (!Number.isFinite(value)) return null;
  if (!Number.isInteger(value)) return null;
  if (value < 1 || value > 5) return null;
  return value;
}

/** 개별 호출 검증 실패. 운영 결합에서 schema_error로 이어진다. */
export interface AxisSchemaError {
  error: 'schema_error';
  /** 어떤 축이 왜 형식 오류인지. 학생 원문·개인정보는 담지 않는다. */
  detail: string;
}

export function isAxisSchemaError(v: AxisLevels | AxisSchemaError): v is AxisSchemaError {
  return (v as AxisSchemaError).error === 'schema_error';
}

/**
 * 모델 1회 출력의 축 수준을 밴드 규칙에 맞추어 검증한다.
 * A밴드: contextLevel은 반드시 null.
 * B·C밴드: contextLevel은 반드시 정수 1~5.
 */
export function validateSingleCall(raw: unknown, band: Band): AxisLevels | AxisSchemaError {
  if (raw === null || typeof raw !== 'object') {
    return { error: 'schema_error', detail: '출력이 객체가 아님' };
  }
  const r = raw as Record<string, unknown>;
  const bad: string[] = [];

  const objectLevel = parseAxisLevel(r.objectLevel);
  if (objectLevel === null) bad.push('objectLevel');

  const specificityLevel = parseAxisLevel(r.specificityLevel);
  if (specificityLevel === null) bad.push('specificityLevel');

  let contextLevel: number | null = null;
  if (band === 'A') {
    // A밴드는 맥락 축 미적용. null 이외의 값은 형식 오류다(0으로 채운 값도 오류).
    if (r.contextLevel !== null) bad.push('contextLevel(A밴드는 null이어야 함)');
  } else {
    contextLevel = parseAxisLevel(r.contextLevel);
    if (contextLevel === null) bad.push('contextLevel');
  }

  if (bad.length) return { error: 'schema_error', detail: `형식 오류 축: ${bad.join(', ')}` };
  return {
    objectLevel: objectLevel as number,
    specificityLevel: specificityLevel as number,
    contextLevel,
  };
}

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
 * 검증을 통과한 호출들을 축별로 결합한다. 반수준을 유지하므로 반올림하지 않는다.
 * 두 호출이 1수준 이내이면 평균, 세 번째 호출을 추가하였으면 중앙값을 쓴다.
 *
 * 결측을 1로 채우지 않는다. 적용 축의 값이 하나도 없으면 결합할 수 없는 입력이므로
 * 호출한 쪽이 운영 결측으로 처리해야 한다(여기서 예외를 던진다).
 */
export function combine(calls: AxisLevels[], useMedian: boolean): AxisLevels {
  if (!calls.length) throw new Error('결합할 유효 호출이 없다');
  const pick = (k: (typeof axisKeys)[number]) => {
    const vs = calls.map((c) => c[k]).filter((v): v is number => v !== null);
    if (!vs.length) return null;
    return useMedian ? median(vs) : mean(vs);
  };
  const objectLevel = pick('objectLevel');
  const specificityLevel = pick('specificityLevel');
  if (objectLevel === null || specificityLevel === null) {
    throw new Error('대상·구체성 축은 결측일 수 없다');
  }
  return { objectLevel, specificityLevel, contextLevel: pick('contextLevel') };
}
