'use client';

/**
 * 연습 모드 화면.
 *
 * 설계서 §4·§7 대응.
 *   - 차시는 교사가 서버에서 연다. 6문항 완료가 다음 차시의 조건이 아니다.
 *   - 완료 수는 정보로만 보여 준다. 수행하지 않은 문항은 0점이 아니라 미수행이다.
 *   - 열람 가능한 차시는 서버의 allowedLessons가 정한다. 날짜·localStorage·URL을
 *     바꾸어도 허용되지 않은 차시에 들어갈 수 없다.
 *   - 제출은 서버 액션이 저장한다. 클라이언트가 Firestore에 직접 쓰지 않는다.
 *   - 같은 제출ID로 다시 보내도 이중 저장되지 않는다. 저장 실패를 완료로 표시하지 않는다.
 *   - 채점 결측은 0점·수준1로 보이게 하지 않는다.
 *   - 적어도 한 문항에서 피드백을 검토하고 수정 또는 고치지 않은 까닭을 남긴다.
 *   - 학급·신원은 서버 세션이 정한다. 화면이 sessionStorage의 학급코드·출석번호를 보내지 않는다.
 */

import { useState, useTransition, useMemo, useEffect, useCallback } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { PRACTICE_QUESTIONS } from '@/lib/questions';
import { FEEDBACK_FALLBACK_TEXT } from '@/lib/feedback';
import {
  getLessonStateAction,
  recordFeedbackReviewAction,
  submitPracticeAction,
  type LessonStateView,
  type SubmitPracticeResult,
} from '@/server/lessons/actions';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { PII_NOTICE } from '@/server/privacy';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  ArrowRight,
  Wand2,
  RefreshCw,
  BookOpen,
  Star,
  Home,
  RotateCcw,
  AlertTriangle,
  CheckCircle2,
} from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/hooks/use-toast';
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';

const questions = PRACTICE_QUESTIONS;

/** 차시 이름. 논문 <부록 표 2> 차시별 문항 구간 배정과 같다. */
const CHASI_TITLE: Record<number, string> = {
  1: '이름과 눈에 보이는 색·모양 함께 쓰기',
  2: '색과 모양을 더 자세히',
  3: '어디에서 무엇을 하고 있나',
  4: '질감과 자세까지 말하기',
  5: '분위기를 담아 쓰기',
  6: '내 문장이 어떻게 달라졌나',
};

/** 한 차시의 문항 수. 정보 표시용이며 잠금 조건이 아니다. */
const QUESTIONS_PER_CHASI = 6;

/** 연습 문항 ID는 레지스트리와 같은 규칙(L01~L36)을 쓴다. */
const questionIdOf = (level: number) => `L${String(level).padStart(2, '0')}`;

/**
 * 일반 체험의 진행 캐시.
 *
 * 연구 세션의 진행은 서버의 제출 이력이 근거다. 일반 체험은 서버에 학생 식별이 없어
 * 새로 고치면 무엇을 했는지 알 수 없으므로, 이 기기에만 남는 캐시로 화면 안에서
 * 이어 보여 준다. 이 값은 접근 권한·동의·완료의 근거가 아니며 잠금에 쓰지 않는다.
 */
const PRACTICE_PROGRESS_KEY = 'experience:practice:v1';
/** 오래된 기록으로 엉뚱한 안내를 하지 않도록 하루만 둔다. */
const PRACTICE_PROGRESS_TTL_MS = 24 * 60 * 60 * 1000;

function readCachedQuestionIds(): string[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(PRACTICE_PROGRESS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as { savedAt?: number; questionIds?: string[] };
    if (typeof parsed?.savedAt !== 'number') return [];
    if (Date.now() - parsed.savedAt > PRACTICE_PROGRESS_TTL_MS) return [];
    return Array.isArray(parsed.questionIds) ? parsed.questionIds.filter((v) => typeof v === 'string') : [];
  } catch {
    return [];
  }
}

function writeCachedQuestionIds(questionIds: string[]) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(
      PRACTICE_PROGRESS_KEY,
      JSON.stringify({ savedAt: Date.now(), questionIds })
    );
  } catch {
    // 저장하지 못해도 화면 동작에는 영향이 없다.
  }
}

