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
import { Home, ArrowRight, Wand2, RefreshCw, BookOpen, Star, Trophy, Printer, Award, Rocket, MessageSquare, Users } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from "@/hooks/use-toast";
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert';
import { Progress } from "@/components/ui/progress";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from '@/components/ui/badge';
import { collection, addDoc, doc, serverTimestamp, setDoc, increment, updateDoc, query, orderBy, limit, type Timestamp, type DocumentReference } from 'firebase/firestore';
import { useFirestore, useCollection, useDoc } from '@/firebase';
import { buildImagePrompt } from '@/lib/image-prompt';
import { getAxisBadge } from '@/lib/badges';
import { sessionXp, getTitle, getNextLevelInfo } from '@/lib/xp';

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
].map((q, i) => ({ ...q, imageUrl: `/questions/game-${String(i + 1).padStart(2, '0')}.jpg` }));

const GAME_QUESTION_COUNT = 5;
// 콤보 기준점 — 이 점수 이상이면 콤보가 이어짐
const COMBO_SCORE = 80;
// 플래시 라운드: 그림을 이 시간(초)만 보여준 뒤 가림
const FLASH_SECONDS = 10;

// 보스전: 5문제 뒤 선택적으로 도전하는 최고 난이도 1문제.
// 게임 문제 풀과 완전히 별개 — 평균/콤보/리더보드에 섞이지 않음.
const BOSS_QUESTION = {
  level: 20,
  koreanTitle: '로봇들이 장 보는 미래 야시장',
  dataAiHint: 'a lively futuristic night market street with three round friendly robots browsing food stalls, colorful paper lanterns strung overhead, white steam rising from food carts, glowing neon shop signs, no humans',
  imageUrl: '/questions/practice-20.jpg',
  rubric: '👑 보스전! 그림 속 모든 것을 빠짐없이, 분위기까지 담아 묘사해야 합니다.\n\n로봇들의 모습과 행동, 가게와 음식, 등불, 김, 네온사인, 거리 분위기... 90점을 넘기면 보스 클리어!',
};
const BOSS_PASS_SCORE = 90;
// 보스 클리어 시 XP 보너스
const BOSS_CLEAR_BONUS_XP = 50;

type GameState = 'nickname' | 'playing' | 'boss-offer' | 'boss' | 'results';
// 보스 결과 (results 배열과 분리 — 평균/콤보/리더보드 오염 방지)
type BossResult = { score: number; studentPrompt: string; feedback: string; cleared: boolean };
// 리더보드용 submission 문서 (읽기 전용, 필요한 필드만)
type Submission = {
  id: string;
  nickname?: string;
  mode?: string;
  averageScore?: number;
  createdAt?: Timestamp | null;
};
type Result = EvaluatePromptOutput & { questionIndex: number; questionLevel: number; koreanTitle: string; studentPrompt: string; originalPrompt: string; isFlash: boolean; };

// results 배열에서 콤보를 파생.
// currentCombo: 배열 끝에서부터 연속으로 COMBO_SCORE 이상인 개수
// maxCombo: 전체 스캔 중 나온 최대 연속 개수
function deriveCombo(results: Result[]): { currentCombo: number; maxCombo: number } {
  let currentCombo = 0;
  let maxCombo = 0;
  let run = 0;
  for (const r of results) {
    if (r.score >= COMBO_SCORE) {
      run += 1;
      if (run > maxCombo) maxCombo = run;
    } else {
      run = 0;
    }
  }
  currentCombo = run;
  return { currentCombo, maxCombo };
}

