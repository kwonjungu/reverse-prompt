'use client';

import { useState, useMemo } from 'react';
import Link from 'next/link';
import { useFirestore, useCollection } from '@/firebase';
import { collection, query, orderBy, deleteDoc, doc } from 'firebase/firestore';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { GraduationCap, ArrowLeft, Printer, Trash2, Search, ClipboardList, TrendingUp } from 'lucide-react';
import { useToast } from "@/hooks/use-toast";
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';

type PracticeAttempt = {
  id: string;
  attendanceNumber: string;
  questionIndex: number;
  originalPrompt: string;
  studentPrompt: string;
  score: number;
  feedback: string;
  createdAt: any;
};

export default function TeacherPage() {
  const [classCodeInput, setClassCodeInput] = useState('');
  const [activeClassCode, setActiveClassCode] = useState<string | null>(null);
  const db = useFirestore();
  const { toast } = useToast();

  const submissionsQuery = useMemo(() => {
    if (!db || !activeClassCode) return null;
    return query(
      collection(db, 'classes', activeClassCode, 'submissions'),
      orderBy('createdAt', 'desc')
    );
  }, [db, activeClassCode]);

  const practiceQuery = useMemo(() => {
    if (!db || !activeClassCode) return null;
    return query(
      collection(db, 'classes', activeClassCode, 'practice_attempts'),
      orderBy('createdAt', 'asc')
    );
  }, [db, activeClassCode]);

  const { data: submissions, loading } = useCollection(submissionsQuery);
  const { data: practice, loading: practiceLoading } = useCollection(practiceQuery);

  // 연습 기록을 학생 → 문제 → 시간순으로 그룹화
  const practiceGrouped = useMemo(() => {
    if (!practice) return {};
    const byStudent: Record<string, Record<number, PracticeAttempt[]>> = {};
    for (const raw of practice as any[]) {
      const a = raw as PracticeAttempt;
      if (!byStudent[a.attendanceNumber]) byStudent[a.attendanceNumber] = {};
      const qMap = byStudent[a.attendanceNumber];
      if (!qMap[a.questionIndex]) qMap[a.questionIndex] = [];
      qMap[a.questionIndex].push(a);
    }
    return byStudent;
  }, [practice]);

  const sortedStudentNumbers = useMemo(() => {
    return Object.keys(practiceGrouped).sort((a, b) => Number(a) - Number(b));
  }, [practiceGrouped]);

  const handleClassEntry = (e: React.FormEvent) => {
    e.preventDefault();
    if (!classCodeInput.trim()) return;
    setActiveClassCode(classCodeInput.trim());
  };

  const handleDelete = async (id: string) => {
    if (!db || !activeClassCode) return;
    if (confirm('이 기록을 정말 삭제할까요?')) {
      try {
        await deleteDoc(doc(db, 'classes', activeClassCode, 'submissions', id));
        toast({ title: "삭제 완료" });
      } catch (e) {
        toast({ variant: "destructive", title: "삭제 실패" });
      }
    }
  };

  const handleDeletePracticeAttempt = async (id: string) => {
    if (!db || !activeClassCode) return;
    if (confirm('이 도전 기록을 삭제할까요?')) {
      try {
        await deleteDoc(doc(db, 'classes', activeClassCode, 'practice_attempts', id));
        toast({ title: '삭제 완료' });
      } catch {
        toast({ variant: 'destructive', title: '삭제 실패' });
      }
    }
  };

  const handlePrint = () => window.print();

  if (!activeClassCode) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <main className="max-w-md w-full">
          <Card className="shadow-2xl border-2 border-primary/20 bg-card/80 backdrop-blur-sm">
            <CardHeader className="text-center">
              <GraduationCap className="h-12 w-12 mx-auto text-primary mb-2" />
              <CardTitle className="text-3xl font-headline">교사 대시보드</CardTitle>
              <CardDescription>학급 코드를 입력하여 학생들의 결과를 확인하세요.</CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleClassEntry} className="space-y-4">
                <div className="space-y-2">
                  <Label>학급 코드</Label>
                  <Input
                    placeholder="예: 3-1"
                    value={classCodeInput}
                    onChange={(e) => setClassCodeInput(e.target.value)}
                    className="h-12 text-lg"
                  />
                </div>
                <Button type="submit" className="w-full font-bold h-12" size="lg">확인하기</Button>
                <Link href="/" className="block text-center mt-4 text-sm text-muted-foreground hover:text-primary flex items-center justify-center">
                  <ArrowLeft className="mr-2 h-4 w-4" /> 홈으로 돌아가기
                </Link>
              </form>
            </CardContent>
          </Card>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background p-4 md:p-8 font-sans">
      <header className="container mx-auto max-w-6xl mb-8 flex flex-col md:flex-row justify-between items-start md:items-center gap-4 no-print">
        <div>
          <h1 className="text-3xl font-black flex items-center gap-3 font-headline">
            <ClipboardList className="h-8 w-8 text-primary" />
            {activeClassCode}반 결과지
          </h1>
          <p className="text-muted-foreground font-body">학생들의 학습 기록을 확인하세요.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setActiveClassCode(null)}>
            <Search className="mr-2 h-4 w-4" /> 다른 학급
          </Button>
          <Button onClick={handlePrint} className="font-bold">
            <Printer className="mr-2 h-4 w-4" /> 인쇄
          </Button>
        </div>
      </header>

      <main className="container mx-auto max-w-6xl">
        <Tabs defaultValue="practice" className="space-y-6">
          <TabsList className="grid w-full grid-cols-2 max-w-md no-print">
            <TabsTrigger value="practice">
              <TrendingUp className="mr-2 h-4 w-4" /> 연습 기록
            </TabsTrigger>
            <TabsTrigger value="exam">
              <ClipboardList className="mr-2 h-4 w-4" /> 시험 결과
            </TabsTrigger>
          </TabsList>

          {/* 연습 기록 탭: 학생별 · 문제별 · 차수별 변화 */}
          <TabsContent value="practice" className="space-y-6">
            {practiceLoading ? (
              <Skeleton className="h-40 w-full rounded-2xl" />
            ) : sortedStudentNumbers.length === 0 ? (
              <Card className="p-12 text-center text-muted-foreground rounded-2xl border-2 border-dashed">
                아직 연습 도전 기록이 없습니다.
              </Card>
            ) : (
              sortedStudentNumbers.map((studentNum) => {
                const qMap = practiceGrouped[studentNum];
                const sortedQuestions = Object.keys(qMap)
                  .map(Number)
                  .sort((a, b) => a - b);
                const totalAttempts = sortedQuestions.reduce((acc, q) => acc + qMap[q].length, 0);

                return (
                  <Card key={studentNum} className="border-2 rounded-2xl bg-card/50 print:break-inside-avoid">
                    <CardHeader className="bg-muted/30 border-b p-5 flex flex-row items-center justify-between">
                      <div className="flex items-center gap-3">
                        <Badge variant="outline" className="text-lg py-1 px-4 bg-background">
                          {studentNum}번
                        </Badge>
                        <CardDescription className="font-body">
                          문제 {sortedQuestions.length}개 · 도전 총 {totalAttempts}회
                        </CardDescription>
                      </div>
                    </CardHeader>
                    <CardContent className="p-5 space-y-6">
                      {sortedQuestions.map((qIdx) => {
                        const attempts = qMap[qIdx];
                        const firstScore = attempts[0]?.score ?? 0;
                        const lastScore = attempts[attempts.length - 1]?.score ?? 0;
                        const diff = lastScore - firstScore;
                        return (
                          <div key={qIdx} className="border rounded-xl p-4 bg-background/60">
                            <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
                              <div>
                                <p className="text-xs text-muted-foreground font-bold uppercase">문제 {qIdx + 1}</p>
                                <p className="text-sm text-muted-foreground italic">
                                  원본 프롬프트: {attempts[0].originalPrompt}
                                </p>
                              </div>
                              {attempts.length > 1 && (
                                <Badge
                                  variant={diff > 0 ? 'default' : diff < 0 ? 'destructive' : 'secondary'}
                                  className="text-xs"
                                >
                                  {diff > 0 ? `+${diff}` : diff} 점 변화
                                </Badge>
                              )}
                            </div>
                            <Table>
                              <TableHeader>
                                <TableRow>
                                  <TableHead className="w-[80px] font-bold">차수</TableHead>
                                  <TableHead className="font-bold">학생 프롬프트</TableHead>
                                  <TableHead className="w-[80px] text-right font-bold">점수</TableHead>
                                  <TableHead className="w-[40px] no-print"></TableHead>
                                </TableRow>
                              </TableHeader>
                              <TableBody>
                                {attempts.map((att, i) => (
                                  <TableRow key={att.id}>
                                    <TableCell className="font-bold">{i + 1}차</TableCell>
                                    <TableCell className="whitespace-pre-wrap py-3 leading-relaxed">{att.studentPrompt}</TableCell>
                                    <TableCell className="text-right font-black text-primary text-lg">{att.score}</TableCell>
                                    <TableCell className="no-print">
                                      <Button
                                        variant="ghost"
                                        size="icon"
                                        onClick={() => handleDeletePracticeAttempt(att.id)}
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

          {/* 시험 결과 탭: 기존 구조 */}
          <TabsContent value="exam" className="space-y-6">
            {loading ? (
              <Skeleton className="h-40 w-full rounded-2xl" />
            ) : !submissions || submissions.length === 0 ? (
              <Card className="p-12 text-center text-muted-foreground rounded-2xl border-2 border-dashed">
                아직 제출된 시험 결과가 없습니다.
              </Card>
            ) : (
              <div className="grid gap-8 print:gap-12">
                {submissions.map((sub: any) => (
                  <Card key={sub.id} className="overflow-hidden border-2 print:border-none print:shadow-none rounded-2xl bg-card/50">
                    <CardHeader className="bg-muted/30 border-b flex flex-row items-center justify-between p-6">
                      <div className="flex items-center gap-4">
                        <Badge variant="outline" className="text-xl py-1 px-4 bg-background">
                          {sub.attendanceNumber}번
                        </Badge>
                        <div>
                          <CardTitle className="text-2xl font-bold font-headline">{sub.nickname}</CardTitle>
                          <CardDescription className="font-body">
                            {sub.createdAt?.toDate ? new Date(sub.createdAt.toDate()).toLocaleString() : '일시 정보 없음'}
                          </CardDescription>
                        </div>
                      </div>
                      <div className="flex items-center gap-6">
                        <div className="text-right">
                          <p className="text-xs text-muted-foreground uppercase font-bold">{sub.mode === 'game' ? '게임 모드' : '시간 제한'}</p>
                          <p className="text-3xl font-black text-primary">{Math.round(sub.averageScore)}점</p>
                        </div>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleDelete(sub.id)}
                          className="no-print text-destructive hover:bg-destructive/10"
                        >
                          <Trash2 className="h-5 w-5" />
                        </Button>
                      </div>
                    </CardHeader>
                    <CardContent className="p-6">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead className="w-[80px] font-bold">문제</TableHead>
                            <TableHead className="font-bold">원본 프롬프트</TableHead>
                            <TableHead className="font-bold">학생 프롬프트</TableHead>
                            <TableHead className="w-[80px] text-right font-bold">점수</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {sub.results.map((res: any, idx: number) => (
                            <TableRow key={idx}>
                              <TableCell className="font-bold text-lg">{idx + 1}</TableCell>
                              <TableCell className="text-sm text-muted-foreground italic whitespace-pre-wrap py-4">{res.originalPrompt ?? '-'}</TableCell>
                              <TableCell className="whitespace-pre-wrap font-body py-4 leading-relaxed">{res.studentPrompt}</TableCell>
                              <TableCell className="text-right font-black text-primary text-xl">{res.score}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </TabsContent>
        </Tabs>
      </main>

      <style jsx global>{`
        @media print {
          .no-print { display: none !important; }
          body { background: white !important; color: black !important; padding: 0 !important; }
          .container { max-width: 100% !important; padding: 0 !important; margin: 0 !important; }
          .card { border: 1px solid #ddd !important; margin-bottom: 2rem !important; break-inside: avoid; border-radius: 0 !important; }
          .bg-muted\\/30 { background-color: #f3f4f6 !important; -webkit-print-color-adjust: exact; }
          .text-primary { color: #7c3aed !important; -webkit-print-color-adjust: exact; }
        }
      `}</style>
    </div>
  );
}
