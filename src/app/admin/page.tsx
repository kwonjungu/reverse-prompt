'use client';

import { useState, useMemo } from 'react';
import Link from 'next/link';
import { runAuditAgent, type AuditOutput, type AuditInput } from '@/ai/flows/audit-agent';
import { getEvaluationPromptForAudit } from '@/lib/evaluation-prompt';
import { buildImagePrompt } from '@/lib/image-prompt';
import { PRACTICE_QUESTIONS } from '@/lib/questions';
import { useFirestore, useCollection } from '@/firebase';
import { collection, query, orderBy, limit } from 'firebase/firestore';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { ArrowLeft, Bot, AlertTriangle, CheckCircle2, Info, Loader2, RefreshCw, ShieldCheck } from 'lucide-react';

// 현재 시스템 설정 — 감수 에이전트에 전달할 snapshot (실제 사용 중인 문제 목록 그대로)
const CURRENT_QUESTIONS = PRACTICE_QUESTIONS.map(({ level, dataAiHint, rubric }) => ({ level, dataAiHint, rubric }));

// 요약 사본이 아니라 실제 채점·이미지 프롬프트를 그대로 감수 대상으로 전달
// (예전엔 손으로 쓴 요약이 실제 점수 밴드와 어긋나 있었음)
const EVALUATION_SYSTEM_PROMPT = getEvaluationPromptForAudit();

const IMAGE_PROMPT_TEMPLATE = buildImagePrompt('{subject}');

const severityIcon = {
  '즉시수정': <AlertTriangle className="h-4 w-4 text-destructive" />,
  '개선권장': <Info className="h-4 w-4 text-yellow-500" />,
  '양호': <CheckCircle2 className="h-4 w-4 text-green-500" />,
};

const severityBadge = {
  '즉시수정': 'destructive' as const,
  '개선권장': 'secondary' as const,
  '양호': 'outline' as const,
};

const gradeColor = {
  'A': 'text-green-600',
  'B': 'text-blue-600',
  'C': 'text-yellow-600',
  'D': 'text-destructive',
};

