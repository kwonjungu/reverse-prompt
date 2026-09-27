'use client';

/**
 * 통합 관리 화면 '연구 자료' 탭의 단서 팩 영역.
 *
 * 비공개 단서 팩(문항별 필수 정보·앵커)을 Firestore 관리자 전용 문서(admin_config/cue_pack)로 올리고,
 * 지금 채점에 쓰는 팩의 문항별 적재 상태(L01~L36)를 보여 준다. 공개 저장소에는 올리지 않는다.
 *
 * 이 화면은 파일을 읽어 서버에 보내기만 한다. 검증·저장·조작 기록은 서버(src/server/admin/cue-pack-actions.ts)가
 * 하고, 서버는 단서 본문을 돌려주지 않는다 — 여기 보이는 것은 문항 ID별 상태·고정 사유·개수·cueVersion·해시 앞자리뿐이다.
 * 고른 파일의 내용은 이 컴포넌트의 메모리에만 두고 브라우저 저장소에 남기지 않는다.
 */

import { useCallback, useEffect, useState } from 'react';
import {
  checkCuePackAction,
  deleteCuePackAction,
  getCuePackStatusAction,
  saveCuePackAction,
  type CuePackAdminStatus,
  type CuePackResult,
} from '@/server/admin/cue-pack-actions';
import type { CuePackCoverage, CuePackUploadCheck, CueRow } from '@/server/registry/cue-pack-store';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useToast } from '@/hooks/use-toast';
import { AlertTriangle, CheckCircle2, FileJson, Loader2, RefreshCw, Trash2, Upload } from 'lucide-react';

/** 상태를 아직 못 읽었을 때 화면에서 먼저 막는 크기(서버도 같은 값으로 다시 막는다). */
const FALLBACK_MAX_BYTES = 900 * 1024;

const SOURCE_LABEL: Record<CuePackAdminStatus['source'], string> = {
  file: '서버 파일(RESEARCH_ASSET_DIR)',
  firestore: 'Firestore 사본',
  none: '없음',
};

const STATE_STYLE: Record<CueRow['state'], string> = {
  loaded: 'border-emerald-600/40 bg-emerald-600/10 text-emerald-800 dark:text-emerald-300',
  invalid: 'border-destructive/50 bg-destructive/10 text-destructive',
  absent: 'border-dashed border-muted-foreground/30 bg-muted/40 text-muted-foreground',
};

const STATE_LABEL: Record<CueRow['state'], string> = {
  loaded: '적재',
  invalid: '실격',
  absent: '없음',
};

