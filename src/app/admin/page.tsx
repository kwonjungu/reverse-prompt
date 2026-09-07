'use client';

/**
 * 감수 에이전트 화면.
 *
 * 바뀐 점
 *  - 인증·역할 확인을 붙였다. 연구자 계정만 감수를 실행한다.
 *  - 문항 제작 프롬프트(sourcePrompt)와 채점 시스템 프롬프트를 클라이언트에서
 *    직접 import 하지 않는다. 서버 액션이 서버에서 읽어 감수 입력에 넣는다.
 *  - 실데이터는 기본으로 보내지 않는다. 승인 기록(수업ID + 승인번호)이 있어야만
 *    서버가 실데이터를 넣는다. 학급코드를 적어 클라이언트가 자료를 내려받던
 *    경로는 없앴다.
 *
 * 대응 문서: 프로그램_수정_프롬프트설계서_v7 §1 P1, §6
 */

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import type { AuditOutput } from '@/ai/flows/audit-agent';
import { runAuditFromServer } from '@/server/auth/audit-actions';
import { loadStaffContext } from '@/server/auth/class-data-actions';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { ArrowLeft, Bot, AlertTriangle, CheckCircle2, Info, Loader2, RefreshCw, ShieldCheck } from 'lucide-react';

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
  const [role, setRole] = useState<string | null>(null);
  const [checking, setChecking] = useState(true);
  const [auditResult, setAuditResult] = useState<AuditOutput | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [useRealData, setUseRealData] = useState(false);
  const [classResearchId, setClassResearchId] = useState('');
  const [approvalId, setApprovalId] = useState('');

  const check = useCallback(async () => {
    setChecking(true);
    try {
      const ctx = await loadStaffContext();
      setRole(ctx.role);
    } catch {
      setRole(null);
    } finally {
      setChecking(false);
    }
  }, []);

  useEffect(() => {
    void check();
  }, [check]);

  const handleRunAudit = async () => {
    setIsRunning(true);
    setAuditResult(null);
    setError(null);
    try {
      const result = await runAuditFromServer(
        useRealData && classResearchId && approvalId
          ? { realData: { classResearchId: classResearchId.trim(), approvalId: approvalId.trim() } }
          : undefined
      );
      setAuditResult(result);
    } catch (e) {
      setError(String((e as Error)?.message ?? '감수를 실행하지 못했습니다.'));
    } finally {
      setIsRunning(false);
    }
  };

  if (checking) {
    return (
      <div className="min-h-screen bg-background p-8">
        <Skeleton className="h-40 w-full max-w-2xl mx-auto rounded-2xl" />
      </div>
    );
  }

  if (role !== 'researcher') {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <Card className="max-w-md w-full border-2">
          <CardHeader>
            <CardTitle className="text-xl">접근할 수 없습니다</CardTitle>
            <CardDescription>
              감수는 승인된 연구자 작업입니다. 교사 화면에서 연구자 계정으로 로그인한 뒤 다시 열어 주세요.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Link href="/teacher">
              <Button variant="outline" className="w-full">로그인 화면으로</Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background p-4 md:p-8">
      <div className="max-w-4xl mx-auto">
        <header className="mb-8 flex items-start justify-between">
          <div>
            <div className="flex items-center gap-3 mb-1">
              <ShieldCheck className="h-8 w-8 text-primary" />
              <h1 className="text-3xl font-black font-headline">감수 에이전트</h1>
            </div>
            <p className="text-muted-foreground">설정(문항·채점 문언·이미지 프롬프트)을 검토합니다.</p>
          </div>
          <Link href="/">
            <Button variant="outline" size="sm"><ArrowLeft className="mr-2 h-4 w-4" />홈</Button>
          </Link>
        </header>

        <Alert className="mb-6">
          <Info className="h-5 w-5" />
          <AlertTitle>기본은 합성 자료 감수</AlertTitle>
          <AlertDescription>
            학생 응답을 다른 AI에 보내는 일은 승인이 있어야 합니다. 승인 기록이 없으면 서버가 실데이터를 거부합니다.
          </AlertDescription>
        </Alert>

        <Card className="mb-6 border-2 border-primary/20">
          <CardHeader>
            <CardTitle className="text-lg">감수 설정</CardTitle>
            <CardDescription>실데이터를 넣으려면 수업ID와 승인번호가 모두 필요합니다.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center gap-3">
              <input
                type="checkbox"
                id="useRealData"
                checked={useRealData}
                onChange={(e) => setUseRealData(e.target.checked)}
                className="h-4 w-4"
              />
              <label htmlFor="useRealData" className="text-sm font-medium">
                승인된 실데이터 포함
              </label>
            </div>
            {useRealData && (
              <div className="grid gap-3 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="classResearchId">수업ID</Label>
                  <Input
                    id="classResearchId"
                    value={classResearchId}
                    onChange={(e) => setClassResearchId(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="approvalId">승인번호</Label>
                  <Input
                    id="approvalId"
                    value={approvalId}
                    onChange={(e) => setApprovalId(e.target.value)}
                  />
                </div>
              </div>
            )}
            <Button
              onClick={() => void handleRunAudit()}
              disabled={isRunning}
              className="w-full font-bold h-12 text-lg"
              size="lg"
            >
              {isRunning
                ? <><Loader2 className="mr-2 h-5 w-5 animate-spin" />감수 중...</>
                : <><Bot className="mr-2 h-5 w-5" />감수 시작</>
              }
            </Button>
          </CardContent>
        </Card>

        {error && (
          <Alert className="mb-6 border-2 border-destructive/30 bg-destructive/5">
            <AlertTriangle className="h-5 w-5 text-destructive" />
            <AlertTitle className="font-bold text-destructive">실행하지 못했습니다</AlertTitle>
            <AlertDescription className="mt-1">{error}</AlertDescription>
          </Alert>
        )}

        {isRunning && (
          <div className="space-y-4">
            <Skeleton className="h-32 w-full rounded-2xl" />
            <Skeleton className="h-24 w-full rounded-2xl" />
          </div>
        )}

        {auditResult && !isRunning && (
          <div className="space-y-6">
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

            <Alert className="border-2 border-destructive/30 bg-destructive/5">
              <AlertTriangle className="h-5 w-5 text-destructive" />
              <AlertTitle className="font-bold text-destructive">최우선 개선 과제</AlertTitle>
              <AlertDescription className="text-base mt-1">{auditResult.topPriority}</AlertDescription>
            </Alert>

            {auditResult.dataInsights && (
              <Alert className="border-2 border-blue-200 bg-blue-50/50">
                <Info className="h-5 w-5 text-blue-600" />
                <AlertTitle className="font-bold text-blue-700">자료에서 본 패턴</AlertTitle>
                <AlertDescription className="text-base mt-1 text-blue-800">{auditResult.dataInsights}</AlertDescription>
              </Alert>
            )}

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

            <Button variant="outline" onClick={() => void handleRunAudit()} className="w-full">
              <RefreshCw className="mr-2 h-4 w-4" />다시 감수하기
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
