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
 *   - 학생은 고치지 않은 이유를 적지 않는다(논문 v12-2). 어떤 세션에서도 입력칸이 없고 서버도 받지 않는다.
 *     수정 과정은 제출할 때마다 자동으로 남는 시도 기록으로만 본다.
 *   - 제출 뒤 완료 수를 새로 받아 와도 보고 있는 문항과 결과는 그대로 둔다.
 *   - 순서 진행: 열린 단계(관리 화면의 수업 시작이 1~6단계를 모두 연다) 안에서 아직 내지 않은
 *     제시 순서상 가장 앞 문항으로 들어가고, 그보다 뒤 문항·단계는 보이지도 고르지도 못한다
 *     (src/lib/practice-progress.ts). 교사가 단계를 하나씩 열지 않는다.
 *   - 힌트는 문항별 힌트(목표 + 확인 질문, 검수를 마친 것만)를 먼저 쓰고, 없으면 단계 공통 안내를 쓴다.
 *     비공개 단서 팩에서 해당 없음인 영역의 확인 질문은 뺀다(서버가 영역 ID만 알려 준다).
 *   - 결과는 100점 점수 없이 영역별 단계(대상 ●●●○)와 4줄 피드백만 보여 준다(공통 루브릭 v12-2).
 *     피드백 아래에는 늘 고정 안내(FEEDBACK_CAUTION: 피드백이 틀릴 수 있어요…)를 붙인다.
 *     해당 없음 영역은 숨긴다. 단계 이름은 src/lib/stages.ts의 6단계 구성을 따른다.
 *   - 학급·신원은 서버 세션이 정한다. 화면이 sessionStorage의 학급코드·출석번호를 보내지 않는다.
 */

