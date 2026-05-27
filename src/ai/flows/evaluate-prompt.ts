'use server';

/**
 * @fileOverview 학생 프롬프트 평가 (초등 3~6학년).
 * 모델: gemini-2.5-flash · 1회 평가 약 ₩2.
 * 자기검증 루프: 피드백 품질이 낮으면(구체 인용 없음) 1회 재평가.
 */

import {ai} from '@/ai/genkit';
import {z} from 'genkit';

const EvaluatePromptInputSchema = z.object({
  photoDataUri: z.string().describe('이미지 데이터 URI'),
  studentPrompt: z.string().describe('학생이 작성한 한국어 프롬프트'),
});
export type EvaluatePromptInput = z.infer<typeof EvaluatePromptInputSchema>;

const EvaluatePromptOutputSchema = z.object({
  score: z.number().describe('점수 0~100'),
  feedback: z.string().describe('칭찬 1줄 + 개선 1줄'),
});
export type EvaluatePromptOutput = z.infer<typeof EvaluatePromptOutputSchema>;

export async function evaluatePrompt(input: EvaluatePromptInput): Promise<EvaluatePromptOutput> {
  return evaluatePromptFlow(input);
}

const SYSTEM_PROMPT = `너는 초등학교 담임 선생님이야. 3~6학년 학생이 그림을 보고 쓴 한국어 묘사를 평가해.

[채점 기준 — 3가지 축을 각각 확인]
A. 대상: 무엇/누구를 그렸는지 명확히 말했는가? (예: 강아지, 로봇)
B. 시각 묘사: 색·모양·크기·자세·표정·동작 중 하나 이상을 적었는가?
C. 맥락/분위기: 배경·장소·시간·느낌·스타일 중 하나 이상을 적었는가?

[점수 가이드 (0~100)]
- 95~100: 세 축 모두 + 형용사 2개 이상, 그림의 세부 요소까지 풍부하게 묘사
- 85~94: 세 축 모두 다룸
- 70~84: 두 축
- 55~69: 한 축만 (대개 대상만 말함)
- 35~54: 그림과 살짝 다르거나 매우 짧음
- 15~34: 그림과 거리가 멈
- 0~14: 완전히 무관하거나 빈 칸

[피드백 — 정확히 2줄, 마크다운 없이 평문]
- 1줄: 학생 글에서 실제 단어 하나를 큰따옴표로 인용하며 칭찬
  (예: "'반짝반짝'이라는 표현, 그림과 딱 어울려요!")
- 2줄: 학생이 빠뜨린 축 하나를 그림에서 보이는 단서로 알려주고, 다음에 써볼 단어 2개 제안
  (예: "강아지 색깔도 같이 적어볼까요? '갈색', '얼룩무늬' 같은 단어가 좋아요.")

[금지]
- "대단해요/감동/최고" 같은 추상 칭찬으로 끝내기
- 한 번에 부족한 점 여러 개 지적 (1개만)
- *, #, -, ** 등 마크다운 기호 사용`;

async function runEvaluation(input: EvaluatePromptInput): Promise<EvaluatePromptOutput> {
  const contentType = input.photoDataUri.split(';')[0].split(':')[1] || 'image/jpeg';
  const response = await ai.generate({
    model: 'googleai/gemini-2.5-flash',
    output: { schema: EvaluatePromptOutputSchema },
    prompt: [
      { media: { url: input.photoDataUri, contentType } },
      { text: `${SYSTEM_PROMPT}\n\n학생 글: "${input.studentPrompt}"\n\nscore와 feedback 두 필드로 JSON 응답.` },
    ],
    config: { temperature: 0.5 },
  });

  const out = response.output;
  if (!out || typeof out.score !== 'number' || !out.feedback) {
    throw new Error(`AI 응답 형식 오류: ${JSON.stringify(out)?.slice(0, 200)}`);
  }
  out.score = Math.max(0, Math.min(100, Math.round(out.score)));
  return out;
}

// 피드백 품질 검사: 학생 글에서 따온 큰따옴표 인용이 있는지 확인
function hasConcreteCitation(feedback: string, studentPrompt: string): boolean {
  const quoted = feedback.match(/'([^']+)'/g) ?? feedback.match(/"([^"]+)"/g) ?? [];
  if (quoted.length === 0) return false;
  // 인용어 중 하나라도 학생 글에 실제로 있는 단어인지 확인
  return quoted.some(q => {
    const word = q.replace(/['"]/g, '').trim();
    return word.length >= 2 && studentPrompt.includes(word);
  });
}

const evaluatePromptFlow = ai.defineFlow(
  {
    name: 'evaluatePromptFlow',
    inputSchema: EvaluatePromptInputSchema,
    outputSchema: EvaluatePromptOutputSchema,
  },
  async (input) => {
    try {
      const first = await runEvaluation(input);

      // 자기검증: 피드백이 구체 인용을 포함하지 않으면 1회 재시도 (디버깅 루프)
      const isQualityOk = hasConcreteCitation(first.feedback, input.studentPrompt) ||
                          input.studentPrompt.trim().length < 10;

      if (!isQualityOk) {
        try {
          const retry = await runEvaluation({
            ...input,
            studentPrompt: input.studentPrompt,
          });
          // 재시도 결과의 피드백이 더 구체적이면 교체
          if (hasConcreteCitation(retry.feedback, input.studentPrompt)) {
            return retry;
          }
        } catch {
          // 재시도 실패해도 첫 결과 반환
        }
      }

      return first;
    } catch (error: any) {
      const msg = error?.message ?? String(error);
      console.error('[evaluatePromptFlow] 실패:', msg);
      return {
        score: 0,
        feedback: `(⚠️ AI 평가 실패: ${msg.slice(0, 120)})`,
      };
    }
  }
);
