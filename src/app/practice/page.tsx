
'use client';

import { useState, useTransition, useMemo, useEffect } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { evaluatePrompt, type EvaluatePromptOutput } from '@/ai/flows/evaluate-prompt';
import { useFirestore, useDoc } from '@/firebase';
import { collection, addDoc, doc, serverTimestamp, setDoc, increment } from 'firebase/firestore';
import { buildImagePrompt } from '@/lib/image-prompt';
import { practiceXp, getTitle } from '@/lib/xp';
import { PRACTICE_QUESTIONS } from '@/lib/questions';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { ArrowRight, Wand2, RefreshCw, BookOpen, Star, Home, RotateCcw } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from "@/hooks/use-toast";
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { getAxisBadge } from '@/lib/badges';

// 문제 목록은 src/lib/questions.ts가 단일 진실 (admin 감수 페이지와 공유)
const questions = PRACTICE_QUESTIONS;

export default function PracticePage() {
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
  const [studentPrompt, setStudentPrompt] = useState('');
  const [evaluation, setEvaluation] = useState<EvaluatePromptOutput | null>(null);
  const [isEvaluating, startEvaluationTransition] = useTransition();
  // attemptCounts: questionIndex → 시도 횟수 (현재 세션 기준)
  const [attemptCounts, setAttemptCounts] = useState<Record<number, number>>({});
  // 방금 채점으로 획득한 XP (피드백 카드에 "+N XP" 표시용). null이면 표시 안 함.
  const [lastEarnedXp, setLastEarnedXp] = useState<number | null>(null);
  const { toast } = useToast();
  const db = useFirestore();

  // 학생 식별자 (없으면 XP 저장·표시 스킵). sessionStorage는 클라이언트에서만 접근 가능.
  const [classCode, setClassCode] = useState<string | null>(null);
  const [attendanceNumber, setAttendanceNumber] = useState<string | null>(null);
  useEffect(() => {
    setClassCode(sessionStorage.getItem('classCode'));
    setAttendanceNumber(sessionStorage.getItem('attendanceNumber'));
  }, []);

  // 학생 XP 문서 실시간 구독 (classCode/attendanceNumber 없으면 null → 구독 안 함)
  const studentDocRef = useMemo(() => {
    if (!db || !classCode || !attendanceNumber) return null;
    return doc(db, 'classes', classCode, 'students', attendanceNumber);
  }, [db, classCode, attendanceNumber]);
  const { data: studentData } = useDoc<{ xp?: number }>(studentDocRef);
  const currentXp = studentData?.xp ?? 0;
  const currentTitle = getTitle(currentXp);

  const isPending = isEvaluating;
  const currentQuestion = questions[currentQuestionIndex];
  const currentAttempts = attemptCounts[currentQuestionIndex] ?? 0;

  useEffect(() => {
    setEvaluation(null);
    setStudentPrompt('');
    setLastEarnedXp(null);
  }, [currentQuestionIndex]);

  const toDataURL = async (url: string): Promise<string> => {
    if (url.startsWith('data:')) return url;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Failed to fetch image: ${res.statusText}`);
    const blob = await res.blob();
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  };

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!studentPrompt.trim()) {
      toast({ variant: 'destructive', title: '프롬프트가 비어 있습니다', description: '이미지에 대한 설명을 작성해 주세요.' });
      return;
    }
    setEvaluation(null);

    startEvaluationTransition(async () => {
      try {
        const photoDataUri = await toDataURL(currentQuestion.imageUrl);
        const result = await evaluatePrompt({ studentPrompt, photoDataUri, questionLevel: currentQuestion.level });
        setEvaluation(result);

        // 시도 횟수 증가
        setAttemptCounts(prev => ({ ...prev, [currentQuestionIndex]: (prev[currentQuestionIndex] ?? 0) + 1 }));

        // 획득 XP 계산 (연습은 절반). 피드백 카드에 "+N XP" 표시.
        const earnedXp = practiceXp(result.score);
        setLastEarnedXp(earnedXp);

        // Firestore 저장
        const sc = sessionStorage.getItem('classCode');
        const an = sessionStorage.getItem('attendanceNumber');
        if (db && sc && an) {
          // 누적 XP increment (score 0이면 스킵). 실패해도 학생 흐름 방해 금지.
          if (earnedXp > 0) {
            setDoc(
              doc(db, 'classes', sc, 'students', an),
              { xp: increment(earnedXp), updatedAt: serverTimestamp() },
              { merge: true }
            ).catch((err) => console.error('XP 저장 실패:', err));
          }
          addDoc(collection(db, 'classes', sc, 'practice_attempts'), {
            attendanceNumber: an,
            questionIndex: currentQuestionIndex,
            questionLevel: currentQuestion.level,
            questionTitle: currentQuestion.koreanTitle,
            originalPrompt: buildImagePrompt(currentQuestion.dataAiHint),
            studentPrompt,
            score: result.score,
            feedback: result.feedback,
            // Firestore는 undefined 필드를 거부하므로 값이 있을 때만 추가
            ...(result.strongestAxis ? { strongestAxis: result.strongestAxis } : {}),
            createdAt: serverTimestamp(),
          }).catch((err) => console.error('연습 기록 저장 실패:', err));
        }
      } catch (error) {
        console.error('Evaluation failed:', error);
        toast({ variant: 'destructive', title: '평가 실패', description: 'AI로부터 피드백을 받을 수 없습니다.' });
      }
    });
  };

  const handleRetry = () => {
    setEvaluation(null);
    // studentPrompt는 유지 — 학생이 이전 답을 보고 수정할 수 있도록
  };

  const handleNextQuestion = () => {
    setCurrentQuestionIndex((prev) => (prev + 1) % questions.length);
  };

  const levelColor = (lv: number) => {
    if (lv <= 3) return 'bg-green-100 text-green-800 border-green-200';
    if (lv <= 6) return 'bg-yellow-100 text-yellow-800 border-yellow-200';
    if (lv <= 8) return 'bg-orange-100 text-orange-800 border-orange-200';
    if (lv <= 11) return 'bg-red-100 text-red-800 border-red-200';
    return 'bg-purple-100 text-purple-800 border-purple-200';
  };

  return (
    <div className="min-h-screen bg-background font-sans">
      <header className="p-4 flex justify-between items-center">
        <div className="flex items-center gap-3">
          <Badge variant="outline" className={`text-sm px-3 py-1 border ${levelColor(currentQuestion.level)}`}>
            Lv.{currentQuestion.level}
          </Badge>
          <span className="text-sm text-muted-foreground">
            문제 {currentQuestionIndex + 1} / {questions.length}
          </span>
          {currentAttempts > 0 && (
            <Badge variant="secondary" className="text-xs">
              이 문제 {currentAttempts}번 도전
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-2">
          {studentDocRef && (
            <span className="text-xs sm:text-sm text-muted-foreground whitespace-nowrap">
              {currentTitle.name} · {currentXp.toLocaleString()} XP
            </span>
          )}
          <Link href="/" passHref>
            <Button variant="outline" size="sm"><Home className="mr-2 h-4 w-4" />홈</Button>
          </Link>
        </div>
      </header>

      <div className="px-4 pb-2">
        <Progress value={((currentQuestionIndex) / questions.length) * 100} className="h-2" />
      </div>

      <main className="container mx-auto p-4 sm:p-6 lg:p-8">
        <div className="text-center mb-8">
          <h1 className="text-4xl font-bold tracking-tight text-transparent bg-clip-text bg-gradient-to-r from-primary via-purple-400 to-pink-500 sm:text-5xl font-headline">연습 모드</h1>
          <p className="mt-2 text-muted-foreground">AI 그림을 보고 설명을 써보세요. 몇 번이든 다시 도전할 수 있어요!</p>
        </div>

        <Card className="max-w-4xl mx-auto shadow-2xl shadow-primary/20 rounded-2xl overflow-hidden border-2 border-primary/20 bg-card/80 backdrop-blur-sm">
          <div className="grid md:grid-cols-5 gap-0">
            <div className="md:col-span-3">
              <div className="relative w-full aspect-[4/3] bg-black/10">
                <Image
                  src={currentQuestion.imageUrl}
                  alt="평가 이미지"
                  fill
                  className="object-contain rounded-tl-2xl md:rounded-l-2xl"
                  priority
                  sizes="(max-width: 768px) 100vw, 60vw"
                />
              </div>
            </div>

            <div className="md:col-span-2 flex flex-col">
              <CardContent className="p-6 flex-grow flex flex-col">
                <Alert className="mb-4 bg-accent/80 border-accent/50 rounded-lg">
                  <BookOpen className="h-4 w-4 text-accent-foreground" />
                  <AlertTitle className="font-semibold text-accent-foreground">힌트</AlertTitle>
                  <AlertDescription className="text-accent-foreground/90 font-body whitespace-pre-line text-sm">
                    {currentQuestion.rubric}
                  </AlertDescription>
                </Alert>

                <form onSubmit={handleSubmit} className="flex-grow flex flex-col">
                  <div className="grid w-full gap-2 flex-grow">
                    <Label htmlFor="prompt-input" className="text-base font-medium">나의 설명 ✨</Label>
                    <Textarea
                      id="prompt-input"
                      placeholder="이 그림은..."
                      value={studentPrompt}
                      onChange={(e) => setStudentPrompt(e.target.value)}
                      rows={5}
                      className="text-base flex-grow bg-input/50 focus:bg-input/80 transition-colors"
                      disabled={isPending}
                    />
                  </div>
                  <Button type="submit" size="lg" className="mt-4 w-full" disabled={isPending}>
                    {isEvaluating ? <RefreshCw className="mr-2 h-4 w-4 animate-spin" /> : <Wand2 className="mr-2 h-4 w-4" />}
                    평가 받기
                  </Button>
                </form>
              </CardContent>
            </div>
          </div>

          {isEvaluating && (
            <div className="p-6 space-y-4">
              <Skeleton className="h-8 w-1/3" />
              <div className="flex items-center gap-6">
                <Skeleton className="h-24 w-24 rounded-full" />
                <div className="space-y-2 flex-1">
                  <Skeleton className="h-6 w-full" />
                  <Skeleton className="h-6 w-5/6" />
                </div>
              </div>
            </div>
          )}

          {evaluation && !isEvaluating && (
            <div className="p-6 animate-in fade-in-50 duration-500">
              <Card className="bg-card/80 backdrop-blur-sm rounded-xl">
                <CardHeader>
                  <CardTitle className="text-2xl font-headline tracking-tight flex items-center gap-2">
                    AI 선생님의 피드백
                    {currentAttempts > 1 && (
                      <Badge variant="outline" className="text-xs font-normal ml-2">
                        {currentAttempts}번째 도전
                      </Badge>
                    )}
                  </CardTitle>
                </CardHeader>
                <CardContent className="flex flex-col sm:flex-row items-center gap-6">
                  <div className="flex flex-col items-center">
                    <div className="relative flex items-center justify-center size-32 bg-gradient-to-br from-primary/20 to-accent/30 rounded-full">
                      <p className="text-5xl font-bold text-primary">{evaluation.score}</p>
                    </div>
                    <p className="text-muted-foreground mt-2 font-semibold">/ 100점</p>
                    {studentDocRef && lastEarnedXp !== null && (
                      <Badge className="mt-2 bg-green-100 text-green-800 border-green-200 border text-sm px-3 py-1 hover:bg-green-100">
                        +{lastEarnedXp} XP
                      </Badge>
                    )}
                  </div>
                  <div className="flex-1">
                    <h4 className="font-semibold text-lg mb-2 flex items-center gap-2"><Star className="text-yellow-400" fill="currentColor" />칭찬 및 개선점</h4>
                    {(() => {
                      const badge = getAxisBadge(evaluation.strongestAxis);
                      return badge ? (
                        <Badge variant="secondary" className="mb-2 text-sm px-3 py-1">
                          {badge.emoji} 오늘의 칭호: {badge.name}
                        </Badge>
                      ) : null;
                    })()}
                    <p className="mt-2 text-muted-foreground whitespace-pre-wrap font-body text-base leading-loose">{evaluation.feedback}</p>
                  </div>
                </CardContent>
                <CardFooter className="flex flex-col sm:flex-row gap-3">
                  <Button onClick={handleRetry} variant="outline" className="w-full sm:w-auto">
                    <RotateCcw className="mr-2 h-4 w-4" />
                    다시 도전하기
                    {currentAttempts > 0 && <span className="ml-1 text-xs text-muted-foreground">({currentAttempts}번째)</span>}
                  </Button>
                  <Button onClick={handleNextQuestion} className="w-full sm:w-auto ml-auto" variant="outline">
                    다음 문제 <ArrowRight className="ml-2 h-4 w-4" />
                  </Button>
                </CardFooter>
              </Card>
            </div>
          )}
        </Card>
      </main>
    </div>
  );
}
