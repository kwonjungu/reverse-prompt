'use server';

/**
 * @fileOverview 학생 프롬프트 평가 — 교육학적 근거 기반 채점
 *
 * 채점 기준·프롬프트 텍스트는 src/lib/evaluation-prompt.ts (단일 진실 공급원 —
 * admin 감수 페이지와 공유. 이론적 배경 주석도 그쪽에).
 *
 * 모델: gemini-2.5-flash (기본 2회 병렬 채점, 1제출당 약 ₩4)
 * 객관성 장치:
 *  - 독립 2회 병렬 채점 → 점수차 12점 이하면 평균, 초과면 3차 채점 후 중앙값
 *  - 피드백 인용 자기검증 (학생 글 실제 단어 인용 여부를 코드로 확인, 조사 허용)
 */

import { ai } from '@/ai/genkit';
import { z } from 'genkit';
import { buildEvaluationPrompt } from '@/lib/evaluation-prompt';

const EvaluatePromptInputSchema = z.object({
  photoDataUri: z.string().describe('이미지 데이터 URI'),
  studentPrompt: z.string().describe('학생이 작성한 한국어 프롬프트'),
  questionLevel: z.number().optional().describe('문제 난이도 레벨 (1~15)'),
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

// 두 채점 결과의 점수차가 이 값 이하면 "합의"로 보고 평균 사용
const AGREEMENT_THRESHOLD = 12;

async function runEvaluation(input: EvaluatePromptInput): Promise<EvaluatePromptOutput> {
  const level = input.questionLevel ?? 9;
  const contentType = input.photoDataUri.split(';')[0].split(':')[1] || 'image/jpeg';

  const response = await ai.generate({
    model: 'googleai/gemini-2.5-flash',
    output: { schema: EvaluatePromptOutputSchema },
    prompt: [
      { media: { url: input.photoDataUri, contentType } },
      { text: buildEvaluationPrompt(level, input.studentPrompt) },
    ],
    config: { temperature: 0.2 },
  });

  const out = response.output;
  if (!out || typeof out.score !== 'number' || !out.feedback) {
    throw new Error(`AI 응답 형식 오류: ${JSON.stringify(out)?.slice(0, 200)}`);
  }
  out.score = Math.max(0, Math.min(100, Math.round(out.score)));
  return out;
}

// 피드백에 학생 글 인용이 있는지 확인 (자기검증용)
// 조사·어미가 붙어 인용된 경우("하얀색이"처럼)를 위해 끝 1글자를 깎은 재대조까지 허용
function hasConcreteCitation(feedback: string, studentPrompt: string): boolean {
  const normalized = studentPrompt.replace(/\s+/g, '');
  const matches = [...feedback.matchAll(/['"‘’“”]([^'"‘’“”]{2,})['"‘’“”]/g)];
  return matches.some(m => {
    const quote = m[1].replace(/\s+/g, '');
    if (normalized.includes(quote)) return true;
    return quote.length >= 3 && normalized.includes(quote.slice(0, -1));
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
      // 객관성: 독립 2회 병렬 채점 (병렬이라 지연 시간은 1회와 동일)
      const settled = await Promise.allSettled([runEvaluation(input), runEvaluation(input)]);
      const candidates = settled
        .filter((s): s is PromiseFulfilledResult<EvaluatePromptOutput> => s.status === 'fulfilled')
        .map(s => s.value);
      if (candidates.length === 0) {
        throw (settled[0] as PromiseRejectedResult).reason;
      }

      let score: number;
      if (candidates.length === 1) {
        score = candidates[0].score;
      } else if (Math.abs(candidates[0].score - candidates[1].score) <= AGREEMENT_THRESHOLD) {
        score = Math.round((candidates[0].score + candidates[1].score) / 2);
      } else {
        // 두 채점이 크게 불일치 → 3차 채점 후 중앙값 (이상치 1개를 자동 배제)
        try {
          candidates.push(await runEvaluation(input));
          score = candidates.map(c => c.score).sort((a, b) => a - b)[1];
        } catch {
          score = Math.round((candidates[0].score + candidates[1].score) / 2);
        }
      }

      // 피드백 선택: 학생 글을 실제 인용한 후보 우선, 그중 최종 점수에 가장 가까운 것
      const tooShort = input.studentPrompt.trim().length < 8;
      let pool = candidates.filter(c => hasConcreteCitation(c.feedback, input.studentPrompt));
      if (pool.length === 0) {
        if (!tooShort) {
          // 전 후보가 추상적 피드백 → 1회 재시도
          try {
            const retry = await runEvaluation(input);
            if (hasConcreteCitation(retry.feedback, input.studentPrompt)) pool = [retry];
          } catch {
            // 재시도 실패 → 기존 후보로 진행
          }
        }
        if (pool.length === 0) pool = candidates;
      }
      const best = pool.reduce((p, c) =>
        Math.abs(c.score - score) < Math.abs(p.score - score) ? c : p
      );

      return { score, feedback: best.feedback };
    } catch (error: any) {
      const msg = error?.message ?? String(error);
      console.error('[evaluatePromptFlow] 실패:', msg);
      return { score: 0, feedback: `(⚠️ AI 평가 실패: ${msg.slice(0, 120)})` };
    }
  }
);
