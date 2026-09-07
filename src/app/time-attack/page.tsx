'use client';

import { useState, useTransition, useMemo, useEffect, useRef, useCallback } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { evaluatePrompt, type EvaluatePromptOutput } from '@/ai/flows/evaluate-prompt';
import { buildImagePrompt } from '@/lib/image-prompt';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Home, ArrowRight, Wand2, RefreshCw, BookOpen, Trophy, Timer, Zap } from 'lucide-react';
import { useToast } from "@/hooks/use-toast";
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert';
import { Progress } from "@/components/ui/progress";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Slider } from '@/components/ui/slider';
import { ModeGuard } from '@/components/mode-guard';

const allQuestions = [
  {
    level: 13,
    koreanTitle: '네온 빛 미래 도시의 밤거리',
    dataAiHint: 'a futuristic city with flying cars and towering skyscrapers at night',
    rubric: '미래 도시 여행 가이드를 쓰듯 이 장면을 설명해봐요!\n\n어떤 도시인지, 하늘에 무엇이 날고 있는지, 건물 빛 색깔, 전체 분위기... 빠르게, 하지만 생생하게!',
  },
  {
    level: 12,
    koreanTitle: '우주를 떠다니는 우주비행사',
    dataAiHint: 'an astronaut floating in space, stars and planets in the background',
    rubric: '우주 탐사 보고서를 빠르게 작성해봐요!\n\n우주비행사 복장, 자세, 배경에 보이는 지구·별·행성, 전체 느낌... 30초 안에 최대한 자세히!',
  },
  {
    level: 13,
    koreanTitle: '밤의 안개 숲을 달리는 빛나는 유니콘',
    dataAiHint: 'a glowing magical unicorn running through a misty lavender forest at night',
    rubric: '마법 생물 목격 신고서를 빠르게 써봐요!\n\n유니콘 색깔·특징, 달리는 모습, 숲 배경, 빛과 안개, 분위기... 시간이 없어요!',
  },
  {
    level: 14,
    koreanTitle: '빛나는 건물과 물고기 떼의 바닷속 도시',
    dataAiHint: 'an underwater city with glowing buildings and fish swimming by',
    rubric: '바닷속 도시 첫 발견 보고서를 작성해봐요!\n\n건물 모양과 빛 색깔, 지나가는 물고기들, 물빛, 전체 분위기... 최대한 많이!',
  },
  {
    level: 11,
    koreanTitle: '무대 위 노래하는 로봇 고양이',
    dataAiHint: 'a robot cat singing on a stage, colorful spotlights, futuristic audience',
    rubric: '공연 실황 중계를 해봐요!\n\n로봇 고양이 모습, 무대 조명 색깔, 관중석 분위기, 전체 에너지... 생생하게 전달해봐요!',
  },
  {
    level: 12,
    koreanTitle: '새벽 언덕 위의 열기구 축제',
    dataAiHint: 'a hot air balloon festival over rolling green hills at sunrise, many colorful striped balloons floating in an orange and pink sky',
    rubric: '축제 홍보 문구를 빠르게 써봐요!\n\n열기구 개수와 색깔, 언덕, 새벽 하늘 색... 시간이 없어요!',
  },
  {
    level: 11,
    koreanTitle: '따뜻한 빵집 안 풍경',
    dataAiHint: 'a cozy bakery interior with fresh breads and cakes displayed on wooden shelves, warm yellow lighting, a glass display counter',
    rubric: '빵집 소개글을 번개처럼 써봐요!\n\n어떤 빵들이 보이는지, 선반과 진열대, 조명 분위기... 침이 고이게!',
  },
  {
    level: 14,
    koreanTitle: '폭풍우 바다의 해적선',
    dataAiHint: 'a pirate ship with black sails on stormy ocean waves, dark clouds and lightning in the background, dramatic lighting',
    rubric: '모험 소설의 클라이맥스를 써봐요!\n\n배와 돛 색깔, 파도, 하늘과 번개, 긴박한 분위기... 빠르고 생생하게!',
  },
  // 이미지는 사전 생성된 정적 파일 (scripts/generate-question-images.mjs).
  // 3번(유니콘)은 게임 모드와 같은 힌트라 game-05 파일 공유.
].map((q, i) => {
  // questionId는 서버 레지스트리가 밴드·이미지·단서를 확정하는 유일한 근거다.
  // 시간 제한 모드 문항은 아직 레지스트리에 등록되어 있지 않아 채점이 거부된다.
  // 이 모드는 연구 세션에서 차단되므로 여기서 문항을 새로 만들지 않고 ID 규칙만 맞춰 둔다.
  const questionId = ['ta-01', 'ta-02', 'game-05', 'ta-04', 'ta-05', 'ta-06', 'ta-07', 'ta-08'][i];
  return { ...q, questionId, imageUrl: `/questions/${questionId}.jpg` };
});

