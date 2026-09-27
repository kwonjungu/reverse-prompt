/**
 * 옛 공통 루브릭 v7(축별 5수준·100점 환산)의 채점 결과 형 — 게임·타임어택 전용.
 *
 * 연습·검사·연수는 공통 루브릭 v12-2(src/lib/research/types.ts의 OperationalResult)를 쓴다.
 * 이 형은 게임·타임어택 채점과, 저장소에 남아 있는 옛 v7 기록을 읽을 때만 쓴다.
 */

import type { AxisLevels, Band } from './scoring';
import type { FeedbackPresentation, FeedbackStatus, MissingReasonModel } from '@/lib/research/types';

export interface AxisScores {
  object: number;
  specificity: number;
  context: number | null;
}

/** 옛 운영 채점 1회의 결과. 결측은 0점이 아니라 null이다. */
export type LegacyOperationalResult =
  | {
      status: 'scored';
      levels: AxisLevels;
      score: number;
      axisScores: AxisScores;
      feedbackStatus: FeedbackStatus;
    }
  | {
      status: 'missing';
      levels: null;
      score: null;
      axisScores: null;
      reason: MissingReasonModel;
    };

export interface LegacyCallRecord {
  callId: string;
  retryIndex: number;
  levels: AxisLevels | null;
  failureReason: string | null;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
}

export interface LegacyScoringRun {
  operationId: string;
  repeatIndex: number;
  band: Band;
  result: LegacyOperationalResult;
  calls: LegacyCallRecord[];
  extraCall: boolean;
  feedback: FeedbackPresentation | null;
  modelId: string;
  modelConfig: Record<string, unknown>;
  rubricVersion: string;
  cueVersion: string;
  imageHash: string;
  promptHash: string;
  codeCommit: string;
  scoredAt: string;
}
