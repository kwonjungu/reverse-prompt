import 'server-only';

/**
 * 채점기 인스턴스.
 *
 * 절차는 ./operational.ts(공통 루브릭 v12-2)와 ./legacy-v7.ts(옛 v7, 게임·타임어택 전용)에 있고,
 * 여기서는 서버 전용 기본 의존(모델 호출, 문항 레지스트리, 개인정보 점검, 모델 설정)을 붙인다.
 * 모델 ID·설정은 src/server/config.ts만 쓴다. 이 파일에 모델명을 새로 적지 않는다.
 */

import { z } from 'genkit';
import { ai } from '@/ai/genkit';
import { registry } from '@/server/registry';
import { privacy } from '@/server/privacy';
import { CODE_COMMIT, EVALUATION_MODEL_CONFIG, EVALUATION_MODEL_ID } from '@/server/config';
import { createGrading, resolveModelConfig, type CallModel } from './operational';
import {
  createGrading as createLegacyV7Grading,
  type CallModel as LegacyCallModel,
  type GradingApi as LegacyGradingApi,
} from './legacy-v7';
import type { GradingApi } from './contract';

export { createGrading, resolveModelConfig } from './operational';
export type { CallModel, GradingDeps, ModelCallInput, ModelCallOutput } from './operational';

/**
 * 한 영역의 출력. level을 여기서 정수로 강제하지 않는다. 범위 밖·소수·다른 문자열도 그대로 받아
 * src/lib/scoring.ts의 validateAreaCall이 형식 오류로 판정하게 한다(보정하지 않기 위함).
 */
const AreaOutputSchema = z.object({
  level: z.union([z.number(), z.string()]).describe('1~4의 정수, 또는 "not_applicable"'),
  evidence: z.string().nullable().describe('학생 글에서 근거가 된 부분(원문 그대로). 없으면 null'),
  missing: z.array(z.string()).describe('빠진 필수 정보 목록. 없으면 빈 배열'),
  evidence_missing: z
    .array(z.string())
    .optional()
    .describe('핵심 대상이 빠져 확인할 수 없는 그 대상의 속성·관계 목록'),
});

const FeedbackFields = {
  feedbackLine1: z.string().optional().describe('1문장 — 이번 목표'),
  feedbackLine2: z.string().optional().describe('2문장 — 잘 쓴 점(영역을 밝히고 학생 표현을 그대로 넣는다)'),
  feedbackLine3: z.string().optional().describe('3문장 — 다음 행동 한 가지'),
  feedbackLine4: z.string().optional().describe('4문장 — 쓸 수 있는 표현 제안 또는 스스로 확인할 질문'),
  quote: z.string().nullable().optional().describe('2문장에 넣은 학생 글의 표현. 없으면 null'),
  strengthArea: z.string().nullable().optional().describe('2문장의 영역: object·feature·relation 또는 null'),
  nextArea: z.string().nullable().optional().describe('3문장의 영역: object·feature·relation 또는 null'),
  nextTarget: z.string().nullable().optional().describe('3문장이 겨냥한 빠진 정보(missing 문구 그대로) 또는 null'),
};

const ScoreOutputSchema = z.object({
  object: AreaOutputSchema.describe('대상의 명확성'),
  feature: AreaOutputSchema.describe('특징의 구체성'),
  relation: AreaOutputSchema.describe('관계의 명확성'),
  ...FeedbackFields,
});

const FeedbackOutputSchema = z.object(FeedbackFields);

/** 모델 API 응답에서 실제로 답한 모델 이름을 꺼낸다(Gemini의 modelVersion). 없으면 null. */
function servedModelOf(custom: unknown): string | null {
  const v = (custom as { modelVersion?: unknown } | null)?.modelVersion;
  return typeof v === 'string' && v ? v : null;
}

/** 기본 모델 호출. 학생 신원·인증정보를 payload에 넣지 않는다. */
export const genkitCallModel: CallModel = async (input) => {
  const parts: Array<Record<string, unknown>> = [];
  if (input.image) {
    parts.push({ media: { url: input.image.dataUri, contentType: input.image.contentType } });
  }
  parts.push({ text: input.prompt });

  const response = await ai.generate({
    model: input.modelId,
    output: { schema: input.purpose === 'feedback' ? FeedbackOutputSchema : ScoreOutputSchema },
    prompt: parts as never,
    config: input.modelConfig,
  });
  if (!response.output) throw new Error('모델 출력 없음');
  return { output: response.output, servedModel: servedModelOf(response.custom) };
};

export const grading: GradingApi = createGrading({
  callModel: genkitCallModel,
  registry,
  privacy,
  modelId: EVALUATION_MODEL_ID,
  modelConfig: resolveModelConfig({ ...EVALUATION_MODEL_CONFIG }),
  codeCommit: CODE_COMMIT,
});

/* ────────────────────────── 옛 v7 — 게임·타임어택 전용 ────────────────────────── */

const LegacyOutputSchema = z.object({
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

const legacyCallModel: LegacyCallModel = async (input) => {
  const parts: Array<Record<string, unknown>> = [];
  if (input.image) {
    parts.push({ media: { url: input.image.dataUri, contentType: input.image.contentType } });
  }
  parts.push({ text: input.prompt });
  const response = await ai.generate({
    model: input.modelId,
    output: { schema: LegacyOutputSchema },
    prompt: parts as never,
    config: input.modelConfig,
  });
  if (!response.output) throw new Error('모델 출력 없음');
  return response.output;
};

/** 옛 공통 루브릭 v7(5수준·100점) 채점기. 게임·타임어택만 쓴다. 저장하지 않는다. */
export const legacyV7Grading: LegacyGradingApi = createLegacyV7Grading({
  callModel: legacyCallModel,
  registry,
  privacy,
  modelId: EVALUATION_MODEL_ID,
  modelConfig: resolveModelConfig({ ...EVALUATION_MODEL_CONFIG }),
  codeCommit: CODE_COMMIT,
});