const GAME_QUESTION_COUNT = 5;
// 기준 점수 — 평균이 이 점수 이상이어야 통과
const PASS_SCORE = 80;

/**
 * 일반 체험의 진행 이력 — 이 기기에만 남는 캐시다.
 *
 * 새로 고쳐도 하던 곳에서 이어지도록 화면 안에서만 쓴다.
 * 권한·완료·점수의 근거로 쓰지 않는다.
 */
const PROGRESS_KEY = 'experience:time-attack:v1';
/** 오래된 기록으로 엉뚱하게 이어지지 않도록 반나절만 둔다. */
const PROGRESS_TTL_MS = 12 * 60 * 60 * 1000;

type TimeAttackProgress = {
  savedAt: number;
  nickname: string;
  timeLimit: number;
  questionIds: string[];
  currentQuestionIndex: number;
  results: Result[];
};

function readProgress(): TimeAttackProgress | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(PROGRESS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as TimeAttackProgress;
    if (!parsed || typeof parsed.savedAt !== 'number') return null;
    if (Date.now() - parsed.savedAt > PROGRESS_TTL_MS) return null;
    if (!Array.isArray(parsed.questionIds) || !Array.isArray(parsed.results)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeProgress(p: Omit<TimeAttackProgress, 'savedAt'>) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(PROGRESS_KEY, JSON.stringify({ ...p, savedAt: Date.now() }));
  } catch {
    // 저장 공간이 없으면 그냥 두고 화면 안에서만 이어 간다.
  }
}

function clearProgress() {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(PROGRESS_KEY);
  } catch {
    // 지우지 못해도 화면 동작에는 영향이 없다.
  }
}

type GameState = 'setup' | 'playing' | 'results';
/**
 * 채점 결과를 화면이 쓰는 모양으로 줄인 것.
 * 결측(status:'missing')이면 score는 0이 아니라 null이다.
 */
type Result = {
  questionIndex: number;
  questionLevel: number;
  koreanTitle: string;
  studentPrompt: string;
  originalPrompt: string;
  score: number | null;
  feedback: string;
};

/**
 * 시간 제한 모드는 일반 체험에서만 연다. 연구 세션에서는 진입을 거부한다(수용시험 7).
 * 기능은 그대로 두고 가드만 감싼다. 차단의 근거는 화면이 아니라 서버 판정이며,
 * route(middleware)·API가 각각 다시 거부한다.
 */
export default function TimeAttackPage() {
  return (
    <ModeGuard mode="time-attack">
      <TimeAttackScreen />
    </ModeGuard>
  );
}

