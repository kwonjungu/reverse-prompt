'use client';

/**
 * 설명 모드 — 논문 v12의 처치 설계와 문언을 맞춘 학생용 안내 화면.
 *
 * 대응:
 *   공통 루브릭 v12-2 — 세 영역(대상·특징·관계)을 영역마다 1~4수준으로 본다 (src/lib/rubric.ts)
 *   6단계 구성과 단계별 초점 영역 (src/lib/stages.ts — 이 화면은 그 목록을 그대로 쓴다)
 *   학생 결과 화면 — 점수(100점)를 보이지 않고 영역별 네 칸(●●●○)과 4문장 피드백만 보인다.
 *     해당 없음(not_applicable) 영역은 칸을 보이지 않는다.
 *   부록 1차시 설계안 (인공지능의 원리·한계·윤리)
 *
 * 주의: 이 활동은 역방향이다. 상상한 것을 그리게 하는 것이 아니라,
 * 이미 있는 그림을 다시 만들 수 있도록 언어로 되짚는 것이다.
 * 운영 규칙상 그림과 다른 정보는 빠진 정보보다 무겁게 보고, 그림에 없는 추가 내용 자체는 감점하지 않는다.
 * 그래도 되살리기 활동의 원칙으로 "그림에 없는 것은 쓰지 않는다"를 알린다(감점한다고 말하지 않는다).
 *
 * 예시로 드는 물건(지우개·색연필·단추·운동화)은 연습·검사 문항에 없는 것으로 고른다.
 * 문항의 답(대상 이름·색 이름·개수)을 이 화면에 두지 않는다.
 */

import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import {
  Home,
  ArrowRight,
  Search,
  Palette,
  MapPin,
  ShieldAlert,
  Eye,
  MessageSquare,
} from 'lucide-react';
import { STAGES } from '@/lib/stages';
import { AREA_LABEL, type AreaId } from '@/lib/scoring';

const AREAS: {
  id: AreaId;
  icon: typeof Search;
  question: string;
  body: string;
  good: string;
  bad: string;
}[] = [
  {
    id: 'object',
    icon: Search,
    question: '무엇이 몇 개 있나',
    body: '그림에 있는 것을 빠짐없이 찾아 알맞은 이름으로 부르고, 몇 개인지도 써요. "학용품"보다 "지우개"가 좋아요. 이름과 개수만 듣고도 그림 속 물건이 딱 정해지면 성공이에요.',
    good: '지우개 한 개',
    bad: '학용품',
  },
  {
    id: 'feature',
    icon: Palette,
    question: '어떻게 생겼나',
    body: '눈에 보이는 색과 모양, 크기, 겉모습(매끈한지, 거친지 등)을 알려 주세요. 여러 가지가 있을 때는 그 생김새가 어느 것의 것인지 알 수 있게 써요.',
    good: '길쭉한 초록 색연필과 네모난 하얀 지우개',
    bad: '초록색이랑 하얀색이 있어요',
  },
  {
    id: 'relation',
    icon: MapPin,
    question: '어디에서 무엇을 하나',
    body: '둘 이상이 있으면 서로 어디에 있는지(위·아래·옆·안), 사람이나 동물이 있으면 어디에서 무엇을 하고 있는지, 물건만 있으면 무엇이 어디에 어떻게 놓여 있는지 알려 주세요. 뒤 단계 그림에서는 언제인지 알 수 있다면 써도 좋아요. 느낌을 쓸 때는 그림 속 무엇을 보고 그렇게 느꼈는지도 함께 써요.',
    good: '색연필이 지우개 왼쪽에 놓여 있어요',
    bad: '같이 있어요',
  },
];

/**
 * 이름에 기본 색·모양을 붙이는 연습 예시.
 * 예시로 드는 대상은 연습·검사 문항에 없는 것으로 고른다. 문항의 답을 그대로 보여 주면
 * 학생이 예시를 옮겨 적게 되어 무엇을 스스로 썼는지 알 수 없다.
 */
const BASIC_EXAMPLES = [
  { name: 'eraser', nameOnly: '지우개', withColorShape: '하얀 네모난 지우개' },
  { name: 'pencil', nameOnly: '색연필', withColorShape: '길쭉한 초록 색연필' },
  { name: 'button', nameOnly: '단추', withColorShape: '작고 동그란 파란 단추' },
];

