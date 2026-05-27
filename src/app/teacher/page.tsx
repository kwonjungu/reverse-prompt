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
import { GraduationCap, ArrowLeft, Printer, Trash2, Search, ClipboardList } from 'lucide-react';
import { useToast } from "@/hooks/use-toast";
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';

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

  const { data: submissions, loading } = useCollection(submissionsQuery);

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

  const handlePrint = () => {
    window.print();
  };

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
            {activeClassCode}반 프롬프트 결과지
          </h1>
          <p className="text-muted-foreground font-body">학생들이 제출한 프롬프트 엔지니어링 학습 결과입니다.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setActiveClassCode(null)}>
            <Search className="mr-2 h-4 w-4" /> 다른 학급 찾기
          </Button>
          <Button onClick={handlePrint} className="font-bold">
            <Printer className="mr-2 h-4 w-4" /> 전체 인쇄하기
          </Button>
        </div>
      </header>

      <main className="container mx-auto max-w-6xl space-y-6">
        {loading ? (
          <div className="space-y-4">
            <Skeleton className="h-40 w-full rounded-2xl" />
            <Skeleton className="h-40 w-full rounded-2xl" />
          </div>
        ) : !submissions || submissions.length === 0 ? (
          <Card className="p-12 text-center text-muted-foreground rounded-2xl border-2 border-dashed">
            아직 제출된 결과가 없습니다.
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
                        <TableHead className="font-bold">작성한 프롬프트</TableHead>
                        <TableHead className="w-[100px] text-right font-bold">점수</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {sub.results.map((res: any, idx: number) => (
                        <TableRow key={idx}>
                          <TableCell className="font-bold text-lg">{idx + 1}</TableCell>
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
      </main>

      <style jsx global>{`
        @media print {
          .no-print { display: none !important; }
          body { background: white !important; color: black !important; padding: 0 !important; }
          .container { max-width: 100% !important; padding: 0 !important; margin: 0 !important; }
          .card { border: 1px solid #ddd !important; margin-bottom: 2rem !important; break-inside: avoid; border-radius: 0 !important; }
          .bg-muted/30 { background-color: #f3f4f6 !important; -webkit-print-color-adjust: exact; }
          .text-primary { color: #7c3aed !important; -webkit-print-color-adjust: exact; }
        }
      `}</style>
    </div>
  );
}