function formatTime(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('ko-KR', {
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatBytes(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined) return '';
  if (bytes < 1024) return `${bytes}B`;
  return `${(bytes / 1024).toFixed(1)}KB`;
}

export function CuePackPanel({ onSignedOut }: { onSignedOut: () => void }) {
  const { toast } = useToast();
  const [status, setStatus] = useState<CuePackAdminStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);

  /** 고른 파일. 저장하거나 취소하면 비운다. */
  const [pending, setPending] = useState<{ name: string; text: string } | null>(null);
  const [check, setCheck] = useState<CuePackUploadCheck | null>(null);
  const [localProblem, setLocalProblem] = useState<string | null>(null);
  /** 파일 입력을 비우기 위한 key */
  const [inputKey, setInputKey] = useState(0);
  const [confirmDelete, setConfirmDelete] = useState(false);

  /** 실패를 알리고 로그인이 끊겼으면 화면에 알린다. 성공이면 data, 아니면 null. */
  const unwrap = useCallback(
    <T,>(res: CuePackResult<T>, title: string): T | null => {
      if (res.ok) return res.data;
      if (res.signedOut) onSignedOut();
      toast({ variant: 'destructive', title, description: res.error });
      return null;
    },
    [onSignedOut, toast]
  );

  const loadStatus = useCallback(async () => {
    setLoading(true);
    try {
      const data = unwrap(await getCuePackStatusAction(), '단서 팩 상태를 읽지 못했습니다');
      if (data) setStatus(data);
    } catch {
      toast({ variant: 'destructive', title: '단서 팩 상태를 읽지 못했습니다' });
    } finally {
      setLoading(false);
    }
  }, [toast, unwrap]);

  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  const resetPending = () => {
    setPending(null);
    setCheck(null);
    setLocalProblem(null);
    setInputKey((k) => k + 1);
  };

  const onFile = async (file: File | undefined) => {
    setCheck(null);
    setLocalProblem(null);
    setPending(null);
    if (!file) return;
    const maxBytes = status?.maxBytes ?? FALLBACK_MAX_BYTES;
    if (file.size > maxBytes) {
      setLocalProblem(`파일이 너무 큽니다(최대 ${Math.floor(maxBytes / 1024)}KB).`);
      return;
    }
    setBusy(true);
    try {
      const text = await file.text();
      setPending({ name: file.name, text });
      const data = unwrap(await checkCuePackAction(text), '파일을 점검하지 못했습니다');
      if (data) setCheck(data);
    } catch {
      setLocalProblem('파일을 읽지 못했습니다.');
    } finally {
      setBusy(false);
    }
  };

  const onSave = async () => {
    if (!pending) return;
    setBusy(true);
    try {
      const data = unwrap(await saveCuePackAction(pending.text), '저장하지 못했습니다');
      if (!data) return;
      if (!data.saved) {
        // 서버가 다시 점검해 거절했다. 그 결과를 그대로 보여 준다.
        setCheck(data.check);
        toast({ variant: 'destructive', title: '저장하지 않았습니다', description: data.check.problem ?? undefined });
        return;
      }
      toast({
        title: `단서 팩을 저장했습니다 · ${data.check.cueVersion ?? ''}`,
        description: `연습 ${data.check.practiceLoadedCount}/${data.check.practiceTotal}개 적재. 다른 서버에는 ${status?.ttlSeconds ?? 60}초 안에 반영됩니다.`,
      });
      resetPending();
      if (data.status) setStatus(data.status);
      else void loadStatus();
    } catch {
      toast({ variant: 'destructive', title: '저장하지 못했습니다', description: '잠시 뒤 다시 해 주세요.' });
    } finally {
      setBusy(false);
    }
  };

  const onDelete = async () => {
    setConfirmDelete(false);
    setBusy(true);
    try {
      const data = unwrap(await deleteCuePackAction(), '지우지 못했습니다');
      if (data) {
        setStatus(data);
        toast({ title: 'Firestore 사본을 지웠습니다' });
      }
    } catch {
      toast({ variant: 'destructive', title: '지우지 못했습니다', description: '잠시 뒤 다시 해 주세요.' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="rounded-2xl">
      <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
        <div className="space-y-1.5">
          <CardTitle className="flex items-center gap-2 text-lg">
            <FileJson className="h-5 w-5" /> 단서 팩 (비공개)
          </CardTitle>
          <CardDescription>
            채점에 쓰는 문항별 필수 정보·앵커입니다. 공개 저장소에 올리지 않고 Firestore의 관리자 전용 문서
            (admin_config/cue_pack)에 둡니다. 서버에 RESEARCH_ASSET_DIR/cue-pack.json 파일이 있으면 그 파일이 우선합니다.
            올린 내용은 이 화면에 다시 보이지 않습니다.
          </CardDescription>
        </div>
        <Button variant="outline" size="sm" onClick={() => void loadStatus()} disabled={loading || busy}>
          <RefreshCw className={`mr-2 h-4 w-4 ${loading ? 'animate-spin' : ''}`} /> 새로 고침
        </Button>
      </CardHeader>
      <CardContent className="space-y-6">
        {!status ? (
          <Skeleton className="h-40 w-full rounded-xl" />
        ) : (
          <CurrentStatus status={status} busy={busy} onDelete={() => setConfirmDelete(true)} />
        )}

        {/* ─────────── 올리기 ─────────── */}
        <section className="space-y-3 rounded-xl border p-4">
          <div className="space-y-1">
            <Label htmlFor="cue-pack-file" className="flex items-center gap-2 font-semibold">
              <Upload className="h-4 w-4" /> 새 단서 팩 올리기
            </Label>
            <p className="text-xs text-muted-foreground">
              JSON 파일을 고르면 먼저 점검만 합니다(저장하지 않음). 결과를 확인한 뒤 “이 팩으로 바꾸기”를 누르면
              지금 사본을 덮어씁니다. 단서를 고쳤으면 cueVersion을 올려 주세요 — 같은 cueVersion으로 내용만 바꾼 파일은 받지 않습니다.
            </p>
          </div>
          <Input
            key={inputKey}
            id="cue-pack-file"
            type="file"
            accept=".json,application/json"
            disabled={busy}
            onChange={(e) => void onFile(e.target.files?.[0])}
            className="max-w-md"
          />
          {busy && !check && pending && (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> 점검하는 중…
            </p>
          )}
          {localProblem && (
            <p className="text-sm text-destructive">{localProblem}</p>
          )}
          {check && pending && (
            <CheckResult
              check={check}
              fileName={pending.name}
              busy={busy}
              onSave={() => void onSave()}
              onCancel={resetPending}
            />
          )}
        </section>
      </CardContent>

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Firestore 사본을 지울까요?</AlertDialogTitle>
            <AlertDialogDescription>
              서버 파일이 없는 곳(Vercel)에서는 지운 뒤 연구 수업 채점이 모두 “단서 없음”으로 멈추고, 연구 수업을 새로
              만들 수 없습니다. 일반 수업은 공통 루브릭만으로 채점됩니다. 지운 기록(cueVersion·해시)은 조작 기록에 남습니다.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>그대로 두기</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => void onDelete()}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              지우기
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

/* ────────────────────────── 지금 상태 ────────────────────────── */

function CurrentStatus(props: { status: CuePackAdminStatus; busy: boolean; onDelete: () => void }) {
  const { status } = props;
  const active = status.active;
  const copy = status.copy;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="font-semibold">지금 채점에 쓰는 단서:</span>
        <Badge variant={status.source === 'none' ? 'destructive' : 'secondary'}>{SOURCE_LABEL[status.source]}</Badge>
        {active.cueVersion && <Badge variant="outline">cueVersion {active.cueVersion}</Badge>}
        <Badge variant="outline">
          연습 {active.coverage.practiceLoadedCount}/{active.coverage.practiceTotal} 적재
        </Badge>
        {active.sha256Prefix && (
          <span className="font-mono text-xs text-muted-foreground">SHA-256 {active.sha256Prefix}…</span>
        )}
      </div>
      {active.error && (
        <Alert className="border-destructive/40 bg-destructive/5">
          <AlertTriangle className="h-4 w-4 text-destructive" />
          <AlertTitle>단서 팩을 쓸 수 없습니다</AlertTitle>
          <AlertDescription className="text-sm">{active.error}</AlertDescription>
        </Alert>
      )}
      {active.loaded && <CoverageView coverage={active.coverage} />}

      <div className="rounded-xl border bg-muted/20 p-4 text-sm">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="font-semibold">Firestore 사본 (admin_config/cue_pack)</p>
          {copy && (
            <Button variant="outline" size="sm" onClick={props.onDelete} disabled={props.busy}>
              <Trash2 className="mr-2 h-4 w-4" /> 사본 지우기
            </Button>
          )}
        </div>
        {status.copyError ? (
          <p className="mt-2 text-destructive">{status.copyError}</p>
        ) : !copy ? (
          <p className="mt-2 text-muted-foreground">올라온 사본이 없습니다.</p>
        ) : (
          <ul className="mt-2 space-y-1 text-muted-foreground">
            <li>
              cueVersion <span className="font-medium text-foreground">{copy.cueVersion ?? '없음'}</span> · 올린 시각{' '}
              {formatTime(copy.updatedAt) || '모름'} · 크기 {formatBytes(copy.byteLength) || '모름'}
            </li>
            <li>
              검증 통과 {copy.questionCount ?? '?'}개 · 실격 {copy.invalidCount ?? '?'}개 · 연습{' '}
              {copy.practiceLoadedCount ?? '?'}/{active.coverage.practiceTotal} 적재
              {copy.sha256Prefix && <span className="ml-2 font-mono text-xs">SHA-256 {copy.sha256Prefix}…</span>}
            </li>
            {!copy.readable && copy.problem && <li className="text-destructive">{copy.problem}</li>}
          </ul>
        )}
        {status.fileActive && (
          <p className="mt-2 text-amber-700 dark:text-amber-400">
            이 서버에는 RESEARCH_ASSET_DIR/cue-pack.json이 있어 그 파일을 씁니다. Firestore 사본은 파일이 없는 서버(Vercel)에서 쓰입니다.
          </p>
        )}
        {status.source === 'firestore' && (
          <p className="mt-2 text-xs text-muted-foreground">
            다른 서버 인스턴스는 최대 {status.ttlSeconds}초 뒤에 새 사본을 읽습니다.
          </p>
        )}
      </div>

      <Alert>
        {status.research.ready ? <CheckCircle2 className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />}
        <AlertTitle>연구 수업 준비 상태: {status.research.ready ? '준비됨' : '준비 전'}</AlertTitle>
        <AlertDescription>
          {status.research.ready ? (
            '운영값과 연습 36문항 단서가 모두 갖춰져 연구 수업을 만들 수 있습니다.'
          ) : (
            <ul className="list-disc pl-5 text-sm">
              {status.research.blockers.map((b) => (
                <li key={b}>{b}</li>
              ))}
            </ul>
          )}
        </AlertDescription>
      </Alert>
    </div>
  );
}

/* ────────────────────────── 점검 결과 ────────────────────────── */

function CheckResult(props: {
  check: CuePackUploadCheck;
  fileName: string;
  busy: boolean;
  onSave: () => void;
  onCancel: () => void;
}) {
  const { check } = props;
  return (
    <div className="space-y-4 rounded-xl border bg-background p-4">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="font-semibold">{props.fileName}</span>
        <span className="text-muted-foreground">{formatBytes(check.byteLength)}</span>
        {check.cueVersion && <Badge variant="outline">cueVersion {check.cueVersion}</Badge>}
        {check.sha256 && <span className="font-mono text-xs text-muted-foreground">SHA-256 {check.sha256.slice(0, 12)}…</span>}
      </div>

      {check.ok ? (
        <p className="flex items-center gap-2 text-sm text-emerald-700 dark:text-emerald-400">
          <CheckCircle2 className="h-4 w-4" /> 저장할 수 있습니다. 검증 통과 {check.validCount}개 · 실격 {check.invalidCount}개.
        </p>
      ) : (
        <Alert className="border-destructive/40 bg-destructive/5">
          <AlertTriangle className="h-4 w-4 text-destructive" />
          <AlertTitle>저장할 수 없습니다</AlertTitle>
          <AlertDescription className="text-sm">{check.problem}</AlertDescription>
        </Alert>
      )}

      {check.warnings.length > 0 && (
        <ul className="list-disc space-y-1 pl-5 text-sm text-amber-700 dark:text-amber-400">
          {check.warnings.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      )}

      {(check.validCount > 0 || check.invalidCount > 0) && <CoverageView coverage={check} />}

      <div className="flex flex-wrap gap-2">
        <Button onClick={props.onSave} disabled={props.busy || !check.ok}>
          {props.busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}
          이 팩으로 바꾸기
        </Button>
        <Button variant="ghost" onClick={props.onCancel} disabled={props.busy}>
          취소
        </Button>
      </div>
    </div>
  );
}

/* ────────────────────────── 문항별 적재 상태 ────────────────────────── */

function CoverageView({ coverage }: { coverage: CuePackCoverage }) {
  const problems = [...coverage.practice, ...coverage.others].filter((r) => r.state !== 'loaded');
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-6 gap-1.5 sm:grid-cols-9 lg:grid-cols-12">
        {coverage.practice.map((row) => (
          <div
            key={row.questionId}
            title={`${row.questionId} · ${STATE_LABEL[row.state]}${row.reason ? ` · ${row.reason}` : ''}`}
            className={`rounded-md border px-1 py-1 text-center font-mono text-xs ${STATE_STYLE[row.state]}`}
          >
            {row.questionId}
          </div>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">
        연습 {coverage.practiceLoadedCount}/{coverage.practiceTotal} 적재
        {coverage.others.length > 0 &&
          ` · 그 밖의 문항 ${coverage.others.map((r) => `${r.questionId}(${STATE_LABEL[r.state]})`).join(', ')}`}
        {coverage.unknownIdCount > 0 && ` · 레지스트리에 없는 ID ${coverage.unknownIdCount}개(무시)`}
      </p>
      {problems.length > 0 && (
        <ul className="max-h-48 space-y-0.5 overflow-y-auto rounded-md border bg-muted/20 p-2 text-xs">
          {problems.map((r) => (
            <li key={r.questionId}>
              <span className="font-mono font-semibold">{r.questionId}</span>{' '}
              <span className={r.state === 'invalid' ? 'text-destructive' : 'text-muted-foreground'}>
                {r.state === 'invalid' ? `실격 — ${r.reason ?? ''}` : '팩에 없음'}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