/** 단계마다 무엇을 하는지 — 단계 이름과 초점은 src/lib/stages.ts에서 온다. */
const STAGE_BLURB: Record<number, string> = {
  1: 'AI에게 그림을 글로 설명하는 방법을 익혀요.',
  2: '무엇이 몇 개 있는지 빠짐없이 써요.',
  3: '색·모양·겉모습이 어느 것의 것인지 드러나게 써요.',
  4: '어디에서 무엇을 하고 있는지, 서로 어디에 있는지 써요.',
  5: '피드백을 그림과 견주어 보고 맞는 것만 받아들여 고쳐 써요.',
  6: '지금까지 배운 것을 모두 담아 써요.',
};

/**
 * 예시 해설에 쓰는 대상.
 *
 * 연습 36문항(L01~L36)과 검사 문항 어디에도 없는 물건으로 고른다. 문항의 그림이나
 * 그 문항의 좋은 문장을 여기에 두면 학생이 예시를 그대로 옮겨 적게 되어 무엇을 스스로
 * 썼는지 알 수 없다. 그래서 이 카드는 문항 이미지를 띄우지 않고 글로만 설명한다.
 */
const SAMPLE = {
  weak: '신발이 있어요.',
  weakWhy: '이름이 너무 넓고 몇 개인지도 없어요. 운동화인지 구두인지 장화인지, 한 짝인지 한 켤레인지 알 수 없어요.',
  strong: '하얀 운동화 한 켤레가 나란히 놓여 있어요. 양옆에 파란 줄이 하나씩 있고 끈은 매여 있어요.',
  invented: '운동장을 달리는 아이가 신은 빨간 운동화',
};

/**
 * 결과 화면 예시 — 위 SAMPLE.weak("신발이 있어요.")를 냈을 때의 모습을 꾸며 본 것이다(실제 채점 결과가 아니다).
 * 다음 행동은 칸이 가장 적게 찬 영역에서 하나만 고른다(같으면 대상 → 특징 → 관계 순, src/lib/scoring.ts).
 */
const RESULT_EXAMPLE: { area: AreaId; level: 1 | 2 | 3 | 4 }[] = [
  { area: 'object', level: 3 },
  { area: 'feature', level: 1 },
  { area: 'relation', level: 1 },
];

const FEEDBACK_EXAMPLE: { label: string; text: string }[] = [
  { label: '이번 목표', text: '이번 목표는 그림을 못 본 친구가 똑같이 떠올릴 수 있게 쓰는 거예요.' },
  { label: '잘 쓴 점', text: `[${AREA_LABEL.object}] "신발"이라고 써서 무엇이 있는지 알려 주었어요.` },
  { label: '다음에 해 볼 것', text: `[${AREA_LABEL.feature}] 신발이 무슨 색이고 어떤 무늬가 있는지 써 보세요.` },
  { label: '쓸 수 있는 표현', text: '"하얀", "파란 줄이 있는"처럼 색과 무늬를 나타내는 말을 붙여 볼 수 있어요.' },
];

/** 영역 하나의 네 칸. 찬 칸은 ●, 빈 칸은 ○. */
function LevelDots({ area, level }: { area: AreaId; level: 1 | 2 | 3 | 4 }) {
  return (
    <div className="flex items-center gap-3" aria-label={`${AREA_LABEL[area]} 네 칸 가운데 ${level}칸`}>
      <span className="w-10 text-sm font-semibold">{AREA_LABEL[area]}</span>
      <span className="text-lg tracking-[0.2em]" aria-hidden="true">
        <span className="text-primary">{'●'.repeat(level)}</span>
        <span className="text-muted-foreground/60">{'○'.repeat(4 - level)}</span>
      </span>
    </div>
  );
}

