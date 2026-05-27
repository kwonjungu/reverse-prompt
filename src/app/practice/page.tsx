
'use client';

import { useState, useTransition, useMemo, useEffect } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { evaluatePrompt, type EvaluatePromptOutput } from '@/ai/flows/evaluate-prompt';
import { generateImage } from '@/ai/flows/generate-image';
import { useFirestore } from '@/firebase';
import { collection, addDoc, serverTimestamp } from 'firebase/firestore';
import { buildImagePrompt } from '@/lib/image-prompt';
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

// 난이도:
//   1~3단계  — 흰 배경, 단일 사물, 색깔·모양만 묘사
//   4~6단계  — 흰 배경, 캐릭터 표정·특징·동작 추가
//   7~8단계  — 배경 첫 등장 (단색)
//   9~11단계 — 배경 + 2~3가지 요소
//   12~15단계— 복합 씬 (여러 요소 + 분위기)
const questions = [
  // ── 1단계 ──
  {
    level: 1,
    dataAiHint: 'a small white fluffy puppy sitting, tongue out, plain pure white background, no collar, no accessories, no objects except the puppy',
    rubric: '① 무엇: 어떤 동물인가요?\n② 색깔: 어떤 색인가요?\n③ 자세: 어떤 자세로 있나요?',
  },
  // ── 2단계 ──
  {
    level: 2,
    dataAiHint: 'a shiny red apple with a short green stem and one small green leaf, centered on plain pure white background, no other objects',
    rubric: '① 무엇: 무엇이 그려져 있나요?\n② 색깔: 어떤 색인가요?\n③ 특징: 꼭지나 잎이 있나요?',
  },
  // ── 3단계 ──
  {
    level: 3,
    dataAiHint: 'a single bright yellow sunflower facing forward, thick green stem, plain pure white background, no other flowers, no vase',
    rubric: '① 무엇: 어떤 꽃인가요?\n② 색깔: 꽃잎과 가운데 색은요?\n③ 방향: 꽃이 어느 쪽을 향하고 있나요?',
  },
  // ── 4단계 ──
  {
    level: 4,
    dataAiHint: 'a gray humanoid robot with a square silver head, two round blue glowing eyes, rectangular body, standing straight with arms at sides, plain pure white background, no weapons',
    rubric: '① 누가: 어떤 캐릭터인가요?\n② 머리 모양: 머리는 어떻게 생겼나요?\n③ 눈 색깔: 눈은 무슨 색인가요?\n④ 자세: 어떻게 서 있나요?',
  },
  // ── 5단계 ──
  {
    level: 5,
    dataAiHint: 'a round brown chocolate chip cookie character with two large round white cartoon eyes and a big smiling mouth, two short stick arms and two short stick legs, standing pose, plain pure white background',
    rubric: '① 무엇: 무슨 음식이 캐릭터로 나왔나요?\n② 색깔·모양: 어떻게 생겼나요?\n③ 얼굴: 어떤 표정인가요?\n④ 특징: 쿠키에 무엇이 박혀 있나요?',
  },
  // ── 6단계 ──
  {
    level: 6,
    dataAiHint: 'a white cat standing upright on two legs, holding a round black microphone with one paw, mouth open wide singing, plain pure white background, no stage, no crowd',
    rubric: '① 누가: 어떤 동물인가요?\n② 색깔: 무슨 색인가요?\n③ 자세: 어떻게 서 있나요?\n④ 행동: 무엇을 들고 무엇을 하고 있나요?',
  },
  // ── 7단계: 배경 첫 등장 (단색) ──
  {
    level: 7,
    dataAiHint: 'a pink cartoon pig with two small round white feathered wings on its back, hovering in midair with a big happy smile, solid light sky-blue background, no clouds, no other objects',
    rubric: '① 누가: 어떤 동물이고 색깔은?\n② 특징: 어떤 특별한 부위가 있나요?\n③ 행동: 무엇을 하고 있나요?\n④ 배경: 배경은 무슨 색인가요?',
  },
  // ── 8단계 ──
  {
    level: 8,
    dataAiHint: 'a yellow crescent moon shape with two closed eyes and a peaceful sleeping smile, surrounded by five small white stars, solid dark navy blue background, nothing else',
    rubric: '① 무엇: 무슨 모양인가요?\n② 색깔: 달은 무슨 색인가요?\n③ 표정: 달이 어떤 표정인가요?\n④ 배경: 배경색과 배경에 무엇이 있나요?',
  },
  // ── 9단계 ──
  {
    level: 9,
    dataAiHint: 'a hamburger with two large round white cartoon eyes and a wide open smiling mouth, two small round legs, standing upright on a simple light yellow background, no extra props',
    rubric: '① 무엇: 무슨 음식이 캐릭터로 나왔나요?\n② 표정·눈: 눈은 어떻게 생겼고 표정은요?\n③ 자세: 어떤 자세로 있나요?\n④ 배경: 배경은 무슨 색인가요?',
  },
  // ── 10단계 ──
  {
    level: 10,
    dataAiHint: 'a white horse with a single straight golden horn on its forehead and a long rainbow-colored mane and tail, standing still in a misty light green meadow, soft golden sunlight from above, no riders, no fairies',
    rubric: '① 누가: 어떤 동물이고 특별한 부분은?\n② 털색: 갈기와 꼬리는 어떤 색인가요?\n③ 배경: 어떤 장소인가요?\n④ 빛: 어떤 빛이 있나요?',
  },
  // ── 11단계 ──
  {
    level: 11,
    dataAiHint: 'a small orange tabby cat wearing a purple wizard hat and robe, sitting at a wooden desk, holding a wooden wand, a glowing purple open spell book on the desk, simple gray stone wall background behind',
    rubric: '① 누가: 어떤 동물인가요?\n② 옷: 무엇을 입고 있나요?\n③ 행동: 무엇을 하고 있나요?\n④ 배경·소품: 책상 위에 무엇이 있나요?',
  },
  // ── 12단계 ──
  {
    level: 12,
    dataAiHint: 'an astronaut in a white spacesuit floating in outer space, arms stretched out sideways, blue Earth visible in the upper left, white stars scattered on black background, one ringed planet visible in the far right distance',
    rubric: '① 누가: 우주비행사는 어떤 복장인가요?\n② 행동: 어떤 자세로 있나요?\n③ 배경: 배경에 무엇이 보이나요?\n④ 분위기: 어떤 느낌인가요?',
  },
  // ── 13단계 ──
  {
    level: 13,
    dataAiHint: 'a futuristic night city viewed from street level, three flying cars with glowing blue headlights in the sky, tall skyscrapers with pink and cyan neon signs on the sides, dark sky, no people, no animals',
    rubric: '① 어디: 어떤 도시인가요?\n② 하늘: 하늘에 무엇이 날고 있나요?\n③ 건물: 건물들은 어떻게 생겼나요?\n④ 빛: 어떤 색의 빛이 있나요?',
  },
  // ── 14단계 ──
  {
    level: 14,
    dataAiHint: 'an underwater ocean floor scene with round dome-shaped glowing teal buildings, a school of small colorful tropical fish swimming past in the foreground, hazy blue-green water, faint light rays coming from the surface above, no people, no submarines',
    rubric: '① 어디: 어떤 곳인가요?\n② 건물: 건물은 어떤 모양이고 색깔인가요?\n③ 무엇: 물속에 무엇이 지나가고 있나요?\n④ 빛: 어떤 빛이 있나요?',
  },
  // ── 15단계 ──
  {
    level: 15,
    dataAiHint: 'a magical fantasy library interior, tall wooden bookshelves on both walls filled with colorful books, five glowing crystal orbs floating in midair at different heights, warm golden lantern light, stone floor, no people',
    rubric: '① 어디: 어떤 장소인가요?\n② 책장: 어떻게 생겼나요?\n③ 빛: 어떤 빛이 떠 있나요?\n④ 분위기: 어떤 느낌인가요?',
  },
];