export default function AdminPage() {
  const [auditResult, setAuditResult] = useState<AuditOutput | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [includeData, setIncludeData] = useState(true);
  const db = useFirestore();

  const practiceQuery = useMemo(() => {
    if (!db) return null;
    // 최근 50건만 샘플링
    return query(
      collection(db, 'classes', '__audit_sample__', 'practice_attempts'),
      orderBy('createdAt', 'desc'),
      limit(50)
    );
  }, [db]);

  // 실제 데이터는 특정 classCode가 아닌 전체를 읽을 수 없으므로
  // 교사가 classCode를 입력하면 로드하는 방식 대신
  // sessionStorage의 classCode 사용
  const [classCodeForAudit, setClassCodeForAudit] = useState('');

  const auditDataQuery = useMemo(() => {
    if (!db || !classCodeForAudit) return null;
    return query(
      collection(db, 'classes', classCodeForAudit, 'practice_attempts'),
      orderBy('createdAt', 'desc'),
      limit(30)
    );
  }, [db, classCodeForAudit]);

  const { data: auditData } = useCollection(auditDataQuery);

  const handleRunAudit = async () => {
    setIsRunning(true);
    setAuditResult(null);

    const recentEvaluations = (auditData as any[])?.map(d => ({
      questionLevel: d.questionLevel,
      studentPrompt: d.studentPrompt,
      score: d.score,
      feedback: d.feedback,
      originalPrompt: d.originalPrompt,
    }));

    const input: AuditInput = {
      questions: CURRENT_QUESTIONS,
      evaluationPrompt: EVALUATION_SYSTEM_PROMPT,
      imagePromptTemplate: IMAGE_PROMPT_TEMPLATE,
      recentEvaluations: includeData && recentEvaluations?.length ? recentEvaluations : undefined,
    };

    try {
      const result = await runAuditAgent(input);
      setAuditResult(result);
    } catch (e: any) {
      console.error('Audit failed:', e);
    } finally {
      setIsRunning(false);
    }
  };

  return (
    <div className="min-h-screen bg-background p-4 md:p-8">
      <div className="max-w-4xl mx-auto">
        <header className="mb-8 flex items-start justify-between">
          <div>
            <div className="flex items-center gap-3 mb-1">
              <ShieldCheck className="h-8 w-8 text-primary" />
              <h1 className="text-3xl font-black font-headline">감수 에이전트</h1>
            </div>
            <p className="text-muted-foreground">AI가 이 프로젝트의 교육적 품질을 자동으로 검토합니다.</p>
          </div>
          <Link href="/">
            <Button variant="outline" size="sm"><ArrowLeft className="mr-2 h-4 w-4" />홈</Button>
          </Link>
        </header>

        {/* 실행 설정 */}
        <Card className="mb-6 border-2 border-primary/20">
          <CardHeader>
            <CardTitle className="text-lg">감수 설정</CardTitle>
            <CardDescription>실제 학생 데이터를 포함하면 패턴 분석까지 수행합니다.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center gap-3">
              <input
                type="checkbox"
                id="includeData"
                checked={includeData}
                onChange={e => setIncludeData(e.target.checked)}
                className="h-4 w-4"
              />
              <label htmlFor="includeData" className="text-sm font-medium">
                실제 학생 데이터 포함 (학급 코드 입력 필요)
              </label>
            </div>
            {includeData && (
              <div className="flex gap-2">
                <input
                  type="text"
                  placeholder="학급 코드 (예: 7531234_3-2)"
                  value={classCodeForAudit}
                  onChange={e => setClassCodeForAudit(e.target.value)}
                  className="flex-1 h-10 px-3 rounded-md border bg-background text-sm"
                />
                <span className="text-xs text-muted-foreground self-center">
                  {auditData ? `${(auditData as any[]).length}건 로드됨` : '미로드'}
                </span>
              </div>
            )}
            <Button
              onClick={handleRunAudit}
              disabled={isRunning}
              className="w-full font-bold h-12 text-lg"
              size="lg"
            >
              {isRunning
                ? <><Loader2 className="mr-2 h-5 w-5 animate-spin" />감수 중... (30~60초 소요)</>
                : <><Bot className="mr-2 h-5 w-5" />감수 시작</>
              }
            </Button>
          </CardContent>
        </Card>

        {/* 로딩 상태 */}
        {isRunning && (
          <div className="space-y-4">
            <Skeleton className="h-32 w-full rounded-2xl" />
            <Skeleton className="h-24 w-full rounded-2xl" />
            <Skeleton className="h-24 w-full rounded-2xl" />
          </div>
        )}

        {/* 감수 결과 */}
        {auditResult && !isRunning && (
          <div className="space-y-6 animate-in fade-in-50 duration-500">
            {/* 종합 등급 */}
            <Card className="border-2 border-primary/20">
              <CardContent className="pt-6">
                <div className="flex items-center gap-6">
                  <div className={`text-8xl font-black font-headline ${gradeColor[auditResult.overallGrade]}`}>
                    {auditResult.overallGrade}
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground font-bold uppercase mb-1">종합 품질 등급</p>
                    <p className="text-base leading-relaxed">{auditResult.overallComment}</p>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* 최우선 개선사항 */}
            <Alert className="border-2 border-destructive/30 bg-destructive/5">
              <AlertTriangle className="h-5 w-5 text-destructive" />
              <AlertTitle className="font-bold text-destructive">최우선 개선 과제</AlertTitle>
              <AlertDescription className="text-base mt-1">{auditResult.topPriority}</AlertDescription>
            </Alert>

            {/* 데이터 인사이트 */}
            {auditResult.dataInsights && (
              <Alert className="border-2 border-blue-200 bg-blue-50/50">
                <Info className="h-5 w-5 text-blue-600" />
                <AlertTitle className="font-bold text-blue-700">학생 데이터 패턴</AlertTitle>
                <AlertDescription className="text-base mt-1 text-blue-800">{auditResult.dataInsights}</AlertDescription>
              </Alert>
            )}

            {/* 발견 사항 목록 */}
            <div className="space-y-3">
              <h2 className="text-xl font-bold">발견 사항 ({auditResult.findings.length}건)</h2>
              {auditResult.findings.map((f, i) => (
                <Card key={i} className={`border ${f.severity === '즉시수정' ? 'border-destructive/40 bg-destructive/5' : f.severity === '개선권장' ? 'border-yellow-300 bg-yellow-50/50' : 'border-green-200 bg-green-50/50'}`}>
                  <CardContent className="pt-4 pb-4">
                    <div className="flex items-start gap-3">
                      <div className="mt-0.5">{severityIcon[f.severity]}</div>
                      <div className="flex-1 min-w-0">
                        <div className="flex flex-wrap items-center gap-2 mb-2">
                          <Badge variant={severityBadge[f.severity]} className="text-xs">{f.severity}</Badge>
                          <Badge variant="outline" className="text-xs">{f.category}</Badge>
                          {f.targetFile && (
                            <code className="text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded">{f.targetFile}</code>
                          )}
                        </div>
                        <p className="text-sm font-medium mb-1">{f.issue}</p>
                        <p className="text-sm text-muted-foreground">→ {f.recommendation}</p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>

            {/* 재실행 버튼 */}
            <Button variant="outline" onClick={handleRunAudit} className="w-full">
              <RefreshCw className="mr-2 h-4 w-4" />다시 감수하기
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
