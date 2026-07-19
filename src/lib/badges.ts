/**
 * 축별 뱃지/칭호 매핑.
 * 채점 AI가 반환하는 strongestAxis(가장 잘한 축)를 학생용 뱃지로 변환한다.
 * 3축: ① 대상/명칭 ② 시각적 구체성 ③ 맥락·분위기
 */

export type StrongestAxis = '대상' | '구체성' | '맥락';

export interface AxisBadge {
  name: string;
  emoji: string;
}

export const AXIS_BADGES: Record<StrongestAxis, AxisBadge> = {
  대상: { name: '관찰 마스터', emoji: '🔎' },
  구체성: { name: '디테일 마스터', emoji: '🎨' },
  맥락: { name: '분위기 화가', emoji: '🌟' },
};

/**
 * strongestAxis 값(문자열, undefined/null 포함)에 해당하는 뱃지를 반환.
 * 알 수 없는 값이면 null (모델이 값을 안 주거나 오타를 낼 수 있으므로 방어적으로).
 */
export function getAxisBadge(axis: string | null | undefined): AxisBadge | null {
  if (!axis) return null;
  return AXIS_BADGES[axis as StrongestAxis] ?? null;
}
