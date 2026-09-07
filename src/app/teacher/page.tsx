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
 * 대응 문서: 프로그램_수정_프롬프트설계서_v7 §6, 수용시험 11
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
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { GraduationCap, ArrowLeft, Printer, Trash2, ClipboardList, TrendingUp, ShieldCheck, LogOut } from 'lucide-react';
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

        <Tabs defaultValue="practice" className="space-y-6">
          <TabsList className="grid w-full grid-cols-3 max-w-xl no-print">
            <TabsTrigger value="practice"><TrendingUp className="mr-2 h-4 w-4" /> 연습 기록</TabsTrigger>
            <TabsTrigger value="exam"><ClipboardList className="mr-2 h-4 w-4" /> 시험 결과</TabsTrigger>
            <TabsTrigger value="research"><ShieldCheck className="mr-2 h-4 w-4" /> 연구 자료</TabsTrigger>
          </TabsList>

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
