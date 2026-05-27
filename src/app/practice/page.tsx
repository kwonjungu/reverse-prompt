
'use client';

import { useState, useTransition, useMemo, useEffect } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { evaluatePrompt, type EvaluatePromptOutput } from '@/ai/flows/evaluate-prompt';
import { generateImage } from '@/ai/flows/generate-image';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { ArrowRight, Wand2, RefreshCw, BookOpen, Star, Home, Rocket, MessageSquare } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from "@/hooks/use-toast";
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert';

const questions = [
  // Level 1: Simple objects with white background
  {
    dataAiHint: 'a cute puppy, white background',
    rubric: '누가: 어떤 강아지인가요? (예: 아기 골든 리트리버)\n어떻게: 무엇을 하고 있나요? (예: 혀를 내밀고 웃고 있어요)\n분위기: 어떤 느낌인가요? (예: 사랑스럽고 활기찬 느낌)'
  },
  {
    dataAiHint: 'a red apple, white background',
    rubric: '무엇을: 어떤 사과인가요? (예: 꼭지가 달린 빨갛고 반짝이는 사과)\n어떻게: 어떻게 보이나요? (예: 한 입 베어먹은 자국이 있어요)\n분위기: 어떤 느낌인가요? (예: 신선하고 먹음직스러운 느낌)'
  },
  {
    dataAiHint: 'a smiling sunflower, white background',
    rubric: '무엇을: 어떤 해바라기인가요? (예: 크고 노란 잎을 가진 해바라기)\n어떻게: 무엇을 하고 있나요? (예: 해를 보며 활짝 웃고 있어요)\n분위기: 어떤 느낌인가요? (예: 밝고 행복한 느낌)'
  },
  // Level 2: Simple shapes and characters
  {
    dataAiHint: 'a blue circle, simple, html shape',
    rubric: '무엇을: 무엇을 닮았나요? (예: 파란색 보름달, 커다란 단추)\n어떻게: 어떻게 보이나요? (예: 테두리가 살짝 빛나고 있어요)\n스타일: 어떤 스타일인가요? (예: 단순한 그림, 3D 스타일)'
  },
  {
    dataAiHint: 'a cool robot, white background',
    rubric: '누가: 어떤 로봇인가요? (예: 네모난 머리와 동그란 눈을 가진 로봇)\n어떻게: 무엇을 하고 있나요? (예: 한 팔을 들고 인사하고 있어요)\n분위기: 어떤 느낌인가요? (예: 미래적이고 친근한 느낌)'
  },
  {
    dataAiHint: 'a yellow star, simple, html shape',
    rubric: '무엇을: 어떤 별인가요? (예: 뾰족한 모서리가 5개인 별)\n어떻게: 어떻게 보이나요? (예: 반짝반짝 빛나고 있어요)\n분위기: 어떤 느낌인가요? (예: 동화책에 나올 것 같은 귀여운 느낌)'
  },
  // Level 3: Simple concepts with a little more imagination
  {
    dataAiHint: 'a flying pig, white background',
    rubric: '누가: 어떤 돼지인가요? (예: 작은 날개를 가진 아기 돼지)\n어떻게: 무엇을 하고 있나요? (예: 구름 사이를 행복하게 날고 있어요)\n분위기: 어떤 느낌인가요? (예: 꿈같고 신비로운 느낌)'
  },
  {
    dataAiHint: 'a singing cat, white background',
    rubric: '누가: 어떤 고양이인가요? (예: 나비넥타이를 맨 하얀 고양이)\n어떻게: 무엇을 하고 있나요? (예: 마이크를 잡고 신나게 노래하고 있어요)\n분위기: 어떤 느낌인가요? (예: 유쾌하고 즐거운 느낌)'
  },
   {
    dataAiHint: 'a running cookie, white background',
    rubric: '누가: 어떤 쿠키인가요? (예: 초코칩이 박힌 동그란 쿠키)\n어떻게: 무엇을 하고 있나요? (예: 장난꾸러기 표정으로 도망치고 있어요)\n분위기: 어떤 느낌인가요? (예: 재미있고 활기찬 느낌)'
  },
  // Level 4: More complex objects and simple scenes
  {
    dataAiHint: 'a hamburger monster, white background',
    rubric: '누가: 어떤 몬스터인가요? (예: 토마토 눈과 양상추 머리카락을 가진 햄버거 몬스터)\n어떻게: 무엇을 하고 있나요? (예: 입을 크게 벌리고 있어요)\n분위기: 맛있어 보이나요, 무서워 보이나요?'
  },
  {
    dataAiHint: 'a sleepy crescent moon in a starry night sky',
    rubric: '무엇을: 어떤 달인가요? (예: 노란색 초승달)\n어떻게: 무엇을 하고 있나요? (예: 별들 사이에서 졸고 있어요)\n어디에: 배경은 어떤가요? (예: 반짝이는 별이 가득한 밤하늘)\n분위기: 어떤 느낌인가요? (예: 조용하고 평화로운 느낌)'
  },
  {
    dataAiHint: 'a rainbow-colored unicorn in a magical forest',
    rubric: '누가: 어떤 유니콘인가요? (예: 무지갯빛 털과 빛나는 뿔을 가진 유니콘)\n어디에: 배경은 어떤가요? (예: 신비로운 안개가 낀 마법의 숲)\n분위기: 어떤 느낌인가요? (예: 환상적이고 동화 같은 느낌)'
  },
  // Level 5: Detailed scenes with background and objects
  {
    dataAiHint: 'an astronaut floating in space, stars and planets in the background',
    rubric: '누가: 어떤 우주비행사인가요? (예: 헬멧에 지구가 비치는 우주비행사)\n어떻게: 무엇을 하고 있나요? (예: 팔을 벌리고 떠다니고 있어요)\n어디에: 배경은 어떤가요? (예: 멀리 토성같은 행성이 보여요)\n분위기: 어떤 느낌인가요? (예: 고요하고 광활한 우주의 느낌)'
  },
  {
    dataAiHint: 'a futuristic city with flying cars and towering skyscrapers at night',
    rubric: '어디에: 어떤 도시인가요? (예: 밤하늘을 나는 자동차와 빛나는 고층 빌딩이 가득한 미래 도시)\n어떻게: 무엇이 보이나요? (예: 건물들 사이에 홀로그램 광고판이 보여요)\n분위기: 어떤 느낌인가요? (예: 화려하고 역동적인 느낌)'
  },
  {
    dataAiHint: 'an underwater city with glowing buildings and fish swimming by',
    rubric: '어디에: 어떤 도시인가요? (예: 산호와 해초로 덮인 물속 도시)\n어떻게: 무엇이 보이나요? (예: 건물들이 스스로 빛을 내고, 알록달록한 물고기들이 옆을 지나가요)\n분위기: 어떤 느낌인가요? (예: 신비롭고 평화로운 느낌)'
  },
].map(q => ({...q, imageUrl: `https://placehold.co/800x600.png?text=${encodeURIComponent(q.dataAiHint)}`}));