export default function PracticePage() {
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
  const [studentPrompt, setStudentPrompt] = useState('');
  const [evaluation, setEvaluation] = useState<EvaluatePromptOutput | null>(null);
  const [generatedImageUrl, setGeneratedImageUrl] = useState<string | null>(null);
  const [isGeneratingImage, setIsGeneratingImage] = useState(true);
  const [imageGenerationError, setImageGenerationError] = useState(false);
  const [isEvaluating, startEvaluationTransition] = useTransition();
  // attemptCounts: questionIndex → 시도 횟수 (현재 세션 기준)
  const [attemptCounts, setAttemptCounts] = useState<Record<number, number>>({});
  const { toast } = useToast();
  const db = useFirestore();

  const isPending = isGeneratingImage || isEvaluating;
  const currentQuestion = questions[currentQuestionIndex];
  const currentAttempts = attemptCounts[currentQuestionIndex] ?? 0;

  useEffect(() => {
    generateNewImage();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentQuestionIndex]);

  const generateNewImage = async () => {
    setIsGeneratingImage(true);
    setImageGenerationError(false);
    setGeneratedImageUrl(null);
    setEvaluation(null);
    setStudentPrompt('');
    try {
      const imageUrl = await generateImage(currentQuestion.dataAiHint);
      setGeneratedImageUrl(imageUrl);
    } catch (error) {
      console.error('Image generation failed:', error);
      setImageGenerationError(true);
      toast({ variant: 'destructive', title: '이미지 생성 실패', description: '잠시 후 다시 시도해주세요.' });
    } finally {
      setIsGeneratingImage(false);
    }
  };

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
        if (!generatedImageUrl) throw new Error('Image not available for evaluation.');
        const photoDataUri = await toDataURL(generatedImageUrl);
        const result = await evaluatePrompt({ studentPrompt, photoDataUri });
        setEvaluation(result);

        // 시도 횟수 증가
        setAttemptCounts(prev => ({ ...prev, [currentQuestionIndex]: (prev[currentQuestionIndex] ?? 0) + 1 }));

        // Firestore 저장
        const classCode = sessionStorage.getItem('classCode');
        const attendanceNumber = sessionStorage.getItem('attendanceNumber');
        if (db && classCode && attendanceNumber) {
          addDoc(collection(db, 'classes', classCode, 'practice_attempts'), {
            attendanceNumber,
            questionIndex: currentQuestionIndex,
            questionLevel: currentQuestion.level,
            originalPrompt: buildImagePrompt(currentQuestion.dataAiHint),
            studentPrompt,
            score: result.score,
            feedback: result.feedback,
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
    setStudentPrompt('');
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
        <Link href="/" passHref>
          <Button variant="outline" size="sm"><Home className="mr-2 h-4 w-4" />홈</Button>
        </Link>
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
                {isGeneratingImage ? (
                  <div className="w-full h-full bg-muted animate-pulse rounded-tl-2xl md:rounded-l-2xl flex items-center justify-center">
                    <div className="flex flex-col items-center gap-2">
                      <Wand2 className="h-8 w-8 text-muted-foreground animate-pulse" />
                      <p className="text-muted-foreground">이미지 생성 중...</p>
                    </div>
                  </div>
                ) : imageGenerationError ? (
                  <div className="w-full h-full bg-muted rounded-tl-2xl md:rounded-l-2xl flex flex-col items-center justify-center gap-4 p-4 text-center">
                    <p className="text-destructive font-semibold">이미지 생성에 실패했습니다.</p>
                    <Button onClick={generateNewImage} disabled={isGeneratingImage}>
                      <RefreshCw className="mr-2 h-4 w-4" /> 다시 생성하기
                    </Button>
                  </div>
                ) : generatedImageUrl ? (
                  <Image
                    src={generatedImageUrl}
                    alt="AI 생성 평가 이미지"
                    fill
                    className="object-contain rounded-tl-2xl md:rounded-l-2xl"
                    priority
                    sizes="(max-width: 768px) 100vw, 60vw"
                  />
                ) : null}
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
                      disabled={isPending || imageGenerationError}
                    />
                  </div>
                  <Button type="submit" size="lg" className="mt-4 w-full" disabled={isPending || imageGenerationError}>
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
