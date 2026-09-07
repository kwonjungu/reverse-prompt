'use client';

/**
 * 검사 화면 — 응답을 모으기만 한다.
 *
 * 설계서 §5
 *  - 점수·피드백·힌트·모범답이 없고 제출 후 재도전이 없다. 제출 전 자기 수정만 허용한다.
 *  - 이 화면은 AI를 부르지 않는다. 채점 관련 모듈을 import 하지 않는다.
 *  - 남은 시간은 서버가 준 값으로 맞춘다. 새로고침해도 초기화되지 않는다.
 *  - 더블클릭·재시도는 같은 제출ID로 보낸다. 이중 저장이 생기지 않는다.
 *  - 타이핑 초안은 이 컴포넌트 안에만 있으며 자동으로 제출되지 않는다.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Image from 'next/image';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Skeleton } from '@/components/ui/skeleton';

type ScreenItem = {
  questionId: string;
  order: number;
  imageUrl: string;
  instruction: string;
  durationSeconds: number;
  startedAt: string;
  remainingSeconds: number;
  submitted: boolean;
};

type ScreenState = {
  ok: boolean;
  message: string | null;
  phase: string | null;
  items: ScreenItem[];
  /** 다음에 열 문항. 서버가 정한다. 화면이 문항ID를 지어내지 않는다. */
  nextQuestionId: string | null;
  serverNow: number;
};

/** 남은 시간을 표시할 때 서버 시각과 브라우저 시각의 차이를 보정한다. */
type Clock = { serverNowAtFetch: number; localNowAtFetch: number };

const mmss = (seconds: number) => {
  const s = Math.max(0, Math.floor(seconds));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
};

/**
 * 제출ID는 문항마다 한 번만 만든다.
 * 같은 문항에서 버튼을 여러 번 눌러도 같은 ID로 가므로 서버가 최초 제출만 남긴다.
 */
const newSubmissionId = () => {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
};