function newSubmissionId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `sub-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

type ResultView = Extract<SubmitPracticeResult, { status: 'done' }>;

export default function PracticePage() {
  const [lessonState, setLessonState] = useState<LessonStateView | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [currentChasi, setCurrentChasi] = useState<number | null>(null);
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
  const [studentPrompt, setStudentPrompt] = useState('');
  const [startedAt, setStartedAt] = useState<string>(() => new Date().toISOString());
  const [result, setResult] = useState<ResultView | null>(null);
  const [blockedMessage, setBlockedMessage] = useState<string | null>(null);
  const [isSubmitting, startSubmit] = useTransition();
  /** 저장에 실패하면 같은 제출ID로 다시 보낸다. 새 응답으로 세지 않기 위함이다. */
  const [pendingSubmissionId, setPendingSubmissionId] = useState<string | null>(null);
  const [reviewNote, setReviewNote] = useState('');
  const [reviewSaved, setReviewSaved] = useState(false);
  /** 이 기기에서 낸 문항. 일반 체험의 표시를 이어 주기 위한 캐시일 뿐이다. */
  const [cachedQuestionIds, setCachedQuestionIds] = useState<string[]>([]);
  const { toast } = useToast();

  /** URL의 lesson 값은 요청일 뿐이다. 허용 여부는 서버가 정한다. */
  const requestedLessonFromUrl = () => {
    if (typeof window === 'undefined') return null;
    const raw = new URLSearchParams(window.location.search).get('lesson');
    const n = Number(raw);
    return raw !== null && Number.isFinite(n) ? n : null;
  };

  const loadLessonState = useCallback(async (requested: number | null) => {
    try {
      const state = await getLessonStateAction(requested);
      setLessonState(state);
      setLoadError(null);
      if (state.deniedMessage) setBlockedMessage(state.deniedMessage);
      const entry = state.entryLesson;
      setCurrentChasi(entry);
      if (entry !== null) {
        const idx = questions.findIndex((q) => q.chasi === entry);
        setCurrentQuestionIndex(idx >= 0 ? idx : 0);
      }
      return state;
    } catch {
      setLoadError('지금 수업 상태를 확인하지 못했어요. 잠시 뒤 다시 해 볼까요?');
      return null;
    }
  }, []);

  useEffect(() => {
    void loadLessonState(requestedLessonFromUrl());
    setCachedQuestionIds(readCachedQuestionIds());
  }, [loadLessonState]);

  const currentQuestion = questions[currentQuestionIndex];

  const chasiQuestions = useMemo(
    () => questions.filter((q) => q.chasi === currentChasi),
    [currentChasi]
  );
  const posInChasi = currentQuestion
    ? chasiQuestions.findIndex((q) => q.level === currentQuestion.level)
    : -1;

  /** 차시별 제출 문항 수. 서버의 제출 이력이 근거이며 잠금에 쓰지 않는다. */
  const attemptedCount = useCallback(
    (chasi: number) => {
      const attempts = lessonState?.attemptsByQuestion ?? {};
      return questions.filter((q) => {
        if (q.chasi !== chasi) return false;
        const id = questionIdOf(q.level);
        // 서버 이력이 먼저다. 일반 체험에서는 이 기기의 캐시로 표시만 이어 준다.
        return (attempts[id] ?? 0) > 0 || cachedQuestionIds.includes(id);
      }).length;
    },
    [lessonState, cachedQuestionIds]
  );

  const goToChasi = async (c: number) => {
    setBlockedMessage(null);
    setResult(null);
    const state = await loadLessonState(c);
    if (state && state.entryLesson !== c) {
      // 서버가 허용하지 않은 차시다. 화면에서 막는 것이 아니라 서버 판정을 그대로 따른다.
      setBlockedMessage(state.deniedMessage ?? '아직 선생님이 열지 않은 단계예요.');
    }
  };

  useEffect(() => {
    setResult(null);
    setStudentPrompt('');
    setPendingSubmissionId(null);
    setReviewNote('');
    setReviewSaved(false);
    setStartedAt(new Date().toISOString());
  }, [currentQuestionIndex]);

  const submit = (submissionId: string) => {
    if (!currentQuestion || currentChasi === null) return;
    startSubmit(async () => {
      try {
        const res = await submitPracticeAction({
          submissionId,
          questionId: questionIdOf(currentQuestion.level),
          lesson: currentChasi,
          text: studentPrompt,
          startedAt,
        });
        if (res.status === 'blocked') {
          setResult(null);
          setBlockedMessage(res.message);
          return;
        }
        setResult(res);
        setBlockedMessage(null);
        // 저장에 실패했으면 같은 제출ID를 남겨 두어 다시 보낼 때 이중 저장되지 않게 한다.
        setPendingSubmissionId(res.save.ok ? null : submissionId);
        if (res.save.ok) {
          void loadLessonState(currentChasi);
          // 새로 고쳐도 무엇을 냈는지 화면에서 이어 보이도록 이 기기에만 남긴다.
          const questionId = questionIdOf(currentQuestion.level);
          if (!cachedQuestionIds.includes(questionId)) {
            const next = [...cachedQuestionIds, questionId];
            setCachedQuestionIds(next);
            writeCachedQuestionIds(next);
          }
        }
      } catch {
        setResult(null);
        toast({
          variant: 'destructive',
          title: '보내지 못했어요',
          description: '잠시 뒤 다시 눌러 주세요. 쓴 글은 그대로 있어요.',
        });
      }
    });
  };

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (isSubmitting) return;
    if (!studentPrompt.trim()) {
      toast({
        variant: 'destructive',
        title: '아직 비어 있어요',
        description: '그림을 보고 설명을 써 주세요.',
      });
      return;
    }
    submit(pendingSubmissionId ?? newSubmissionId());
  };

  const handleRetrySave = () => {
    if (pendingSubmissionId) submit(pendingSubmissionId);
  };

  const handleRevise = () => {
    // 피드백을 보고 고쳐 쓰는 흐름. 이전 제출은 그대로 두고 새 제출로 남는다.
    if (result) {
      void recordFeedbackReviewAction({
        submissionId: result.submissionId,
        kind: 'revised',
      });
    }
    setResult(null);
    setPendingSubmissionId(null);
    setStartedAt(new Date().toISOString());
  };

  const handleKeepAsIs = async () => {
    if (!result) return;
    if (!reviewNote.trim()) {
      toast({
        variant: 'destructive',
        title: '한 줄만 적어 주세요',
        description: '고치지 않기로 한 까닭을 짧게 써 주세요.',
      });
      return;
    }
    const res = await recordFeedbackReviewAction({
      submissionId: result.submissionId,
      kind: 'kept',
      note: reviewNote,
    });
    if (res.ok) {
      setReviewSaved(true);
      void loadLessonState(currentChasi);
    } else {
      toast({ variant: 'destructive', title: '기록하지 못했어요', description: res.message ?? '' });
    }
  };

  const handleNextQuestion = () => {
    const idxs = questions
      .map((q, i) => ({ q, i }))
      .filter(({ q }) => q.chasi === currentChasi)
      .map(({ i }) => i);
    if (!idxs.length) return;
    const at = idxs.indexOf(currentQuestionIndex);
    setCurrentQuestionIndex(idxs[(at + 1) % idxs.length]);
  };

  const levelColor = (lv: number) => {
    if (lv <= 6) return 'bg-green-100 text-green-800 border-green-200';
    if (lv <= 12) return 'bg-yellow-100 text-yellow-800 border-yellow-200';
    if (lv <= 18) return 'bg-orange-100 text-orange-800 border-orange-200';
    if (lv <= 24) return 'bg-red-100 text-red-800 border-red-200';
    return 'bg-purple-100 text-purple-800 border-purple-200';
  };

  if (!lessonState) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-4">
        <p className="text-sm text-muted-foreground">
          {loadError ?? '잠시만 기다려 주세요.'}
        </p>
      </div>
    );
  }

  // 서버가 연 차시가 없으면 문항을 보여 주지 않는다.
  if (currentChasi === null || !currentQuestion) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-4">
        <Card className="w-full max-w-md rounded-2xl border-2 border-primary/20 bg-card/80">
          <CardHeader>
            <CardTitle className="text-center font-headline">아직 열린 단계가 없어요</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 text-center">
            <p className="text-muted-foreground">
              {blockedMessage ?? '선생님이 단계를 열어 주면 시작할 수 있어요.'}
            </p>
            <Link href="/" passHref>
              <Button className="w-full">
                <Home className="mr-2 h-4 w-4" />
                홈으로 돌아가기
              </Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  const doneInChasi = attemptedCount(currentChasi);

  return (
    <div className="min-h-screen bg-background font-sans">
      <header className="p-4 flex justify-between items-center">
        <div className="flex items-center gap-3">
          <Badge
            variant="outline"
            className={`text-sm px-3 py-1 border ${levelColor(currentQuestion.level)}`}
          >
            Lv.{currentQuestion.level}
          </Badge>
          <span className="text-sm text-muted-foreground">
            {currentChasi}단계 · {posInChasi + 1}번째 문항
          </span>
        </div>
        <Link href="/" passHref>
          <Button variant="outline" size="sm">
            <Home className="mr-2 h-4 w-4" />홈
          </Button>
        </Link>
      </header>

      {/* 단계 선택 — 서버가 연 단계만 나온다. 완료 수는 정보일 뿐이다. */}
      <nav className="px-4 pb-4" aria-label="단계 선택">
        <ol className="mx-auto flex max-w-4xl flex-wrap justify-center gap-2">
          {lessonState.allowedLessons.map((c) => {
            const active = c === currentChasi;
            return (
              <li key={c}>
                <button
                  type="button"
                  onClick={() => void goToChasi(c)}
                  aria-current={active ? 'step' : undefined}
                  title={CHASI_TITLE[c]}
                  className={[
                    'flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs transition',
                    active
                      ? 'border-primary bg-primary text-primary-foreground shadow'
                      : 'border-primary/30 bg-card hover:bg-accent',
                  ].join(' ')}
                >
                  <span className="font-semibold">{c}단계</span>
                  <span className="hidden sm:inline opacity-80">{CHASI_TITLE[c]}</span>
                  <span className="tabular-nums opacity-70">
                    {attemptedCount(c)}/{QUESTIONS_PER_CHASI} 문항
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
        {lessonState.scheduleControlled && (
          <p className="mt-2 text-center text-xs text-muted-foreground">
            단계는 선생님이 열어 주세요. 지금 열린 단계만 보여요.
          </p>
        )}
      </nav>

      {blockedMessage && (
        <div className="px-4 pb-4">
          <Alert className="mx-auto max-w-4xl border-primary/40 bg-primary/5">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>지금은 열 수 없어요</AlertTitle>
            <AlertDescription>{blockedMessage}</AlertDescription>
          </Alert>
        </div>
      )}

      <main className="container mx-auto p-4 sm:p-6 lg:p-8">
        <div className="text-center mb-8">
          <h1 className="text-4xl font-bold tracking-tight text-transparent bg-clip-text bg-gradient-to-r from-primary via-purple-400 to-pink-500 sm:text-5xl font-headline">
            연습 모드
          </h1>
          <p className="mt-2 text-muted-foreground">
            {currentChasi}단계 · {CHASI_TITLE[currentChasi]}
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            그림을 보고 설명을 써 보세요. 몇 번이든 다시 도전할 수 있어요.
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            지금까지 이 단계에서 {doneInChasi}/{QUESTIONS_PER_CHASI} 문항을 냈어요. 다 하지 않아도
            괜찮아요.
          </p>
          {lessonState.reviewedQuestionCount === 0 && (
            <p className="mt-1 text-sm text-primary">
              한 문항은 피드백을 읽고 고쳐 쓰거나, 고치지 않은 까닭을 적어 보세요.
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
                    <Label htmlFor="prompt-input" className="text-base font-medium">
                      나의 설명
                    </Label>
                    <Textarea
                      id="prompt-input"
                      placeholder="이 그림은..."
                      value={studentPrompt}
                      onChange={(e) => setStudentPrompt(e.target.value)}
                      rows={5}
                      className="text-base flex-grow bg-input/50 focus:bg-input/80 transition-colors"
                      disabled={isSubmitting}
                    />
                    {/* 전송 전 점검의 한계를 문구 사본이 아니라 원문 상수로 알린다. */}
                    <p className="mt-2 text-xs text-muted-foreground">{PII_NOTICE}</p>
                  </div>
                  <Button type="submit" size="lg" className="mt-4 w-full" disabled={isSubmitting}>
                    {isSubmitting ? (
                      <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <Wand2 className="mr-2 h-4 w-4" />
                    )}
                    {pendingSubmissionId ? '다시 보내기' : '평가 받기'}
                  </Button>
                </form>
              </CardContent>
            </div>
          </div>

          {isSubmitting && (
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

          {result && !isSubmitting && (
            <div className="p-6 animate-in fade-in-50 duration-500">
              {/* 저장 상태를 먼저 정확히 알린다. 실패를 완료 화면으로 바꾸지 않는다. */}
              {!result.save.ok ? (
                <Alert variant="destructive" className="mb-4">
                  <AlertTriangle className="h-4 w-4" />
                  <AlertTitle>아직 저장하지 못했어요</AlertTitle>
                  <AlertDescription className="space-y-2">
                    <p>{result.save.message}</p>
                    <Button size="sm" variant="outline" onClick={handleRetrySave}>
                      <RotateCcw className="mr-2 h-4 w-4" />
                      같은 글로 다시 보내기
                    </Button>
                  </AlertDescription>
                </Alert>
              ) : (
                <Alert className="mb-4 border-emerald-500/40 bg-emerald-500/5">
                  <CheckCircle2 className="h-4 w-4" />
                  <AlertTitle>
                    {result.save.duplicate ? '이미 낸 글이에요' : '글을 저장했어요'}
                  </AlertTitle>
                  <AlertDescription>
                    {result.save.duplicate
                      ? '같은 글이 이미 저장되어 있어요. 두 번 세지 않아요.'
                      : result.save.message ?? `${result.attemptNo}번째 도전으로 남았어요.`}
                  </AlertDescription>
                </Alert>
              )}

              <Card className="bg-card/80 backdrop-blur-sm rounded-xl">
                <CardHeader>
                  <CardTitle className="text-2xl font-headline tracking-tight">
                    AI 선생님의 피드백
                  </CardTitle>
                </CardHeader>
                <CardContent className="flex flex-col sm:flex-row items-center gap-6">
                  <div className="flex flex-col items-center">
                    {result.scoring.status === 'scored' ? (
                      <>
                        <div className="relative flex items-center justify-center size-32 bg-gradient-to-br from-primary/20 to-accent/30 rounded-full">
                          <p className="text-5xl font-bold text-primary">
                            {Math.round(result.scoring.score)}
                          </p>
                        </div>
                        <p className="text-muted-foreground mt-2 font-semibold">/ 100점</p>
                      </>
                    ) : (
                      <div className="flex size-32 items-center justify-center rounded-full bg-muted/60 px-4 text-center">
                        <p className="text-sm text-muted-foreground">점수 없음</p>
                      </div>
                    )}
                  </div>
                  <div className="flex-1">
                    {result.scoring.status === 'missing' ? (
                      <p className="text-base leading-loose text-muted-foreground">
                        {result.scoring.message}
                      </p>
                    ) : (
                      <>
                        <h4 className="font-semibold text-lg mb-2 flex items-center gap-2">
                          <Star className="text-yellow-400" fill="currentColor" />
                          칭찬 및 개선점
                        </h4>
                        <p className="mt-2 text-muted-foreground whitespace-pre-wrap font-body text-base leading-loose">
                          {result.feedback?.text ?? FEEDBACK_FALLBACK_TEXT}
                        </p>
                      </>
                    )}
                  </div>
                </CardContent>

                {/* 피드백 검토 — 고쳐 쓰거나, 고치지 않은 까닭을 남긴다. */}
                <CardContent className="border-t pt-4">
                  {reviewSaved ? (
                    <p className="text-sm text-muted-foreground">
                      고치지 않은 까닭을 남겼어요. 다음 문항으로 가도 좋아요.
                    </p>
                  ) : (
                    <div className="space-y-3">
                      <p className="text-sm font-medium">
                        피드백을 읽고 어떻게 할까요?
                      </p>
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
                        <div className="flex-1 space-y-1">
                          <Label htmlFor="keep-note" className="text-xs text-muted-foreground">
                            고치지 않는다면 그 까닭을 한 줄로 적어 주세요
                          </Label>
                          <Input
                            id="keep-note"
                            value={reviewNote}
                            onChange={(e) => setReviewNote(e.target.value)}
                            placeholder="예: 그림에 없는 것이라 넣지 않았어요"
                          />
                        </div>
                        <Button variant="outline" onClick={() => void handleKeepAsIs()}>
                          까닭 남기기
                        </Button>
                      </div>
                    </div>
                  )}
                </CardContent>

                <CardFooter className="flex flex-col sm:flex-row gap-3">
                  <Button onClick={handleRevise} variant="outline" className="w-full sm:w-auto">
                    <RotateCcw className="mr-2 h-4 w-4" />
                    고쳐서 다시 쓰기
                  </Button>
                  <Button
                    onClick={handleNextQuestion}
                    className="w-full sm:w-auto ml-auto"
                    variant="outline"
                  >
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
