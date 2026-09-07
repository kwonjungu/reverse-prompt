'use client';

/**
 * 모드 차단 화면 가드.
 *
 * 설계서 §4·수용시험 7 대응. 이 컴포넌트는 차단의 근거가 아니라 표시일 뿐이다.
 * 실제 거부는 route(middleware)·server action·API가 각각 한다. 여기서는 서버에
 * 물어본 결과가 나오기 전에 화면을 그리지 않아, 허용되지 않은 활동이 잠깐이라도
 * 열려 보이지 않게 한다.
 */

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Home } from 'lucide-react';
import { MODE_BLOCKED_MESSAGE } from '@/lib/research/session-modes';
import type { AppMode } from '@/lib/research/types';

type GuardState =
  | { phase: 'checking' }
  | { phase: 'allowed' }
  | { phase: 'blocked'; message: string };

export function ModeGuard({ mode, children }: { mode: AppMode; children: React.ReactNode }) {
  const [state, setState] = useState<GuardState>({ phase: 'checking' });

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch(`/api/lessons/mode?mode=${encodeURIComponent(mode)}`, {
          cache: 'no-store',
        });
        const data = (await res.json()) as { allowed?: boolean; message?: string | null };
        if (!alive) return;
        if (res.ok && data.allowed) {
          setState({ phase: 'allowed' });
        } else {
          setState({ phase: 'blocked', message: data.message || MODE_BLOCKED_MESSAGE });
        }
      } catch {
        if (!alive) return;
        // 확인하지 못했으면 열지 않는다. 확인 실패를 허용으로 바꾸지 않는다.
        setState({
          phase: 'blocked',
          message: '지금 이 활동을 열 수 있는지 확인하지 못했어요. 잠시 뒤 다시 해 볼까요?',
        });
      }
    })();
    return () => {
      alive = false;
    };
  }, [mode]);

  if (state.phase === 'checking') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <p className="text-sm text-muted-foreground">잠시만 기다려 주세요.</p>
      </div>
    );
  }

  if (state.phase === 'blocked') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-4">
        <Card className="w-full max-w-md rounded-2xl border-2 border-primary/20 bg-card/80 backdrop-blur-sm">
          <CardHeader>
            <CardTitle className="text-center font-headline">지금은 열 수 없어요</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 text-center">
            <p className="text-muted-foreground">{state.message}</p>
            <Link href="/" passHref>
              <Button className="w-full">
                <Home className="mr-2 h-4 w-4" />
                홈으로 돌아가기
              </Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  return <>{children}</>;
}