export function AssessmentClient() {
  const [state, setState] = useState<ScreenState | null>(null);
  const [clock, setClock] = useState<Clock | null>(null);
  const [tick, setTick] = useState(0);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const submissionIds = useRef<Record<string, string>>({});
  const startedRequests = useRef<Set<string>>(new Set());

  const applyState = useCallback((next: ScreenState) => {
    setState(next);
    setClock({ serverNowAtFetch: next.serverNow, localNowAtFetch: Date.now() });
  }, []);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/assessment/state', { cache: 'no-store' });
      applyState((await res.json()) as ScreenState);
    } catch {
      setNotice('연결이 잠시 끊겼어요. 그대로 두고 기다려 주세요.');
    }
  }, [applyState]);

  useEffect(() => {
    void load();
  }, [load]);

  // 1초마다 화면만 갱신하고, 마감 판정은 서버가 한다.
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, []);

  // 30초마다 서버와 시간을 다시 맞춘다. 브라우저 시계를 바꿔도 남은 시간이 늘지 않는다.
  useEffect(() => {
    const id = setInterval(() => void load(), 30000);
    return () => clearInterval(id);
  }, [load]);

  /** 아직 제출하지 않은 첫 문항이 지금 문항이다. 순서를 학생이 바꿀 수 없다. */
  const current = useMemo(() => {
    if (!state?.ok) return null;
    return state.items.find((i) => !i.submitted) ?? null;
  }, [state]);

  const remaining = useMemo(() => {
    if (!current || !clock) return 0;
    const elapsed = (Date.now() - clock.localNowAtFetch) / 1000;
    return Math.max(0, current.remainingSeconds - elapsed);
  }, [current, clock, tick]);

  // 문항이 바뀌면 초안을 비운다. 이전 문항의 초안이 다음 문항으로 넘어가지 않는다.
  useEffect(() => {
    setDraft('');
    setNotice(null);
  }, [current?.questionId]);

  const startNextItem = useCallback(
    async (questionId: string | null) => {
      if (!questionId || startedRequests.current.has(questionId)) return;
      startedRequests.current.add(questionId);
      try {
        const res = await fetch('/api/assessment/start', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ questionId }),
        });
        applyState((await res.json()) as ScreenState);
      } catch {
        startedRequests.current.delete(questionId);
        setNotice('연결이 잠시 끊겼어요. 그대로 두고 기다려 주세요.');
      }
    },
    [applyState]
  );

  const submit = useCallback(async () => {
    if (!current || busy) return;
    setBusy(true);
    // 이 문항의 제출ID는 한 번만 만든다. 재시도해도 같은 값을 쓴다.
    if (!submissionIds.current[current.questionId]) {
      submissionIds.current[current.questionId] = newSubmissionId();
    }
    const submissionId = submissionIds.current[current.questionId];

    try {
      const res = await fetch('/api/assessment/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ submissionId, questionId: current.questionId, text: draft }),
      });
      const result = (await res.json()) as { stored: boolean; duplicate: boolean; message: string };
      setNotice(result.message);
      // 저장되지 않았으면 완료로 넘기지 않는다.
      if (result.stored) await load();
    } catch {
      setNotice('아직 저장되지 않았어요. 다시 눌러 주세요.');
      // 기술 실패를 서버에 남긴다. 초안을 대신 제출하지 않는다.
      void fetch('/api/assessment/failure', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ questionId: current.questionId, reason: 'network' }),
      }).catch(() => undefined);
    } finally {
      setBusy(false);
    }
  }, [current, busy, draft, load]);

  if (!state) {
    return (
      <div className="mx-auto max-w-3xl space-y-4 p-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (!state.ok) {
    return (
      <div className="mx-auto max-w-3xl p-6">
        <Alert>
          <AlertTitle>잠깐만요</AlertTitle>
          <AlertDescription>{state.message ?? '선생님을 기다려 주세요.'}</AlertDescription>
        </Alert>
      </div>
    );
  }

  // 아직 아무 문항도 열리지 않았다. 첫 문항을 서버에 열어 달라고 한다.
  if (!current && state.items.length === 0 && state.nextQuestionId) {
    return (
      <div className="mx-auto max-w-3xl space-y-4 p-6">
        <Card>
          <CardHeader>
            <CardTitle className="font-headline text-2xl">그림을 보고 설명 쓰기</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 leading-relaxed">
            <p>그림을 보고, 무엇이 있고 어떻게 보이는지 자세히 써 보는 시간이에요.</p>
            <p>모두 세 개의 그림이 차례로 나와요. 그림마다 시간이 정해져 있어요.</p>
            <p>제출을 누르면 다시 고칠 수 없으니, 다 쓰고 나서 눌러요.</p>
          </CardContent>
          <CardFooter>
            <Button onClick={() => void startNextItem(state.nextQuestionId)}>시작하기</Button>
          </CardFooter>
        </Card>
      </div>
    );
  }

  // 앞 문항을 냈고 다음 문항이 남아 있다. 서버에 다음 문항을 열어 달라고 한다.
  if (!current && state.nextQuestionId) {
    return (
      <div className="mx-auto max-w-3xl p-6">
        <Card>
          <CardHeader>
            <CardTitle className="font-headline text-xl">잘 냈어요</CardTitle>
          </CardHeader>
          <CardContent className="leading-relaxed">
            <p>다음 그림으로 넘어갈까요? 넘어가면 시간이 시작돼요.</p>
          </CardContent>
          <CardFooter>
            <Button onClick={() => void startNextItem(state.nextQuestionId)}>다음 그림 보기</Button>
          </CardFooter>
        </Card>
      </div>
    );
  }

  if (!current) {
    return (
      <div className="mx-auto max-w-3xl p-6">
        <Alert>
          <AlertTitle>다 했어요</AlertTitle>
          <AlertDescription>모두 마쳤어요. 선생님의 안내를 기다려 주세요.</AlertDescription>
        </Alert>
      </div>
    );
  }

  const timeUp = remaining <= 0;

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-6">
      <div className="flex items-center justify-between">
        <span className="text-sm text-muted-foreground">{current.order} / 3</span>
        <span
          className={`font-mono text-lg ${timeUp ? 'text-destructive' : ''}`}
          aria-label="남은 시간"
        >
          {mmss(remaining)}
        </span>
      </div>

      <Card>
        <CardContent className="p-4">
          <div className="relative aspect-[4/3] w-full overflow-hidden rounded-md bg-muted">
            {/* 이미지는 인증 경로에서만 받는다. 데이터 URI를 화면에 싣지 않는다. */}
            <Image
              src={current.imageUrl}
              alt="설명할 그림"
              fill
              unoptimized
              className="object-contain"
              onError={() => {
                setNotice('그림을 불러오지 못했어요. 선생님께 알려 주세요.');
                void fetch('/api/assessment/failure', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ questionId: current.questionId, reason: 'image_load' }),
                }).catch(() => undefined);
              }}
            />
          </div>
        </CardContent>
      </Card>

      <p className="whitespace-pre-wrap leading-relaxed">{current.instruction}</p>

      <Textarea
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        disabled={timeUp || busy}
        rows={7}
        placeholder="여기에 써 보세요."
      />

      {notice && (
        <Alert>
          <AlertDescription>{notice}</AlertDescription>
        </Alert>
      )}

      {timeUp && (
        <Alert>
          <AlertTitle>시간이 다 됐어요</AlertTitle>
          <AlertDescription>
            이 그림은 여기까지예요. 쓰던 글은 내지 않아요.
          </AlertDescription>
        </Alert>
      )}

      <div className="flex justify-end gap-2">
        {timeUp && state.nextQuestionId && (
          <Button variant="outline" onClick={() => void startNextItem(state.nextQuestionId)}>
            다음 그림 보기
          </Button>
        )}
        <Button onClick={() => void submit()} disabled={busy || timeUp || draft.trim().length === 0}>
          {busy ? '내는 중...' : '제출하기'}
        </Button>
      </div>
    </div>
  );
}
