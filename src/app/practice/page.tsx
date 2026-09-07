
'use client';

import { useState, useTransition, useMemo, useEffect } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { evaluatePrompt, type EvaluatePromptOutput } from '@/ai/flows/evaluate-prompt';
import { useFirestore } from '@/firebase';
import { collection, addDoc, serverTimestamp } from 'firebase/firestore';
import { PRACTICE_QUESTIONS, CHASI_RANGE } from '@/lib/questions';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { ArrowRight, Wand2, RefreshCw, BookOpen, Star, Home, RotateCcw, Lock, Check } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from "@/hooks/use-toast";
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';

// 문항 목록은 src/lib/questions.ts가 단일 진실 (admin 감수 페이지와 공유)
const questions = PRACTICE_QUESTIONS;

/** 차시 이름. 논문 <부록 표 2> 차시별 문항 구간 배정과 같다. */
const CHASI_TITLE: Record<number, string> = {
  1: '무엇을 그렸는지 이름 붙이기',
  2: '색과 모양을 더하기',
  3: '어디에서 무엇을 하고 있나',
  4: '질감과 자세까지 말하기',
  5: '분위기를 담아 쓰기',
  6: '내 문장이 어떻게 달라졌나',
};

const CHASI_LIST = [1, 2, 3, 4, 5, 6];

/** 한 차시를 마치려면 그 차시의 6문항을 모두 한 번 이상 제출해야 한다. */
const REQUIRED_PER_CHASI = 6;

/** 진행 상황 저장 키 — 학급과 출석번호로 학생을 구분한다. */
const progressKey = () => {
  if (typeof window === 'undefined') return null;
  const cls = sessionStorage.getItem('classCode');
  const no = sessionStorage.getItem('attendanceNumber');
  return cls && no ? `practice-progress:${cls}:${no}` : null;
};

