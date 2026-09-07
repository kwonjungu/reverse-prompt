'use client';

import { useState, useTransition, useMemo, useEffect, useRef } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { evaluatePrompt, type EvaluatePromptOutput } from '@/ai/flows/evaluate-prompt';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Home, ArrowRight, Wand2, RefreshCw, BookOpen, Star, Trophy, Printer, Award, Rocket, MessageSquare } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from "@/hooks/use-toast";
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert';
import { Progress } from "@/components/ui/progress";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { collection, addDoc, serverTimestamp } from 'firebase/firestore';
import { useFirestore } from '@/firebase';
import { buildImagePrompt } from '@/lib/image-prompt';
import { ModeGuard } from '@/components/mode-guard';

const allQuestions = [
  {
    level: 10,
    koreanTitle: '햇살 가득한 방의 흰 강아지',
    dataAiHint: 'a cute puppy with white fur, golden eyes, wagging tail, sitting in a sunny room',
    rubric: '강아지를 처음 보는 친구에게 자세히 소개해봐요!\n\n털 색깔, 눈 색, 어떤 자세인지, 무엇을 하고 있는지, 주변 환경은 어떤지... 그림 속 모든 것을 전해줘요.',
  },
  {
    level: 11,
    koreanTitle: '아침 햇살 속 나무 테이블의 사과',
    dataAiHint: 'a bright red shiny apple with a green leaf, on a wooden table, soft morning light',
    rubric: '과일 가게 광고 문구를 써보듯이 이 사과를 설명해봐요!\n\n색깔, 빛나는 정도, 테이블의 재질, 빛의 느낌, 어떤 분위기인지... 먹고 싶어지도록 생생하게 써봐요.',
  },
  {
    level: 11,
    koreanTitle: '파란 하늘 아래 웃는 해바라기',
    dataAiHint: 'a cheerful sunflower with a smiley face, blue sky background, fluffy white clouds',
    rubric: '동화책 삽화를 설명하는 작가가 되어봐요!\n\n해바라기의 표정, 꽃잎 색깔, 하늘 색, 구름 모양, 이 그림의 전체 분위기... 독자가 삽화 없이도 그릴 수 있게 묘사해봐요.',
  },
  {
    level: 7,
    koreanTitle: '손 흔드는 은색 로봇',
    dataAiHint: 'a friendly small silver robot waving its hand, white clean background',
    rubric: '로봇 제품 설명서를 쓰듯이 이 로봇을 소개해봐요!\n\n몸의 색깔과 재질, 크기, 손 동작, 표정, 어떤 느낌인지... 이 로봇을 본 적 없는 사람도 바로 상상할 수 있게 써봐요.',
  },
  {
    level: 13,
    koreanTitle: '밤의 안개 숲을 달리는 빛나는 유니콘',
    dataAiHint: 'a glowing magical unicorn running through a misty lavender forest at night',
    rubric: '마법 세계를 탐험한 모험가의 일지를 써봐요!\n\n유니콘 색깔과 특징, 뿔의 모습, 숲의 색깔과 안개, 밤하늘, 전체 분위기... 읽는 사람이 그 자리에 있는 것처럼 써봐요.',
  },
  {
    level: 10,
    koreanTitle: '비 오는 창가의 주황 고양이',
    dataAiHint: 'an orange tabby cat sitting on a wooden windowsill watching rain, raindrops on the window glass, gray sky outside, warm cozy room light inside',
    rubric: '창가의 고양이를 그림일기로 남겨봐요!\n\n고양이 색깔과 자세, 창밖 날씨, 유리창의 빗방울, 방 안의 분위기... 조용한 순간을 생생하게 담아봐요.',
  },
  {
    level: 11,
    koreanTitle: '무지개 아래 초원의 오두막',
    dataAiHint: 'a small wooden cottage with a red roof in a green meadow under a bright rainbow, colorful wildflowers in the foreground, blue sky with fluffy white clouds',
    rubric: '동화 나라 부동산 광고를 써봐요!\n\n오두막의 색깔과 지붕, 무지개, 꽃밭, 하늘... 누구나 살고 싶어지게 소개해봐요!',
  },
  {
    level: 12,
    koreanTitle: '우주선 안의 우주복 강아지',
    dataAiHint: 'a cute brown puppy wearing a small white astronaut helmet floating inside a spaceship cabin, a round window behind showing stars and space',
    rubric: '우주 뉴스 특보를 전해봐요!\n\n강아지의 모습과 쓰고 있는 것, 떠 있는 자세, 창밖 풍경, 선실 안... 놀라운 장면을 보도해봐요!',
  },
  {
    level: 12,
    koreanTitle: '케이크로 만든 동화 속 성',
    dataAiHint: 'a fairy tale castle made of pink and white layered birthday cake, lit candles as towers, a chocolate gate, candy trees around, soft pastel sky',
    rubric: '과자 왕국 여행 안내서를 써봐요!\n\n성이 무엇으로 만들어졌는지, 탑과 문, 주변 나무들, 하늘 색깔... 달콤하게 묘사해봐요!',
  },
  {
    level: 13,
    koreanTitle: '얼음 호수에서 스케이트 타는 펭귄',
    dataAiHint: 'a penguin wearing a red knitted scarf ice skating on a frozen lake, snowy pine trees around the lake, soft winter afternoon sunlight',
    rubric: '겨울 스포츠 중계를 해봐요!\n\n펭귄이 입은 것, 스케이트 타는 모습, 호수와 주변 나무, 겨울 햇살... 신나게 중계해봐요!',
  },
  // 이미지는 사전 생성된 정적 파일 (scripts/generate-question-images.mjs).
  // dataAiHint 변경 시 스크립트로 재생성할 것.
].map((q, i) => {
  // questionId는 서버 레지스트리가 밴드·이미지·단서를 확정하는 유일한 근거다.
  // 게임 모드 문항은 아직 레지스트리에 등록되어 있지 않아 채점이 거부된다.
  // 이 모드는 연구 세션에서 차단되므로 여기서 문항을 새로 만들지 않고 ID 규칙만 맞춰 둔다.
  const questionId = `game-${String(i + 1).padStart(2, '0')}`;
  return { ...q, questionId, imageUrl: `/questions/${questionId}.jpg` };
});

