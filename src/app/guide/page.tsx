'use client';

/**
 * 설명 모드 — 논문의 처치 설계와 문언을 일치시킨 안내 화면.
 *
 * 대응:
 *   <표 III-4> AI·교사 공통 5수준 루브릭 (세 축과 공통 판정 원칙)
 *   <표 III-5> 밴드 전환의 확정 명세 (1~6단계)
 *   부록 1차시 설계안 (인공지능의 원리·한계·윤리)
 *   부록 공통 운영 지침 (각 차시 도입의 예시 해설)
 *
 * 주의: 이 활동은 역방향이다. 상상한 것을 그리게 하는 것이 아니라,
 * 이미 있는 그림을 다시 만들 수 있도록 언어로 되짚는 것이다.
 * 그림에 없는 것을 지어내면 수준이 내려간다는 원칙을 여기서 분명히 알린다.
 */

import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Home, ArrowRight, Search, Palette, CloudSun, ShieldAlert, Eye } from 'lucide-react';

const AXES = [
  {
    icon: Search,
    no: '축 1',
    name: '무엇이 있나',
    body: '그림에 있는 것을 빠짐없이 찾아 정확한 이름으로 부르는 거예요. "학용품"보다 "지우개", "지우개"보다 "모서리가 닳은 지우개"가 좋아요. 이름만 듣고도 그림 하나로 딱 정해지면 성공이에요.',
    good: '지우개 한 개',
    bad: '학용품',
  },
  {
    icon: Palette,
    no: '축 2',
    name: '어떻게 생겼나',
    body: '먼저 눈에 바로 보이는 색과 모양, 크기, 개수를 알려 주세요. 만졌을 때의 느낌이나 자세는 나중 단계에서 더해도 돼요. 같은 이름을 가진 다른 물건과 구별되도록 좁혀 주는 말이 좋은 말이에요.',
    good: '길쭉한 초록 색연필',
    bad: '예쁜 색연필',
  },
  {
    icon: CloudSun,
    no: '축 3',
    name: '어디에서 언제',
    body: '어디에 있는지, 무엇을 하고 있는지, 언제인지, 어떤 느낌인지 알려 주세요. 느낌을 쓸 때는 그림 속 무엇 때문에 그렇게 느꼈는지 근거도 함께 써야 해요.',
    good: '문 앞 신발장에 나란히 놓여 있어서 줄이 가지런하다',
    bad: '멋있다',
  },
];

/**
 * 1차시 도입(4분)에 쓰는 기본 색·형태 예시.
 * 전문 질감·재질은 필수로 요구하지 않는다. 채점 축 문언과 어긋나지 않게 유지할 것.
 *
 * 예시로 드는 대상은 연습·검사 문항에 없는 것으로 고른다. 문항의 답을 그대로 보여 주면
 * 학생이 예시를 옮겨 적게 되어 무엇을 스스로 썼는지 알 수 없다.
 */
const BASIC_EXAMPLES = [
  { name: 'eraser', nameOnly: '지우개', withColorShape: '하얀 네모난 지우개' },
  { name: 'pencil', nameOnly: '색연필', withColorShape: '길쭉한 초록 색연필' },
  { name: 'button', nameOnly: '단추', withColorShape: '작고 동그란 파란 단추' },
];

const STAGES = [
  { n: 1, title: '이름과 눈에 보이는 색·모양 함께 쓰기', axis: '축 1 + 축 2(기본 색·형태)' },
  { n: 2, title: '색과 모양을 더 자세히', axis: '축 1 + 축 2' },
  { n: 3, title: '어디에서 무엇을 하고 있나', axis: '축 1 + 축 2 + 배경·행동' },
  { n: 4, title: '질감과 자세까지 말하기', axis: '축 1 + 축 2 + 배경·행동' },
  { n: 5, title: '분위기를 담아 쓰기', axis: '세 축 모두' },
  { n: 6, title: '내 문장이 어떻게 달라졌나', axis: '세 축 모두' },
];

/**
 * 예시 해설에 쓰는 대상.
 *
 * 연습 36문항(L01~L36)과 검사 문항 어디에도 없는 물건으로 고른다. 문항의 그림이나
 * 그 문항의 만점 문장을 여기에 두면 학생이 예시를 그대로 옮겨 적게 되어 무엇을 스스로
 * 썼는지 알 수 없다. 그래서 이 카드는 문항 이미지를 띄우지 않고 글로만 설명한다.
 */
