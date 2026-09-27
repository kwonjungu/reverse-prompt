/**
 * 연습 6단계 — 논문 v12의 단계 구성(공개 정보만).
 *
 *   1 도구와 작성 방식 이해   L01–L06   세 영역
 *   2 대상과 수량             L07–L12   대상 영역 중심
 *   3 특징                    L19–L24   특징 영역 중심
 *   4 관계                    L13–L18   관계 영역 중심
 *   5 피드백 검토와 재작성    L25–L30   세 영역
 *   6 종합                    L31–L36   세 영역
 *
 * 문항 ID와 이미지는 그대로 두고 단계(chasi)와 제시 순서만 이 표로 정한다.
 * 밴드(A=L01–12, B=L13–24, C=L25–36)는 문항 번호로 정하며 단계와 무관하다(src/lib/scoring.ts의 bandOf).
 * 채점은 모든 단계에서 세 영역(해당 없음 포함)을 기록한다. 초점은 힌트 순서와 피드백의 우선순위에만 쓴다.
 */

import type { AreaId } from '@/lib/scoring';

export interface Stage {
  chasi: number;
  title: string;
  /** 힌트·피드백에서 먼저 짚는 영역. null이면 세 영역을 고르게 다룬다. */
  focus: AreaId | null;
  /** 이 단계의 문항 번호(level), 제시 순서대로 */
  levels: number[];
}

const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => from + i);

export const STAGES: readonly Stage[] = [
  { chasi: 1, title: '도구와 작성 방식 이해', focus: null, levels: range(1, 6) },
  { chasi: 2, title: '대상과 수량', focus: 'object', levels: range(7, 12) },
  { chasi: 3, title: '특징', focus: 'feature', levels: range(19, 24) },
  { chasi: 4, title: '관계', focus: 'relation', levels: range(13, 18) },
  { chasi: 5, title: '피드백 검토와 재작성', focus: null, levels: range(25, 30) },
  { chasi: 6, title: '종합', focus: null, levels: range(31, 36) },
];

export const STAGE_TITLE: Record<number, string> = Object.fromEntries(
  STAGES.map((s) => [s.chasi, s.title])
);

const CHASI_BY_LEVEL = new Map<number, number>();
const ORDER_BY_LEVEL = new Map<number, number>();
{
  let order = 0;
  for (const s of STAGES) {
    for (const level of s.levels) {
      CHASI_BY_LEVEL.set(level, s.chasi);
      ORDER_BY_LEVEL.set(level, ++order);
    }
  }
}

/** 문항 번호(1~36)가 속한 단계. 없는 번호면 null. */
export function chasiOfLevel(level: number): number | null {
  return CHASI_BY_LEVEL.get(level) ?? null;
}

/** 제시 순서(1~36). 학생 화면은 이 순서로 문항을 푼다. 없는 번호면 null. */
export function presentationOrderOf(level: number): number | null {
  return ORDER_BY_LEVEL.get(level) ?? null;
}

/** 단계의 초점 영역. 1·5·6단계와 알 수 없는 단계는 null. */
export function stageFocusArea(chasi: number | null | undefined): AreaId | null {
  if (chasi === null || chasi === undefined) return null;
  return STAGES.find((s) => s.chasi === chasi)?.focus ?? null;
}
