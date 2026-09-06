'use server';

/**
 * @fileOverview promptgrader 시스템 감수 에이전트.
 *
 * 교육학적 적절성 / 채점 공정성 / 피드백 품질 / 문제 난이도 / 이미지 프롬프트 편향을
 * 자동으로 검토하고 개선안을 제시합니다.
 *
 * 모델: gemini-3.8-flash (비용 절감)
 * 실제 데이터(학생 제출물)가 있으면 패턴 분석까지 수행합니다.
 */

import { ai } from '@/ai/genkit';
import { z } from 'genkit';

// ── 입력 스키마 ──────────────────────────────────────────
const QuestionSchema = z.object({
  level: z.number(),
  dataAiHint: z.string(),
  rubric: z.string(),
});

const EvalSampleSchema = z.object({
  questionLevel: z.number().optional(),
  studentPrompt: z.string(),
  score: z.number(),
  feedback: z.string(),
  originalPrompt: z.string().optional(),
});

export const AuditInputSchema = z.object({
  questions: z.array(QuestionSchema).describe('현재 설정된 연습 문제 목록'),
  evaluationPrompt: z.string().describe('채점 AI에 사용 중인 시스템 프롬프트'),
  imagePromptTemplate: z.string().describe('이미지 생성 시 사용하는 buildImagePrompt 전체 텍스트'),
  recentEvaluations: z.array(EvalSampleSchema).optional().describe('최근 학생 제출 및 채점 결과 (선택)'),
});
export type AuditInput = z.infer<typeof AuditInputSchema>;

// ── 출력 스키마 ──────────────────────────────────────────
const FindingSchema = z.object({
  category: z.enum([
    '문제 난이도',
    '이미지 프롬프트',
    '힌트(rubric)',
    '채점 기준',
    '피드백 품질',
    '교육학적 적절성',
  ]),
  severity: z.enum(['즉시수정', '개선권장', '양호']),
  issue: z.string().describe('발견한 문제 또는 관찰 내용'),
  recommendation: z.string().describe('구체적인 개선 방법'),
  targetFile: z.string().optional().describe('수정이 필요한 파일 경로'),
});

export const AuditOutputSchema = z.object({
  overallGrade: z.enum(['A', 'B', 'C', 'D']).describe('시스템 전체 품질 등급'),
  overallComment: z.string().describe('전체 평가 요약 (2~3문장)'),
  findings: z.array(FindingSchema).describe('발견 사항 목록 (중요도 순)'),
  topPriority: z.string().describe('가장 먼저 해야 할 개선 작업 1가지'),
  dataInsights: z.string().optional().describe('실제 학생 데이터에서 발견한 패턴 (데이터가 있을 때만)'),
});
export type AuditOutput = z.infer<typeof AuditOutputSchema>;

export async function runAuditAgent(input: AuditInput): Promise<AuditOutput> {
  return auditFlow(input);
}

// ── 에이전트 플로우 ──────────────────────────────────────
const auditFlow = ai.defineFlow(
  {
    name: 'auditAgentFlow',
    inputSchema: AuditInputSchema,
    outputSchema: AuditOutputSchema,
  },
  async (input) => {
    const hasData = (input.recentEvaluations?.length ?? 0) > 0;
    const dataSection = hasData
      ? `\n\n[실제 학생 제출 데이터 ${input.recentEvaluations!.length}건]\n` +
        input.recentEvaluations!.map((e, i) =>
          `#${i + 1} Lv.${e.questionLevel ?? '?'} | 점수:${e.score} | 학생:"${e.studentPrompt.slice(0, 60)}..." | 피드백:"${e.feedback.slice(0, 80)}..."`
        ).join('\n')
      : '\n\n[실제 데이터 없음 — 설정만으로 감수]';

    const prompt = `
너는 초등교육 전문가이자 AI 시스템 품질 감수관이야.
아래 promptgrader 프로젝트의 구성 요소를 교육학적 관점에서 꼼꼼히 감수하고 JSON으로 보고해.

대상: 초등학교 3~6학년 / AI 프롬프트 엔지니어링 학습 앱

──────────────────────────────────────────
[1] 연습 문제 ${input.questions.length}개 (level / dataAiHint / rubric)
${input.questions.map(q =>
  `  Lv.${q.level}: hint="${q.dataAiHint.slice(0, 80)}..." | rubric="${q.rubric.slice(0, 60)}..."`
).join('\n')}

[2] 채점 AI 시스템 프롬프트
${input.evaluationPrompt}

[3] 이미지 생성 프롬프트 템플릿
${input.imagePromptTemplate}
${dataSection}
──────────────────────────────────────────

감수 포인트:
1. 문제 난이도 — 1~15단계 사이에 과도한 점프가 있는가? 초등학생이 소화 가능한가?
2. 이미지 프롬프트 — 모델 편향(불필요한 요소 추가) 방지 장치가 충분한가?
3. 힌트(rubric) — 학생의 상상력을 여는가, 닫는가? 난이도에 맞는가?
4. 채점 기준 — 초등학생 수준에 공정한가? 특정 축이 너무 어렵지 않은가?
5. 피드백 품질 — 실제 데이터가 있으면 피드백이 구체적인지, 칭찬-개선 비율이 적절한지 확인.
6. 교육학적 적절성 — 전체 학습 경험이 초등생의 인지 발달에 맞는가?

findings는 severity 순(즉시수정 → 개선권장 → 양호)으로 정렬해서 JSON 반환.
`;

    try {
      const response = await ai.generate({
        model: 'googleai/gemini-3.8-flash',
        output: { schema: AuditOutputSchema },
        prompt,
        config: { temperature: 0.3 },
      });

      const out = response.output;
      if (!out) throw new Error('에이전트 응답 없음');
      return out;
    } catch (error: any) {
      console.error('[auditAgentFlow] 실패:', error?.message);
      return {
        overallGrade: 'C' as const,
        overallComment: `감수 에이전트 실행 실패: ${error?.message?.slice(0, 100)}`,
        findings: [],
        topPriority: '에이전트 오류를 확인하세요.',
      };
    }
  }
);