const SAMPLE = {
  subject: '운동화 한 켤레',
  weak: '신발이 있어요.',
  weakWhy: '이름이 너무 넓어요. 운동화인지 구두인지 장화인지 알 수 없어요.',
  strong: '하얀 운동화 한 켤레가 있어요. 양옆에 파란 줄이 하나씩 있고 끈은 매여 있어요.',
  invented: '운동장을 달리는 아이가 신은 빨간 운동화',
};

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
              먼저 그림을 봅니다. 그리고 그 그림을 한 번도 못 본 사람이 똑같이 떠올릴 수 있도록
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
              지어내는 것이 아니라 눈앞의 그림을 되살리는 것이에요. 그림에 없는 것을 쓰면 점수가
              오히려 내려가요. 길게 쓴다고 좋은 것도 아니에요. 그림 하나로 좁혀 주는 말이 좋은
              말이에요.
            </AlertDescription>
          </Alert>

          <div className="text-center mb-8">
            <h2 className="text-3xl font-headline font-bold">세 가지를 살펴봐요</h2>
            <p className="mt-2 text-muted-foreground">
              점수도 이 세 가지로 나뉘어요. 선생님도 같은 기준으로 봅니다.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-10">
            {AXES.map((a) => {
              const Icon = a.icon;
              return (
                <Card key={a.no} className="bg-card/50 backdrop-blur-sm rounded-xl p-6">
                  <CardHeader className="flex flex-row items-center gap-3 p-0 mb-3">
                    <div className="bg-primary/20 p-2.5 rounded-lg">
                      <Icon className="h-6 w-6 text-primary" />
                    </div>
                    <div>
                      <Badge variant="secondary" className="text-xs mb-1">
                        {a.no}
                      </Badge>
                      <CardTitle className="text-xl font-headline m-0">{a.name}</CardTitle>
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
                  <strong>{SAMPLE.subject}</strong>로 무엇인지 정하고(축 1), <strong>하얀</strong>{' '}
                  색과 <strong>파란 줄</strong>, <strong>매여 있는 끈</strong>으로 어떻게 생겼는지
                  좁혔어요(축 2). 1단계에서는 여기까지면 충분해요.
                  &lsquo;푹신푹신하다&rsquo; 같은 만진 느낌은 4단계에서 배워요.
                </p>
              </div>
              <div className="rounded-lg bg-destructive/5 p-3">
                <p className="font-semibold text-destructive mb-1">이건 안 돼요</p>
                <p className="text-muted-foreground">
                  &ldquo;{SAMPLE.invented}&rdquo; — 운동장도 아이도 그림에 없어요. 없는 것을
                  지어내면 수준이 내려가요.
                </p>
              </div>
            </div>
          </Card>

          {/* 1차시 도입(4분) — 이름과 눈에 보이는 기본 색·형태를 함께 쓰는 연습 */}
          <Card className="rounded-2xl bg-card/60 backdrop-blur-sm p-6 md:p-8 mb-10">
            <CardTitle className="text-2xl font-headline mb-3 flex items-center gap-2">
              <Palette className="h-6 w-6 text-primary" />
              오늘은 이름과 색·모양을 함께 써 봐요
            </CardTitle>
            <p className="text-muted-foreground text-sm font-body leading-relaxed mb-4">
              이름만 쓰면 그림이 하나로 정해지지 않아요. 이름 옆에 <strong>눈에 바로 보이는 색</strong>과{' '}
              <strong>모양</strong>을 한 가지씩만 붙여도 훨씬 좋아져요. 어려운 재질이나 만진 느낌은
              아직 안 써도 괜찮아요.
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
              점수도 이 두 가지를 함께 봐요. 무엇이 있는지(축 1)와 어떻게 생겼는지(축 2)를 따로
              봅니다. 1단계에서는 눈에 보이는 기본 색과 형태까지면 충분해요.
            </p>
          </Card>

          <div className="text-center mb-6">
            <h2 className="text-3xl font-headline font-bold">여섯 단계로 나아가요</h2>
            <p className="mt-2 text-muted-foreground">
              한 단계에 여섯 문항이에요. 다음 단계는 선생님이 열어 주세요. 여섯 문항을 다 하지
              않아도 괜찮고, 못 한 문항은 0점이 아니라 아직 하지 않은 것으로 남아요.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 mb-10">
            {STAGES.map((s) => (
              <div
                key={s.n}
                className="flex items-start gap-3 rounded-xl border bg-card/60 p-4 backdrop-blur-sm"
              >
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/15 text-sm font-bold text-primary">
                  {s.n}
                </div>
                <div>
                  <p className="font-semibold leading-tight">{s.title}</p>
                  <p className="mt-1 text-xs text-muted-foreground">{s.axis}</p>
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
                우리가 <strong>색·모양·질감</strong>을 또렷하게 말해 줄수록 잘 알아들어요.
              </p>
              <p>
                인공지능은 사람의 마음을 읽지 못해요. 내가 무엇을 떠올렸는지는 알 수 없고, 내가 쓴
                낱말만 봅니다. 그래서 같은 그림을 보고도 사람마다 다른 문장을 쓰면 다른 그림이
                나와요.
              </p>
              <p>
                인공지능이 매기는 점수도 완전하지 않아요. 같은 글을 두 번 채점하면 조금 다르게 볼
                때가 있어서, 이 프로그램은 두 번 채점해서 견주어 봅니다. 점수는 <strong>참고</strong>
                예요. 성적에 들어가지 않아요.
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
