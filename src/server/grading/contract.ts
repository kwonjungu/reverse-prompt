import 'server-only';

/**
 * 운영 채점 진입점 계약. 구현은 src/server/grading/index.ts.
 * 연습 화면(즉시 채점)과 검사 사후 일괄 채점이 같은 함수를 쓴다.
 *
 * 대응 문서: 프로그램_수정_프롬프트설계서_v7 §3
 */

import type { Band } from '@/lib/scoring';
import type { ScoringRun, SessionType } from '@/lib/research/types';

export interface GradingRequest {
  questionId: string;
  band: Band;
  /** 정제된 학생 응답. 채점 지시가 아니라 평가 대상 데이터로 다룬다. */
  studentText: string;
  /** 신원 ID를 넣지 않는다. 채점 payload에는 학생·학급·시점이 없어야 한다. */
  operationId: string;
  repeatIndex: number;
  sessionType: SessionType;
  /** 피드백을 생성할지. 검사 채점에서는 false. */
  wantFeedback: boolean;
}

export interface GradingApi {
  /** 운영 채점 1회(독립 2회 + 조건부 3회)를 수행하고 전체 호출 이력을 남긴다. */
  runOperationalScoring(req: GradingRequest): Promise<ScoringRun>;
}
