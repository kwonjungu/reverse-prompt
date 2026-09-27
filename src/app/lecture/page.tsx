'use client';

/**
 * 연수(강의) 모드 화면.
 *
 * 연수에서 강사와 참가자가 바로 써 보는 시연용 화면이다. 수업 번호·교사 로그인·
 * 차시 개방이 없고, 연수 번호를 한 번 넣으면 고정 20문항을 순서대로 쓴다.
 *
 * 지키는 것
 *   - **아무것도 저장하지 않는다.** 화면에도 그렇게 적어 둔다. 여기 채점 결과는 연구
 *     자료가 아니며 교사 화면·내보내기에 나타나지 않는다.
 *   - 결과는 연습 화면과 같은 학생 보기다. 100점 점수를 보이지 않고 영역별 네 칸(대상 ●●●○)과
 *     네 문장 피드백만 보인다. 해당 없음 영역은 숨긴다(공통 루브릭 v12-2).
 *   - 채점 허용 여부는 화면이 아니라 서버가 판정한다(@/server/lecture/actions).
 *     번호를 통과하지 않은 요청, 목록에 없는 문항은 서버가 거절한다.
 *   - 채점 결측을 0점·최저 수준으로 보여 주지 않는다.
 */

import { useCallback, useEffect, useState, useTransition } from 'react';
import Image from 'next/image';
import { LECTURE_QUESTIONS, lectureQuestionId } from '@/lib/lecture-questions';
import { FEEDBACK_CAUTION, FEEDBACK_FALLBACK_TEXT, FEEDBACK_LINE_COUNT } from '@/lib/feedback';
import { AREA_IDS, AREA_LABEL, type AreaId, type AreaLevels } from '@/lib/scoring';
import { STAGE_TITLE } from '@/lib/stages';
import {
  enterLectureAction,
  evaluateLectureAction,
  isLectureUnlockedAction,
  type LectureEvaluateResult,
} from '@/server/lecture/actions';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Skeleton } from '@/components/ui/skeleton';
import { PII_STUDENT_NOTICE } from '@/server/privacy';
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Info,
  RefreshCw,
  MessageSquareText,
  RotateCcw,
  Wand2,
} from 'lucide-react';

type DoneResult = Extract<LectureEvaluateResult, { status: 'done' }>;

const questions = LECTURE_QUESTIONS;

/** 네 문장 피드백의 줄 이름. 4문장은 표현 제안이거나 스스로 확인할 질문이다. */
const FEEDBACK_LINE_LABELS = ['이번 목표', '잘 쓴 점', '다음에 해 볼 것', '써 보거나 확인해 볼 것'] as const;

const AREA_BY_LABEL: Record<string, AreaId> = Object.fromEntries(
  AREA_IDS.map((a) => [AREA_LABEL[a], a])
) as Record<string, AreaId>;

/** 영역 하나의 네 칸. 찬 칸은 ●, 빈 칸은 ○. */
function LevelDots({ area, level }: { area: AreaId; level: 1 | 2 | 3 | 4 }) {
  return (
    <div className="flex items-center gap-3" aria-label={`${AREA_LABEL[area]} 네 칸 가운데 ${level}칸`}>
      <span className="w-10 text-sm font-semibold">{AREA_LABEL[area]}</span>
      <span className="text-xl tracking-[0.2em]" aria-hidden="true">
        <span className="text-primary">{'●'.repeat(level)}</span>
        <span className="text-muted-foreground/60">{'○'.repeat(4 - level)}</span>
      </span>
    </div>
  );
}

/** 해당 영역만 네 칸으로 보인다. 해당 없음(not_applicable) 영역은 숨긴다. */
function AreaLevelsView({ levels }: { levels: AreaLevels }) {
  return (
    <div className="space-y-2">
      {AREA_IDS.map((area) => {
        const level = levels[area];
        return typeof level === 'number' ? <LevelDots key={area} area={area} level={level} /> : null;
      })}
    </div>
  );
}

