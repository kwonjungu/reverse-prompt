'use client';

/**
 * 첫 화면 — 입장과 모드 선택.
 *
 * 설계서 §4·§6 대응.
 *   - 어떤 모드를 보여 줄지는 서버가 정한 세션 성격이 정한다. 확장 버전 토글을
 *     없앴다. 토글을 숨기는 것은 차단이 아니므로, 실제 거부는 middleware·페이지
 *     가드·server action·API가 각각 한다. 여기서는 표시만 맞춘다.
 *   - sessionStorage의 학교코드·학년반·출석번호는 일반 체험의 편의값일 뿐
 *     연구 세션의 권위 있는 신원이 아니다. 연구 세션의 신원은 서버가 발급·검증한
 *     세션 토큰으로 확정한다(@/server/auth).
 */

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Zap, Gamepad2, ArrowRight, Timer, BookOpen, GraduationCap, User, Info } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { SchoolPicker } from '@/components/school-picker';
import type { SchoolMatch } from '@/lib/school-search';
import { getAllowedModesAction } from '@/server/lessons/actions';
import { MODE_BLOCKED_MESSAGE } from '@/lib/research/session-modes';
import type { AppMode, SessionType } from '@/lib/research/types';

const MODE_CARDS: {
  mode: AppMode;
  icon: typeof BookOpen;
  title: string;
  description: string;
  href: string;
  cta: string;
}[] = [
  {
    mode: 'guide',
    icon: BookOpen,
    title: '설명 모드',
    description:
      "AI에게 그림을 그려달라고 부탁하는 '프롬프트'가 무엇인지 쉽고 재미있게 배워보세요.",
    href: '/guide',
    cta: '배우러 가기',
  },
  {
    mode: 'practice',
    icon: Zap,
    title: '연습 모드',
    description: '다양한 사진을 보고 자유롭게 프롬프트를 작성하며 AI의 피드백을 받아보세요.',
    href: '/practice',
    cta: '연습 시작하기',
  },
  {
    mode: 'game',
    icon: Gamepad2,
    title: '게임 모드',
    description: '닉네임을 정하고 5개의 문제에 도전하세요.',
    href: '/game',
    cta: '도전 시작하기',
  },
  {
    mode: 'time-attack',
    icon: Timer,
    title: '시간 제한 모드',
    description: '제한 시간 안에 프롬프트를 작성하여 순발력과 정확성을 겨뤄보세요.',
    href: '/time-attack',
    cta: '스피드 챌린지',
  },
];

