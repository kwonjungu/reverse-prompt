
'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Zap, Gamepad2, ArrowRight, Timer, BookOpen, GraduationCap, User } from 'lucide-react';
import { useToast } from "@/hooks/use-toast";

export default function Home() {
  const [classCode, setClassCode] = useState('');
  const [attendanceNumber, setAttendanceNumber] = useState('');
  const [isEntered, setIsEntered] = useState(false);
  const { toast } = useToast();
  const router = useRouter();

  useEffect(() => {
    const savedCode = sessionStorage.getItem('classCode');
    const savedNum = sessionStorage.getItem('attendanceNumber');
    if (savedCode && savedNum) {
      setClassCode(savedCode);
      setAttendanceNumber(savedNum);
      setIsEntered(true);
    }
  }, []);

  const handleEntry = (e: React.FormEvent) => {
    e.preventDefault();
    if (!classCode.trim() || !attendanceNumber.trim()) {
      toast({
        variant: "destructive",
        title: "입력 오류",
        description: "학급 코드와 출석 번호를 모두 입력해주세요.",
      });
      return;
    }
    sessionStorage.setItem('classCode', classCode);
    sessionStorage.setItem('attendanceNumber', attendanceNumber);
    setIsEntered(true);
    toast({
      title: "입장 성공!",
      description: `${classCode}반 ${attendanceNumber}번 학생, 환영합니다!`,
    });
  };

  const handleLogout = () => {
    sessionStorage.removeItem('classCode');
    sessionStorage.removeItem('attendanceNumber');
    setIsEntered(false);
    setClassCode('');
    setAttendanceNumber('');
  };

  if (!isEntered) {
    return (
      <div className="min-h-screen bg-background font-sans flex flex-col items-center justify-center p-4">
        <div className="absolute top-0 left-0 w-full h-full bg-gradient-to-br from-primary/20 via-transparent to-primary/20 opacity-30 z-0"></div>
        <main className="container mx-auto max-w-md z-10">
          <div className="text-center mb-8">
            <h1 className="text-4xl md:text-5xl font-bold tracking-tight text-transparent bg-clip-text bg-gradient-to-r from-primary via-purple-400 to-pink-500 font-headline mb-4">나는 프롬프트 마스터</h1>
            <p className="text-muted-foreground">우리 반 코드를 입력하고 시작해요!</p>
          </div>

          <Card className="shadow-2xl shadow-primary/10 rounded-2xl bg-card/80 backdrop-blur-sm border-2 border-primary/20">
            <CardHeader>
              <CardTitle className="text-center font-headline">학생 입장</CardTitle>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleEntry} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="classCode">학급 코드</Label>
                  <Input 
                    id="classCode" 
                    placeholder="예: 3-1" 
                    value={classCode}
                    onChange={(e) => setClassCode(e.target.value)}
                    className="bg-input/50"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="attendanceNumber">출석 번호</Label>
                  <Input 
                    id="attendanceNumber" 
                    type="number"
                    placeholder="번호만 입력" 
                    value={attendanceNumber}
                    onChange={(e) => setAttendanceNumber(e.target.value)}
                    className="bg-input/50"
                  />
                </div>
                <Button type="submit" className="w-full font-bold" size="lg">
                  입장하기 <ArrowRight className="ml-2" />
                </Button>
              </form>
            </CardContent>
          </Card>

          <div className="mt-8 text-center">
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

  return (
    <div className="min-h-screen bg-background font-sans flex flex-col items-center justify-center p-4">
      <div className="absolute top-0 left-0 w-full h-full bg-gradient-to-br from-primary/20 via-transparent to-primary/20 opacity-30 z-0"></div>
      <main className="container mx-auto text-center z-10">
        <header className="fixed top-4 right-4 flex items-center gap-4 bg-card/50 p-2 px-4 rounded-full border border-border">
          <div className="flex items-center gap-2 text-sm font-medium">
            <User className="h-4 w-4 text-primary" />
            <span>{classCode}반 {attendanceNumber}번</span>
          </div>
          <Button variant="ghost" size="sm" onClick={handleLogout} className="text-xs">로그아웃</Button>
        </header>

        <div className="mb-12">
          <h1 className="text-5xl md:text-7xl font-bold tracking-tight text-transparent bg-clip-text bg-gradient-to-r from-primary via-purple-400 to-pink-500 font-headline mb-4">나는 프롬프트 마스터</h1>
          <p className="mt-3 text-lg text-muted-foreground max-w-2xl mx-auto">AI 프롬프트 엔지니어링 챌린지! 모드를 선택하고 실력을 뽐내보세요.</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8 max-w-7xl mx-auto">
          <Card className="shadow-2xl shadow-primary/10 rounded-2xl overflow-hidden border-2 border-transparent hover:border-primary/40 transition-all duration-300 transform hover:-translate-y-2 bg-card/80 backdrop-blur-sm">
            <CardHeader>
              <BookOpen className="h-10 w-10 mx-auto text-primary" />
              <CardTitle className="text-3xl font-headline mt-4">설명 모드</CardTitle>
              <CardDescription className="text-muted-foreground mt-2 min-h-[6rem]">
                AI에게 그림을 그려달라고 부탁하는 '프롬프트'가 무엇인지 쉽고 재미있게 배워보세요.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Link href="/guide" passHref>
                <Button size="lg" className="w-full font-bold">
                  배우러 가기 <ArrowRight className="ml-2" />
                </Button>
              </Link>
            </CardContent>
          </Card>

          <Card className="shadow-2xl shadow-primary/10 rounded-2xl overflow-hidden border-2 border-transparent hover:border-primary/40 transition-all duration-300 transform hover:-translate-y-2 bg-card/80 backdrop-blur-sm">
            <CardHeader>
              <Zap className="h-10 w-10 mx-auto text-primary" />
              <CardTitle className="text-3xl font-headline mt-4">연습 모드</CardTitle>
              <CardDescription className="text-muted-foreground mt-2 min-h-[6rem]">
                다양한 사진을 보고 자유롭게 프롬프트를 작성하며 AI의 피드백을 받아보세요.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Link href="/practice" passHref>
                <Button size="lg" className="w-full font-bold">
                  연습 시작하기 <ArrowRight className="ml-2" />
                </Button>
              </Link>
            </CardContent>
          </Card>

          <Card className="shadow-2xl shadow-primary/10 rounded-2xl overflow-hidden border-2 border-transparent hover:border-primary/40 transition-all duration-300 transform hover:-translate-y-2 bg-card/80 backdrop-blur-sm">
            <CardHeader>
              <Gamepad2 className="h-10 w-10 mx-auto text-primary" />
              <CardTitle className="text-3xl font-headline mt-4">게임 모드</CardTitle>
              <CardDescription className="text-muted-foreground mt-2 min-h-[6rem]">
                닉네임을 정하고 5개의 문제에 도전하세요! 점수는 선생님께 자동으로 전송됩니다.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Link href="/game" passHref>
                <Button size="lg" className="w-full font-bold">
                  도전 시작하기 <ArrowRight className="ml-2" />
                </Button>
              </Link>
            </CardContent>
          </Card>

          <Card className="shadow-2xl shadow-primary/10 rounded-2xl overflow-hidden border-2 border-transparent hover:border-primary/40 transition-all duration-300 transform hover:-translate-y-2 bg-card/80 backdrop-blur-sm">
            <CardHeader>
              <Timer className="h-10 w-10 mx-auto text-primary" />
              <CardTitle className="text-3xl font-headline mt-4">시간 제한 모드</CardTitle>
              <CardDescription className="text-muted-foreground mt-2 min-h-[6rem]">
                제한 시간 안에 프롬프트를 작성하여 순발력과 정확성을 겨뤄보세요.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Link href="/time-attack" passHref>
                <Button size="lg" className="w-full font-bold">
                  스피드 챌린지! <ArrowRight className="ml-2" />
                </Button>
              </Link>
            </CardContent>
          </Card>
        </div>
        <div className="mt-8">
          <p className="text-muted-foreground text-sm mt-4">Made by 권준구</p>
        </div>
      </main>
    </div>
  );
}