import { useState, useTransition, useMemo, useEffect, useCallback, useRef } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { PRACTICE_QUESTIONS } from '@/lib/questions';
import { FEEDBACK_CAUTION, FEEDBACK_FALLBACK_TEXT } from '@/lib/feedback';
import { STAGE_TITLE } from '@/lib/stages';
import { screenHintOf, type PracticeHint } from '@/lib/practice-hints';
import {
  AREA_IDS,
  AREA_LABEL,
  parseAreaLevel,
  type AreaId,
  type AreaLevel,
  type AreaLevels,
} from '@/lib/scoring';
import {
  landingQuestion,
  nextQuestionInOrder,
  openQuestionsInOrder,
  progressFrontier,
  reachableLessons,
} from '@/lib/practice-progress';
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
import { PII_STUDENT_NOTICE } from '@/server/privacy';
import { Label } from '@/components/ui/label';
import {
  ArrowRight,
  Wand2,
  RefreshCw,
  BookOpen,
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

// 단계 이름(STAGE_TITLE)은 논문 v12의 6단계 구성이며 정의는 src/lib/stages.ts 하나에 있다.

/** 한 단계의 문항 수. 정보 표시용이며 잠금 조건이 아니다. */
const QUESTIONS_PER_CHASI = 6;

/** 연습 문항 ID는 레지스트리와 같은 규칙(L01~L36)을 쓴다. */
const questionIdOf = (level: number) => `L${String(level).padStart(2, '0')}`;

/**
 * 순서 진행 계산에 쓰는 목록. index는 questions 배열의 위치다.
 * 진행은 문항 번호(level)가 아니라 제시 순서(order)를 따른다(3단계 L19–L24 → 4단계 L13–L18).
 */
const PROGRESS_LIST = questions.map((q, index) => ({
  id: questionIdOf(q.level),
  level: q.level,
  chasi: q.chasi,
  order: q.order,
  index,
}));

/**
 * 화면에 보일 영역 단계. 해당 없음(not_applicable) 영역은 숨긴다.
 * 정수 1~4가 아닌 값은 고쳐 보이지 않고 그 영역을 빼 둔다(형식 오류를 유효 값으로 바꾸지 않는다).
 */
function visibleAreaLevels(levels: AreaLevels): { area: AreaId; level: AreaLevel }[] {
  const out: { area: AreaId; level: AreaLevel }[] = [];
  for (const area of AREA_IDS) {
    const level = parseAreaLevel(levels[area]);
    if (typeof level === 'number') out.push({ area, level });
  }
  return out;
}

/** 저장된 피드백 문장(4줄, \n으로 이음)을 줄로 나눈다. 빈 줄은 뺀다. */
function feedbackLines(text: string): string[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

/** 영역 단계 점 — 채운 점(●)이 단계, 빈 점(○)이 남은 단계. 숫자·점수는 보이지 않는다. */
function AreaDots({ area, level }: { area: AreaId; level: AreaLevel }) {
  const label = AREA_LABEL[area];
  return (
    <li className="flex items-center gap-3">
      <span className="w-10 shrink-0 font-semibold">{label}</span>
      <span
        role="img"
        aria-label={`${label} 4단계 중 ${level}단계`}
        className="text-xl leading-none tracking-[0.2em]"
      >
        <span aria-hidden="true" className="text-primary">
          {'●'.repeat(level)}
        </span>
        <span aria-hidden="true" className="text-muted-foreground/40">
          {'○'.repeat(4 - level)}
        </span>
      </span>
    </li>
  );
}

/** 힌트 상자 — 목표 한 문장과 확인 질문. 영역에 딸리지 않은 선택 안내(C밴드)는 목록 아래에 둔다. */
function HintBody({ hint }: { hint: PracticeHint }) {
  const areaChecks = hint.checks.filter((c) => c.area !== null);
  const optional = hint.checks.filter((c) => c.area === null);
  return (
    <div className="space-y-2">
      <p className="font-medium">{hint.goal}</p>
      {areaChecks.length > 0 && (
        <ul className="list-disc space-y-1 pl-5">
          {areaChecks.map((c) => (
            <li key={`${c.area}:${c.text}`}>{c.text}</li>
          ))}
        </ul>
      )}
      {optional.map((c) => (
        <p key={c.text} className="text-xs opacity-80">
          {c.text}
        </p>
      ))}
    </div>
  );
}

/** 서버 제출 기록 + 이 화면에서 방금 낸 문항(+ 번호 없는 옛 반이면 이 기기 캐시). */
function submittedSetOf(state: LessonStateView | null, local: Iterable<string>): Set<string> {
  const set = new Set(local);
  for (const [id, n] of Object.entries(state?.attemptsByQuestion ?? {})) if (n > 0) set.add(id);
  return set;
}

/**
 * 번호 없는 옛 체험 반의 진행 캐시.
 *
 * 연구 세션과 번호가 있는 일반 수업은 서버의 제출 기록이 근거다(다시 들어와도 번호로 이어진다).
 * 번호 없는 옛 반만 다시 들어오면 무엇을 했는지 서버가 알 수 없어, 이 기기에만 남는 캐시로
 * 이어 보여 준다. 한 기기를 여러 학생이 쓰므로 번호로 이어지는 반에서는 읽지도 쓰지도 않는다.
 * 이 값은 접근 권한·동의·완료의 근거가 아니다.
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
  /** 이 화면에서 낸 문항(+ 번호 없는 옛 반이면 이 기기 캐시). 서버 기록을 새로 받기 전에도 순서 진행에 쓴다. */
  const [cachedQuestionIds, setCachedQuestionIds] = useState<string[]>([]);
  const localSubmittedRef = useRef<Set<string>>(new Set());
  const { toast } = useToast();

  /** URL의 lesson 값은 요청일 뿐이다. 허용 여부는 서버가 정한다. */
  const requestedLessonFromUrl = () => {
    if (typeof window === 'undefined') return null;
    const raw = new URLSearchParams(window.location.search).get('lesson');
    const n = Number(raw);
    return raw !== null && Number.isFinite(n) ? n : null;
  };

  /**
   * keepPosition: 제출·기록 뒤 완료 수만 새로 받아 온다. 보고 있는 문항과 결과를 건드리지 않는다.
   * (예전에는 여기서 문항을 단계 첫 문항으로 되돌려, 2번째 문항부터 제출하면 결과가 사라지고
   * 첫 문항 빈 칸으로 튕겼다.)
   */
  const loadLessonState = useCallback(async (
    requested: number | null,
    opts?: { keepPosition?: boolean; initial?: boolean }
  ) => {
    try {
      const state = await getLessonStateAction(requested);
      if (opts?.initial && !state.progressAcrossEntries) {
        for (const id of readCachedQuestionIds()) localSubmittedRef.current.add(id);
        setCachedQuestionIds([...localSubmittedRef.current]);
      }
      setLessonState(state);
      setLoadError(null);
      if (opts?.keepPosition) return state;
      if (state.deniedMessage) setBlockedMessage(state.deniedMessage);
      // 아직 내지 않은 제시 순서상 가장 앞 문항(단계 단추를 눌렀으면 그 단계 안에서)으로 들어간다.
      const target = landingQuestion(
        openQuestionsInOrder(PROGRESS_LIST, state.allowedLessons),
        submittedSetOf(state, localSubmittedRef.current),
        { lesson: requested, fallbackLesson: state.entryLesson }
      );
      if (target) {
        setCurrentChasi(target.chasi);
        setCurrentQuestionIndex(target.index);
      } else {
        setCurrentChasi(state.entryLesson);
      }
      return state;
    } catch {
      setLoadError('지금 수업 상태를 확인하지 못했어요. 잠시 뒤 다시 해 볼까요?');
      return null;
    }
  }, []);

  useEffect(() => {
    void loadLessonState(requestedLessonFromUrl(), { initial: true });
  }, [loadLessonState]);

  const currentQuestion = questions[currentQuestionIndex];

  const chasiQuestions = useMemo(
    () => questions.filter((q) => q.chasi === currentChasi),
    [currentChasi]
  );
  const posInChasi = currentQuestion
    ? chasiQuestions.findIndex((q) => q.level === currentQuestion.level)
    : -1;

  const submittedIds = useMemo(
    () => submittedSetOf(lessonState, cachedQuestionIds),
    [lessonState, cachedQuestionIds]
  );
  /** 열린 단계의 문항(제시 순서)과, 그 가운데 아직 내지 않은 가장 앞 문항. */
  const orderedOpen = useMemo(
    () => openQuestionsInOrder(PROGRESS_LIST, lessonState?.allowedLessons ?? []),
    [lessonState]
  );
  const frontier = useMemo(() => progressFrontier(orderedOpen, submittedIds), [orderedOpen, submittedIds]);
  /** 단추를 보여 줄 단계. 진행 위치보다 뒤 단계는 보이지 않는다. */
  const visibleLessons = useMemo(() => reachableLessons(orderedOpen, frontier), [orderedOpen, frontier]);

  /** 차시별 제출 문항 수. 서버의 제출 기록이 근거다. */
  const attemptedCount = useCallback(
    (chasi: number) =>
      questions.filter((q) => q.chasi === chasi && submittedIds.has(questionIdOf(q.level))).length,
    [submittedIds]
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
          void loadLessonState(currentChasi, { keepPosition: true });
          // 서버 기록을 새로 받기 전에도 다음 문항이 열리도록 이 화면에 바로 남긴다.
          localSubmittedRef.current.add(questionIdOf(currentQuestion.level));
          const next = [...localSubmittedRef.current];
          setCachedQuestionIds(next);
          // 번호 없는 옛 반만 이 기기에 남긴다(다시 들어오면 서버가 이어 주지 못하므로).
          if (lessonState && !lessonState.progressAcrossEntries) writeCachedQuestionIds(next);
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

  /** 제시 순서의 다음 문항. 단계를 넘어갈 수 있고, 지금 문항을 내지 못했으면 넘어가지 않는다. */
  const handleNextQuestion = () => {
    if (!currentQuestion) return;
    const next = nextQuestionInOrder(
      orderedOpen,
      submittedSetOf(lessonState, localSubmittedRef.current),
      currentQuestion.level
    );
    if (!next) {
      toast({ title: '이 문항을 먼저 내 주세요', description: '글이 저장되면 다음 문제가 열려요.' });
      return;
    }
    setCurrentChasi(next.chasi);
    setCurrentQuestionIndex(next.index);
  };

  /**
   * 배지 색은 단계를 따른다. 제시 순서가 문항 번호와 다르므로(3단계 L19–L24 → 4단계 L13–L18)
   * 번호로 색을 정하면 단계가 올라가도 색이 거꾸로 간다.
   */
  const stageColor = (chasi: number) => {
    if (chasi <= 1) return 'bg-green-100 text-green-800 border-green-200';
    if (chasi === 2) return 'bg-yellow-100 text-yellow-800 border-yellow-200';
    if (chasi === 3) return 'bg-orange-100 text-orange-800 border-orange-200';
    if (chasi === 4) return 'bg-red-100 text-red-800 border-red-200';
    if (chasi === 5) return 'bg-pink-100 text-pink-800 border-pink-200';
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
  /**
   * 검수를 마친 문항 힌트. 해당 없음인 영역의 확인 질문은 뺀다 — 단서 팩이 있으면 단서 팩, 없으면 코드의 기본 목록.
   * 서버는 영역 ID만 알려 준다(단서 내용은 오지 않는다). 서버 값이 없으면 기본 목록을 쓴다.
   */
  const hint = screenHintOf(
    questionIdOf(currentQuestion.level),
    lessonState.notApplicableAreas
      ? lessonState.notApplicableAreas[questionIdOf(currentQuestion.level)] ?? []
      : undefined
  );
  const areaRows = result?.scoring.status === 'scored' ? visibleAreaLevels(result.scoring.levels) : [];

  return (
    <div className="min-h-screen bg-background font-sans">
      <header className="p-4 flex justify-between items-center">
        <div className="flex items-center gap-3">
          {/*
            문항 번호(level)로 'Lv.' 표시를 하면 3단계 L19–L24 → 4단계 L13–L18에서 숫자가 거꾸로 가
            난이도가 내려가는 것처럼 보인다. 제시 순서(order)로 전체 가운데 몇 번째인지만 보인다.
          */}
          <Badge
            variant="outline"
            className={`text-sm px-3 py-1 border ${stageColor(currentQuestion.chasi)}`}
          >
            {currentQuestion.order} / {questions.length}
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

      {/* 단계 선택 — 열린 단계 가운데 진행 위치까지만 나온다(practice-progress). */}
      <nav className="px-4 pb-4" aria-label="단계 선택">
        <ol className="mx-auto flex max-w-4xl flex-wrap justify-center gap-2">
          {visibleLessons.map((c) => {
            const active = c === currentChasi;
            return (
              <li key={c}>
                <button
                  type="button"
                  onClick={() => void goToChasi(c)}
                  aria-current={active ? 'step' : undefined}
                  title={STAGE_TITLE[c]}
                  className={[
                    'flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs transition',
                    active
                      ? 'border-primary bg-primary text-primary-foreground shadow'
                      : 'border-primary/30 bg-card hover:bg-accent',
                  ].join(' ')}
                >
                  <span className="font-semibold">{c}단계</span>
                  <span className="hidden sm:inline opacity-80">{STAGE_TITLE[c]}</span>
                  <span className="tabular-nums opacity-70">
                    {attemptedCount(c)}/{QUESTIONS_PER_CHASI} 문항
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
        <p className="mt-2 text-center text-xs text-muted-foreground">
          앞 문항을 내면 다음 문항이 열려요.
        </p>
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
            {currentChasi}단계 · {STAGE_TITLE[currentChasi]}
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            그림을 보고 설명을 써 보세요. 몇 번이든 다시 도전할 수 있어요.
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            지금까지 이 단계에서 {doneInChasi}/{QUESTIONS_PER_CHASI} 문항을 냈어요.
          </p>
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
                    {hint ? <HintBody hint={hint} /> : currentQuestion.rubric}
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
                    {/* 학생에게는 짧은 행동 안내만. 문구 사본이 아니라 원문 상수를 쓴다. */}
                    <p className="mt-2 text-xs text-muted-foreground">{PII_STUDENT_NOTICE}</p>
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
              <div className="space-y-2">
                <Skeleton className="h-5 w-40" />
                <Skeleton className="h-5 w-40" />
                <Skeleton className="h-5 w-40" />
              </div>
              <div className="space-y-2">
                <Skeleton className="h-6 w-full" />
                <Skeleton className="h-6 w-5/6" />
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
                    AI 피드백
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-5">
                  {/*
                    100점 점수는 보여 주지 않는다(공통 루브릭 v12-2). 영역별 단계(●●●○)와 4줄 피드백만.
                    해당 없음 영역은 숨긴다. 결측이면 단계를 만들지 않고 안내만 한다(0점·1단계로 보이지 않게).
                  */}
                  {result.scoring.status === 'missing' ? (
                    <p className="text-base leading-loose text-muted-foreground">
                      {result.scoring.message}
                    </p>
                  ) : (
                    <>
                      {areaRows.length > 0 && (
                        <ul className="space-y-2" aria-label="영역별 단계">
                          {areaRows.map(({ area, level }) => (
                            <AreaDots key={area} area={area} level={level} />
                          ))}
                        </ul>
                      )}
                      <div className="space-y-2 font-body text-base leading-relaxed text-muted-foreground">
                        {feedbackLines(result.feedback?.text ?? FEEDBACK_FALLBACK_TEXT).map((line, i) => (
                          <p key={i}>{line}</p>
                        ))}
                      </div>
                    </>
                  )}
                  <p className="text-sm text-muted-foreground border-t pt-3">{FEEDBACK_CAUTION}</p>
                </CardContent>

                {(
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
                )}
              </Card>
            </div>
          )}
        </Card>
      </main>
    </div>
  );
}