const GAME_QUESTION_COUNT = 5;

type GameState = 'nickname' | 'playing' | 'results';
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
 * 게임 모드는 일반 체험에서만 연다. 연구 세션에서는 진입을 거부한다(수용시험 7).
 * 기능은 그대로 두고 가드만 감싼다. 차단의 근거는 화면이 아니라 서버 판정이며,
 * route(middleware)·API가 각각 다시 거부한다.
 */
export default function GamePage() {
  return (
    <ModeGuard mode="game">
      <GameModeScreen />
    </ModeGuard>
  );
}

function GameModeScreen() {
  const db = useFirestore();
  const [gameState, setGameState] = useState<GameState>('nickname');
  const [nickname, setNickname] = useState('');
  const [questions, setQuestions] = useState(allQuestions.slice(0, GAME_QUESTION_COUNT));
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
  const [studentPrompt, setStudentPrompt] = useState('');
  const [results, setResults] = useState<Result[]>([]);
  const [isEvaluating, startEvaluationTransition] = useTransition();
  const certificateRef = useRef<HTMLDivElement>(null);
  const [currentDate, setCurrentDate] = useState('');

  const { toast } = useToast();

  const isPending = isEvaluating;
  const currentQuestion = useMemo(() => questions[currentQuestionIndex], [questions, currentQuestionIndex]);

  useEffect(() => {
    const shuffled = [...allQuestions].sort(() => 0.5 - Math.random());
    setQuestions(shuffled.slice(0, GAME_QUESTION_COUNT));
    setCurrentDate(new Date().toLocaleDateString('ko-KR'));
  }, []);

  useEffect(() => {
    if (gameState === 'playing') setStudentPrompt('');
  }, [gameState, currentQuestionIndex]);

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

  const handleNicknameSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!nickname.trim()) {
      toast({ variant: "destructive", title: "닉네임을 입력해주세요!" });
      return;
    }
    setGameState('playing');
  };

  const handlePromptSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!studentPrompt.trim()) {
      toast({ variant: "destructive", title: "프롬프트가 비어 있습니다" });
      return;
    }

    startEvaluationTransition(async () => {
      try {
        // 밴드·이미지·단서는 서버가 questionId로 확정한다. 클라이언트 이미지 URI를 보내지 않는다.
        const result = await evaluatePrompt({ questionId: currentQuestion.questionId, studentPrompt });
        const newResults = [...results, {
          questionIndex: currentQuestionIndex,
          questionLevel: currentQuestion.level,
          koreanTitle: currentQuestion.koreanTitle,
          studentPrompt,
          originalPrompt: buildImagePrompt(currentQuestion.dataAiHint),
          score: result.result.status === 'scored' ? result.result.score : null,
          feedback: result.feedback?.text ?? '채점을 마치지 못했어요. 선생님과 함께 확인해요.',
        }];
        setResults(newResults);

        if (currentQuestionIndex < GAME_QUESTION_COUNT - 1) {
          setCurrentQuestionIndex(prev => prev + 1);
        } else {
          saveToFirestore(newResults);
          setGameState('results');
        }
      } catch (error) {
        console.error("Evaluation failed:", error);
        toast({ variant: "destructive", title: "평가 실패", description: "AI 피드백을 받을 수 없습니다." });
      }
    });
  };

  const saveToFirestore = (finalResults: Result[]) => {
    const classCode = sessionStorage.getItem('classCode');
    const attendanceNumber = sessionStorage.getItem('attendanceNumber');
    if (!db || !classCode || !attendanceNumber) return;

    // 결측은 0점이 아니므로 평균에서 제외한다. 유효한 점수가 없으면 평균도 없다.
    const scored = finalResults.filter((r): r is Result & { score: number } => r.score !== null);
    const averageScore = scored.length
      ? scored.reduce((acc, r) => acc + r.score, 0) / scored.length
      : null;

    addDoc(collection(db, 'classes', classCode, 'submissions'), {
      attendanceNumber,
      nickname,
      results: finalResults,
      averageScore,
      mode: 'game',
      createdAt: serverTimestamp()
    });
  };

  const handlePrint = () => {
    const printContent = certificateRef.current;
    if (printContent) {
      const printWindow = window.open('', '', 'height=900,width=650');
      if (printWindow) {
        printWindow.document.write('<html><head><title>인증서</title>');
        printWindow.document.write('<link href="https://fonts.googleapis.com/css2?family=Gowun+Dodum&family=Jost:wght@400;500;600;700&display=swap" rel="stylesheet">');
        printWindow.document.write(`
        <style>
            body { 
                font-family: "Gowun Dodum", sans-serif; 
                display: flex; align-items: flex-start; justify-content: center; 
                width: 100%; height: 100%; padding: 2rem; margin: 0; box-sizing: border-box;
                background: white;
            } 
            .certificate-container {
                position: relative; width: 100%; max-width: 550px; aspect-ratio: 600 / 850;
                background-color: #f9fafb; padding: 40px; text-align: center;
                border: 12px double #DAA520; color: #333; box-sizing: border-box; margin: auto;
            }
            .certificate-title { font-size: 3.5rem; font-weight: bold; color: #1e3a8a; margin-bottom: 1rem; }
            .recipient-line { font-size: 1.8rem; margin: 2rem 0; border-bottom: 2px solid #ddd; display: inline-block; padding: 0 1rem; }
            .certificate-body { font-size: 1.4rem; line-height: 1.8; margin-bottom: 3rem; text-align: center; }
            .date-line { font-size: 1.2rem; margin-top: 2rem; }
            .stamp { font-size: 1.5rem; font-weight: bold; color: #b91c1c; margin-top: 1rem; }
        </style>
        `);
        printWindow.document.write('</head><body>');
        printWindow.document.write(certificateRef.current.innerHTML);
        printWindow.document.write('</body></html>');
        printWindow.document.close();
        printWindow.focus();
        printWindow.print();
      }
    }
  };

  if (gameState === 'nickname') {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <Card className="max-w-md w-full shadow-2xl rounded-2xl bg-card/80 backdrop-blur-sm">
          <CardHeader>
            <CardTitle className="text-3xl font-headline text-center">게임 모드</CardTitle>
            <CardDescription className="text-center">5개의 프롬프트 챌린지에 도전하세요!</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleNicknameSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="nickname" className="text-lg font-medium">나의 멋진 닉네임</Label>
                <Input id="nickname" value={nickname} onChange={e => setNickname(e.target.value)} placeholder="용감한 프롬프터" className="text-lg h-12" />
              </div>
              <Button type="submit" size="lg" className="w-full font-bold">도전 시작! <ArrowRight className="ml-2"/></Button>
              <Link href="/" passHref className="block w-full">
                 <Button variant="outline" className="w-full mt-2"><Home className="mr-2"/> 홈으로</Button>
              </Link>
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
    return (
        <div className="min-h-screen bg-background font-sans">
            <header className="p-4 flex justify-end">
                <Link href="/" passHref>
                    <Button variant="outline"><Home className="mr-2 h-4 w-4" />홈으로</Button>
                </Link>
            </header>
            <main className="container mx-auto p-4 sm:p-6 lg:p-8">
                <Card className="max-w-4xl mx-auto shadow-2xl rounded-2xl p-6 bg-card/80 backdrop-blur-sm">
                    <CardHeader className="text-center">
                        <Trophy className="h-16 w-16 mx-auto text-yellow-400" />
                        <CardTitle className="text-4xl font-headline mt-4">챌린지 완료!</CardTitle>
                        <CardDescription className="text-lg">훌륭한 실력을 보여주셨네요, {nickname}님!</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-8">
                        <div className="text-center bg-muted/50 p-6 rounded-xl border-2 border-primary/20">
                            <p className="text-xl font-semibold text-muted-foreground">나의 평균 점수</p>
                            <p className="text-7xl font-bold text-primary">{averageScore === null ? '채점 못함' : `${Math.round(averageScore)}점`}</p>
                        </div>
                        <div>
                          <h3 className="text-2xl font-headline mb-4 text-center">상세 결과</h3>
                           <Card className="overflow-hidden bg-muted/30">
                              <Table>
                                <TableHeader>
                                  <TableRow>
                                    <TableHead className="w-[50px]">문제</TableHead>
                                    <TableHead>제출한 프롬프트</TableHead>
                                    <TableHead className="text-right">점수</TableHead>
                                  </TableRow>
                                </TableHeader>
                                <TableBody>
                                  {results.map((result, index) => (
                                    <TableRow key={index}>
                                      <TableCell className="font-medium">{index + 1}</TableCell>
                                      <TableCell className="font-body text-muted-foreground">{result.studentPrompt}</TableCell>
                                      <TableCell className="text-right font-bold text-primary text-lg">{result.score === null ? '채점 못함' : Math.round(result.score)}</TableCell>
                                    </TableRow>
                                  ))}
                                </TableBody>
                              </Table>
                           </Card>
                        </div>
                         <div className="text-center p-6 border-dashed border-2 rounded-xl border-primary/50 bg-primary/5" >
                            <div ref={certificateRef} className="certificate-container hidden">
                                <h1 className="certificate-title">상 장</h1>
                                <p style={{fontSize: '1.2rem', color: '#666'}}>프롬프트 마스터 인증서</p>
                                <p className="recipient-line">성명: {nickname}</p>
                                <p className="certificate-body">
                                    위 어린이는 AI 프롬프트 엔지니어링 챌린지에서<br/>
                                    평균 {averageScore === null ? '' : `${Math.round(averageScore)}점`}이라는 우수한 성적을 거두었기에<br/>
                                    이 상장을 수여하여 실력을 인증합니다.
                                </p>
                                <p className="date-line">{currentDate}</p>
                                <p className="stamp">나는 프롬프트 마스터 (인)</p>
                            </div>
                             <Button onClick={handlePrint} className="mt-6" variant="secondary" size="lg">
                                <Printer className="mr-2 h-5 w-5" /> 인증서 출력하기
                             </Button>
                        </div>
                    </CardContent>
                    <CardFooter>
                        <Link href="/" className="w-full">
                           <Button className="w-full" size="lg">홈으로 돌아가기</Button>
                        </Link>
                    </CardFooter>
                </Card>
            </main>
        </div>
    );
  }

  return (
    <div className="min-h-screen bg-background font-sans">
       <header className="p-4 flex justify-between items-center bg-card/50">
            <Progress value={((currentQuestionIndex) / GAME_QUESTION_COUNT) * 100} className="w-1/4" />
            <h2 className="text-lg font-bold">{nickname}님 ({currentQuestionIndex + 1}/{GAME_QUESTION_COUNT})</h2>
            <Link href="/" passHref>
                <Button variant="ghost"><Home className="mr-2 h-4 w-4" />나가기</Button>
            </Link>
       </header>
      <main className="container mx-auto p-4 sm:p-6 lg:p-8">
        <Card className="max-w-4xl mx-auto shadow-2xl rounded-2xl overflow-hidden border-2 border-primary/20 bg-card/80 backdrop-blur-sm">
          <div className="grid md:grid-cols-5 gap-0">
            <div className="md:col-span-3">
                <div className="relative w-full aspect-[4/3] bg-black/10">
                  <Image src={currentQuestion.imageUrl} alt="평가 이미지" fill className="object-contain" priority />
                </div>
            </div>
            <div className="md:col-span-2 flex flex-col p-6 space-y-4">
                <Alert className="bg-primary/5 border-primary/20">
                  <BookOpen className="h-4 w-4 text-primary" />
                  <AlertTitle className="font-bold">이 그림을 설명해보세요!</AlertTitle>
                  <AlertDescription className="whitespace-pre-line text-sm mt-2">{currentQuestion?.rubric}</AlertDescription>
                </Alert>
                <form onSubmit={handlePromptSubmit} className="flex-grow flex flex-col gap-4">
                  <div className="flex-grow">
                    <Label htmlFor="prompt-input" className="font-bold text-lg mb-2 block">나의 설명 프롬프트 ✨</Label>
                    <Textarea
                      id="prompt-input"
                      placeholder="예: 따뜻한 햇살이 비치는 거실에 하얀색 강아지가 앉아서 꼬리를 살랑살랑 흔들고 있어요."
                      value={studentPrompt}
                      onChange={(e) => setStudentPrompt(e.target.value)}
                      className="h-full min-h-[180px] text-lg p-4"
                      disabled={isPending}
                    />
                  </div>
                  <Button type="submit" size="lg" className="w-full h-14 text-xl font-bold" disabled={isPending}>
                    {isEvaluating ? <RefreshCw className="animate-spin" /> : <Award className="mr-2" />}
                    {currentQuestionIndex < GAME_QUESTION_COUNT - 1 ? "제출하고 다음으로" : "최종 결과 보기"}
                  </Button>
                </form>
            </div>
          </div>
        </Card>
      </main>
    </div>
  );
}