export default function PracticePage() {
  const [currentChasi, setCurrentChasi] = useState(1);
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
  /** 제출을 마친 문항 레벨의 집합. 차시 잠금 해제의 근거가 된다. */
  const [doneLevels, setDoneLevels] = useState<Set<number>>(new Set());
  const [studentPrompt, setStudentPrompt] = useState('');
  const [evaluation, setEvaluation] = useState<EvaluatePromptOutput | null>(null);
  const [isEvaluating, startEvaluationTransition] = useTransition();
  // attemptCounts: questionIndex → 시도 횟수 (현재 세션 기준)
  const [attemptCounts, setAttemptCounts] = useState<Record<number, number>>({});
  const { toast } = useToast();
  const db = useFirestore();

  const isPending = isEvaluating;
  const currentQuestion = questions[currentQuestionIndex];
  const currentAttempts = attemptCounts[currentQuestionIndex] ?? 0;

  /** 저장해 둔 진행 상황을 불러온다. */
  useEffect(() => {
    const key = progressKey();
    if (!key) return;
    try {
      const saved = JSON.parse(localStorage.getItem(key) ?? '[]') as number[];
      const set = new Set(saved);
      setDoneLevels(set);
      // 마지막으로 열려 있는 차시에서 이어 시작한다.
      let open = 1;
      for (const c of CHASI_LIST) {
        const [from, to] = CHASI_RANGE[c];
        const done = questions.filter(q => q.level >= from && q.level <= to && set.has(q.level)).length;
        if (done >= REQUIRED_PER_CHASI && c < 6) open = c + 1;
      }
      setCurrentChasi(open);
      setCurrentQuestionIndex(questions.findIndex(q => q.chasi === open));
    } catch {
      // 저장값이 깨졌으면 처음부터 시작한다.
    }
  }, []);

  /** 차시별 진행 수와 잠금 여부 */
  const chasiState = useMemo(() => {
    const state: Record<number, { done: number; unlocked: boolean; cleared: boolean }> = {};
    let unlocked = true;
    for (const c of CHASI_LIST) {
      const [from, to] = CHASI_RANGE[c];
      const done = questions.filter(q => q.level >= from && q.level <= to && doneLevels.has(q.level)).length;
      const cleared = done >= REQUIRED_PER_CHASI;
      state[c] = { done, unlocked, cleared };
      unlocked = unlocked && cleared; // 앞 차시를 마쳐야 다음 차시가 열린다
    }
    return state;
  }, [doneLevels]);

  const chasiQuestions = useMemo(
    () => questions.filter(q => q.chasi === currentChasi),
    [currentChasi]
  );
  const posInChasi = chasiQuestions.findIndex(q => q.level === currentQuestion.level);

  const goToChasi = (c: number) => {
    if (!chasiState[c]?.unlocked) return;
    setCurrentChasi(c);
    setCurrentQuestionIndex(questions.findIndex(q => q.chasi === c));
  };

  useEffect(() => {
    setEvaluation(null);
    setStudentPrompt('');
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

        // 채점이 정상으로 끝난 문항만 완료로 기록한다(결측은 세지 않는다).
        if (!result.missing) {
          setDoneLevels(prev => {
            const next = new Set(prev);
            next.add(currentQuestion.level);
            const key = progressKey();
            if (key) {
              try { localStorage.setItem(key, JSON.stringify([...next])); } catch {}
            }
            return next;
          });
        }

        // Firestore 저장
        const classCode = sessionStorage.getItem('classCode');
        const attendanceNumber = sessionStorage.getItem('attendanceNumber');
        if (db && classCode && attendanceNumber) {
          addDoc(collection(db, 'classes', classCode, 'practice_attempts'), {
            attendanceNumber,
            questionIndex: currentQuestionIndex,
            questionLevel: currentQuestion.level,
            questionTitle: currentQuestion.koreanTitle,
            originalPrompt: currentQuestion.sourcePrompt,
            studentPrompt,
            score: result.score,
            feedback: result.feedback,
            // 축별 자료 (논문 <표 Ⅲ-4>·<표 Ⅲ-7>) — 결합 전후를 모두 남긴다
            chasi: currentQuestion.chasi,
            band: result.band,
            levels: result.levels,
            axisScores: result.axisScores,
            rawCalls: result.calls,
            extraCall: result.extraCall,
            missing: result.missing,
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

  /** 같은 차시 안에서만 순환한다. 다음 차시로는 마쳐야 넘어갈 수 있다. */
  const handleNextQuestion = () => {
    const idxs = questions
      .map((q, i) => ({ q, i }))
      .filter(({ q }) => q.chasi === currentChasi)
      .map(({ i }) => i);
    const at = idxs.indexOf(currentQuestionIndex);
    setCurrentQuestionIndex(idxs[(at + 1) % idxs.length]);
  };

  /** 현재 차시를 마쳤을 때 다음 차시로 넘어간다. */
  const handleNextChasi = () => {
    if (currentChasi >= 6 || !chasiState[currentChasi]?.cleared) return;
    goToChasi(currentChasi + 1);
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
            {currentChasi}단계 · {posInChasi + 1} / {REQUIRED_PER_CHASI}
          </span>
          {currentAttempts > 0 && (
            <Badge variant="secondary" className="text-xs">
              이 문제 {currentAttempts}번 도전
            </Badge>
          )}
        </div>
        <Link href="/" passHref>
          <Button variant="outline" size="sm"><Home className="mr-2 h-4 w-4" />홈</Button>
        </Link>
      </header>

      <div className="px-4 pb-2">
        <Progress
          value={(chasiState[currentChasi].done / REQUIRED_PER_CHASI) * 100}
          className="h-2"
        />
      </div>

      {/* 단계 선택 — 앞 단계의 6문항을 모두 마쳐야 다음 단계가 열린다 */}
      <nav className="px-4 pb-4" aria-label="단계 선택">
        <ol className="mx-auto flex max-w-4xl flex-wrap justify-center gap-2">
          {CHASI_LIST.map((c) => {
            const s = chasiState[c];
            const active = c === currentChasi;
            return (
              <li key={c}>
                <button
                  type="button"
                  onClick={() => goToChasi(c)}
                  disabled={!s.unlocked}
                  aria-current={active ? 'step' : undefined}
                  title={s.unlocked ? CHASI_TITLE[c] : `${c - 1}단계를 마치면 열려요`}
                  className={[
                    'flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs transition',
                    active
                      ? 'border-primary bg-primary text-primary-foreground shadow'
                      : s.unlocked
                        ? 'border-primary/30 bg-card hover:bg-accent'
                        : 'cursor-not-allowed border-muted bg-muted/40 text-muted-foreground',
                  ].join(' ')}
                >
                  {!s.unlocked ? (
                    <Lock className="h-3 w-3" />
                  ) : s.cleared ? (
                    <Check className="h-3 w-3" />
                  ) : null}
                  <span className="font-semibold">{c}단계</span>
                  <span className="hidden sm:inline opacity-80">{CHASI_TITLE[c]}</span>
                  <span className="tabular-nums opacity-70">
                    {s.done}/{REQUIRED_PER_CHASI}
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
      </nav>

      <main className="container mx-auto p-4 sm:p-6 lg:p-8">
        <div className="text-center mb-8">
          <h1 className="text-4xl font-bold tracking-tight text-transparent bg-clip-text bg-gradient-to-r from-primary via-purple-400 to-pink-500 sm:text-5xl font-headline">연습 모드</h1>
          <p className="mt-2 text-muted-foreground">
            {currentChasi}단계 · {CHASI_TITLE[currentChasi]}
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            그림을 보고 설명을 써 보세요. 몇 번이든 다시 도전할 수 있어요.
            이 단계의 {REQUIRED_PER_CHASI}문항을 모두 마치면 다음 단계가 열려요.
          </p>

          {chasiState[currentChasi].cleared && currentChasi < 6 && (
            <div className="mt-4">
              <Button onClick={handleNextChasi} size="lg" className="rounded-full">
                {currentChasi + 1}단계로 넘어가기
                <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            </div>
          )}
          {chasiState[6].cleared && (
            <p className="mt-4 text-sm font-semibold text-primary">
              여섯 단계를 모두 마쳤어요. 1차시에 쓴 문장과 지금 문장을 견주어 보세요.
            </p>
          )}
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
                  </div>
                  <div className="flex-1">
                    <h4 className="font-semibold text-lg mb-2 flex items-center gap-2"><Star className="text-yellow-400" fill="currentColor" />칭찬 및 개선점</h4>
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
