'use server';

/**
 * @fileOverview promptgrader 시스템 감수 에이전트.
 *
 * 교육학적 적절성 / 채점 공정성 / 피드백 품질 / 문제 난이도 / 이미지 프롬프트 편향을
 * 자동으로 검토하고 개선안을 제시합니다.
 *
 * 모델: gemini-2.5-flash (비용 절감)
 *
 * 이 경로는 학생 응답을 다른 AI에 보내는 경로다. 그러므로 기본은 합성 자료(설정만)
 * 감수이며, 실데이터 입력은 연구자 역할과 명시적 승인 기록이 함께 있을 때만 받는다.
 * 승인 플래그가 없으면 실데이터를 거부한다. 테스트 목적으로 실데이터를 내려받거나
 * 감수 AI로 보내지 않는다.
 *
 * 실제 호출은 서버 액션 @/server/auth/audit-actions의 runAuditFromServer를 거친다.
 * 클라이언트가 이 함수를 직접 부르더라도 아래 승인 검사에서 막힌다.
 *
 * 대응 문서: 프로그램_수정_프롬프트설계서_v7 §1 P1, §6
 */

import { ai } from '@/ai/genkit';
import { z } from 'genkit';

// ── 입력 스키마 ──────────────────────────────────────────
const QuestionSchema = z.object({
  level: z.number(),
  chasi: z.number(),
  koreanTitle: z.string(),
  sourcePrompt: z.string(),
  rubric: z.string(),
});

// 감수 payload에는 신원 ID(연구ID·학급ID·출석번호·학교명)를 넣지 않는다.
const EvalSampleSchema = z.object({
  questionLevel: z.number().optional(),
  studentPrompt: z.string(),
  score: z.number().optional(),
  feedback: z.string().optional(),
  originalPrompt: z.string().optional(),
});

export const AuditInputSchema = z.object({
  questions: z.array(QuestionSchema).describe('현재 설정된 연습 문제 목록'),
  evaluationPrompt: z.string().describe('채점 AI에 사용 중인 시스템 프롬프트'),
  imagePromptTemplate: z.string().describe('이미지 생성 시 사용하는 buildImagePrompt 전체 텍스트'),
  recentEvaluations: z.array(EvalSampleSchema).optional().describe('최근 학생 제출 (선택, 승인 필요)'),
  /** 기본은 합성 자료다. 실데이터는 승인 기록이 있어야 한다. */
  dataSource: z.enum(['synthetic', 'real']).default('synthetic'),
  /** 연구자 역할 확인과 명시적 승인 기록. 실데이터일 때만 채운다. */
  approval: z
    .object({
      approvalId: z.string(),
      approvedBy: z.string(),
      approvedAt: z.string(),
    })
    .optional(),
});
export type AuditInput = z.infer<typeof AuditInputSchema>;

/**
 * 승인 없는 실데이터 감수 전송을 막을 때 던지는 오류.
 * 'use server' 파일은 async 함수 외의 export를 두지 않으므로 내보내지 않는다.
 * 호출부는 error.name === 'AuditPolicyError'로 구분한다.
 */
class AuditPolicyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AuditPolicyError';
  }
}

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
  const dataSource = input.dataSource ?? 'synthetic';
  const hasRealData = (input.recentEvaluations?.length ?? 0) > 0;

  // 합성 자료만 기본 허용한다. 실데이터가 섞여 오면 승인 여부와 무관하게 먼저 막는다.
  if (hasRealData && dataSource !== 'real') {
    throw new AuditPolicyError(
      '실데이터 감수는 기본 허용되지 않습니다. 합성 자료로만 감수합니다.'
    );
  }
  if (dataSource === 'real') {
    const approval = input.approval;
    if (!approval?.approvalId || !approval.approvedBy || !approval.approvedAt) {
      throw new AuditPolicyError(
        '연구자 역할과 명시적 승인 기록이 없으면 실데이터를 감수 AI로 보내지 않습니다.'
      );
    }
  }
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
      ? `\n\n[승인된 학생 제출 자료 ${input.recentEvaluations!.length}건 - 신원 정보 없음]\n` +
        input.recentEvaluations!.map((e, i) =>
          `#${i + 1} Lv.${e.questionLevel ?? '?'} | 학생 응답:"${e.studentPrompt.slice(0, 60)}..."`
        ).join('\n')
      : '\n\n[학생 자료 없음 — 설정만으로 감수]';

    const prompt = `
너는 초등교육 전문가이자 AI 시스템 품질 감수관이야.
아래 promptgrader 프로젝트의 구성 요소를 교육학적 관점에서 꼼꼼히 감수하고 JSON으로 보고해.

대상: 초등학교 5~6학년 / 역프롬프트 학습 시스템

──────────────────────────────────────────
[1] 연습 문항 ${input.questions.length}개 (level / 차시 / 제목 / 이미지 원 프롬프트 / 안내문)
${input.questions.map(q =>
  `  Lv.${q.level}(${q.chasi}차시) ${q.koreanTitle}: src="${q.sourcePrompt.slice(0, 80)}..." | 안내="${q.rubric.slice(0, 60)}..."`
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
      const fallback: AuditOutput = {
        overallGrade: 'C',
        overallComment: `감수 에이전트 실행 실패: ${error?.message?.slice(0, 100)}`,
        findings: [],
        topPriority: '에이전트 오류를 확인하세요.',
      };
      return fallback;
    }
  }
);
