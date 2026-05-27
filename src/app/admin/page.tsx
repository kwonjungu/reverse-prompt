'use client';

import { useState, useMemo } from 'react';
import Link from 'next/link';
import { runAuditAgent, type AuditOutput, type AuditInput } from '@/ai/flows/audit-agent';
import { useFirestore, useCollection } from '@/firebase';
import { collection, query, orderBy, limit } from 'firebase/firestore';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { ArrowLeft, Bot, AlertTriangle, CheckCircle2, Info, Loader2, RefreshCw, ShieldCheck } from 'lucide-react';

// 현재 시스템 설정 — 감수 에이전트에 전달할 snapshot
const CURRENT_QUESTIONS = [
  { level: 1, dataAiHint: 'a small white fluffy puppy sitting, tongue out, plain pure white background, no collar, no accessories, no objects except the puppy', rubric: '이 그림을 한 번도 못 본 친구에게 문자로 보낸다면?\n\n색깔은 어떤지, 어떤 자세인지, 어떤 느낌인지 생각나는 대로 써봐요.\n더 자세히 쓸수록 AI가 똑같은 그림을 만들 수 있어요!' },
  { level: 2, dataAiHint: 'a shiny red apple with a short green stem and one small green leaf, centered on plain pure white background, no other objects', rubric: '이 물건을 눈 감고 머릿속으로 떠올릴 수 있게 설명해봐요.\n\n색깔, 모양, 크기, 어떤 특징이 있는지... 단어를 많이 쓸수록 좋아요!' },
  { level: 3, dataAiHint: 'a single bright yellow sunflower facing forward, thick green stem, plain pure white background, no other flowers, no vase', rubric: '꽃집 주인이 되어 이 꽃을 소개하는 설명을 써봐요.' },
  { level: 4, dataAiHint: 'a gray humanoid robot with a square silver head, two round blue glowing eyes, rectangular body, standing straight with arms at sides, plain pure white background, no weapons', rubric: '로봇 설계 도면을 글로 그려봐요!' },
  { level: 5, dataAiHint: 'a round brown chocolate chip cookie character with two large round white cartoon eyes and a big smiling mouth, two short stick arms and two short stick legs, standing pose, plain pure white background', rubric: '이 캐릭터의 프로필을 써봐요!' },
  { level: 6, dataAiHint: 'a white cat standing upright on two legs, holding a round black microphone with one paw, mouth open wide singing, plain pure white background, no stage, no crowd', rubric: '음악 방송 해설자가 되어 이 장면을 중계해봐요!' },
  { level: 7, dataAiHint: 'a pink cartoon pig with two small round white feathered wings on its back, hovering in midair with a big happy smile, solid light sky-blue background, no clouds, no other objects', rubric: '뉴스 기자가 되어 이 신기한 장면을 보도해봐요!' },
  { level: 8, dataAiHint: 'a yellow crescent moon shape with two closed eyes and a peaceful sleeping smile, surrounded by five small white stars, solid dark navy blue background, nothing else', rubric: '동화책의 한 페이지를 글로 써봐요!' },
  { level: 9, dataAiHint: 'a hamburger with two large round white cartoon eyes and a wide open smiling mouth, two small round legs, standing upright on a simple light yellow background, no extra props', rubric: '이 캐릭터를 처음 만난 탐험가처럼 관찰 일지를 써봐요!' },
  { level: 10, dataAiHint: 'a white horse with a single straight golden horn on its forehead and a long rainbow-colored mane and tail, standing still in a misty light green meadow, soft golden sunlight from above, no riders, no fairies', rubric: '마법의 생물을 목격한 탐험가의 보고서를 써봐요!' },
  { level: 11, dataAiHint: 'a small orange tabby cat wearing a purple wizard hat and robe, sitting at a wooden desk, holding a wooden wand, a glowing purple open spell book on the desk, simple gray stone wall background behind', rubric: '이 장면을 영화 대본처럼 묘사해봐요!' },
  { level: 12, dataAiHint: 'an astronaut in a white spacesuit floating in outer space, arms stretched out sideways, blue Earth visible in the upper left, white stars scattered on black background, one ringed planet visible in the far right distance', rubric: '우주에서 찍은 사진을 지구 관제센터에 보고하는 전문가가 되어봐요!' },
  { level: 13, dataAiHint: 'a futuristic night city viewed from street level, three flying cars with glowing blue headlights in the sky, tall skyscrapers with pink and cyan neon signs on the sides, dark sky, no people, no animals', rubric: '미래 여행 가이드북의 한 페이지를 써봐요!' },
  { level: 14, dataAiHint: 'an underwater ocean floor scene with round dome-shaped glowing teal buildings, a school of small colorful tropical fish swimming past in the foreground, hazy blue-green water, faint light rays coming from the surface above, no people, no submarines', rubric: '바닷속 세계를 처음 발견한 탐험가의 일기를 써봐요!' },
  { level: 15, dataAiHint: 'a magical fantasy library interior, tall wooden bookshelves on both walls filled with colorful books, five glowing crystal orbs floating in midair at different heights, warm golden lantern light, stone floor, no people', rubric: '마법 도서관에 처음 들어선 주인공의 눈에 보이는 것을 써봐요!' },
];

