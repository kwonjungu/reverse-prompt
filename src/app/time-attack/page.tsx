'use client';

import { useState, useTransition, useMemo, useEffect, useRef, useCallback } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { evaluatePrompt, type EvaluatePromptOutput } from '@/ai/flows/evaluate-prompt';
import { generateImage } from '@/ai/flows/generate-image';
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
        dataAiHint: 'a futuristic city with flying cars and towering skyscrapers at night',
        rubric: '누가/무엇을: 도시에 무엇이 보이나요? (고층 빌딩, 날아다니는 자동차 등)\n어떻게: 조명이나 도시의 움직임은 어떤가요? (반짝이는 불빛, 빠른 움직임)\n분위기: 미래 도시의 화려하고 역동적인 느낌을 설명하세요.'
    },
    {
        dataAiHint: 'an astronaut floating in space, stars and planets in the background',
        rubric: '누가: 우주비행사의 모습은 어떤가요? (우주복의 색깔, 헬멧에 비치는 모습 등)\n어디에: 주변 우주의 풍경(행성, 별, 성운)을 묘사해보세요.\n배치: 우주비행사가 화면의 어디에 어떻게 떠 있나요?'
    },
    {
        dataAiHint: 'a glowing magical unicorn running through a misty lavender forest at night',
        rubric: '누가: 유니콘의 신비로운 특징(뿔의 빛, 털색 등)을 써보세요.\n어디에: 숲의 색깔과 안개의 느낌을 자세히 묘사하세요.\n시간: 지금은 어떤 시간대이고, 어떤 마법 같은 일이 일어날 것 같나요?'
    },
    {
        dataAiHint: 'an underwater city with glowing buildings and fish swimming by',
        rubric: '어디에: 물속 도시는 어떤 모습인가요? (산호로 된 건물, 스스로 빛나는 집)\n어떻게: 어떤 물고기들이 옆을 지나가고 있나요? (알록달록한 색깔, 무리지어 헤엄치는 모습)\n분위기: 바다 깊은 곳의 고요하고 신비로운 분위기를 설명하세요.'
    },
    {
        dataAiHint: 'a robot cat singing on a stage, colorful spotlights, futuristic audience',
        rubric: '누가: 로봇 고양이는 어떻게 생겼고 무엇을 하고 있나요?\n어디에: 무대 위의 조명과 배경은 어떤가요? (화려한 스포트라이트)\n분위기: 공연장의 열기와 즐거운 분위기를 묘사하세요.'
    }
];

const GAME_QUESTION_COUNT = 5;

type GameState = 'setup' | 'playing' | 'results';
type Result = EvaluatePromptOutput & { questionIndex: number; studentPrompt: string; originalPrompt: string; };