export default function GuidePage() {
  return (
    <div className="min-h-screen bg-background font-sans text-foreground">
      <header className="p-4 flex justify-end">
        <Link href="/" passHref>
          <Button variant="outline">
            <Home className="mr-2 h-4 w-4" />
            홈으로 돌아가기
          </Button>
        </Link>
      </header>

      <main className="container mx-auto p-4 sm:p-6 lg:p-8">
        <div className="max-w-4xl mx-auto">
          <div className="text-center mb-12">
            <h1 className="text-4xl md:text-5xl font-bold tracking-tight text-transparent bg-clip-text bg-gradient-to-r from-primary via-purple-400 to-pink-500 font-headline">
              그림을 보고, 그 그림을 되살리는 글쓰기
            </h1>
            <p className="mt-4 text-lg text-muted-foreground max-w-2xl mx-auto">
              먼저 그림을 봅니다. 그리고 그 그림을 한 번도 못 본 친구가 똑같이 떠올릴 수 있도록
              글로 되짚습니다.
            </p>
          </div>

          <Card className="shadow-2xl shadow-primary/10 rounded-2xl bg-card/80 backdrop-blur-sm p-6 md:p-10 mb-8">
            <CardTitle className="text-2xl font-headline mb-4">이 활동은 거꾸로예요</CardTitle>
            <div className="text-muted-foreground text-base space-y-3 font-body leading-relaxed">
              <p>
                보통은 사람이 먼저 글을 쓰고 인공지능이 그림을 만들어요. 그러면 내가 무엇을 잘못
                썼는지 알기 어려워요. 그림이 그럴듯하게 나오면 &ldquo;원래 이걸 그리려고 했어&rdquo;
                하고 넘어가게 되거든요.
              </p>
              <p>
                이 활동은 순서를 뒤집습니다. <strong>완성된 그림이 먼저 있어요.</strong> 여러분은
                그 그림을 다시 만들 수 있는 문장을 씁니다. 목표가 눈앞에 있으니 무엇이 빠졌는지
                바로 알 수 있어요.
              </p>
            </div>
          </Card>

          <Alert className="mb-10 border-destructive/40 bg-destructive/5">
            <ShieldAlert className="h-4 w-4 text-destructive" />
            <AlertTitle className="font-semibold">가장 중요한 약속</AlertTitle>
            <AlertDescription className="text-sm leading-relaxed">
              <strong>그림에 없는 것은 쓰지 않아요.</strong> 이 활동의 목표는 멋진 이야기를
              지어내는 것이 아니라 눈앞의 그림을 되살리는 것이에요. 그림에 없는 것을 보태면 친구가
              다른 그림을 떠올리게 돼요. 그림과 다르게 쓰면(색이나 개수를 틀리게 쓰면) 칸이 덜
              차요. 길게 쓴다고 좋은 것도 아니에요. 그림 하나로 좁혀 주는 말이 좋은 말이에요.
            </AlertDescription>
          </Alert>

          <div className="text-center mb-8">
            <h2 className="text-3xl font-headline font-bold">세 영역을 살펴봐요</h2>
            <p className="mt-2 text-muted-foreground">
              AI는 대상·특징·관계를 따로따로 봐요. 선생님도 같은 기준으로 봐요.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-10">
            {AREAS.map((a) => {
              const Icon = a.icon;
              return (
                <Card key={a.id} className="bg-card/50 backdrop-blur-sm rounded-xl p-6">
                  <CardHeader className="flex flex-row items-center gap-3 p-0 mb-3">
                    <div className="bg-primary/20 p-2.5 rounded-lg">
                      <Icon className="h-6 w-6 text-primary" />
                    </div>
                    <div>
                      <Badge variant="secondary" className="text-xs mb-1">
                        {AREA_LABEL[a.id]}
                      </Badge>
                      <CardTitle className="text-xl font-headline m-0">{a.question}</CardTitle>
                    </div>
                  </CardHeader>
                  <CardContent className="p-0 space-y-3">
                    <p className="font-body text-sm text-muted-foreground">{a.body}</p>
                    <div className="space-y-1.5 text-sm">
                      <p className="rounded-md bg-emerald-500/10 px-3 py-2 text-emerald-700 dark:text-emerald-300">
                        좋아요 · {a.good}
                      </p>
                      <p className="rounded-md bg-muted px-3 py-2 text-muted-foreground">
                        아쉬워요 · {a.bad}
                      </p>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>

          <Card className="shadow-2xl shadow-primary/10 rounded-2xl bg-card/80 backdrop-blur-sm p-6 md:p-10 mb-10">
            <CardTitle className="text-2xl font-headline mb-6 flex items-center gap-2">
              <Eye className="h-6 w-6 text-primary" />
              같이 해 볼까요
            </CardTitle>
            <p className="mb-4 text-sm text-muted-foreground font-body">
              아래 예시는 연습 문제에 나오지 않는 물건으로 해 보는 거예요. 연습 문제의 답을 미리
              알려 주면 스스로 찾아내는 즐거움이 사라지니까요. 그림 대신 글로만 견주어 봐요.
            </p>
            <div className="space-y-4 text-sm font-body">
              <div>
                <p className="font-semibold mb-1">이렇게 쓰면 아쉬워요</p>
                <blockquote className="rounded-r-lg border-l-4 border-muted bg-muted/40 p-3 italic">
                  {SAMPLE.weak}
                </blockquote>
                <p className="mt-1 text-muted-foreground">{SAMPLE.weakWhy}</p>
              </div>
              <div>
                <p className="font-semibold mb-1">이렇게 쓰면 좋아요</p>
                <blockquote className="rounded-r-lg border-l-4 border-primary bg-primary/10 p-3 italic">
                  {SAMPLE.strong}
                </blockquote>
                <p className="mt-1 text-muted-foreground">
                  <strong>운동화 한 켤레</strong>로 무엇이 몇 개인지 정하고({AREA_LABEL.object}),{' '}
                  <strong>하얀</strong> 색과 <strong>양옆의 파란 줄</strong>,{' '}
                  <strong>매여 있는 끈</strong>으로 어떻게 생겼는지 좁혔어요({AREA_LABEL.feature}).{' '}
                  <strong>나란히 놓여 있어요</strong>는 두 짝이 서로 어디에 있는지 알려 줘요(
                  {AREA_LABEL.relation}).
                </p>
              </div>
              <div className="rounded-lg bg-destructive/5 p-3">
                <p className="font-semibold text-destructive mb-1">이건 안 돼요</p>
                <p className="text-muted-foreground">
                  &ldquo;{SAMPLE.invented}&rdquo; — 운동장도 아이도 그림에 없고, 운동화 색도 그림과
                  달라요. 없는 것을 보태면 친구가 다른 그림을 떠올리고, 그림과 다르게 쓰면 칸이 덜
                  차요.
                </p>
              </div>
            </div>
          </Card>

          {/* 결과 화면 안내 — 점수 대신 영역별 네 칸과 4문장 피드백 */}
          <Card className="rounded-2xl bg-card/60 backdrop-blur-sm p-6 md:p-8 mb-10">
            <CardTitle className="text-2xl font-headline mb-3 flex items-center gap-2">
              <MessageSquare className="h-6 w-6 text-primary" />
              글을 내면 이렇게 알려 줘요
            </CardTitle>
            <p className="text-muted-foreground text-sm font-body leading-relaxed mb-4">
              연습 모드에서는 <strong>점수를 보여 주지 않아요.</strong> 대신 세 영역이 네 칸 가운데
              몇 칸까지 찼는지 보여 줘요. 칸 수는 성적이 아니라 무엇을 더 쓰면 좋을지 알려 주는
              표시예요. 그림에 따라 보지 않는 영역도 있어요. 그 영역은 칸이 나오지 않아요.
            </p>
            <p className="text-xs text-muted-foreground mb-2">
              예시 · &ldquo;{SAMPLE.weak}&rdquo;라고 냈을 때
            </p>
            <div className="grid gap-4 md:grid-cols-[auto_1fr] items-start">
              <div className="rounded-xl border bg-card/60 p-4 space-y-1.5">
                {RESULT_EXAMPLE.map((r) => (
                  <LevelDots key={r.area} area={r.area} level={r.level} />
                ))}
              </div>
              <ol className="rounded-xl border bg-card/60 p-4 space-y-2 text-sm font-body">
                {FEEDBACK_EXAMPLE.map((line, i) => (
                  <li key={line.label} className="flex gap-2">
                    <span className="shrink-0 text-xs text-muted-foreground w-24 pt-0.5">
                      {i + 1}. {line.label}
                    </span>
                    <span>{line.text}</span>
                  </li>
                ))}
              </ol>
            </div>
            <p className="mt-4 text-sm text-muted-foreground font-body leading-relaxed">
              피드백은 네 문장이에요. <strong>다음에 해 볼 것은 한 가지뿐</strong>이고, 칸이 가장
              적게 찬 영역에서 골라요. 그것부터 고쳐서 다시 써 봐요. 고칠 것이 없으면 스스로 확인해
              볼 질문을 알려 줘요.
            </p>
          </Card>

          {/* 이름과 눈에 보이는 기본 색·형태를 함께 쓰는 연습 */}
          <Card className="rounded-2xl bg-card/60 backdrop-blur-sm p-6 md:p-8 mb-10">
            <CardTitle className="text-2xl font-headline mb-3 flex items-center gap-2">
              <Palette className="h-6 w-6 text-primary" />
              이름에 색·모양을 붙여 봐요
            </CardTitle>
            <p className="text-muted-foreground text-sm font-body leading-relaxed mb-4">
              이름만 쓰면 그림이 하나로 정해지지 않아요. 이름 옆에 <strong>눈에 바로 보이는 색</strong>과{' '}
              <strong>모양</strong>을 한 가지씩만 붙여도 훨씬 좋아져요. 어려운 재료 이름은 몰라도
              괜찮아요. 눈에 보이는 대로 써요.
            </p>
            <div className="grid gap-3 sm:grid-cols-3 text-sm font-body">
              {BASIC_EXAMPLES.map((ex) => (
                <div key={ex.name} className="rounded-xl border bg-card/60 p-4">
                  <p className="text-xs text-muted-foreground">이름만</p>
                  <p className="mb-2">{ex.nameOnly}</p>
                  <p className="text-xs text-muted-foreground">이름 + 색 · 모양</p>
                  <p className="font-semibold text-primary">{ex.withColorShape}</p>
                </div>
              ))}
            </div>
            <div className="mt-4 grid gap-2 sm:grid-cols-2 text-sm">
              <p className="rounded-md bg-muted px-3 py-2 text-muted-foreground">
                쓸 수 있는 색 · 빨강, 주황, 노랑, 초록, 파랑, 보라, 갈색, 검정, 흰색, 회색, 은색
              </p>
              <p className="rounded-md bg-muted px-3 py-2 text-muted-foreground">
                쓸 수 있는 모양 · 동그란, 네모난, 세모난, 길쭉한, 납작한, 두꺼운, 접힌, 큰, 작은
              </p>
            </div>
            <p className="mt-4 text-xs text-muted-foreground">
              {AREA_LABEL.object}과 {AREA_LABEL.feature}은 따로 봐요. 이름과 개수가 분명하면{' '}
              {AREA_LABEL.object} 칸이, 색과 모양이 어느 것의 것인지 분명하면 {AREA_LABEL.feature}{' '}
              칸이 차요.
            </p>
          </Card>

          <div className="text-center mb-6">
            <h2 className="text-3xl font-headline font-bold">여섯 단계로 나아가요</h2>
            <p className="mt-2 text-muted-foreground">
              한 단계에 여섯 문항이에요. 앞 단계부터 순서대로 풀고, 한 문항을 내면 다음 문항이
              열려요. 어느 단계든 세 영역을 모두 보고, 단계마다 먼저 살펴볼 곳이 있어요. 아직 안 한
              문항은 틀린 것이 아니라 아직 하지 않은 것으로 남아요.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 mb-10">
            {STAGES.map((s) => (
              <div
                key={s.chasi}
                className="flex items-start gap-3 rounded-xl border bg-card/60 p-4 backdrop-blur-sm"
              >
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/15 text-sm font-bold text-primary">
                  {s.chasi}
                </div>
                <div>
                  <p className="font-semibold leading-tight">{s.title}</p>
                  <p className="mt-1 text-xs text-muted-foreground">{STAGE_BLURB[s.chasi]}</p>
                  <p className="mt-1 text-xs text-primary">
                    {s.focus ? `${AREA_LABEL[s.focus]} 먼저 살펴봐요` : '세 영역을 고루 살펴봐요'}
                  </p>
                </div>
              </div>
            ))}
          </div>

          <Card className="rounded-2xl bg-card/60 backdrop-blur-sm p-6 md:p-8 mb-10">
            <CardTitle className="text-2xl font-headline mb-4">
              인공지능은 어떻게 보고, 무엇을 못 할까요
            </CardTitle>
            <div className="text-muted-foreground text-sm space-y-3 font-body leading-relaxed">
              <p>
                인공지능은 그림을 사람처럼 &ldquo;이해&rdquo;하지 않아요. 색과 모양, 부분들의
                생김새를 잘게 나누어 살펴본 다음, 그 특징이 무엇과 비슷한지 견주어 봅니다. 그래서
                우리가 <strong>무엇이 몇 개, 어떤 색과 모양, 어디에</strong> 있는지 또렷하게 말해
                줄수록 잘 알아들어요.
              </p>
              <p>
                인공지능은 사람의 마음을 읽지 못해요. 내가 무엇을 떠올렸는지는 알 수 없고, 내가 쓴
                낱말만 봅니다. 그래서 같은 그림을 보고도 사람마다 다른 문장을 쓰면 다른 그림이
                나와요.
              </p>
              <p>
                인공지능이 채우는 칸도 완전하지 않아요. 같은 글이라도 조금 다르게 볼 때가 있어요.
                칸 수는 <strong>참고</strong>예요. 성적에 들어가지 않아요. 이상하다 싶으면
                선생님과 함께 확인해요.
              </p>
              <p className="rounded-lg bg-muted/60 p-3">
                <strong>지킬 것.</strong> 내 이름, 친구 이름, 선생님 이름, 학교 이름, 사는 곳,
                전화번호는 쓰지 않아요. 그림에 보이는 것만 씁니다.
              </p>
            </div>
          </Card>

          <div className="text-center mt-12">
            <p className="text-lg text-muted-foreground mb-4">
              틀려도 괜찮아요. 몇 번이든 고쳐 쓸 수 있어요.
            </p>
            <Link href="/practice" passHref>
              <Button size="lg" className="font-bold text-lg">
                연습하러 가기
                <ArrowRight className="ml-2" />
              </Button>
            </Link>
          </div>
        </div>
      </main>
    </div>
  );
}
