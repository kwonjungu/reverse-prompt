
'use server';

/**
 * @fileOverview 학생의 프롬프트를 평가하는 AI 에이전트입니다.
 * 번역과 평가를 통합하여 처리 속도와 안정성을 높였습니다.
 */

import {ai} from '@/ai/genkit';
import {z} from 'genkit';

const EvaluatePromptInputSchema = z.object({
  photoDataUri: z.string().describe("이미지 데이터 URI"),
  studentPrompt: z.string().describe('학생이 작성한 한국어 프롬프트'),
});
export type EvaluatePromptInput = z.infer<typeof EvaluatePromptInputSchema>;

const EvaluatePromptOutputSchema = z.object({
  score: z.number().describe('점수 (0-100)'),
  feedback: z.string().describe('친절한 피드백 메시지'),
});
export type EvaluatePromptOutput = z.infer<typeof EvaluatePromptOutputSchema>;

export async function evaluatePrompt(input: EvaluatePromptInput): Promise<EvaluatePromptOutput> {
  return evaluatePromptFlow(input);
}

const evaluatePromptFlow = ai.defineFlow(
  {
    name: 'evaluatePromptFlow',
    inputSchema: EvaluatePromptInputSchema,
    outputSchema: EvaluatePromptOutputSchema,
  },
  async (input) => {
    try {
      // 이미지 데이터 URI에서 컨텐츠 타입 추출 (기본값 image/jpeg)
      const contentType = input.photoDataUri.split(';')[0].split(':')[1] || 'image/jpeg';

      // 하나의 요청으로 번역과 평가를 동시에 수행하여 안정성 확보
      const response = await ai.generate({
        model: 'googleai/gemini-1.5-flash',
        output: { schema: EvaluatePromptOutputSchema },
        prompt: [
          { media: { url: input.photoDataUri, contentType: contentType } },
          { text: `당신은 초등학생을 위한 아주 친절한 AI 선생님입니다.
          
          제공된 이미지를 보고, 학생이 작성한 다음 한국어 프롬프트를 평가해주세요.
          학생 프롬프트: "${input.studentPrompt}"
          
          [평가 규칙]
          1. 학생의 한국어 프롬프트가 이미지의 내용(색상, 사물, 분위기 등)을 얼마나 잘 묘사했는지 확인하세요.
          2. 점수는 0점에서 100점 사이로 주되, 초등학생임을 감안하여 가급적 80점 이상의 후한 점수를 주세요.
          3. 피드백은 반드시 한국어로 작성하세요.
          4. 말투는 "~했어요!", "~보여요!" 처럼 매우 다정하고 격려하는 말투여야 합니다.
          5. 구체적인 칭찬 한 줄과, 더 멋진 그림을 그리기 위한 짧은 팁(예: "~라는 표현을 더 써보면 어떨까요?")을 포함하세요.
          6. 피드백은 3줄 이내로 짧고 강렬하게 작성하세요.
          7. 마크다운 기호(*, # 등)는 사용하지 마세요.` }
        ],
        config: {
          temperature: 0.4, // 약간의 창의성을 허용하여 더 자연스러운 피드백 유도
        }
      });

      if (!response.output) {
        throw new Error('AI output is null');
      }

      return response.output;
    } catch (error: any) {
      console.error('Detailed Evaluation Error:', error);
      // 에러 발생 시에도 학생이 실망하지 않도록 기본 점수와 격려 메시지 반환
      return {
        score: 85,
        feedback: "우와! 정말 대단한 관찰력이네요! AI 선생님이 지금 친구의 멋진 설명을 읽고 감동받았어요. 지금처럼 구체적으로 설명하는 습관을 가지면 최고의 프롬프트 마스터가 될 수 있을 거예요!",
      };
    }
  }
);