/**
 * 네 문장 피드백. 한 줄에 한 문장이며 2·3문장 앞의 [대상]·[특징]·[관계]는 영역 표시로 바꿔 보인다.
 * 고정 안내(fallback)나 줄 수가 맞지 않는 글은 그대로 한 덩어리로 보인다(문장을 지어 붙이지 않는다).
 */
function FeedbackLines({ text }: { text: string }) {
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  if (lines.length !== FEEDBACK_LINE_COUNT) {
    return <p className="whitespace-pre-wrap font-body text-base leading-relaxed text-muted-foreground">{text}</p>;
  }
  return (
    <ol className="space-y-3">
      {lines.map((line, i) => {
        const m = /^\[([^\]]{1,6})\]\s*/.exec(line);
        const area = m ? AREA_BY_LABEL[m[1]] : undefined;
        const body = m && area ? line.slice(m[0].length) : line;
        return (
          <li key={i} className="rounded-lg bg-muted/40 p-3">
            <p className="mb-1 flex items-center gap-2 text-xs font-semibold text-muted-foreground">
              {FEEDBACK_LINE_LABELS[i]}
              {area && (
                <span className="rounded-full border border-primary/40 px-2 py-0.5 text-[11px] text-primary">
                  {AREA_LABEL[area]}
                </span>
              )}
            </p>
            <p className="font-body text-base leading-relaxed">{body}</p>
          </li>
        );
      })}
    </ol>
  );
}