const EVALUATION_SYSTEM_PROMPT = `초등학교 담임 선생님으로서 학생 글을 3축(대상/시각묘사/맥락)으로 채점.
점수 0~100: 세 축 모두+형용사 2개=95~100, 세 축=85~94, 두 축=70~84, 한 축=55~69, 짧음=35~54, 거리 멈=15~34, 무관=0~14.
피드백 2줄: 학생 글 단어 인용 칭찬 + 빠진 축 1개 지적 + 단어 2개 제안. 추상 칭찬 금지.`;

const IMAGE_PROMPT_TEMPLATE = `Generate a high-quality image of: {subject}. Render ONLY what is explicitly described. Do NOT add clothing, accessories, scarves, collars, hats, or any props not mentioned. Do NOT add text, watermarks, or extra objects. Keep the composition clean and simple.`;

const severityIcon = {
  '즉시수정': <AlertTriangle className="h-4 w-4 text-destructive" />,
  '개선권장': <Info className="h-4 w-4 text-yellow-500" />,
  '양호': <CheckCircle2 className="h-4 w-4 text-green-500" />,
};

const severityBadge = {
  '즉시수정': 'destructive' as const,
  '개선권장': 'secondary' as const,
  '양호': 'outline' as const,
};

const gradeColor = {
  'A': 'text-green-600',
  'B': 'text-blue-600',
  'C': 'text-yellow-600',
  'D': 'text-destructive',
};