export default function Home() {
  const [school, setSchool] = useState<SchoolMatch | null>(null);
  const [grade, setGrade] = useState('');
  const [classNumber, setClassNumber] = useState('');
  const [attendanceNumber, setAttendanceNumber] = useState('');
  const [isEntered, setIsEntered] = useState(false);
  /** 서버가 정한 세션 성격과 허용 모드. 클라이언트 토글로 바꾸지 않는다. */
  const [modes, setModes] = useState<AppMode[] | null>(null);
  const [sessionType, setSessionType] = useState<SessionType>('experience');
  const [blockedNotice, setBlockedNotice] = useState<string | null>(null);
  /** 선생님이 알려 준 수업 번호와 참가 번호. 연구 세션의 신원은 서버가 확정한다. */
  const [classResearchId, setClassResearchId] = useState('');
  const [participantCode, setParticipantCode] = useState('');
  const [isIssuing, setIsIssuing] = useState(false);
  const [entryNotice, setEntryNotice] = useState<string | null>(null);
  /** 허용 모드가 비어 있을 때 서버가 준 안내. 구현 용어 없이 그대로 보여 준다. */
  const [modeNotice, setModeNotice] = useState<string | null>(null);
  const { toast } = useToast();

  useEffect(() => {
    const savedSchool = sessionStorage.getItem('school');
    const savedGrade = sessionStorage.getItem('grade');
    const savedClass = sessionStorage.getItem('classNumber');
    const savedNum = sessionStorage.getItem('attendanceNumber');
    if (savedSchool && savedGrade && savedClass && savedNum) {
      try {
        setSchool(JSON.parse(savedSchool));
        setGrade(savedGrade);
        setClassNumber(savedClass);
        setAttendanceNumber(savedNum);
        setIsEntered(true);
      } catch {
        // 저장값이 깨졌으면 다시 입력받는다.
      }
    }
  }, []);

  /** 다른 화면에서 차단되어 돌아온 경우 사유를 알린다. */
  useEffect(() => {
    const blocked = new URLSearchParams(window.location.search).get('blocked');
    if (blocked) setBlockedNotice(MODE_BLOCKED_MESSAGE);
  }, []);

  /** 허용 모드는 서버에서 받아 온다. 받기 전에는 모드 카드를 그리지 않는다. */
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await getAllowedModesAction();
        if (!alive) return;
        setModes(res.modes);
        setSessionType(res.sessionType);
        setModeNotice(res.modes.length ? null : res.message ?? null);
      } catch {
        if (!alive) return;
        // 확인하지 못했으면 아무 활동도 열지 않는다. 확인 실패를 허용으로 바꾸지 않는다.
        setModes([]);
        setModeNotice('지금 무엇을 할 수 있는지 확인하지 못했어요. 잠시 뒤 다시 해 볼까요?');
      }
    })();
    return () => {
      alive = false;
    };
  }, [isEntered]);

  const handleEntry = (e: React.FormEvent) => {
    e.preventDefault();
    if (!school || !grade || !classNumber.trim() || !attendanceNumber.trim()) {
      toast({
        variant: 'destructive',
        title: '입력 오류',
        description: '학교, 학년, 반, 번호를 모두 입력해주세요.',
      });
      return;
    }

    // 학급 코드 = 학교코드_학년-반 (예: 7531234_3-2). 일반 체험의 구분값이다.
    const classCode = `${school.code}_${grade}-${classNumber.trim()}`;

    sessionStorage.setItem('classCode', classCode);
    sessionStorage.setItem('school', JSON.stringify(school));
    sessionStorage.setItem('grade', grade);
    sessionStorage.setItem('classNumber', classNumber.trim());
    sessionStorage.setItem('attendanceNumber', attendanceNumber.trim());
    setIsEntered(true);
    toast({
      title: '입장했어요',
      description: `${school.name} ${grade}학년 ${classNumber}반 ${attendanceNumber}번 학생, 환영합니다.`,
    });
  };

  /**
   * 선생님이 연 수업으로 들어간다.
   * 신원·세션 성격·연구 수집 가능 여부는 서버가 정하고 HttpOnly 쿠키로만 다룬다.
   * 여기서 보낸 값은 요청일 뿐이며 화면이 권한을 만들지 않는다.
   */
  const handleClassEntry = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!classResearchId.trim()) {
      toast({
        variant: 'destructive',
        title: '수업 번호가 필요해요',
        description: '선생님이 알려 준 수업 번호를 적어 주세요.',
      });
      return;
    }
    setIsIssuing(true);
    setEntryNotice(null);
    try {
      const res = await fetch('/api/auth/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // 옛 신원 잔재(학교코드·학년반·출석번호)를 연구 경로로 보내지 않는다.
        // 학급·신원·세션 성격은 서버가 수업 번호와 참가 번호로 확정한다.
        body: JSON.stringify({
          classResearchId: classResearchId.trim(),
          participantCode: participantCode.trim() || null,
        }),
      });
      if (!res.ok) {
        setEntryNotice('열려 있는 수업이 아니에요. 번호를 다시 확인해 주세요.');
        return;
      }
      const data = (await res.json()) as { route?: string };
      if (data.route === 'offline_alternative') {
        setEntryNotice(
          '지금은 이 수업에서 기록을 남기지 않는 활동으로 참여해요. 선생님께 여쭤보세요.'
        );
      }
      setIsEntered(true);
      const modeRes = await getAllowedModesAction();
      setModes(modeRes.modes);
      setSessionType(modeRes.sessionType);
      setModeNotice(modeRes.modes.length ? null : modeRes.message ?? null);
    } catch {
      setEntryNotice('지금 들어가지 못했어요. 잠시 뒤 다시 해 볼까요?');
    } finally {
      setIsIssuing(false);
    }
  };

  const handleLogout = () => {
    void fetch('/api/auth/session', { method: 'DELETE' }).catch(() => {});
    sessionStorage.removeItem('classCode');
    sessionStorage.removeItem('school');
    sessionStorage.removeItem('grade');
    sessionStorage.removeItem('classNumber');
    sessionStorage.removeItem('attendanceNumber');
    setIsEntered(false);
    setSchool(null);
    setGrade('');
    setClassNumber('');
    setAttendanceNumber('');
  };

  if (!isEntered) {
    return (
      <div className="min-h-screen bg-background font-sans flex flex-col items-center justify-center p-4">
        <div className="absolute top-0 left-0 w-full h-full bg-gradient-to-br from-primary/20 via-transparent to-primary/20 opacity-30 z-0"></div>
        <main className="container mx-auto max-w-md z-10">
          <div className="text-center mb-8">
            <h1 className="text-4xl md:text-5xl font-bold tracking-tight text-transparent bg-clip-text bg-gradient-to-r from-primary via-purple-400 to-pink-500 font-headline mb-4">
              나는 프롬프트 마스터
            </h1>
            <p className="text-muted-foreground">우리 학교를 찾고 입장해요!</p>
          </div>

          {blockedNotice && (
            <Alert className="mb-6 border-primary/40 bg-primary/5">
              <Info className="h-4 w-4" />
              <AlertTitle>지금은 열 수 없어요</AlertTitle>
              <AlertDescription>{blockedNotice}</AlertDescription>
            </Alert>
          )}

          <Card className="shadow-2xl shadow-primary/10 rounded-2xl bg-card/80 backdrop-blur-sm border-2 border-primary/20">
            <CardHeader>
              <CardTitle className="text-center font-headline">학생 입장</CardTitle>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleEntry} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="school">학교</Label>
                  <SchoolPicker value={school} onChange={setSchool} />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <Label htmlFor="grade">학년</Label>
                    <Select value={grade} onValueChange={setGrade}>
                      <SelectTrigger id="grade" className="h-12 text-lg">
                        <SelectValue placeholder="학년" />
                      </SelectTrigger>
                      <SelectContent>
                        {[1, 2, 3, 4, 5, 6].map((g) => (
                          <SelectItem key={g} value={String(g)}>
                            {g}학년
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="classNumber">반</Label>
                    <Input
                      id="classNumber"
                      type="number"
                      min={1}
                      placeholder="반"
                      value={classNumber}
                      onChange={(e) => setClassNumber(e.target.value)}
                      className="h-12 text-lg"
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="attendanceNumber">출석 번호</Label>
                  <Input
                    id="attendanceNumber"
                    type="number"
                    min={1}
                    placeholder="번호만 입력"
                    value={attendanceNumber}
                    onChange={(e) => setAttendanceNumber(e.target.value)}
                    className="h-12 text-lg"
                  />
                </div>

                <Button type="submit" className="w-full font-bold" size="lg">
                  입장하기 <ArrowRight className="ml-2" />
                </Button>
              </form>
              <p className="mt-4 text-xs text-muted-foreground">
                수업에서 쓰는 활동은 선생님이 열어 주세요. 여기서 적은 학년·반·번호는 화면을
                구분하는 데만 씁니다.
              </p>
            </CardContent>
          </Card>

          {/* 선생님이 연 수업으로 들어가는 경로. 신원과 세션 성격은 서버가 확정한다. */}
          <Card className="mt-6 rounded-2xl bg-card/60 backdrop-blur-sm border border-primary/20">
            <CardHeader>
              <CardTitle className="text-center text-lg font-headline">
                선생님이 연 수업으로 들어가기
              </CardTitle>
              <CardDescription className="text-center text-xs">
                수업 번호가 있을 때만 쓰세요. 없으면 위에서 그냥 입장해도 돼요.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {entryNotice && (
                <Alert className="mb-4 border-primary/40 bg-primary/5">
                  <Info className="h-4 w-4" />
                  <AlertDescription>{entryNotice}</AlertDescription>
                </Alert>
              )}
              <form onSubmit={handleClassEntry} className="space-y-3">
                <div className="space-y-2">
                  <Label htmlFor="classResearchId">수업 번호</Label>
                  <Input
                    id="classResearchId"
                    value={classResearchId}
                    onChange={(e) => setClassResearchId(e.target.value)}
                    placeholder="선생님이 알려 준 번호"
                    autoComplete="off"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="participantCode">참가 번호 (있을 때만)</Label>
                  <Input
                    id="participantCode"
                    value={participantCode}
                    onChange={(e) => setParticipantCode(e.target.value)}
                    placeholder="받은 참가 번호"
                    autoComplete="off"
                  />
                </div>
                <Button type="submit" variant="secondary" className="w-full" disabled={isIssuing}>
                  {isIssuing ? '들어가는 중이에요' : '수업으로 들어가기'}
                </Button>
              </form>
            </CardContent>
          </Card>

          <div className="mt-8 text-center flex flex-col items-center gap-2">
            <Link href="/teacher">
              <Button variant="link" className="text-muted-foreground hover:text-primary">
                <GraduationCap className="mr-2 h-4 w-4" /> 선생님이신가요? (결과 확인하기)
              </Button>
            </Link>
          </div>
        </main>
      </div>
    );
  }

  const visibleCards = MODE_CARDS.filter((c) => (modes ?? []).includes(c.mode));

  return (
    <div className="min-h-screen bg-background font-sans flex flex-col items-center justify-center p-4">
      <div className="absolute top-0 left-0 w-full h-full bg-gradient-to-br from-primary/20 via-transparent to-primary/20 opacity-30 z-0"></div>
      <main className="container mx-auto text-center z-10">
        <header className="fixed top-4 right-4 flex items-center gap-3 bg-card/80 backdrop-blur-sm p-2 px-4 rounded-full border border-border shadow-lg">
          <div className="flex items-center gap-2 text-sm font-medium">
            <User className="h-4 w-4 text-primary shrink-0" />
            <span className="max-w-[260px] truncate">
              {school?.name} {grade}-{classNumber} {attendanceNumber}번
            </span>
          </div>
          <Button variant="ghost" size="sm" onClick={handleLogout} className="text-xs">
            로그아웃
          </Button>
        </header>

        <div className="mb-12 mt-16">
          <h1 className="text-5xl md:text-7xl font-bold tracking-tight text-transparent bg-clip-text bg-gradient-to-r from-primary via-purple-400 to-pink-500 font-headline mb-4">
            나는 프롬프트 마스터
          </h1>
          <p className="mt-3 text-lg text-muted-foreground max-w-2xl mx-auto">
            그림을 보고 그 그림을 되살리는 글을 써 봐요.
          </p>
        </div>

        {blockedNotice && (
          <Alert className="mx-auto mb-8 max-w-xl border-primary/40 bg-primary/5 text-left">
            <Info className="h-4 w-4" />
            <AlertTitle>지금은 열 수 없어요</AlertTitle>
            <AlertDescription>{blockedNotice}</AlertDescription>
          </Alert>
        )}

        {modes === null ? (
          <p className="text-sm text-muted-foreground">잠시만 기다려 주세요.</p>
        ) : visibleCards.length === 0 ? (
          <Alert className="mx-auto max-w-xl border-primary/40 bg-primary/5 text-left">
            <Info className="h-4 w-4" />
            <AlertTitle>지금 열린 활동이 없어요</AlertTitle>
            <AlertDescription>
              {modeNotice ?? '선생님이 활동을 열어 주면 시작할 수 있어요.'}
            </AlertDescription>
          </Alert>
        ) : (
          <div
            className={`grid grid-cols-1 md:grid-cols-2 gap-8 mx-auto ${
              visibleCards.length > 2 ? 'lg:grid-cols-4 max-w-7xl' : 'max-w-4xl'
            }`}
          >
            {visibleCards.map((card) => {
              const Icon = card.icon;
              return (
                <Card
                  key={card.mode}
                  className="shadow-2xl shadow-primary/10 rounded-2xl overflow-hidden border-2 border-transparent hover:border-primary/40 transition-all duration-300 transform hover:-translate-y-2 bg-card/80 backdrop-blur-sm"
                >
                  <CardHeader>
                    <Icon className="h-10 w-10 mx-auto text-primary" />
                    <CardTitle className="text-3xl font-headline mt-4">{card.title}</CardTitle>
                    <CardDescription className="text-muted-foreground mt-2 min-h-[6rem]">
                      {card.description}
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <Link href={card.href} passHref>
                      <Button size="lg" className="w-full font-bold">
                        {card.cta} <ArrowRight className="ml-2" />
                      </Button>
                    </Link>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}

        {sessionType !== 'experience' && (
          <p className="mt-8 text-sm text-muted-foreground">
            지금은 선생님이 연 활동만 할 수 있어요.
          </p>
        )}

        <div className="mt-8">
          <p className="text-muted-foreground text-sm mt-4">Made by 권준구</p>
        </div>
      </main>
    </div>
  );
}