export default function LecturePage() {
  /** null = 아직 확인 중. 확인 전에는 문항을 그리지 않는다. */
  const [unlocked, setUnlocked] = useState<boolean | null>(null);
  const [code, setCode] = useState('');
  const [codeError, setCodeError] = useState<string | null>(null);
  const [isEntering, startEnter] = useTransition();

  const [index, setIndex] = useState(0);
  const [text, setText] = useState('');
  const [result, setResult] = useState<DoneResult | null>(null);
  const [blockedMessage, setBlockedMessage] = useState<string | null>(null);
  const [isSubmitting, startSubmit] = useTransition();

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const ok = await isLectureUnlockedAction();
        if (alive) setUnlocked(ok);
      } catch {
        if (alive) setUnlocked(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const question = questions[index];

  const reset = useCallback(() => {
    setText('');
    setResult(null);
    setBlockedMessage(null);
  }, []);

  const go = (next: number) => {
    if (next < 0 || next >= questions.length) return;
    setIndex(next);
    reset();
  };

  const handleEnter = (e: React.FormEvent) => {
    e.preventDefault();
    if (isEntering) return;
    startEnter(async () => {
      const res = await enterLectureAction(code);
      if (res.ok) {
        setUnlocked(true);
        setCodeError(null);
      } else {
        setCodeError(res.message);
      }
    });
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting) return;
    if (!text.trim()) {
      setBlockedMessage('그림을 보고 설명을 써 주세요.');
      return;
    }
    startSubmit(async () => {
      try {
        const res = await evaluateLectureAction({
          questionId: lectureQuestionId(question.level),
          text,
        });
        if (res.status === 'blocked') {
          setResult(null);
          setBlockedMessage(res.message);
          return;
        }
        setResult(res);
        setBlockedMessage(null);
      } catch {
        setResult(null);
        setBlockedMessage('보내지 못했어요. 잠시 뒤 다시 눌러 주세요. 쓴 글은 그대로 있어요.');
      }
    });
  };

  if (unlocked === null) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <p className="text-sm text-muted-foreground">잠시만 기다려 주세요.</p>
      </div>
    );
  }

  if (!unlocked) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-4">
        <main className="w-full max-w-sm">
          <div className="mb-8 text-center">
            <h1 className="mb-3 bg-gradient-to-r from-primary via-purple-400 to-pink-500 bg-clip-text font-headline text-4xl font-bold tracking-tight text-transparent">
              나는 프롬프트 마스터
            </h1>
            <p className="text-muted-foreground">연수용 체험판이에요.</p>
          </div>

          <Card className="rounded-2xl border-2 border-primary/20 bg-card/80 backdrop-blur-sm shadow-2xl shadow-primary/10">
            <CardHeader>
              <CardTitle className="text-center font-headline">연수 번호 입력</CardTitle>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleEnter} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="lecture-code">화면에 적힌 번호</Label>
                  <Input
                    id="lecture-code"
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                    inputMode="numeric"
                    autoComplete="off"
                    placeholder="번호를 입력하세요"
                    className="h-12 text-center text-lg tracking-widest"
                  />
                </div>
                {codeError && (
                  <Alert variant="destructive">
                    <AlertTriangle className="h-4 w-4" />
                    <AlertDescription>{codeError}</AlertDescription>
                  </Alert>
                )}
                <Button type="submit" size="lg" className="w-full font-bold" disabled={isEntering}>
                  {isEntering ? '들어가는 중이에요' : '시작하기'}
                </Button>
              </form>
              <p className="mt-4 text-xs text-muted-foreground">
                연수 체험판이라 쓴 글과 채점 결과를 저장하지 않습니다. 학생과 함께 쓰는 수업용 화면은
                따로 있습니다.
              </p>
            </CardContent>
          </Card>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background font-sans">
      <header className="border-b border-border/60 px-4 py-3">
        <div className="mx-auto flex max-w-4xl flex-wrap items-center justify-between gap-2">
          <p className="font-headline text-lg font-bold">나는 프롬프트 마스터 · 연수 체험판</p>
          <p className="text-sm tabular-nums text-muted-foreground">
            {index + 1} / {questions.length} 문항
          </p>
        </div>
      </header>

      <main className="container mx-auto p-4 sm:p-6 lg:p-8">
        <div className="mb-6 text-center">
          <p className="text-muted-foreground">
            그림을 보고 설명을 써 보세요. 몇 번이든 다시 쓸 수 있어요.
          </p>
        </div>

        <Alert className="mx-auto mb-6 max-w-4xl border-primary/40 bg-primary/5">
          <Info className="h-4 w-4" />
          <AlertTitle>연수 체험판입니다</AlertTitle>
          <AlertDescription>
            쓴 글과 채점 결과를 저장하지 않아요. 연구 자료로도 쓰이지 않습니다. 결과는 학생 화면과 같이
            점수 없이 대상·특징·관계의 네 칸과 네 문장 피드백으로 보여요.
          </AlertDescription>
        </Alert>

        <Card className="mx-auto max-w-4xl overflow-hidden rounded-2xl border-2 border-primary/20 bg-card/80 backdrop-blur-sm shadow-2xl shadow-primary/20">
          <div className="grid gap-0 md:grid-cols-5">
            <div className="md:col-span-3">
              <div className="relative aspect-[4/3] w-full bg-black/10">
                <Image
                  src={question.imageUrl}
                  alt="평가 이미지"
                  fill
                  className="rounded-tl-2xl object-contain md:rounded-l-2xl"
                  priority
                  sizes="(max-width: 768px) 100vw, 60vw"
                />
              </div>
            </div>

            <div className="flex flex-col md:col-span-2">
              <CardContent className="flex flex-grow flex-col p-6">
                <Alert className="mb-4 rounded-lg border-accent/50 bg-accent/80">
                  <BookOpen className="h-4 w-4 text-accent-foreground" />
                  <AlertTitle className="font-semibold text-accent-foreground">
                    힌트 · {question.chasi}단계 {STAGE_TITLE[question.chasi] ?? ''}
                  </AlertTitle>
                  <AlertDescription className="whitespace-pre-line font-body text-sm text-accent-foreground/90">
                    {question.rubric}
                  </AlertDescription>
                </Alert>

                <form onSubmit={handleSubmit} className="flex flex-grow flex-col">
                  <div className="grid w-full flex-grow gap-2">
                    <Label htmlFor="lecture-prompt" className="text-base font-medium">
                      나의 설명
                    </Label>
                    <Textarea
                      id="lecture-prompt"
                      placeholder="이 그림은..."
                      value={text}
                      onChange={(e) => setText(e.target.value)}
                      rows={5}
                      className="flex-grow bg-input/50 text-base transition-colors focus:bg-input/80"
                      disabled={isSubmitting}
                    />
                    <p className="mt-2 text-xs text-muted-foreground">{PII_STUDENT_NOTICE}</p>
                  </div>
                  <Button type="submit" size="lg" className="mt-4 w-full" disabled={isSubmitting}>
                    {isSubmitting ? (
                      <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <Wand2 className="mr-2 h-4 w-4" />
                    )}
                    평가 받기
                  </Button>
                </form>
              </CardContent>
            </div>
          </div>

          {blockedMessage && !isSubmitting && (
            <div className="p-6 pt-0">
              <Alert variant="destructive">
                <AlertTriangle className="h-4 w-4" />
                <AlertTitle>보내지 못했어요</AlertTitle>
                <AlertDescription>{blockedMessage}</AlertDescription>
              </Alert>
            </div>
          )}

          {isSubmitting && (
            <div className="space-y-4 p-6">
              <Skeleton className="h-8 w-1/3" />
              <div className="flex flex-col gap-6 sm:flex-row">
                <div className="w-40 space-y-2">
                  <Skeleton className="h-6 w-full" />
                  <Skeleton className="h-6 w-full" />
                  <Skeleton className="h-6 w-full" />
                </div>
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-6 w-full" />
                  <Skeleton className="h-6 w-5/6" />
                  <Skeleton className="h-6 w-full" />
                  <Skeleton className="h-6 w-4/6" />
                </div>
              </div>
            </div>
          )}

          {result && !isSubmitting && (
            <div className="animate-in fade-in-50 p-6 duration-500">
              <Card className="rounded-xl bg-card/80 backdrop-blur-sm">
                <CardHeader>
                  <CardTitle className="font-headline text-2xl tracking-tight">
                    AI 피드백
                  </CardTitle>
                </CardHeader>
                {result.scoring.status === 'missing' ? (
                  <CardContent>
                    {/* 결측은 0점·1수준이 아니다. 칸을 그리지 않고 다시 보내라고만 알린다. */}
                    <p className="text-base leading-loose text-muted-foreground">{result.scoring.message}</p>
                  </CardContent>
                ) : (
                  <CardContent className="flex flex-col gap-6 sm:flex-row sm:items-start">
                    <div className="shrink-0 rounded-xl border bg-background/60 p-4">
                      <AreaLevelsView levels={result.scoring.levels} />
                    </div>
                    <div className="flex-1">
                      <h4 className="mb-3 flex items-center gap-2 text-lg font-semibold">
                        <MessageSquareText className="h-5 w-5 text-primary" />
                        다시 쓸 때 볼 것
                      </h4>
                      <FeedbackLines text={result.feedback?.text ?? FEEDBACK_FALLBACK_TEXT} />
                    </div>
                  </CardContent>
                )}
                <CardContent className="pt-0">
                  <p className="border-t pt-3 text-sm text-muted-foreground">{FEEDBACK_CAUTION}</p>
                </CardContent>
                <CardFooter>
                  <Button variant="outline" onClick={reset} className="w-full sm:w-auto">
                    <RotateCcw className="mr-2 h-4 w-4" />
                    고쳐서 다시 쓰기
                  </Button>
                </CardFooter>
              </Card>
            </div>
          )}
        </Card>

        <nav className="mx-auto mt-6 flex max-w-4xl items-center justify-between gap-3">
          <Button variant="outline" onClick={() => go(index - 1)} disabled={index === 0}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            이전 문제
          </Button>
          <Button
            variant="outline"
            onClick={() => go(index + 1)}
            disabled={index === questions.length - 1}
          >
            다음 문제
            <ArrowRight className="ml-2 h-4 w-4" />
          </Button>
        </nav>
      </main>
    </div>
  );
}
