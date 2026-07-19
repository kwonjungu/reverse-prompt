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
import { collection, addDoc, serverTimestamp } from 'firebase/firestore';
import { useFirestore } from '@/firebase';

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
].map((q, i) => ({ ...q, imageUrl: `/questions/${['ta-01', 'ta-02', 'game-05', 'ta-04', 'ta-05', 'ta-06', 'ta-07', 'ta-08'][i]}.jpg` }));

const GAME_QUESTION_COUNT = 5;
// 기준 점수 — 평균이 이 점수 이상이어야 통과
const PASS_SCORE = 80;

type GameState = 'setup' | 'playing' | 'results';
type Result = EvaluatePromptOutput & { questionIndex: number; questionLevel: number; koreanTitle: string; studentPrompt: string; originalPrompt: string; };

// results 배열에서 콤보를 파생 (기준점은 PASS_SCORE 재사용).
// currentCombo: 배열 끝에서부터 연속으로 PASS_SCORE 이상인 개수
// maxCombo: 전체 스캔 중 나온 최대 연속 개수
function deriveCombo(results: Result[]): { currentCombo: number; maxCombo: number } {
  let maxCombo = 0;
  let run = 0;
  for (const r of results) {
    if (r.score >= PASS_SCORE) {
      run += 1;
      if (run > maxCombo) maxCombo = run;
    } else {
      run = 0;
    }
  }
  return { currentCombo: run, maxCombo };
}

export default function TimeAttackPage() {
  const db = useFirestore();
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

  const { toast } = useToast();
  const isPending = isEvaluating;
  const currentQuestion = useMemo(() => questions[currentQuestionIndex], [questions, currentQuestionIndex]);
  const { currentCombo, maxCombo } = useMemo(() => deriveCombo(results), [results]);

  useEffect(() => {
    if (gameState === 'playing' && !isPending) {
      setTimeLeft(timeLimit);
      if (timerRef.current) clearInterval(timerRef.current);

      timerRef.current = setInterval(() => {
        setTimeLeft(prev => {
          if (prev <= 1) {
            if (timerRef.current) clearInterval(timerRef.current);
            handleManualSubmit();
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    }
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [gameState, isPending, timeLimit]);

  useEffect(() => {
    if (gameState === 'playing') setStudentPrompt('');
  }, [gameState, currentQuestionIndex]);

  useEffect(() => {
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
      const promptToEvaluate = studentPrompt.trim() === '' ? '시간 안에 제출하지 못했습니다.' : studentPrompt;
      let result: EvaluatePromptOutput;

      try {
        const photoDataUri = await toDataURL(questions[currentQuestionIndex].imageUrl);
        result = await evaluatePrompt({ studentPrompt: promptToEvaluate, photoDataUri, questionLevel: questions[currentQuestionIndex]?.level });
      } catch (error) {
        result = { score: 0, feedback: 'AI 평가에 실패했습니다.' };
      }
      
      const q = questions[currentQuestionIndex];
      const newResults = [...results, {
        ...result,
        questionIndex: currentQuestionIndex,
        questionLevel: q?.level ?? 0,
        koreanTitle: q?.koreanTitle ?? '',
        studentPrompt: promptToEvaluate,
        originalPrompt: buildImagePrompt(q?.dataAiHint ?? ''),
      }];
      setResults(newResults);

      if (currentQuestionIndex < GAME_QUESTION_COUNT - 1) {
        setCurrentQuestionIndex(prev => prev + 1);
      } else {
        saveToFirestore(newResults);
        setGameState('results');
      }
    });
  }, [currentQuestionIndex, studentPrompt, results]);

  const saveToFirestore = (finalResults: Result[]) => {
    const classCode = sessionStorage.getItem('classCode');
    const attendanceNumber = sessionStorage.getItem('attendanceNumber');
    if (!db || !classCode || !attendanceNumber) return;

    const averageScore = finalResults.reduce((acc, r) => acc + r.score, 0) / finalResults.length;

    // Firestore는 배열 원소의 undefined 필드를 거부 → strongestAxis는 없으면 null로 정규화
    const sanitizedResults = finalResults.map((r) => ({
      ...r,
      strongestAxis: r.strongestAxis ?? null,
    }));

    const { maxCombo } = deriveCombo(finalResults);

    addDoc(collection(db, 'classes', classCode, 'submissions'), {
      attendanceNumber,
      nickname,
      results: sanitizedResults,
      averageScore,
      maxCombo,
      passScore: PASS_SCORE,
      passed: Math.round(averageScore) >= PASS_SCORE,
      mode: 'time-attack',
      createdAt: serverTimestamp()
    });
  };

  const restartChallenge = () => {
    const shuffled = [...allQuestions].sort(() => 0.5 - Math.random());
    setQuestions(shuffled.slice(0, GAME_QUESTION_COUNT));
    setResults([]);
    setCurrentQuestionIndex(0);
    setStudentPrompt('');
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
            <form onSubmit={(e) => { e.preventDefault(); if (nickname.trim()) setGameState('playing'); }} className="space-y-6">
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
    const averageScore = results.reduce((acc, r) => acc + r.score, 0) / results.length;
    const passed = Math.round(averageScore) >= PASS_SCORE;
    return (
        <div className="min-h-screen bg-background p-4 flex flex-col items-center justify-center">
            <Card className={`max-w-4xl w-full p-8 text-center space-y-6 shadow-2xl border-2 ${passed ? 'border-primary/20' : 'border-destructive/30'}`}>
                {passed ? (
                  <Trophy className="h-20 w-20 mx-auto text-yellow-400" />
                ) : (
                  <Zap className="h-20 w-20 mx-auto text-destructive" />
                )}
                <h1 className="text-5xl font-bold font-headline">{passed ? '기준 통과!' : '아쉬워요!'}</h1>
                <div className={`p-10 rounded-2xl border-2 ${passed ? 'bg-muted/50 border-primary/10' : 'bg-destructive/5 border-destructive/10'}`}>
                    <p className="text-muted-foreground text-xl">최종 평균 점수 (기준 {PASS_SCORE}점)</p>
                    <p className={`text-8xl font-black mt-2 ${passed ? 'text-primary' : 'text-destructive'}`}>{Math.round(averageScore)}점</p>
                    {maxCombo >= 2 && (
                      <p className="text-2xl font-bold text-orange-500 mt-4 animate-in fade-in zoom-in">
                        🔥 최대 {maxCombo}연속 {PASS_SCORE}점 돌파!
                      </p>
                    )}
                </div>
                <p className="text-xl">
                  {passed
                    ? `기준 점수 ${PASS_SCORE}점을 넘었어요! 결과가 선생님께 자동으로 전송되었습니다.`
                    : `기준 점수 ${PASS_SCORE}점에 조금 못 미쳤어요. 다시 도전해봐요! (결과는 선생님께 전송되었습니다)`}
                </p>
                <div className="flex flex-col sm:flex-row gap-3">
                  {!passed && (
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
                {currentCombo >= 2 && (
                  <span key={currentCombo} className="text-orange-500 text-lg animate-in fade-in zoom-in duration-300">
                    🔥 {currentCombo}연속!
                  </span>
                )}
            </div>
            <h2 className="font-bold text-lg">{nickname}님 ({currentQuestionIndex + 1}/{GAME_QUESTION_COUNT}) · 목표 {PASS_SCORE}점</h2>
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
