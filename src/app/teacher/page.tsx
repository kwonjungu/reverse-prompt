'use client';

/**
 * 교사·연구자 대시보드.
 *
 * 예전에는 학급코드만 입력하면 클라이언트가 Firestore를 직접 조회·삭제했다.
 * 이제는 서버 인증을 거쳐 서버가 배정한 학급만 목록으로 받고, 조회·삭제도
 * 서버 액션이 소속 권한을 확인한 뒤에만 수행한다.
 *
 * 연구자에게는 비식별 읽기만 준다. 삭제 단추는 교사에게만 보이며, 보이지 않는 것과
 * 별개로 서버가 다시 거부한다.
 *
 * 차시 개방·폐쇄와 검사 세션 열기·닫기도 여기서 한다(설계서 §4·§5, 수용시험 6).
 * 점수나 완료 문항 수는 개방 조건이 아니다. 완료 수는 정보로만 보여 준다.
 * 공통 루브릭은 사본을 만들지 않고 단일 버전 리소스(src/lib/rubric.ts)에서 그대로 낸다(설계서 §2).
 *
 * 대응 문서: 프로그램_수정_프롬프트설계서_v7 §2·§4·§5·§6, 수용시험 6·11
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { signInWithEmailAndPassword } from 'firebase/auth';
import { useAuth } from '@/firebase';
import { postStaffSession, clearStaffSession } from '@/firebase/auth/staff-session';
import {
  loadStaffContext,
  loadLessonRecords,
  deleteLessonRecord,
  loadResearchRecords,
} from '@/server/auth/class-data-actions';
import {
  openLessonAction,
  closeLessonAction,
  type OpenLessonResult,
} from '@/server/lessons/actions';
import {
  openAssessmentSession,
  closeAssessmentSession,
  finalizeTimeouts,
} from '@/server/assessment/actions';
import { renderForTeacher, RUBRIC_VERSION } from '@/lib/rubric';
import { PII_NOTICE } from '@/server/privacy';
import type { Band } from '@/lib/scoring';
import type { AssessmentPhase } from '@/lib/research/types';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Textarea } from '@/components/ui/textarea';
import { GraduationCap, ArrowLeft, Printer, Trash2, ClipboardList, TrendingUp, ShieldCheck, LogOut, CalendarClock, BookOpenCheck } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';

type StaffContext = Awaited<ReturnType<typeof loadStaffContext>>;
type LessonRecords = Awaited<ReturnType<typeof loadLessonRecords>>;
type ResearchRecords = Awaited<ReturnType<typeof loadResearchRecords>>;

type PracticeAttempt = {
  id: string;
  attendanceNumber?: string;
  questionIndex?: number;
  questionLevel?: number;
  questionTitle?: string;
  studentPrompt?: string;
  score?: number | null;
  createdAt?: string | null;
};

export default function TeacherPage() {
  const firebaseAuth = useAuth();
  const { toast } = useToast();

  const [context, setContext] = useState<StaffContext | null>(null);
  const [checking, setChecking] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [signingIn, setSigningIn] = useState(false);

  const [activeClassCode, setActiveClassCode] = useState('');
  const [activeResearchClass, setActiveResearchClass] = useState('');
  const [lesson, setLesson] = useState<LessonRecords | null>(null);
  const [research, setResearch] = useState<ResearchRecords | null>(null);
  const [loadingData, setLoadingData] = useState(false);

  /* 차시 개방·폐쇄 — 점수·완료 수는 조건이 아니다. */
  const [lessonNumber, setLessonNumber] = useState('1');
  const [lessonReason, setLessonReason] = useState('');
  const [lessonResult, setLessonResult] = useState<OpenLessonResult | null>(null);
  const [lessonBusy, setLessonBusy] = useState(false);

  /* 검사 세션 — 열기·닫기와 미제출 칸 마감. */
  const [assessmentPhase, setAssessmentPhase] = useState<AssessmentPhase>('pre');
  const [assessmentSessionId, setAssessmentSessionId] = useState('');
  const [assessmentNotice, setAssessmentNotice] = useState<string | null>(null);
  const [assessmentBlockers, setAssessmentBlockers] = useState<string[]>([]);
  const [assessmentBusy, setAssessmentBusy] = useState(false);

  /* 공통 루브릭 — 사본이 아니라 단일 버전 리소스에서 낸다. */
  const [rubricBand, setRubricBand] = useState<Band>('A');

  const refreshContext = useCallback(async () => {
    setChecking(true);
    try {
      const ctx = await loadStaffContext();
      setContext(ctx);
    } catch {
      setContext(null);
    } finally {
      setChecking(false);
    }
  }, []);

  useEffect(() => {
    void refreshContext();
  }, [refreshContext]);

  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!firebaseAuth) return;
    setSigningIn(true);
    try {
      const credential = await signInWithEmailAndPassword(firebaseAuth, email.trim(), password);
      const idToken = await credential.user.getIdToken();
      await postStaffSession(idToken);
      setPassword('');
      await refreshContext();
    } catch {
      // 실패 사유를 세분해서 알리지 않는다(계정 존재 여부 노출 방지).
      toast({ variant: 'destructive', title: '로그인 실패', description: '계정 정보를 확인해 주세요.' });
    } finally {
      setSigningIn(false);
    }
  };

  const handleSignOut = async () => {
    await clearStaffSession();
    setContext(null);
    setLesson(null);
    setResearch(null);
    setActiveClassCode('');
    setActiveResearchClass('');
  };

  const openLessonClass = async (classCode: string) => {
    setActiveClassCode(classCode);
    setLoadingData(true);
    try {
      setLesson(await loadLessonRecords(classCode));
    } catch (err) {
      setLesson(null);
      toast({ variant: 'destructive', title: '조회 실패', description: String((err as Error)?.message ?? '') });
    } finally {
      setLoadingData(false);
    }
  };

  const openResearchClass = async (classResearchId: string) => {
    setActiveResearchClass(classResearchId);
    setLoadingData(true);
    try {
      setResearch(await loadResearchRecords(classResearchId));
    } catch (err) {
      setResearch(null);
      toast({ variant: 'destructive', title: '조회 실패', description: String((err as Error)?.message ?? '') });
    } finally {
      setLoadingData(false);
    }
  };

  const handleDeletePractice = async (id: string) => {
    if (!activeClassCode) return;
    if (!confirm('이 도전 기록을 삭제할까요?')) return;
    try {
      await deleteLessonRecord(activeClassCode, 'practice_attempts', id);
      toast({ title: '삭제 완료' });
      await openLessonClass(activeClassCode);
    } catch {
      toast({ variant: 'destructive', title: '삭제 실패' });
    }
  };

  const handleDeleteSubmission = async (id: string) => {
    if (!activeClassCode) return;
    if (!confirm('이 기록을 정말 삭제할까요?')) return;
    try {
      await deleteLessonRecord(activeClassCode, 'submissions', id);
      toast({ title: '삭제 완료' });
      await openLessonClass(activeClassCode);
    } catch {
      toast({ variant: 'destructive', title: '삭제 실패' });
    }
  };

  /* ─────────── 차시 개방·폐쇄 ───────────
   * 서버 액션이 교사 권한을 다시 확인한다. 화면은 요청만 보낸다.
   * 학생의 점수·완료 문항 수를 조건으로 쓰지 않는다.
   */
  const requireResearchClass = (): string | null => {
    if (!activeResearchClass) {
      toast({
        variant: 'destructive',
        title: '수업ID를 먼저 고르세요',
        description: '위에서 연구 학급(수업ID)을 선택해 주세요.',
      });
      return null;
    }
    return activeResearchClass;
  };

  const handleOpenLesson = async () => {
    const classResearchId = requireResearchClass();
    if (!classResearchId) return;
    setLessonBusy(true);
    try {
      const res = await openLessonAction({
        classResearchId,
        lesson: Number(lessonNumber),
        reason: lessonReason.trim() || null,
      });
      setLessonResult(res);
      toast(
        res.ok
          ? { title: `${lessonNumber}차시를 열었습니다` }
          : { variant: 'destructive', title: '열지 못했습니다', description: res.error ?? '' }
      );
    } catch (err) {
      setLessonResult(null);
      toast({ variant: 'destructive', title: '열지 못했습니다', description: String((err as Error)?.message ?? '') });
    } finally {
      setLessonBusy(false);
    }
  };

  const handleCloseLesson = async (scope: 'one' | 'all') => {
    const classResearchId = requireResearchClass();
    if (!classResearchId) return;
    setLessonBusy(true);
    try {
      const res = await closeLessonAction({
        classResearchId,
        lesson: scope === 'one' ? Number(lessonNumber) : undefined,
        reason: lessonReason.trim() || null,
      });
      setLessonResult(res);
      toast(
        res.ok
          ? { title: scope === 'one' ? `${lessonNumber}차시를 닫았습니다` : '수업을 닫았습니다' }
          : { variant: 'destructive', title: '닫지 못했습니다', description: res.error ?? '' }
      );
    } catch (err) {
      setLessonResult(null);
      toast({ variant: 'destructive', title: '닫지 못했습니다', description: String((err as Error)?.message ?? '') });
    } finally {
      setLessonBusy(false);
    }
  };

  /* ─────────── 검사 세션 ─────────── */
  const handleOpenAssessment = async () => {
    const classResearchId = requireResearchClass();
    if (!classResearchId) return;
    setAssessmentBusy(true);
    setAssessmentBlockers([]);
    try {
      const res = await openAssessmentSession(classResearchId, assessmentPhase);
      if (res.ok && res.assessmentSessionId) {
        setAssessmentSessionId(res.assessmentSessionId);
        setAssessmentNotice(`${assessmentPhase === 'pre' ? '사전' : '사후'} 검사를 열었습니다.`);
      } else {
        setAssessmentBlockers(res.blockers ?? []);
        setAssessmentNotice('아직 검사를 열 수 없습니다. 아래 미확정 항목을 확인해 주세요.');
      }
    } catch (err) {
      setAssessmentNotice(String((err as Error)?.message ?? '검사를 열지 못했습니다.'));
    } finally {
      setAssessmentBusy(false);
    }
  };

  const handleCloseAssessment = async () => {
    if (!assessmentSessionId.trim()) return;
    setAssessmentBusy(true);
    try {
      const res = await closeAssessmentSession(assessmentSessionId.trim());
      setAssessmentNotice(res.ok ? '검사를 닫았습니다.' : '닫지 못했습니다. 검사 번호를 확인해 주세요.');
    } catch (err) {
      setAssessmentNotice(String((err as Error)?.message ?? '닫지 못했습니다.'));
    } finally {
      setAssessmentBusy(false);
    }
  };

  /**
   * 시간이 끝났는데 제출되지 않은 칸을 결측으로 확정한다.
   * 화면에 남아 있던 초안 텍스트는 넘기지 않는다. 대상 연구ID만 보낸다.
   */
  const handleFinalizeTimeouts = async () => {
    if (!assessmentSessionId.trim()) return;
    if (!researchIds.length) {
      setAssessmentNotice('마감할 대상이 없습니다. 먼저 연구 자료를 불러와 주세요.');
      return;
    }
    if (!confirm('제출되지 않은 칸을 결측으로 확정할까요? 되돌릴 수 없습니다.')) return;
    setAssessmentBusy(true);
    try {
      const res = await finalizeTimeouts(assessmentSessionId.trim(), researchIds);
      setAssessmentNotice(
        res.ok ? `미제출 칸 ${res.created}개를 결측으로 남겼습니다.` : '마감하지 못했습니다.'
      );
    } catch (err) {
      setAssessmentNotice(String((err as Error)?.message ?? '마감하지 못했습니다.'));
    } finally {
      setAssessmentBusy(false);
    }
  };

  // 연습 기록을 학생 → 문제 → 시간순으로 묶는다.
  const practiceGrouped = useMemo(() => {
    const byStudent: Record<string, Record<number, PracticeAttempt[]>> = {};
    for (const raw of (lesson?.practiceAttempts ?? []) as PracticeAttempt[]) {
      const student = raw.attendanceNumber ?? '-';
      const question = raw.questionIndex ?? 0;
      if (!byStudent[student]) byStudent[student] = {};
      if (!byStudent[student][question]) byStudent[student][question] = [];
      byStudent[student][question].push(raw);
    }
    return byStudent;
  }, [lesson]);

  const sortedStudents = useMemo(
    () => Object.keys(practiceGrouped).sort((a, b) => Number(a) - Number(b)),
    [practiceGrouped]
  );

  /** 불러온 연구 자료에 들어 있는 연구ID. 미제출 칸 마감의 대상 목록으로만 쓴다. */
  const researchIds = useMemo(() => {
    const ids = new Set<string>();
    for (const record of research?.records ?? []) {
      const id = (record as Record<string, unknown>).researchId;
      if (typeof id === 'string' && id) ids.add(id);
    }
    return Array.from(ids).sort();
  }, [research]);

  /**
   * 연구ID별 제출 문항 수.
   * 정보 표시용이다. 차시 개방의 조건이 아니며 이 수로 학생을 막지 않는다.
   */
  const submittedCounts = useMemo(() => {
    const counts = new Map<string, Set<string>>();
    for (const record of research?.records ?? []) {
      const r = record as Record<string, unknown>;
      const id = typeof r.researchId === 'string' ? r.researchId : null;
      const questionId = typeof r.questionId === 'string' ? r.questionId : null;
      if (!id || !questionId) continue;
      if (r.responseStatus && r.responseStatus !== 'submitted') continue;
      if (!counts.has(id)) counts.set(id, new Set());
      counts.get(id)!.add(questionId);
    }
    return Array.from(counts.entries())
      .map(([researchId, set]) => ({ researchId, count: set.size }))
      .sort((a, b) => a.researchId.localeCompare(b.researchId));
  }, [research]);

  if (checking) {
    return (
      <div className="min-h-screen bg-background p-8">
        <Skeleton className="h-40 w-full max-w-xl mx-auto rounded-2xl" />
      </div>
    );
  }

  if (!context) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <main className="max-w-md w-full">
          <Card className="shadow-2xl border-2 border-primary/20">
            <CardHeader className="text-center">
              <GraduationCap className="h-12 w-12 mx-auto text-primary mb-2" />
              <CardTitle className="text-2xl font-headline">교사·연구자 로그인</CardTitle>
              <CardDescription>
                학급 자료는 배정된 계정으로만 볼 수 있습니다. 학급 코드만으로는 열리지 않습니다.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleSignIn} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="staff-email">계정</Label>
                  <Input
                    id="staff-email"
                    type="email"
                    autoComplete="username"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="h-12"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="staff-password">비밀번호</Label>
                  <Input
                    id="staff-password"
                    type="password"
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="h-12"
                  />
                </div>
                <Button type="submit" className="w-full h-12 font-bold" disabled={signingIn || !firebaseAuth}>
                  로그인
                </Button>
                <Link href="/" className="block text-center text-sm text-muted-foreground hover:text-primary">
                  <ArrowLeft className="inline mr-2 h-4 w-4" /> 홈으로 돌아가기
                </Link>
              </form>
            </CardContent>
          </Card>
        </main>
      </div>
    );
  }

  const isTeacher = context.role === 'teacher';

  return (
    <div className="min-h-screen bg-background p-4 md:p-8 font-sans">
      <header className="container mx-auto max-w-6xl mb-6 flex flex-col md:flex-row justify-between items-start md:items-center gap-4 no-print">
        <div>
          <h1 className="text-3xl font-black flex items-center gap-3 font-headline">
            <ClipboardList className="h-8 w-8 text-primary" />
            학급 자료
          </h1>
          <p className="text-muted-foreground font-body">
            역할: {isTeacher ? '교사' : '연구자'} · 배정된 학급만 표시합니다.
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Button variant="outline" onClick={() => window.print()}>
            <Printer className="mr-2 h-4 w-4" /> 인쇄
          </Button>
          <Button variant="ghost" onClick={handleSignOut}>
            <LogOut className="mr-2 h-4 w-4" /> 로그아웃
          </Button>
        </div>
      </header>

      <main className="container mx-auto max-w-6xl space-y-6">
        <Card className="no-print">
          <CardHeader>
            <CardTitle className="text-lg">학급 선택</CardTitle>
            <CardDescription>
              목록은 서버가 계정에 배정한 학급입니다. 다른 학급은 서버가 거부합니다.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 md:grid-cols-2">
            {isTeacher && (
              <div className="space-y-2">
                <Label>수업 기록 학급</Label>
                <Select value={activeClassCode} onValueChange={(v) => void openLessonClass(v)}>
                  <SelectTrigger className="h-12">
                    <SelectValue placeholder={context.classCodes.length ? '학급 선택' : '배정된 학급 없음'} />
                  </SelectTrigger>
                  <SelectContent>
                    {context.classCodes.map((code) => (
                      <SelectItem key={code} value={code}>{code}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="space-y-2">
              <Label>연구 학급(수업ID)</Label>
              <Select value={activeResearchClass} onValueChange={(v) => void openResearchClass(v)}>
                <SelectTrigger className="h-12">
                  <SelectValue placeholder={context.classResearchIds.length ? '수업ID 선택' : '배정된 수업ID 없음'} />
                </SelectTrigger>
                <SelectContent>
                  {context.classResearchIds.map((id) => (
                    <SelectItem key={id} value={id}>{id}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>

        <Tabs defaultValue="schedule" className="space-y-6">
          <TabsList className="grid w-full grid-cols-2 max-w-3xl no-print sm:grid-cols-5">
            <TabsTrigger value="schedule"><CalendarClock className="mr-2 h-4 w-4" /> 수업 운영</TabsTrigger>
            <TabsTrigger value="rubric"><BookOpenCheck className="mr-2 h-4 w-4" /> 채점 기준</TabsTrigger>
            <TabsTrigger value="practice"><TrendingUp className="mr-2 h-4 w-4" /> 연습 기록</TabsTrigger>
            <TabsTrigger value="exam"><ClipboardList className="mr-2 h-4 w-4" /> 시험 결과</TabsTrigger>
            <TabsTrigger value="research"><ShieldCheck className="mr-2 h-4 w-4" /> 연구 자료</TabsTrigger>
          </TabsList>

          {/* 차시 개방·폐쇄와 검사 세션. 수용시험 6을 교사가 실제로 수행하는 자리다. */}
          <TabsContent value="schedule" className="space-y-6">
            {!isTeacher ? (
              <Alert>
                <AlertTitle>연구자 계정</AlertTitle>
                <AlertDescription>수업 일정 관리는 교사 계정에서 합니다.</AlertDescription>
              </Alert>
            ) : (
              <>
                <Card className="rounded-2xl">
                  <CardHeader>
                    <CardTitle className="text-lg">차시 열기 · 닫기</CardTitle>
                    <CardDescription>
                      고른 수업ID({activeResearchClass || '미선택'})의 차시를 엽니다. 학생의
                      <strong> 점수나 완료 문항 수는 개방 조건이 아닙니다.</strong> 1차시를 두 문항만
                      한 학생도 2차시를 열면 들어옵니다. 아래 완료 수는 정보로만 보여 주는 값입니다.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="grid gap-4 md:grid-cols-2">
                      <div className="space-y-2">
                        <Label>차시</Label>
                        <Select value={lessonNumber} onValueChange={setLessonNumber}>
                          <SelectTrigger className="h-12">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {[1, 2, 3, 4, 5, 6].map((n) => (
                              <SelectItem key={n} value={String(n)}>{n}차시</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="lesson-reason">사유 (기록에 남습니다, 선택)</Label>
                        <Input
                          id="lesson-reason"
                          value={lessonReason}
                          onChange={(e) => setLessonReason(e.target.value)}
                          placeholder="예: 3월 2주 정규 수업"
                          className="h-12"
                        />
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button onClick={() => void handleOpenLesson()} disabled={lessonBusy}>
                        {lessonNumber}차시 열기
                      </Button>
                      <Button variant="outline" onClick={() => void handleCloseLesson('one')} disabled={lessonBusy}>
                        {lessonNumber}차시만 닫기
                      </Button>
                      <Button variant="outline" onClick={() => void handleCloseLesson('all')} disabled={lessonBusy}>
                        수업 전체 닫기
                      </Button>
                    </div>

                    {lessonResult && (
                      <Alert className={lessonResult.ok ? '' : 'border-destructive/40'}>
                        <AlertTitle>
                          {lessonResult.ok ? '지금 열린 차시' : '처리하지 못했습니다'}
                        </AlertTitle>
                        <AlertDescription className="space-y-1">
                          {lessonResult.ok ? (
                            <>
                              <p>
                                열린 차시:{' '}
                                {lessonResult.allowedLessons.length
                                  ? lessonResult.allowedLessons.map((n) => `${n}차시`).join(', ')
                                  : '없음'}
                                {lessonResult.currentLesson !== null &&
                                  ` · 현재 ${lessonResult.currentLesson}차시`}
                              </p>
                              {!lessonResult.durable && (
                                <p className="text-destructive">
                                  {lessonResult.error ??
                                    '서버 저장소에 남기지 못했습니다. 연구 운영에 쓰지 마세요.'}
                                </p>
                              )}
                            </>
                          ) : (
                            <p>{lessonResult.error}</p>
                          )}
                        </AlertDescription>
                      </Alert>
                    )}
                    <p className="text-xs text-muted-foreground">
                      이 칸은 방금 처리한 결과를 보여 줍니다. 다른 기기에서 바꾼 상태를 다시 읽어
                      오려면 차시를 한 번 더 열어 확인해 주세요.
                    </p>
                  </CardContent>
                </Card>

                <Card className="rounded-2xl">
                  <CardHeader>
                    <CardTitle className="text-lg">사전 · 사후 검사</CardTitle>
                    <CardDescription>
                      검사 화면은 점수·피드백을 보여 주지 않습니다. 미확정 항목이 있으면 서버가
                      열어 주지 않습니다.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="grid gap-4 md:grid-cols-2">
                      <div className="space-y-2">
                        <Label>시점</Label>
                        <Select
                          value={assessmentPhase}
                          onValueChange={(v) => setAssessmentPhase(v as AssessmentPhase)}
                        >
                          <SelectTrigger className="h-12">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="pre">사전 검사</SelectItem>
                            <SelectItem value="post">사후 검사</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="assessment-session">검사 번호</Label>
                        <Input
                          id="assessment-session"
                          value={assessmentSessionId}
                          onChange={(e) => setAssessmentSessionId(e.target.value)}
                          placeholder="검사를 열면 자동으로 채워집니다"
                          className="h-12"
                        />
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button onClick={() => void handleOpenAssessment()} disabled={assessmentBusy}>
                        검사 열기
                      </Button>
                      <Button
                        variant="outline"
                        onClick={() => void handleCloseAssessment()}
                        disabled={assessmentBusy || !assessmentSessionId.trim()}
                      >
                        검사 닫기
                      </Button>
                      <Button
                        variant="outline"
                        onClick={() => void handleFinalizeTimeouts()}
                        disabled={assessmentBusy || !assessmentSessionId.trim()}
                      >
                        미제출 칸 마감
                      </Button>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      미제출 칸 마감은 시간이 끝났는데 내지 않은 칸을 결측으로 남깁니다. 학생 화면에
                      남아 있던 초안은 넘기지 않으므로 초안이 응답으로 확정되지 않습니다. 대상은
                      불러온 연구 자료의 참가자 {researchIds.length}명입니다.
                    </p>
                    {assessmentNotice && (
                      <Alert className={assessmentBlockers.length ? 'border-destructive/40' : ''}>
                        <AlertTitle>안내</AlertTitle>
                        <AlertDescription className="space-y-1">
                          <p>{assessmentNotice}</p>
                          {assessmentBlockers.length > 0 && (
                            <ul className="list-disc pl-5">
                              {assessmentBlockers.map((b) => (
                                <li key={b}>{b}</li>
                              ))}
                            </ul>
                          )}
                        </AlertDescription>
                      </Alert>
                    )}
                  </CardContent>
                </Card>

                <Card className="rounded-2xl">
                  <CardHeader>
                    <CardTitle className="text-lg">제출 문항 수 (정보)</CardTitle>
                    <CardDescription>
                      개방 조건이 아닙니다. 이 수가 적어도 다음 차시에 들어갈 수 있습니다.
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    {submittedCounts.length === 0 ? (
                      <p className="text-sm text-muted-foreground">
                        불러온 연구 자료가 없습니다. 위에서 수업ID를 고르면 표시합니다.
                      </p>
                    ) : (
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>참가자(연구ID)</TableHead>
                            <TableHead className="text-right">제출 문항 수</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {submittedCounts.map((row) => (
                            <TableRow key={row.researchId}>
                              <TableCell className="font-mono text-xs">{row.researchId}</TableCell>
                              <TableCell className="text-right tabular-nums">{row.count}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    )}
                  </CardContent>
                </Card>
              </>
            )}
          </TabsContent>

          {/* 공통 루브릭 — 사본을 손으로 옮겨 적지 않고 단일 버전 리소스에서 그대로 낸다. */}
          <TabsContent value="rubric" className="space-y-4">
            <Card className="rounded-2xl">
              <CardHeader>
                <CardTitle className="text-lg">공통 루브릭 {RUBRIC_VERSION}</CardTitle>
                <CardDescription>
                  AI 채점 지시문·이 화면·내보내기 문서가 모두 같은 원본에서 나옵니다. 문항별 단서와
                  수준 경계는 문항 명세를 함께 적용합니다.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="max-w-xs space-y-2 no-print">
                  <Label>밴드</Label>
                  <Select value={rubricBand} onValueChange={(v) => setRubricBand(v as Band)}>
                    <SelectTrigger className="h-12">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="A">A밴드 (Lv.1~12)</SelectItem>
                      <SelectItem value="B">B밴드 (Lv.13~24)</SelectItem>
                      <SelectItem value="C">C밴드 (Lv.25~36)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <Textarea
                  readOnly
                  value={renderForTeacher(rubricBand)}
                  className="min-h-[420px] font-body text-sm leading-relaxed"
                />
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="practice" className="space-y-6">
            {!isTeacher ? (
              <Alert>
                <AlertTitle>연구자 계정</AlertTitle>
                <AlertDescription>수업 기록은 연구 저장소와 분리되어 있어 열람 대상이 아닙니다.</AlertDescription>
              </Alert>
            ) : loadingData ? (
              <Skeleton className="h-40 w-full rounded-2xl" />
            ) : sortedStudents.length === 0 ? (
              <Card className="p-12 text-center text-muted-foreground rounded-2xl border-2 border-dashed">
                표시할 연습 기록이 없습니다.
              </Card>
            ) : (
              sortedStudents.map((studentNum) => {
                const qMap = practiceGrouped[studentNum];
                const questions = Object.keys(qMap).map(Number).sort((a, b) => a - b);
                return (
                  <Card key={studentNum} className="border-2 rounded-2xl bg-card/50 print:break-inside-avoid">
                    <CardHeader className="bg-muted/30 border-b p-5">
                      <Badge variant="outline" className="text-lg py-1 px-4 bg-background w-fit">
                        {studentNum}번
                      </Badge>
                    </CardHeader>
                    <CardContent className="p-5 space-y-6">
                      {questions.map((qIdx) => {
                        const attempts = qMap[qIdx];
                        return (
                          <div key={qIdx} className="border rounded-xl p-4 bg-background/60">
                            <p className="text-sm font-medium mb-3">
                              문제 {qIdx + 1} {attempts[0]?.questionTitle ?? ''}
                            </p>
                            <Table>
                              <TableHeader>
                                <TableRow>
                                  <TableHead className="w-[80px] font-bold">차수</TableHead>
                                  <TableHead className="font-bold">학생 응답</TableHead>
                                  <TableHead className="w-[90px] text-right font-bold">점수</TableHead>
                                  <TableHead className="w-[40px] no-print"></TableHead>
                                </TableRow>
                              </TableHeader>
                              <TableBody>
                                {attempts.map((att, i) => (
                                  <TableRow key={att.id}>
                                    <TableCell className="font-bold">{i + 1}차</TableCell>
                                    <TableCell className="whitespace-pre-wrap py-3 leading-relaxed">
                                      {att.studentPrompt ?? ''}
                                    </TableCell>
                                    {/* 결측은 0점이 아니다. 점수가 없으면 '기록 없음'으로 둔다. */}
                                    <TableCell className="text-right font-black text-primary text-lg">
                                      {typeof att.score === 'number' ? att.score : '기록 없음'}
                                    </TableCell>
                                    <TableCell className="no-print">
                                      <Button
                                        variant="ghost"
                                        size="icon"
                                        onClick={() => void handleDeletePractice(att.id)}
                                        className="text-destructive/60 hover:bg-destructive/10 h-8 w-8"
                                      >
                                        <Trash2 className="h-4 w-4" />
                                      </Button>
                                    </TableCell>
                                  </TableRow>
                                ))}
                              </TableBody>
                            </Table>
                          </div>
                        );
                      })}
                    </CardContent>
                  </Card>
                );
              })
            )}
          </TabsContent>

          <TabsContent value="exam" className="space-y-6">
            {!isTeacher ? (
              <Alert>
                <AlertTitle>연구자 계정</AlertTitle>
                <AlertDescription>수업 기록은 열람 대상이 아닙니다.</AlertDescription>
              </Alert>
            ) : !lesson || lesson.submissions.length === 0 ? (
              <Card className="p-12 text-center text-muted-foreground rounded-2xl border-2 border-dashed">
                표시할 결과가 없습니다.
              </Card>
            ) : (
              <div className="grid gap-6">
                {(lesson.submissions as Record<string, unknown>[]).map((sub) => (
                  <Card key={String(sub.id)} className="border-2 rounded-2xl bg-card/50">
                    <CardHeader className="bg-muted/30 border-b flex flex-row items-center justify-between p-5">
                      <Badge variant="outline" className="text-lg py-1 px-4 bg-background">
                        {String(sub.attendanceNumber ?? '-')}번
                      </Badge>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => void handleDeleteSubmission(String(sub.id))}
                        className="no-print text-destructive hover:bg-destructive/10"
                      >
                        <Trash2 className="h-5 w-5" />
                      </Button>
                    </CardHeader>
                    <CardContent className="p-5">
                      <pre className="text-sm whitespace-pre-wrap font-body">
                        {JSON.stringify(sub.results ?? [], null, 2)}
                      </pre>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </TabsContent>

          <TabsContent value="research" className="space-y-4">
            <Alert>
              <ShieldCheck className="h-5 w-5" />
              <AlertTitle>비식별 읽기</AlertTitle>
              <AlertDescription>
                {research?.notice ??
                  '연구ID 자료입니다. 학교명·출석번호·실명 대응표는 포함하지 않습니다.'}
                {' '}삭제 권한은 분리되어 있어 이 화면에서 연구 자료를 지울 수 없습니다.
                <span className="mt-2 block text-xs">{PII_NOTICE}</span>
              </AlertDescription>
            </Alert>
            {loadingData ? (
              <Skeleton className="h-40 w-full rounded-2xl" />
            ) : !research || research.records.length === 0 ? (
              <Card className="p-12 text-center text-muted-foreground rounded-2xl border-2 border-dashed">
                표시할 연구 자료가 없습니다.
              </Card>
            ) : (
              <Card className="rounded-2xl">
                <CardContent className="p-5 overflow-x-auto">
                  <pre className="text-xs whitespace-pre-wrap">
                    {JSON.stringify(research.records, null, 2)}
                  </pre>
                </CardContent>
              </Card>
            )}
          </TabsContent>
        </Tabs>
      </main>

      <style jsx global>{`
        @media print {
          .no-print { display: none !important; }
          body { background: white !important; color: black !important; padding: 0 !important; }
          .container { max-width: 100% !important; padding: 0 !important; margin: 0 !important; }
        }
      `}</style>
    </div>
  );
}