export default function AdminPage() {
  const [auditResult, setAuditResult] = useState<AuditOutput | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [includeData, setIncludeData] = useState(true);
  const db = useFirestore();

  const practiceQuery = useMemo(() => {
    if (!db) return null;
    // 최근 50건만 샘플링
    return query(
      collection(db, 'classes', '__audit_sample__', 'practice_attempts'),
      orderBy('createdAt', 'desc'),
      limit(50)
    );
  }, [db]);

  // 실제 데이터는 특정 classCode가 아닌 전체를 읽을 수 없으므로
  // 교사가 classCode를 입력하면 로드하는 방식 대신
  // sessionStorage의 classCode 사용
  const [classCodeForAudit, setClassCodeForAudit] = useState('');

  const auditDataQuery = useMemo(() => {
    if (!db || !classCodeForAudit) return null;
    return query(
      collection(db, 'classes', classCodeForAudit, 'practice_attempts'),
      orderBy('createdAt', 'desc'),
      limit(30)
    );
  }, [db, classCodeForAudit]);

  const { data: auditData } = useCollection(auditDataQuery);

  const handleRunAudit = async () => {
    setIsRunning(true);
    setAuditResult(null);

    const recentEvaluations = (auditData as any[])?.map(d => ({
      questionLevel: d.questionLevel,
      studentPrompt: d.studentPrompt,
      score: d.score,
      feedback: d.feedback,
      originalPrompt: d.originalPrompt,
    }));

    const input: AuditInput = {
      questions: CURRENT_QUESTIONS,
      evaluationPrompt: EVALUATION_SYSTEM_PROMPT,
      imagePromptTemplate: IMAGE_PROMPT_TEMPLATE,
      recentEvaluations: includeData && recentEvaluations?.length ? recentEvaluations : undefined,
    };

    try {
      const result = await runAuditAgent(input);
      setAuditResult(result);
    } catch (e: any) {
      console.error('Audit failed:', e);
    } finally {
      setIsRunning(false);
    }
  };

  return (
    <div className="min-h-screen bg-background p-4 md:p-8">
      <div className="max-w-4xl mx-auto">
        <header className="mb-8 flex items-start justify-between">
          <div>
            <div className="flex items-center gap-3 mb-1">
              <ShieldCheck className="h-8 w-8 text-primary" />
              <h1 className="text-3xl font-black font-headline">감수 에이전트</h1>
            </div>
            <p className="text-muted-foreground">AI가 이 프로젝트의 교육적 품질을 자동으로 검토합니다.</p>
          </div>
          <Link href="/">
            <Button variant="outline" size="sm"><ArrowLeft className="mr-2 h-4 w-4" />홈</Button>
          </Link>
        </header>

        {/* 실행 설정 */}
        <Card className="mb-6 border-2 border-primary/20">
          <CardHeader>
            <CardTitle className="text-lg">감수 설정</CardTitle>
            <CardDescription>실제 학생 데이터를 포함하면 패턴 분석까지 수행합니다.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center gap-3">
              <input
                type="checkbox"
                id="includeData"
                checked={includeData}
                onChange={e => setIncludeData(e.target.checked)}
                className="h-4 w-4"
              />
              <label htmlFor="includeData" className="text-sm font-medium">
                실제 학생 데이터 포함 (학급 코드 입력 필요)
              </label>
            </div>
            {includeData && (
              <div className="flex gap-2">
                <input
                  type="text"
                  placeholder="학급 코드 (예: 7531234_3-2)"
                  value={classCodeForAudit}
                  onChange={e => setClassCodeForAudit(e.target.value)}
                  className="flex-1 h-10 px-3 rounded-md border bg-background text-sm"
                />
                <span className="text-xs text-muted-foreground self-center">
                  {auditData ? `${(auditData as any[]).length}건 로드됨` : '미로드'}
                </span>
              </div>
            )}
            <Button
              onClick={handleRunAudit}
              disabled={isRunning}
              className="w-full font-bold h-12 text-lg"
              size="lg"
            >
              {isRunning
                ? <><Loader2 className="mr-2 h-5 w-5 animate-spin" />감수 중... (30~60초 소요)</>
                : <><Bot className="mr-2 h-5 w-5" />감수 시작</>
              }
            </Button>
          </CardContent>
        </Card>

        {/* 로딩 상태 */}
        {isRunning && (
          <div className="space-y-4">
            <Skeleton className="h-32 w-full rounded-2xl" />
            <Skeleton className="h-24 w-full rounded-2xl" />
            <Skeleton className="h-24 w-full rounded-2xl" />
          </div>
        )}

        {/* 감수 결과 */}
        {auditResult && !isRunning && (
          <div className="space-y-6 animate-in fade-in-50 duration-500">
            {/* 종합 등급 */}
            <Card className="border-2 border-primary/20">
              <CardContent className="pt-6">
                <div className="flex items-center gap-6">
                  <div className={`text-8xl font-black font-headline ${gradeColor[auditResult.overallGrade]}`}>
                    {auditResult.overallGrade}
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground font-bold uppercase mb-1">종합 품질 등급</p>
                    <p className="text-base leading-relaxed">{auditResult.overallComment}</p>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* 최우선 개선사항 */}
            <Alert className="border-2 border-destructive/30 bg-destructive/5">
              <AlertTriangle className="h-5 w-5 text-destructive" />
              <AlertTitle className="font-bold text-destructive">최우선 개선 과제</AlertTitle>
              <AlertDescription className="text-base mt-1">{auditResult.topPriority}</AlertDescription>
            </Alert>

            {/* 데이터 인사이트 */}
            {auditResult.dataInsights && (
              <Alert className="border-2 border-blue-200 bg-blue-50/50">
                <Info className="h-5 w-5 text-blue-600" />
                <AlertTitle className="font-bold text-blue-700">학생 데이터 패턴</AlertTitle>
                <AlertDescription className="text-base mt-1 text-blue-800">{auditResult.dataInsights}</AlertDescription>
              </Alert>
            )}

            {/* 발견 사항 목록 */}
            <div className="space-y-3">
              <h2 className="text-xl font-bold">발견 사항 ({auditResult.findings.length}건)</h2>
              {auditResult.findings.map((f, i) => (
                <Card key={i} className={`border ${f.severity === '즉시수정' ? 'border-destructive/40 bg-destructive/5' : f.severity === '개선권장' ? 'border-yellow-300 bg-yellow-50/50' : 'border-green-200 bg-green-50/50'}`}>
                  <CardContent className="pt-4 pb-4">
                    <div className="flex items-start gap-3">
                      <div className="mt-0.5">{severityIcon[f.severity]}</div>
                      <div className="flex-1 min-w-0">
                        <div className="flex flex-wrap items-center gap-2 mb-2">
                          <Badge variant={severityBadge[f.severity]} className="text-xs">{f.severity}</Badge>
                          <Badge variant="outline" className="text-xs">{f.category}</Badge>
                          {f.targetFile && (
                            <code className="text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded">{f.targetFile}</code>
                          )}
                        </div>
                        <p className="text-sm font-medium mb-1">{f.issue}</p>
                        <p className="text-sm text-muted-foreground">→ {f.recommendation}</p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>

            {/* 재실행 버튼 */}
            <Button variant="outline" onClick={handleRunAudit} className="w-full">
              <RefreshCw className="mr-2 h-4 w-4" />다시 감수하기
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
