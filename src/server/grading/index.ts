import 'server-only';

/**
 * GradingApi 구현 인스턴스.
 *
 * 절차 자체는 src/server/grading/operational.ts에 있고, 여기서는 서버 전용 기본 의존
 * (모델 호출, 문항 레지스트리, 개인정보 점검, 모델 설정)을 붙이기만 한다.
 * 모델 ID·설정은 src/server/config.ts만 쓴다. 이 파일에 모델명을 새로 적지 않는다.
 *
 * 대응 문서: 프로그램_수정_프롬프트설계서_v7 §3
 */

import { z } from 'genkit';
import { ai } from '@/ai/genkit';
import { registry } from '@/server/registry';
import { privacy } from '@/server/privacy';
import { CODE_COMMIT, EVALUATION_MODEL_CONFIG, EVALUATION_MODEL_ID } from '@/server/config';
import { createGrading, type CallModel } from './operational';
import type { GradingApi } from './contract';

export { createGrading } from './operational';
export type { CallModel, GradingDeps, ModelCallInput } from './operational';

/**
 * 모델 출력 스키마.
 * 수준을 여기서 정수로 강제하지 않는다. 범위 밖·소수 같은 형식 오류를 그대로 받아
 * scoring.ts의 validateSingleCall이 형식 오류로 판정하게 한다(보정하지 않기 위함).
 */
const ModelOutputSchema = z.object({
  objectLevel: z.number().nullable().describe('대상 완전성 수준. 정수 1~5'),
  specificityLevel: z.number().nullable().describe('시각적 구체성 수준. 정수 1~5'),
  contextLevel: z.number().nullable().describe('맥락 축 수준. 정수 1~5. A밴드는 null'),
  rationale: z.string().optional().describe('판정 근거'),
  feedbackLine1: z.string().optional().describe('피드백 1줄 — 목표'),
  feedbackLine2: z.string().optional().describe('피드백 2줄 — 현재 수행'),
  feedbackLine3: z.string().optional().describe('피드백 3줄 — 다음 행동'),
  feedbackLine4: z.string().optional().describe('피드백 4줄 — 활용할 표현 또는 자기 점검'),
  quote: z.string().nullable().optional().describe('학생 글에 그대로 있는 인용 표현. 없으면 null'),
});

/** 기본 모델 호출. 학생 신원·인증정보를 payload에 넣지 않는다. */
export const genkitCallModel: CallModel = async (input) => {
  const parts: Array<Record<string, unknown>> = [];
  if (input.image) {
    parts.push({ media: { url: input.image.dataUri, contentType: input.image.contentType } });
  }
  parts.push({ text: input.prompt });

  const response = await ai.generate({
    model: input.modelId,
    output: { schema: ModelOutputSchema },
    prompt: parts as never,
    config: input.modelConfig,
  });
  if (!response.output) throw new Error('모델 출력 없음');
  return response.output;
};

export const grading: GradingApi = createGrading({
  callModel: genkitCallModel,
  registry,
  privacy,
  modelId: EVALUATION_MODEL_ID,
  modelConfig: { ...EVALUATION_MODEL_CONFIG },
  codeCommit: CODE_COMMIT,
});