export default function TimeAttackPage() {
  const db = useFirestore();
  const [gameState, setGameState] = useState<GameState>('setup');
  const [nickname, setNickname] = useState('');
  const [timeLimit, setTimeLimit] = useState(30);
  const [questions, setQuestions] = useState(allQuestions.slice(0, GAME_QUESTION_COUNT));
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
  const [studentPrompt, setStudentPrompt] = useState('');
  const [results, setResults] = useState<Result[]>([]);
  const [generatedImageUrl, setGeneratedImageUrl] = useState<string | null>(null);
  const [isGeneratingImage, setIsGeneratingImage] = useState(false);
  const [isEvaluating, startEvaluationTransition] = useTransition();
  const [timeLeft, setTimeLeft] = useState(timeLimit);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  const { toast } = useToast();
  const isPending = isGeneratingImage || isEvaluating;
  const currentQuestion = useMemo(() => questions[currentQuestionIndex], [questions, currentQuestionIndex]);

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
    if (gameState === 'playing') {
      generateNewImage();
    }
  }, [gameState, currentQuestionIndex]);

  useEffect(() => {
    const shuffled = [...allQuestions].sort(() => 0.5 - Math.random());
    setQuestions(shuffled.slice(0, GAME_QUESTION_COUNT));
  }, []);

  const generateNewImage = async () => {
    if (!currentQuestion) return;
    setIsGeneratingImage(true);
    setGeneratedImageUrl(null);
    setStudentPrompt('');
    try {
      const imageUrl = await generateImage(currentQuestion.dataAiHint);
      setGeneratedImageUrl(imageUrl);
    } catch (error) {
      toast({ variant: "destructive", title: "이미지 생성 실패" });
      setGameState('setup');
    } finally {
      setIsGeneratingImage(false);
    }
  };

  const handleManualSubmit = useCallback(async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (timerRef.current) clearInterval(timerRef.current);
    
    startEvaluationTransition(async () => {
      const promptToEvaluate = studentPrompt.trim() === '' ? '시간 안에 제출하지 못했습니다.' : studentPrompt;
      let result: EvaluatePromptOutput;

      try {
        if (!generatedImageUrl) throw new Error("No image");
        result = await evaluatePrompt({ studentPrompt: promptToEvaluate, photoDataUri: generatedImageUrl });
      } catch (error) {
        result = { score: 0, feedback: 'AI 평가에 실패했습니다.' };
      }
      
      const newResults = [...results, { ...result, questionIndex: currentQuestionIndex, studentPrompt: promptToEvaluate, originalPrompt: questions[currentQuestionIndex]?.dataAiHint ?? '' }];
      setResults(newResults);

      if (currentQuestionIndex < GAME_QUESTION_COUNT - 1) {
        setCurrentQuestionIndex(prev => prev + 1);
      } else {
        saveToFirestore(newResults);
        setGameState('results');
      }
    });
  }, [currentQuestionIndex, studentPrompt, generatedImageUrl, results]);

  const saveToFirestore = (finalResults: Result[]) => {
    const classCode = sessionStorage.getItem('classCode');
    const attendanceNumber = sessionStorage.getItem('attendanceNumber');
    if (!db || !classCode || !attendanceNumber) return;

    const averageScore = finalResults.reduce((acc, r) => acc + r.score, 0) / finalResults.length;

    addDoc(collection(db, 'classes', classCode, 'submissions'), {
      attendanceNumber,
      nickname,
      results: finalResults,
      averageScore,
      mode: 'time-attack',
      createdAt: serverTimestamp()
    });
  };

  if (gameState === 'setup') {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <Card className="max-w-md w-full shadow-2xl rounded-2xl bg-card/80 backdrop-blur-sm border-2 border-primary/20">
          <CardHeader>
            <Zap className="h-12 w-12 mx-auto text-primary mb-2" />
            <CardTitle className="text-3xl font-headline text-center">시간 제한 모드</CardTitle>
            <CardDescription className="text-center">더 빠르게, 더 정확하게 설명해보세요!</CardDescription>
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
    return (
        <div className="min-h-screen bg-background p-4 flex flex-col items-center justify-center">
            <Card className="max-w-4xl w-full p-8 text-center space-y-6 shadow-2xl border-2 border-primary/20">
                <Trophy className="h-20 w-20 mx-auto text-yellow-400" />
                <h1 className="text-5xl font-bold font-headline">챌린지 완료!</h1>
                <div className="bg-muted/50 p-10 rounded-2xl border-2 border-primary/10">
                    <p className="text-muted-foreground text-xl">최종 평균 점수</p>
                    <p className="text-8xl font-black text-primary mt-2">{Math.round(averageScore)}점</p>
                </div>
                <p className="text-xl">훌륭합니다! 결과가 선생님께 자동으로 전송되었습니다.</p>
                <Link href="/" passHref className="w-full">
                    <Button size="lg" className="w-full h-16 text-xl font-bold">홈으로 돌아가기</Button>
                </Link>
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
            <h2 className="font-bold text-lg">{nickname}님 ({currentQuestionIndex + 1}/{GAME_QUESTION_COUNT})</h2>
       </header>
      <main className="container mx-auto p-4 max-w-6xl mt-4">
        <Card className="grid md:grid-cols-2 gap-0 overflow-hidden rounded-2xl border-2 border-primary/20 bg-card/80 backdrop-blur-sm">
            <div className="relative aspect-square md:aspect-auto bg-black/10">
                {isGeneratingImage || isEvaluating ? (
                    <div className="absolute inset-0 flex items-center justify-center bg-muted animate-pulse">
                        <RefreshCw className="h-12 w-12 animate-spin text-primary" />
                    </div>
                ) : generatedImageUrl && (
                    <Image src={generatedImageUrl} alt="Target" fill className="object-contain" priority />
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