export default function GamePage() {
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
  // 플래시 라운드: 5문제 중 랜덤 1개 인덱스. 세션 시작 시 확정.
  const [flashQuestionIndex, setFlashQuestionIndex] = useState(-1);
  // 플래시 문제에서 그림을 보여줄 남은 시간(초). null이면 카운트다운 없음.
  const [flashRemaining, setFlashRemaining] = useState<number | null>(null);

  // 리더보드: results 화면 진입 후 sessionStorage의 classCode로 조회
  const [classCode, setClassCode] = useState<string | null>(null);
  const [attendanceNumber, setAttendanceNumber] = useState<string | null>(null);
  // 이번 세션에서 획득한 XP (결과 화면 표시용). saveToFirestore에서 확정.
  const [earnedXp, setEarnedXp] = useState(0);

  // 보스전: 보스 문제의 입력·결과. results 배열에는 넣지 않는다.
  const [bossPrompt, setBossPrompt] = useState('');
  const [bossResult, setBossResult] = useState<BossResult | null>(null);
  // 5문제 완료 시 저장된 세션 doc — 보스 결과를 나중에 updateDoc으로 덧붙이기 위해 보관
  const sessionDocRef = useRef<DocumentReference | null>(null);

  const { toast } = useToast();

  // 학생 XP 문서 실시간 구독 (없으면 null → 구독 안 함). 훅은 조기 return 위에서 호출.
  const studentDocRef = useMemo(() => {
    if (!db || !classCode || !attendanceNumber) return null;
    return doc(db, 'classes', classCode, 'students', attendanceNumber);
  }, [db, classCode, attendanceNumber]);
  const { data: studentData } = useDoc<{ xp?: number }>(studentDocRef);
  const currentXp = studentData?.xp ?? 0;
  const currentTitle = getTitle(currentXp);
  const nextLevel = getNextLevelInfo(currentXp);

  // 복합 인덱스(where+orderBy)를 피하려고 orderBy+limit만 사용하고
  // 클라이언트에서 mode/오늘/정렬을 필터링. 결과 화면에서만 쿼리 활성화.
  const leaderboardQuery = useMemo(() => {
    if (!db || !classCode || gameState !== 'results') return null;
    return query(
      collection(db, 'classes', classCode, 'submissions'),
      orderBy('createdAt', 'desc'),
      limit(50)
    );
  }, [db, classCode, gameState]);

  const { data: leaderboardRaw } = useCollection(leaderboardQuery);
  const leaderboardData = (leaderboardRaw ?? []) as Submission[];

  const isPending = isEvaluating;
  const currentQuestion = useMemo(() => questions[currentQuestionIndex], [questions, currentQuestionIndex]);
  const { currentCombo, maxCombo } = useMemo(() => deriveCombo(results), [results]);

  // 현재 문제가 플래시 라운드인지
  const isFlashRound = currentQuestionIndex === flashQuestionIndex;
  // 플래시 라운드에서 그림이 아직 보이는 상태인지 (카운트다운 진행 중)
  const isImageVisible = !isFlashRound || flashRemaining === null || flashRemaining > 0;
  // 그림이 가려졌는지 (플래시 라운드이고 시간이 다 됨)
  const isImageHidden = isFlashRound && flashRemaining === 0;

  useEffect(() => {
    const shuffled = [...allQuestions].sort(() => 0.5 - Math.random());
    setQuestions(shuffled.slice(0, GAME_QUESTION_COUNT));
    setCurrentDate(new Date().toLocaleDateString('ko-KR'));
    // 5문제 중 랜덤 1개를 플래시 라운드로 지정
    setFlashQuestionIndex(Math.floor(Math.random() * GAME_QUESTION_COUNT));
    // 리더보드 조회용 classCode (없으면 null → 카드 숨김)
    setClassCode(sessionStorage.getItem('classCode'));
    setAttendanceNumber(sessionStorage.getItem('attendanceNumber'));
  }, []);

  useEffect(() => {
    if (gameState === 'playing') setStudentPrompt('');
  }, [gameState, currentQuestionIndex]);

  // 플래시 카운트다운: 플래시 문제에 도달하면 FLASH_SECONDS부터 0까지 세고 그림을 가림.
  // 문제 전환/게임 상태 변경 시 cleanup으로 타이머와 상태를 초기화.
  useEffect(() => {
    if (gameState !== 'playing' || currentQuestionIndex !== flashQuestionIndex) {
      setFlashRemaining(null);
      return;
    }
    setFlashRemaining(FLASH_SECONDS);
    const interval = setInterval(() => {
      setFlashRemaining((prev) => {
        if (prev === null || prev <= 1) {
          clearInterval(interval);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [gameState, currentQuestionIndex, flashQuestionIndex]);

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
        const photoDataUri = await toDataURL(currentQuestion.imageUrl);
        const result = await evaluatePrompt({ studentPrompt, photoDataUri, questionLevel: currentQuestion.level });
        const newResults = [...results, {
          ...result,
          questionIndex: currentQuestionIndex,
          questionLevel: currentQuestion.level,
          koreanTitle: currentQuestion.koreanTitle,
          studentPrompt,
          originalPrompt: buildImagePrompt(currentQuestion.dataAiHint),
          isFlash: isFlashRound,
        }];
        setResults(newResults);

        if (currentQuestionIndex < GAME_QUESTION_COUNT - 1) {
          setCurrentQuestionIndex(prev => prev + 1);
        } else {
          // 5문제 완료 → 즉시 저장 (보스 화면에서 이탈해도 기록이 남게).
          // 보스 결과는 이후 applyBossOutcome()이 같은 doc을 updateDoc으로 갱신한다.
          saveToFirestore(newResults);
          setGameState('boss-offer');
        }
      } catch (error) {
        console.error("Evaluation failed:", error);
        toast({ variant: "destructive", title: "평가 실패", description: "AI 피드백을 받을 수 없습니다." });
      }
    });
  };

  // 세션 저장 — 5문제 완료 즉시 1회 호출 (보스 화면에서 이탈해도 기록이 남게).
  // 보스 결과는 이후 applyBossOutcome()이 같은 doc을 updateDoc으로 갱신한다.
  const saveToFirestore = (finalResults: Result[]) => {
    const classCode = sessionStorage.getItem('classCode');
    const attendanceNumber = sessionStorage.getItem('attendanceNumber');
    if (!db || !classCode || !attendanceNumber) return;

    const averageScore = finalResults.reduce((acc, r) => acc + r.score, 0) / finalResults.length;

    // 세션 기본 XP = 문제당 score 합산. 보스 XP는 applyBossOutcome에서 추가 적립.
    const totalXp = sessionXp(finalResults.map((r) => r.score));
    setEarnedXp(totalXp);
    if (totalXp > 0) {
      setDoc(
        doc(db, 'classes', classCode, 'students', attendanceNumber),
        { xp: increment(totalXp), updatedAt: serverTimestamp() },
        { merge: true }
      ).catch((err) => console.error('XP 저장 실패:', err));
    }

    // Firestore는 배열 원소의 undefined 필드도 거부 → strongestAxis는 없으면 null로 정규화
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
      mode: 'game',
      // 보스 결과는 additive 필드로. 도전하면 applyBossOutcome이 updateDoc으로 덮어씀.
      boss: { attempted: false, score: null, cleared: false },
      createdAt: serverTimestamp()
    }).then((ref) => {
      sessionDocRef.current = ref;
    }).catch((err) => console.error('세션 저장 실패:', err));
  };

  // 보스 결과 반영: 세션 doc의 boss 필드 갱신 + 보스 XP 추가 적립 (클리어 시 보너스)
  const applyBossOutcome = (boss: BossResult) => {
    const classCode = sessionStorage.getItem('classCode');
    const attendanceNumber = sessionStorage.getItem('attendanceNumber');
    if (!db || !classCode || !attendanceNumber) return;

    if (sessionDocRef.current) {
      updateDoc(sessionDocRef.current, {
        boss: { attempted: true, score: boss.score, cleared: boss.cleared },
      }).catch((err) => console.error('보스 결과 저장 실패:', err));
    }

    const bossXp = boss.score + (boss.cleared ? BOSS_CLEAR_BONUS_XP : 0);
    if (bossXp > 0) {
      setEarnedXp((prev) => prev + bossXp);
      setDoc(
        doc(db, 'classes', classCode, 'students', attendanceNumber),
        { xp: increment(bossXp), updatedAt: serverTimestamp() },
        { merge: true }
      ).catch((err) => console.error('XP 저장 실패:', err));
    }
  };

  // 보스 도전 안 함 → 세션은 이미 저장돼 있으므로 결과 화면으로만 이동.
  const handleSkipBoss = () => {
    setGameState('results');
  };

  // 보스 도전 시작
  const handleStartBoss = () => {
    setBossPrompt('');
    setGameState('boss');
  };

  // 보스 문제 제출 (콤보·플래시 없음, questionLevel 20 고정). 1회만.
  const handleBossSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!bossPrompt.trim()) {
      toast({ variant: "destructive", title: "프롬프트가 비어 있습니다" });
      return;
    }
    startEvaluationTransition(async () => {
      try {
        const photoDataUri = await toDataURL(BOSS_QUESTION.imageUrl);
        const result = await evaluatePrompt({ studentPrompt: bossPrompt, photoDataUri, questionLevel: BOSS_QUESTION.level });
        const boss: BossResult = {
          score: result.score,
          studentPrompt: bossPrompt,
          feedback: result.feedback,
          cleared: result.score >= BOSS_PASS_SCORE,
        };
        setBossResult(boss);
        applyBossOutcome(boss);
        setGameState('results');
      } catch (error) {
        console.error("Boss evaluation failed:", error);
        toast({ variant: "destructive", title: "평가 실패", description: "AI 피드백을 받을 수 없습니다." });
      }
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

  if (gameState === 'boss-offer') {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <Card className="max-w-lg w-full shadow-2xl rounded-2xl bg-card/90 backdrop-blur-sm border-4 border-purple-600/60">
          <CardHeader className="text-center">
            <div className="text-6xl mb-2 animate-in fade-in zoom-in duration-500">👑</div>
            <CardTitle className="text-3xl font-headline text-purple-700">숨겨진 보스가 나타났다!</CardTitle>
            <CardDescription className="text-lg mt-2">
              5문제를 모두 마쳤어요, {nickname}님! 이제 최고 난이도 보스에 도전할 수 있어요.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="bg-gradient-to-br from-purple-500/10 to-red-500/10 p-5 rounded-xl border-2 border-purple-500/30 text-center space-y-2">
              <p className="text-sm font-semibold text-muted-foreground">보스 문제</p>
              <p className="text-2xl font-bold text-purple-700">{BOSS_QUESTION.koreanTitle}</p>
              <p className="text-lg font-bold text-red-600">
                🎯 {BOSS_PASS_SCORE}점 이상이면 보스 클리어!
              </p>
              <p className="text-sm text-muted-foreground">
                딱 한 번의 기회예요. 도전하지 않아도 점수에는 영향이 없어요.
              </p>
            </div>
            <div className="flex flex-col sm:flex-row gap-3 pt-2">
              <Button
                onClick={handleStartBoss}
                size="lg"
                className="flex-1 h-14 text-lg font-bold bg-purple-600 hover:bg-purple-700"
              >
                👑 도전하기
              </Button>
              <Button
                onClick={handleSkipBoss}
                size="lg"
                variant="outline"
                className="flex-1 h-14 text-lg font-bold"
              >
                그냥 결과 보기
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (gameState === 'boss') {
    return (
      <div className="min-h-screen bg-background font-sans">
        <header className="p-4 flex justify-between items-center bg-purple-950/10">
          <h2 className="text-lg font-bold text-purple-700">👑 보스전</h2>
          <span className="text-red-600 font-bold text-lg animate-in fade-in zoom-in">
            {BOSS_PASS_SCORE}점을 넘겨라!
          </span>
        </header>
        <main className="container mx-auto p-4 sm:p-6 lg:p-8">
          <Card className="max-w-4xl mx-auto shadow-2xl rounded-2xl overflow-hidden border-4 border-purple-600/60 bg-card/80 backdrop-blur-sm">
            <div className="grid md:grid-cols-5 gap-0">
              <div className="md:col-span-3">
                <div className="relative w-full aspect-[4/3] bg-black/10">
                  <Image src={BOSS_QUESTION.imageUrl} alt="보스 이미지" fill className="object-contain" priority />
                  <div className="absolute inset-x-0 top-0 p-2 text-center bg-gradient-to-b from-purple-900/70 to-transparent text-white">
                    <p className="font-bold text-sm sm:text-base drop-shadow">👑 {BOSS_QUESTION.koreanTitle}</p>
                  </div>
                </div>
              </div>
              <div className="md:col-span-2 flex flex-col p-6 space-y-4">
                <Alert className="bg-purple-500/5 border-purple-500/30">
                  <BookOpen className="h-4 w-4 text-purple-600" />
                  <AlertTitle className="font-bold text-purple-700">보스 미션!</AlertTitle>
                  <AlertDescription className="whitespace-pre-line text-sm mt-2">{BOSS_QUESTION.rubric}</AlertDescription>
                </Alert>
                <form onSubmit={handleBossSubmit} className="flex-grow flex flex-col gap-4">
                  <div className="flex-grow">
                    <Label htmlFor="boss-prompt-input" className="font-bold text-lg mb-2 block">나의 설명 프롬프트 👑</Label>
                    <Textarea
                      id="boss-prompt-input"
                      placeholder="그림 속 모든 것을 빠짐없이, 분위기까지 담아 써보세요!"
                      value={bossPrompt}
                      onChange={(e) => setBossPrompt(e.target.value)}
                      className="h-full min-h-[180px] text-lg p-4"
                      disabled={isPending}
                    />
                  </div>
                  <Button
                    type="submit"
                    size="lg"
                    className="w-full h-14 text-xl font-bold bg-purple-600 hover:bg-purple-700"
                    disabled={isPending}
                  >
                    {isEvaluating ? <RefreshCw className="animate-spin" /> : <Award className="mr-2" />}
                    보스에게 도전!
                  </Button>
                </form>
              </div>
            </div>
          </Card>
        </main>
      </div>
    );
  }

  if (gameState === 'results') {
    const averageScore = results.reduce((acc, r) => acc + r.score, 0) / results.length;

    // 오늘 자정(로컬) 이후 게임 모드 기록만 추려 점수 내림차순 TOP 5
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const topFive = leaderboardData
      .filter((s) => s.mode === 'game' && typeof s.averageScore === 'number')
      .filter((s) => {
        const created = s.createdAt?.toDate?.();
        return created ? created >= todayStart : false;
      })
      .sort((a, b) => (b.averageScore ?? 0) - (a.averageScore ?? 0))
      .slice(0, 5);

    // 내 세션 강조: 닉네임+반올림 점수 일치(1회만). 여러 줄 중복 방지.
    const myRounded = Math.round(averageScore);
    let myHighlighted = false;

    const rankBadge = (rank: number) =>
      rank === 0 ? '🥇' : rank === 1 ? '🥈' : rank === 2 ? '🥉' : `${rank + 1}`;

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
                            <p className="text-7xl font-bold text-primary">{Math.round(averageScore)}점</p>
                            {maxCombo >= 2 && (
                              <p className="text-2xl font-bold text-orange-500 mt-4 animate-in fade-in zoom-in">
                                🔥 최대 {maxCombo}연속 {COMBO_SCORE}점 돌파!
                              </p>
                            )}
                        </div>
                        {studentDocRef && (
                          <div className="bg-gradient-to-br from-primary/10 to-accent/20 p-6 rounded-xl border-2 border-primary/20 text-center space-y-3">
                            <p className="text-2xl font-bold text-primary animate-in fade-in zoom-in">
                              +{earnedXp.toLocaleString()} XP 획득!
                            </p>
                            <p className="text-lg font-semibold">
                              {currentTitle.name} · 총 {currentXp.toLocaleString()} XP
                            </p>
                            {nextLevel ? (
                              <div className="max-w-md mx-auto space-y-1">
                                <Progress value={nextLevel.progressPercent} className="h-3" />
                                <p className="text-sm text-muted-foreground">
                                  다음 칭호 <b>{nextLevel.nextTitle}</b>까지 {nextLevel.remaining.toLocaleString()} XP
                                </p>
                              </div>
                            ) : (
                              <p className="text-sm text-muted-foreground">최고 칭호에 도달했어요! 🎉</p>
                            )}
                          </div>
                        )}
                        {bossResult && (
                          bossResult.cleared ? (
                            <div className="bg-gradient-to-br from-purple-500/15 to-red-500/15 p-6 rounded-xl border-4 border-purple-600/60 text-center space-y-2 animate-in fade-in zoom-in">
                              <div className="text-5xl">👑</div>
                              <p className="text-3xl font-bold text-purple-700">보스 클리어!</p>
                              <p className="text-lg font-semibold">
                                {BOSS_QUESTION.koreanTitle} · {bossResult.score}점
                              </p>
                              <p className="text-sm text-muted-foreground">최고 난이도 보스를 물리쳤어요! (+{BOSS_CLEAR_BONUS_XP} XP 보너스)</p>
                            </div>
                          ) : (
                            <div className="bg-muted/50 p-6 rounded-xl border-2 border-purple-500/20 text-center space-y-1">
                              <div className="text-4xl">👑</div>
                              <p className="text-xl font-bold text-purple-700">보스는 다음 기회에...</p>
                              <p className="text-lg font-semibold text-muted-foreground">내 점수 {bossResult.score}점</p>
                              <p className="text-sm text-muted-foreground">감점은 없어요. 다음에 또 도전해봐요!</p>
                            </div>
                          )
                        )}
                        {topFive.length > 0 && (
                          <div>
                            <h3 className="text-2xl font-headline mb-4 text-center flex items-center justify-center gap-2">
                              <Users className="h-6 w-6 text-primary" />
                              우리 반 오늘의 TOP 5
                            </h3>
                            <Card className="overflow-hidden bg-muted/30">
                              <Table>
                                <TableHeader>
                                  <TableRow>
                                    <TableHead className="w-[60px] text-center">순위</TableHead>
                                    <TableHead>닉네임</TableHead>
                                    <TableHead className="text-right">점수</TableHead>
                                  </TableRow>
                                </TableHeader>
                                <TableBody>
                                  {topFive.map((s, rank) => {
                                    const rounded = Math.round(s.averageScore ?? 0);
                                    // 내 세션과 처음 일치하는 줄 1개만 강조
                                    const isMine =
                                      !myHighlighted &&
                                      s.nickname === nickname &&
                                      rounded === myRounded;
                                    if (isMine) myHighlighted = true;
                                    return (
                                      <TableRow key={s.id} className={isMine ? 'bg-primary/10 font-bold' : ''}>
                                        <TableCell className="text-center text-lg">{rankBadge(rank)}</TableCell>
                                        <TableCell className="whitespace-nowrap">
                                          {s.nickname || '이름 없음'}
                                          {isMine && <span className="ml-2 text-xs text-primary">(나)</span>}
                                        </TableCell>
                                        <TableCell className="text-right font-bold text-primary text-lg">{rounded}점</TableCell>
                                      </TableRow>
                                    );
                                  })}
                                </TableBody>
                              </Table>
                            </Card>
                          </div>
                        )}
                        <div>
                          <h3 className="text-2xl font-headline mb-4 text-center">상세 결과</h3>
                           <Card className="overflow-hidden bg-muted/30">
                              <Table>
                                <TableHeader>
                                  <TableRow>
                                    <TableHead className="w-[50px]">문제</TableHead>
                                    <TableHead>제출한 프롬프트</TableHead>
                                    <TableHead>칭호</TableHead>
                                    <TableHead className="text-right">점수</TableHead>
                                  </TableRow>
                                </TableHeader>
                                <TableBody>
                                  {results.map((result, index) => (
                                    <TableRow key={index}>
                                      <TableCell className="font-medium whitespace-nowrap">
                                        {index + 1}
                                        {result.isFlash && (
                                          <span title="플래시 라운드" className="ml-1">⚡</span>
                                        )}
                                      </TableCell>
                                      <TableCell className="font-body text-muted-foreground">{result.studentPrompt}</TableCell>
                                      <TableCell>
                                        {(() => {
                                          const badge = getAxisBadge(result.strongestAxis);
                                          return badge ? (
                                            <Badge variant="secondary" className="whitespace-nowrap">
                                              {badge.emoji} {badge.name}
                                            </Badge>
                                          ) : (
                                            <span className="text-muted-foreground text-xs">-</span>
                                          );
                                        })()}
                                      </TableCell>
                                      <TableCell className="text-right font-bold text-primary text-lg">{result.score}</TableCell>
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
                                    평균 {Math.round(averageScore)}점이라는 우수한 성적을 거두었기에<br/>
                                    이 상장을 수여하여 실력을 인증합니다.
                                    {maxCombo >= 2 && (<><br/>(최대 {maxCombo}연속 우수 답안)</>)}
                                    {bossResult?.cleared && (<><br/>👑 보스 클리어</>)}
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
            <div className="flex items-center gap-3">
              <h2 className="text-lg font-bold">{nickname}님 ({currentQuestionIndex + 1}/{GAME_QUESTION_COUNT})</h2>
              {currentCombo >= 2 && (
                <span key={currentCombo} className="text-orange-500 font-bold text-lg animate-in fade-in zoom-in duration-300">
                  🔥 {currentCombo}연속!
                </span>
              )}
            </div>
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
                  {isFlashRound && isImageVisible && (
                    <div className="absolute inset-x-0 top-0 p-3 flex flex-col items-center gap-2 bg-gradient-to-b from-black/70 to-transparent text-white text-center">
                      <p className="font-bold text-sm sm:text-base drop-shadow">
                        ⚡ 플래시 라운드! 그림을 10초만 보여줄게요. 눈에 담아두세요!
                      </p>
                      <span className="text-4xl font-black tabular-nums drop-shadow-lg">
                        {flashRemaining ?? FLASH_SECONDS}
                      </span>
                    </div>
                  )}
                  {isImageHidden && (
                    <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/90 text-white text-center p-4">
                      <span className="text-5xl">🙈</span>
                      <p className="text-xl font-bold">기억으로 써보세요!</p>
                    </div>
                  )}
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
                      placeholder={isFlashRound && isImageVisible
                        ? "그림을 눈에 담는 중... 가려지면 기억으로 써요!"
                        : "예: 따뜻한 햇살이 비치는 거실에 하얀색 강아지가 앉아서 꼬리를 살랑살랑 흔들고 있어요."}
                      value={studentPrompt}
                      onChange={(e) => setStudentPrompt(e.target.value)}
                      className="h-full min-h-[180px] text-lg p-4"
                      disabled={isPending || (isFlashRound && isImageVisible)}
                    />
                  </div>
                  <Button type="submit" size="lg" className="w-full h-14 text-xl font-bold" disabled={isPending || (isFlashRound && isImageVisible)}>
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