function TimeAttackScreen() {
  const [gameState, setGameState] = useState<GameState>('setup');
  const [nickname, setNickname] = useState('');
  const [timeLimit, setTimeLimit] = useState(30);
  const [questions, setQuestions] = useState(allQuestions.slice(0, GAME_QUESTION_COUNT));
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
  const [studentPrompt, setStudentPrompt] = useState('');
  const [results, setResults] = useState<Result[]>([]);
  const [isEvaluating, startEvaluationTransition] = useTransition();
  const [timeLeft, setTimeLeft] = useState(timeLimit);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  /** 이 기기에 남아 있던 진행 이력에서 이어 왔는지. 안내 문구에만 쓴다. */
  const [restored, setRestored] = useState(false);
  /**
   * 자동 제출이 학생의 최신 글을 버리지 않도록 최신 값을 ref에 담아 둔다.
   * 타이머 콜백은 만들어진 시점의 값을 붙들고 있어서 state를 직접 읽으면 옛 값이 간다.
   */
  const studentPromptRef = useRef(studentPrompt);
  const resultsRef = useRef<Result[]>([]);
  const submitRef = useRef<() => void>(() => {});

  const { toast } = useToast();
  const isPending = isEvaluating;
  const currentQuestion = useMemo(() => questions[currentQuestionIndex], [questions, currentQuestionIndex]);

  // 최신 입력과 최신 제출 함수를 ref에 담아 둔다. 타이머가 옛 값을 붙들지 않게 한다.
  useEffect(() => {
    studentPromptRef.current = studentPrompt;
  }, [studentPrompt]);

  useEffect(() => {
    resultsRef.current = results;
  }, [results]);

  useEffect(() => {
    if (gameState === 'playing' && !isPending) {
      setTimeLeft(timeLimit);
      if (timerRef.current) clearInterval(timerRef.current);

      timerRef.current = setInterval(() => {
        setTimeLeft(prev => {
          if (prev <= 1) {
            if (timerRef.current) clearInterval(timerRef.current);
            // 시간이 끝나 자동으로 낼 때도 학생이 마지막으로 쓴 글이 그대로 간다.
            submitRef.current();
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    }
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [gameState, isPending, timeLimit]);

  useEffect(() => {
    if (gameState === 'playing') {
      setStudentPrompt('');
      studentPromptRef.current = '';
    }
  }, [gameState, currentQuestionIndex]);

  useEffect(() => {
    // 새로 고쳐도 하던 곳에서 이어지도록 이 기기의 캐시를 읽는다. 서버 기록이 아니다.
    const saved = readProgress();
    const restoredQuestions = saved
      ? saved.questionIds
          .map((id) => allQuestions.find((q) => q.questionId === id))
          .filter((q): q is (typeof allQuestions)[number] => Boolean(q))
      : [];
    if (saved && restoredQuestions.length === GAME_QUESTION_COUNT && saved.nickname) {
      setQuestions(restoredQuestions);
      setNickname(saved.nickname);
      setResults(saved.results);
      resultsRef.current = saved.results;
      if (Number.isFinite(saved.timeLimit)) setTimeLimit(saved.timeLimit);
      setCurrentQuestionIndex(Math.min(saved.currentQuestionIndex, GAME_QUESTION_COUNT - 1));
      setGameState(saved.results.length >= GAME_QUESTION_COUNT ? 'results' : 'playing');
      setRestored(true);
      return;
    }
    const shuffled = [...allQuestions].sort(() => 0.5 - Math.random());
    setQuestions(shuffled.slice(0, GAME_QUESTION_COUNT));
  }, []);

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

  const handleManualSubmit = useCallback(async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (timerRef.current) clearInterval(timerRef.current);

    startEvaluationTransition(async () => {
      // 최신 입력은 ref에서 읽는다. 자동 제출이 학생 글을 통째로 버리지 않게 하기 위함이다.
      const typed = studentPromptRef.current.trim();
      const promptToEvaluate = typed === '' ? '시간 안에 제출하지 못했습니다.' : typed;
      const q = questions[currentQuestionIndex];
      let score: number | null = null;
      let feedback = '채점을 마치지 못했어요. 선생님과 함께 확인해요.';

      try {
        // 밴드·이미지·단서는 서버가 questionId로 확정한다. 클라이언트 이미지 URI를 보내지 않는다.
        const result = await evaluatePrompt({ questionId: q.questionId, studentPrompt: promptToEvaluate });
        score = result.result.status === 'scored' ? result.result.score : null;
        feedback = result.feedback?.text ?? feedback;
      } catch (error) {
        // 채점 실패는 결측이다. 0점으로 만들지 않는다.
        console.error('채점 실패:', error);
      }

      const newResults = [...resultsRef.current, {
        questionIndex: currentQuestionIndex,
        questionLevel: q?.level ?? 0,
        koreanTitle: q?.koreanTitle ?? '',
        studentPrompt: promptToEvaluate,
        originalPrompt: buildImagePrompt(q?.dataAiHint ?? ''),
        score,
        feedback,
      }];
      resultsRef.current = newResults;
      setResults(newResults);

      const finished = currentQuestionIndex >= GAME_QUESTION_COUNT - 1;
      // 이 기기에서 이어 볼 수 있게만 남긴다. 서버에 보내지 않는다.
      writeProgress({
        nickname,
        timeLimit,
        questionIds: questions.map((qq) => qq.questionId),
        currentQuestionIndex: finished ? currentQuestionIndex : currentQuestionIndex + 1,
        results: newResults,
      });
      if (!finished) {
        setCurrentQuestionIndex(prev => prev + 1);
      } else {
        setGameState('results');
      }
    });
  }, [currentQuestionIndex, questions, nickname, timeLimit]);

  // 타이머가 부를 최신 제출 함수를 매 렌더마다 갱신한다.
  useEffect(() => {
    submitRef.current = () => {
      void handleManualSubmit();
    };
  });

  const restartChallenge = () => {
    clearProgress();
    const shuffled = [...allQuestions].sort(() => 0.5 - Math.random());
    setQuestions(shuffled.slice(0, GAME_QUESTION_COUNT));
    setResults([]);
    resultsRef.current = [];
    setCurrentQuestionIndex(0);
    setStudentPrompt('');
    studentPromptRef.current = '';
    setRestored(false);
    setGameState('playing');
  };

  if (gameState === 'setup') {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <Card className="max-w-md w-full shadow-2xl rounded-2xl bg-card/80 backdrop-blur-sm border-2 border-primary/20">
          <CardHeader>
            <Zap className="h-12 w-12 mx-auto text-primary mb-2" />
            <CardTitle className="text-3xl font-headline text-center">시간 제한 모드</CardTitle>
            <CardDescription className="text-center">평균 {PASS_SCORE}점을 넘어야 통과! 더 빠르게, 더 정확하게 설명해보세요!</CardDescription>
          </CardHeader>
          <CardContent>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (!nickname.trim()) return;
                // 새 도전을 시작하면 이 기기에 남은 이전 진행 이력을 지운다.
                clearProgress();
                setResults([]);
                resultsRef.current = [];
                setCurrentQuestionIndex(0);
                setRestored(false);
                setGameState('playing');
              }}
              className="space-y-6"
            >
              <div className="space-y-2">
                <Label htmlFor="nickname" className="font-bold">나의 닉네임</Label>
                <Input id="nickname" value={nickname} onChange={e => setNickname(e.target.value)} placeholder="용감한 프롬프터" className="h-12 text-lg" />
              </div>
              <div className="space-y-4">
                <div className="flex justify-between font-bold">
                    <Label>문제당 시간 제한</Label>
                    <span className="text-primary">{timeLimit}초</span>
                </div>
                <Slider min={10} max={120} step={5} value={[timeLimit]} onValueChange={(v) => setTimeLimit(v[0])} />
              </div>
              <Button type="submit" className="w-full font-bold h-14 text-xl" size="lg">도전 시작!</Button>
              <Link href="/" className="block text-center mt-4 text-sm text-muted-foreground hover:text-primary">홈으로 돌아가기</Link>
            </form>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (gameState === 'results') {
    const scoredResults = results.filter((r): r is Result & { score: number } => r.score !== null);
    const averageScore = scoredResults.length
      ? scoredResults.reduce((acc, r) => acc + r.score, 0) / scoredResults.length
      : null;
    const passed = averageScore !== null && Math.round(averageScore) >= PASS_SCORE;
    // 채점을 마치지 못한 것은 기준 미달이 아니다. 0점으로도, 미달로도 보이게 하지 않는다.
    const unscored = averageScore === null;
    return (
        <div className="min-h-screen bg-background p-4 flex flex-col items-center justify-center">
            <Card className={`max-w-4xl w-full p-8 text-center space-y-6 shadow-2xl border-2 ${passed ? 'border-primary/20' : 'border-destructive/30'}`}>
                {passed ? (
                  <Trophy className="h-20 w-20 mx-auto text-yellow-400" />
                ) : (
                  <Zap className="h-20 w-20 mx-auto text-destructive" />
                )}
                <h1 className="text-5xl font-bold font-headline">
                  {unscored ? '채점을 마치지 못했어요' : passed ? '기준 통과!' : '아쉬워요!'}
                </h1>
                <div className={`p-10 rounded-2xl border-2 ${passed ? 'bg-muted/50 border-primary/10' : 'bg-destructive/5 border-destructive/10'}`}>
                    <p className="text-muted-foreground text-xl">최종 평균 점수 (기준 {PASS_SCORE}점)</p>
                    <p className={`text-8xl font-black mt-2 ${passed ? 'text-primary' : 'text-destructive'}`}>{averageScore === null ? '채점 못함' : `${Math.round(averageScore)}점`}</p>
                </div>
                <p className="text-xl">
                  {unscored
                    ? '점수를 낼 수 없었어요. 쓴 글이 잘못된 것은 아니에요. 다시 도전해도 좋아요.'
                    : passed
                      ? `기준 점수 ${PASS_SCORE}점을 넘었어요!`
                      : `기준 점수 ${PASS_SCORE}점에 조금 못 미쳤어요. 다시 도전해봐요!`}
                </p>
                {/* 결과를 서버에 보내지 않는다. 보내지 않은 것을 보냈다고 쓰지 않는다. */}
                <Alert className="border-primary/30 bg-primary/5 text-left">
                  <Timer className="h-4 w-4" />
                  <AlertTitle>이 결과는 이 기기에만 남아요</AlertTitle>
                  <AlertDescription>
                    시간 제한 모드 결과는 선생님께 전송되지 않아요. 보여 주고 싶으면 이 화면을
                    직접 보여 주세요.
                  </AlertDescription>
                </Alert>
                <div className="flex flex-col sm:flex-row gap-3">
                  {(!passed || unscored) && (
                    <Button size="lg" className="w-full h-16 text-xl font-bold" onClick={restartChallenge}>
                      <RefreshCw className="mr-2 h-6 w-6" /> 다시 도전하기
                    </Button>
                  )}
                  <Link href="/" passHref className="w-full">
                      <Button size="lg" variant={passed ? 'default' : 'outline'} className="w-full h-16 text-xl font-bold">홈으로 돌아가기</Button>
                  </Link>
                </div>
            </Card>
        </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
       <header className="p-4 flex justify-between items-center bg-card/80 backdrop-blur-md sticky top-0 z-10 border-b">
            <div className="flex items-center gap-4 text-2xl font-black">
                <Timer className="h-8 w-8 text-primary" />
                <span className={timeLeft <= 5 ? "text-destructive animate-pulse" : "text-primary"}>{timeLeft}초</span>
            </div>
            <h2 className="font-bold text-lg">
              {nickname}님 ({currentQuestionIndex + 1}/{GAME_QUESTION_COUNT}) · 목표 {PASS_SCORE}점
              {restored && (
                <span className="ml-2 text-xs font-normal text-muted-foreground">
                  하던 곳에서 이어 왔어요
                </span>
              )}
            </h2>
       </header>
      <main className="container mx-auto p-4 max-w-6xl mt-4">
        <Card className="grid md:grid-cols-2 gap-0 overflow-hidden rounded-2xl border-2 border-primary/20 bg-card/80 backdrop-blur-sm">
            <div className="relative aspect-square md:aspect-auto bg-black/10">
                {isEvaluating ? (
                    <div className="absolute inset-0 flex items-center justify-center bg-muted animate-pulse">
                        <RefreshCw className="h-12 w-12 animate-spin text-primary" />
                    </div>
                ) : (
                    <Image src={currentQuestion.imageUrl} alt="평가 이미지" fill className="object-contain" priority />
                )}
            </div>
            <div className="p-8 space-y-6 flex flex-col">
                <Alert className="bg-primary/5 border-primary/20">
                    <BookOpen className="h-5 w-5 text-primary" />
                    <AlertTitle className="font-bold text-lg">번개처럼 설명하세요!</AlertTitle>
                    <AlertDescription className="whitespace-pre-line text-base mt-2">{currentQuestion?.rubric}</AlertDescription>
                </Alert>
                <form onSubmit={handleManualSubmit} className="flex-grow flex flex-col gap-4">
                    <div className="flex-grow">
                        <Label className="text-xl font-bold">나의 프롬프트 ✨</Label>
                        <Textarea 
                            value={studentPrompt} 
                            onChange={e => setStudentPrompt(e.target.value)}
                            placeholder="시간이 얼마 없어요! 그림을 자세히 설명해주세요."
                            className="h-full min-h-[250px] mt-3 text-lg p-4 bg-input/50"
                        />
                    </div>
                    <Button size="lg" className="w-full text-2xl font-black h-20" disabled={isPending}>
                        제출하기!
                    </Button>
                </form>
            </div>
        </Card>
      </main>
    </div>
  );
}