export default function PracticePage() {
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
  const [studentPrompt, setStudentPrompt] = useState('');
  const [evaluation, setEvaluation] = useState<EvaluatePromptOutput | null>(null);
  const [generatedImageUrl, setGeneratedImageUrl] = useState<string | null>(null);
  const [isGeneratingImage, setIsGeneratingImage] = useState(true);
  const [imageGenerationError, setImageGenerationError] = useState(false);
  const [isEvaluating, startEvaluationTransition] = useTransition();
  const { toast } = useToast();

  const isPending = isGeneratingImage || isEvaluating;

  const currentQuestion = useMemo(() => questions[currentQuestionIndex], [currentQuestionIndex]);

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
        console.error("Image generation failed:", error);
        setImageGenerationError(true);
        toast({
          variant: "destructive",
          title: "이미지 생성 실패",
          description: "AI 이미지 생성에 실패했습니다. 다시 시도해주세요.",
        });
      } finally {
        setIsGeneratingImage(false);
      }
    };

  const toDataURL = async (url: string): Promise<string> => {
    if (url.startsWith('data:')) {
      return url;
    }
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to fetch image: ${response.statusText}`);
    }
    const blob = await response.blob();
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
      toast({
        variant: "destructive",
        title: "프롬프트가 비어 있습니다",
        description: "이미지에 대한 설명을 작성해 주세요.",
      });
      return;
    }

    setEvaluation(null);

    startEvaluationTransition(async () => {
      try {
        if (!generatedImageUrl) {
          throw new Error("Image not available for evaluation.");
        }
        const photoDataUri = await toDataURL(generatedImageUrl);
        const result = await evaluatePrompt({
          studentPrompt,
          photoDataUri,
        });
        setEvaluation(result);
      } catch (error) {
        console.error("Evaluation failed:", error);
        toast({
          variant: "destructive",
          title: "평가 실패",
          description: "AI로부터 피드백을 받을 수 없습니다. 다시 시도해 주세요.",
        });
      }
    });
  };

  const handleNextQuestion = () => {
    setCurrentQuestionIndex((prevIndex) => (prevIndex + 1) % questions.length);
  };
  
  return (
    <div className="min-h-screen bg-background font-sans">
       <header className="p-4 flex justify-end">
            <Link href="/" passHref>
                <Button variant="outline"><Home className="mr-2 h-4 w-4" />홈으로 돌아가기</Button>
            </Link>
        </header>
      <main className="container mx-auto p-4 sm:p-6 lg:p-8">
        <div className="text-center mb-10">
          <h1 className="text-5xl font-bold tracking-tight text-transparent bg-clip-text bg-gradient-to-r from-primary via-purple-400 to-pink-500 sm:text-6xl font-headline">연습 모드</h1>
          <p className="mt-3 text-lg text-muted-foreground max-w-2xl mx-auto">AI 프롬프트 엔지니어링 챌린지! 그림을 멋지게 설명하고, AI 선생님의 피드백을 받아보세요.</p>
        </div>

        <Card className="max-w-4xl mx-auto shadow-2xl shadow-primary/20 rounded-2xl overflow-hidden border-2 border-primary/20 bg-card/80 backdrop-blur-sm">
          <div className="grid md:grid-cols-5 gap-0">
            <div className="md:col-span-3">
              <CardHeader className="p-0">
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
                       <p className="text-sm text-muted-foreground">API 요청 제한 때문일 수 있습니다. 잠시 후 다시 시도해 주세요.</p>
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
                      data-ai-hint={currentQuestion.dataAiHint}
                      priority
                      sizes="(max-width: 768px) 100vw, 60vw"
                    />
                  ) : null}
                </div>
              </CardHeader>
            </div>

            <div className="md:col-span-2 flex flex-col">
              <CardContent className="p-6 flex-grow flex flex-col">
                 <Alert className="mb-6 bg-accent/80 border-accent/50 rounded-lg">
                  <BookOpen className="h-4 w-4 text-accent-foreground" />
                  <AlertTitle className="font-semibold text-accent-foreground">힌트!</AlertTitle>
                  <AlertDescription className="text-accent-foreground/90 font-body whitespace-pre-line">
                    {currentQuestion.rubric}
                  </AlertDescription>
                </Alert>

                <form onSubmit={handleSubmit} className="flex-grow flex flex-col">
                  <div className="grid w-full gap-2 flex-grow">
                    <Label htmlFor="prompt-input" className="text-base font-medium">나의 설명 프롬프트 ✨</Label>
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
                  <CardTitle className="text-2xl font-headline tracking-tight">AI 선생님의 피드백</CardTitle>
                </CardHeader>
                <CardContent className="flex flex-col sm:flex-row items-center gap-6">
                  <div className="flex flex-col items-center">
                    <div className="relative flex items-center justify-center size-36 bg-gradient-to-br from-primary/20 to-accent/30 rounded-full">
                       <p className="text-6xl font-bold text-primary">{evaluation.score}</p>
                    </div>
                    <p className="text-muted-foreground mt-2 font-semibold">/ 100점</p>
                  </div>
                  <div className="flex-1">
                    <h4 className="font-semibold text-lg mb-2 flex items-center gap-2"><Star className="text-yellow-400" fill="currentColor"/>칭찬 및 개선점</h4>
                    <p className="mt-2 text-muted-foreground whitespace-pre-wrap font-body text-lg leading-loose">{evaluation.feedback}</p>
                  </div>
                </CardContent>
                <CardFooter>
                   <Button onClick={handleNextQuestion} className="w-full sm:w-auto ml-auto" variant="outline">
                    다음 문제 풀기 <ArrowRight className="ml-2 h-4 w-4" />
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

    