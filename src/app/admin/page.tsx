'use client';

/**
 * 통합 관리 화면(/admin).
 *
 * 관리자가 여기서 반을 만들고, 반 입장 비밀번호를 정하고, 수업을 시작·종료하고,
 * 차시를 열고 닫는다. 교사 계정을 만들어 반을 배정하면 교사는 /teacher에서
 * 그 반 학생의 진행을 본다. 학생은 첫 화면에서 수업 번호 + 비밀번호로 그 반에만 들어간다.
 *
 * 이 화면은 요청만 보낸다. 관리자 세션 확인·비밀번호 해시·권한 판정은 모두 서버
 * (src/server/admin)가 한다. 단추를 숨기는 것은 차단이 아니다.
 * 학생 답안·점수는 이 화면에 나오지 않는다(관리 계정은 반·계정 관리만 한다).
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  adminSignInAction,
  adminSignOutAction,
  changeAdminPasswordAction,
  createClassAction,
  createTeacherAction,
  enableTeacherLoginAction,
  endClassAction,
  getAdminStatusAction,
  loadConsoleAction,
  resetTeacherPasswordAction,
  setClassEntryAction,
  setClassPasswordAction,
  setLessonOpenAction,
  setTeacherClassesAction,
  setTeacherDisabledAction,
  startClassAction,
  type AdminClassRow,
  type AdminConsoleData,
  type AdminResult,
  type AdminStatus,
  type AdminTeacherRow,
} from '@/server/admin/actions';
import type { SessionType } from '@/lib/research/types';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
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
import {
  AlertTriangle,
  Copy,
  DoorClosed,
  DoorOpen,
  GraduationCap,
  KeyRound,
  Loader2,
  LogOut,
  Play,
  Plus,
  RefreshCw,
  School,
  Settings,
  ShieldCheck,
  Square,
  UserPlus,
  Users,
} from 'lucide-react';

const LESSONS = [1, 2, 3, 4, 5, 6] as const;
const REFRESH_INTERVAL_MS = 20_000;

const SESSION_TYPE_LABEL: Record<SessionType, string> = {
  experience: '일반 수업',
  research_practice: '연구 수업',
  research_assessment: '연구 검사',
};

const CREDENTIAL_HINT: Record<string, string> = {
  unset: 'Vercel 환경 변수에 ADMIN_PASSWORD(10자 이상)를 넣고 다시 배포해 주세요.',
  env_too_short: 'ADMIN_PASSWORD가 10자보다 짧아 쓰지 않습니다. 더 긴 값으로 바꿔 주세요.',
  stored_malformed: 'Firestore admin_config/console 문서의 passwordHash가 올바르지 않습니다.',
  unknown: '관리자 비밀번호 설정을 확인하지 못했습니다.',
};

type ClassPhase = 'not_started' | 'running' | 'entry_closed' | 'ended';

function phaseOf(row: AdminClassRow): ClassPhase {
  if (row.lesson?.closedAt) return 'ended';
  if (row.active) return 'running';
  if (row.lesson && row.lesson.allowedLessons.length > 0) return 'entry_closed';
  return 'not_started';
}

const PHASE_BADGE: Record<ClassPhase, { label: string; className: string }> = {
  not_started: { label: '시작 전', className: 'bg-muted text-muted-foreground' },
  running: { label: '수업 중 · 입장 열림', className: 'bg-emerald-600 text-white hover:bg-emerald-600' },
  entry_closed: { label: '수업 중 · 입장 닫힘', className: 'bg-amber-500 text-white hover:bg-amber-500' },
  ended: { label: '수업 종료', className: 'bg-slate-500 text-white hover:bg-slate-500' },
};

function formatTime(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function spacedId(id: string): string {
  return /^[0-9]{6}$/.test(id) ? `${id.slice(0, 3)} ${id.slice(3)}` : id;
}

export default function AdminConsolePage() {
  const { toast } = useToast();

  const [status, setStatus] = useState<AdminStatus | null>(null);
  const [data, setData] = useState<AdminConsoleData | null>(null);
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const [password, setPassword] = useState('');
  const [signingIn, setSigningIn] = useState(false);

  const loadStatus = useCallback(async () => {
    try {
      setStatus(await getAdminStatusAction());
    } catch {
      setStatus({
        setup: { firebase: false, sessionSecret: false, credential: 'unknown' },
        signedIn: false,
        research: null,
        firebase: null,
      });
    }
  }, []);

  const markSignedOut = useCallback(() => {
    setData(null);
    setStatus((prev) => (prev ? { ...prev, signedIn: false, research: null, firebase: null } : prev));
  }, []);

  const refresh = useCallback(
    async (quiet = false) => {
      if (!quiet) setRefreshing(true);
      try {
        const res = await loadConsoleAction();
        if (res.ok) {
          setData(res.data);
        } else if (res.signedOut) {
          markSignedOut();
        } else if (!quiet) {
          toast({ variant: 'destructive', title: '불러오지 못했습니다', description: res.error });
        }
      } catch {
        if (!quiet) toast({ variant: 'destructive', title: '불러오지 못했습니다' });
      } finally {
        if (!quiet) setRefreshing(false);
      }
    },
    [markSignedOut, toast]
  );

  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  const signedIn = status?.signedIn === true;

  useEffect(() => {
    if (!signedIn) return;
    void refresh();
    // 입장 중 학생 수 등을 주기적으로 새로 읽는다. 화면이 가려져 있으면 건너뛴다.
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') void refresh(true);
    }, REFRESH_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [signedIn, refresh]);

  /** server action을 부르고 결과를 알린다. 성공하면 목록을 다시 읽는다. */
  const act = useCallback(
    async <T,>(fn: () => Promise<AdminResult<T>>, success?: string): Promise<T | null> => {
      setBusy(true);
      try {
        const res = await fn();
        if (!res.ok) {
          if (res.signedOut) markSignedOut();
          toast({ variant: 'destructive', title: '처리하지 못했습니다', description: res.error });
          return null;
        }
        if (success) toast({ title: success });
        await refresh(true);
        return res.data;
      } catch {
        toast({ variant: 'destructive', title: '처리하지 못했습니다', description: '잠시 뒤 다시 해 주세요.' });
        return null;
      } finally {
        setBusy(false);
      }
    },
    [markSignedOut, refresh, toast]
  );

  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setSigningIn(true);
    try {
      const res = await adminSignInAction(password);
      if (!res.ok) {
        toast({ variant: 'destructive', title: '로그인하지 못했습니다', description: res.error });
        return;
      }
      setPassword('');
      await loadStatus();
    } finally {
      setSigningIn(false);
    }
  };

  const handleSignOut = async () => {
    await adminSignOutAction().catch(() => undefined);
    markSignedOut();
  };

  /* ─────────── 로그인 전 ─────────── */

  if (!status) {
    return (
      <div className="min-h-screen bg-background p-8">
        <Skeleton className="mx-auto h-48 w-full max-w-md rounded-2xl" />
      </div>
    );
  }

  if (!signedIn) {
    const setupProblems: string[] = [];
    if (!status.setup.firebase) {
      setupProblems.push('서버 자격증명 FIREBASE_SERVICE_ACCOUNT_JSON이 없습니다.');
    }
    // 서명 키는 STUDENT_SESSION_SECRET이 없으면 서버 자격증명에서 만든다. 자격증명이 있는데도
    // 없다고 나오는 경우(형식이 틀린 JSON)만 따로 알린다.
    if (status.setup.firebase && !status.setup.sessionSecret) {
      setupProblems.push('서버 자격증명 JSON에서 서명 키를 만들지 못했습니다. 내려받은 파일 내용을 그대로 다시 붙여 넣어 주세요.');
    }
    if (status.setup.firebase && status.setup.credential !== 'env' && status.setup.credential !== 'stored') {
      setupProblems.push(CREDENTIAL_HINT[status.setup.credential] ?? CREDENTIAL_HINT.unknown);
    }
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-4">
        <main className="w-full max-w-md space-y-4">
          <Card className="border-2 border-primary/20 shadow-2xl">
            <CardHeader className="text-center">
              <ShieldCheck className="mx-auto mb-2 h-12 w-12 text-primary" />
              <CardTitle className="font-headline text-2xl">통합 관리</CardTitle>
              <CardDescription>반 개설·수업 시작과 종료·교사 계정을 관리합니다.</CardDescription>
            </CardHeader>
            <CardContent>
              {setupProblems.length > 0 && (
                <Alert className="mb-4 border-destructive/40 bg-destructive/5">
                  <AlertTriangle className="h-4 w-4 text-destructive" />
                  <AlertTitle>서버 설정이 필요합니다</AlertTitle>
                  <AlertDescription>
                    <ul className="list-disc space-y-1 pl-4 text-sm">
                      {setupProblems.map((p) => (
                        <li key={p}>{p}</li>
                      ))}
                    </ul>
                  </AlertDescription>
                </Alert>
              )}
              <form onSubmit={handleSignIn} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="admin-password">관리자 비밀번호</Label>
                  <Input
                    id="admin-password"
                    type="password"
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="h-12"
                  />
                </div>
                <Button type="submit" className="h-12 w-full font-bold" disabled={signingIn || !password}>
                  {signingIn ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                  들어가기
                </Button>
              </form>
            </CardContent>
          </Card>
          <div className="flex justify-center gap-4 text-sm text-muted-foreground">
            <Link href="/teacher" className="hover:text-primary">교사 화면</Link>
            <Link href="/" className="hover:text-primary">학생 첫 화면</Link>
          </div>
        </main>
      </div>
    );
  }

  /* ─────────── 로그인 후 ─────────── */

  return (
    <div className="min-h-screen bg-background p-4 md:p-8">
      <div className="mx-auto max-w-6xl space-y-6">
        <header className="flex flex-col justify-between gap-4 md:flex-row md:items-center">
          <div>
            <h1 className="flex items-center gap-3 font-headline text-3xl font-black">
              <ShieldCheck className="h-8 w-8 text-primary" />
              통합 관리
            </h1>
            <p className="text-sm text-muted-foreground">
              반을 열고 닫으면 학생 입장과 차시가 바로 바뀝니다.
              {data?.loadedAt ? ` · ${formatTime(data.loadedAt)} 기준` : ''}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => void refresh()} disabled={refreshing}>
              <RefreshCw className={`mr-2 h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} /> 새로 고침
            </Button>
            <Link href="/teacher">
              <Button variant="outline">
                <GraduationCap className="mr-2 h-4 w-4" /> 교사 화면
              </Button>
            </Link>
            <Button variant="ghost" onClick={() => void handleSignOut()}>
              <LogOut className="mr-2 h-4 w-4" /> 로그아웃
            </Button>
          </div>
        </header>

        {status.firebase && (
          <FirebaseSetupAlerts
            check={status.firebase}
            busy={busy}
            onEnable={async () => {
              const check = await act(() => enableTeacherLoginAction(), '교사 로그인(이메일/비밀번호)을 켰습니다');
              if (check) setStatus((prev) => (prev ? { ...prev, firebase: check } : prev));
            }}
          />
        )}

        <Tabs defaultValue="classes" className="space-y-6">
          <TabsList className="grid w-full max-w-lg grid-cols-3">
            <TabsTrigger value="classes"><School className="mr-2 h-4 w-4" />수업 운영</TabsTrigger>
            <TabsTrigger value="teachers"><Users className="mr-2 h-4 w-4" />교사 계정</TabsTrigger>
            <TabsTrigger value="settings"><Settings className="mr-2 h-4 w-4" />설정</TabsTrigger>
          </TabsList>

          <TabsContent value="classes" className="space-y-6">
            <CreateClassCard
              busy={busy}
              researchReady={status.research?.ready === true}
              researchBlockers={status.research?.blockers ?? []}
              onCreate={async (input) => {
                const created = await act(() => createClassAction(input));
                if (created) {
                  toast({
                    title: `반을 만들었습니다 · 수업 번호 ${spacedId(created.classId)}`,
                    description: '아직 닫혀 있습니다. “수업 시작”을 눌러야 학생이 들어옵니다.',
                  });
                }
                return created !== null;
              }}
            />

            {!data ? (
              <div className="grid gap-4 md:grid-cols-2">
                <Skeleton className="h-64 rounded-2xl" />
                <Skeleton className="h-64 rounded-2xl" />
              </div>
            ) : data.classes.length === 0 ? (
              <Card className="rounded-2xl border-2 border-dashed p-12 text-center text-muted-foreground">
                아직 만든 반이 없습니다. 위에서 반을 만들어 주세요.
              </Card>
            ) : (
              <div className="grid gap-4 lg:grid-cols-2">
                {data.classes.map((row) => (
                  <ClassCard
                    key={row.classId}
                    row={row}
                    teachers={data.teachers.filter((t) => t.classResearchIds.includes(row.classId))}
                    busy={busy}
                    act={act}
                  />
                ))}
              </div>
            )}
          </TabsContent>

          <TabsContent value="teachers" className="space-y-6">
            <TeachersPanel data={data} busy={busy} act={act} />
          </TabsContent>

          <TabsContent value="settings" className="space-y-6">
            <SettingsPanel status={status} busy={busy} act={act} />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}

type Act = <T>(fn: () => Promise<AdminResult<T>>, success?: string) => Promise<T | null>;

/* ────────────────────────── Firebase 설정 점검 ────────────────────────── */

/**
 * 관리 화면이 직접 확인한 Firebase 설정 문제만 보여 준다. 문제가 없으면 아무것도 그리지 않는다.
 * 확인하지 못한 항목(unknown)은 '문제'로 단정하지 않는다.
 */
function FirebaseSetupAlerts(props: {
  check: NonNullable<AdminStatus['firebase']>;
  busy: boolean;
  onEnable: () => Promise<void>;
}) {
  const { check } = props;
  const mismatch = check.projectMatch === false;
  const loginOff = check.teacherLogin === 'disabled';
  if (!mismatch && !loginOff) return null;
  return (
    <div className="space-y-3">
      {mismatch && (
        <Alert className="border-destructive/40 bg-destructive/5">
          <AlertTriangle className="h-4 w-4 text-destructive" />
          <AlertTitle>Firebase 프로젝트가 서로 다릅니다</AlertTitle>
          <AlertDescription className="space-y-1 text-sm">
            <p>
              서버 키는 <code>{check.serverProjectId}</code>, 웹 설정은 <code>{check.clientProjectId}</code>입니다.
              이대로면 여기서 만든 교사 계정으로 교사가 로그인하지 못합니다.
            </p>
            <p>
              <code>{check.clientProjectId}</code> 프로젝트의 서비스 계정 키를 내려받아
              Vercel의 FIREBASE_SERVICE_ACCOUNT_JSON을 바꿔 주세요.
            </p>
          </AlertDescription>
        </Alert>
      )}
      {loginOff && (
        <Alert className="border-amber-400 bg-amber-50/60 dark:bg-amber-950/20">
          <AlertTriangle className="h-4 w-4 text-amber-600" />
          <AlertTitle>교사 로그인(이메일/비밀번호)이 꺼져 있습니다</AlertTitle>
          <AlertDescription className="space-y-2 text-sm">
            <p>교사 계정을 만들어도 교사 화면에 로그인할 수 없습니다. 아래 단추로 켤 수 있습니다.</p>
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" disabled={props.busy} onClick={() => void props.onEnable()}>
                지금 켜기
              </Button>
              {check.providersUrl && (
                <a
                  href={check.providersUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-xs underline underline-offset-2"
                >
                  또는 Firebase 콘솔에서 직접 켜기
                </a>
              )}
            </div>
          </AlertDescription>
        </Alert>
      )}
    </div>
  );
}

/* ────────────────────────── 반 만들기 ────────────────────────── */

function CreateClassCard(props: {
  busy: boolean;
  researchReady: boolean;
  researchBlockers: string[];
  onCreate: (input: { label: string; sessionType: SessionType; entryPassword: string | null }) => Promise<boolean>;
}) {
  const [label, setLabel] = useState('');
  const [sessionType, setSessionType] = useState<SessionType>('experience');
  const [entryPassword, setEntryPassword] = useState('');

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const ok = await props.onCreate({
      label,
      sessionType,
      entryPassword: entryPassword || null,
    });
    if (ok) {
      setLabel('');
      setEntryPassword('');
    }
  };

  return (
    <Card className="rounded-2xl border-2 border-primary/20">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <Plus className="h-5 w-5" /> 새 반 만들기
        </CardTitle>
        <CardDescription>
          수업 번호(여섯 자리)는 서버가 무작위로 정합니다. 비밀번호는 암호화(해시)해서만 저장하므로
          나중에 다시 볼 수 없습니다. 잊으면 새로 정하면 됩니다.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="grid gap-4 md:grid-cols-[2fr_1.2fr_1.5fr_auto] md:items-end">
          <div className="space-y-2">
            <Label htmlFor="class-label">반 이름</Label>
            <Input
              id="class-label"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="예: 5학년 3반 화요일"
              maxLength={40}
            />
          </div>
          <div className="space-y-2">
            <Label>수업 성격</Label>
            <Select value={sessionType} onValueChange={(v) => setSessionType(v as SessionType)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="experience">일반 수업</SelectItem>
                <SelectItem value="research_practice" disabled={!props.researchReady}>
                  연구 수업{props.researchReady ? '' : ' (준비 전)'}
                </SelectItem>
                <SelectItem value="research_assessment" disabled={!props.researchReady}>
                  연구 검사{props.researchReady ? '' : ' (준비 전)'}
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="class-password">입장 비밀번호 (4자 이상)</Label>
            <Input
              id="class-password"
              type="password"
              autoComplete="new-password"
              value={entryPassword}
              onChange={(e) => setEntryPassword(e.target.value)}
              placeholder="비워 두면 번호만으로 입장"
            />
          </div>
          <Button type="submit" disabled={props.busy || !label.trim()}>
            <Plus className="mr-2 h-4 w-4" /> 만들기
          </Button>
        </form>
        <p className="mt-3 text-xs text-muted-foreground">
          반 이름에 학교명이나 학생 이름은 적지 마세요. 일반 수업의 점수는 연구 자료로 쓰지 않습니다.
        </p>
        {!props.researchReady && props.researchBlockers.length > 0 && (
          <details className="mt-2 text-xs text-muted-foreground">
            <summary className="cursor-pointer">연구 수업을 아직 열 수 없는 까닭</summary>
            <ul className="mt-1 list-disc pl-5">
              {props.researchBlockers.map((b) => (
                <li key={b}>{b}</li>
              ))}
            </ul>
          </details>
        )}
      </CardContent>
    </Card>
  );
}

/* ────────────────────────── 반 카드 ────────────────────────── */

function ClassCard(props: { row: AdminClassRow; teachers: AdminTeacherRow[]; busy: boolean; act: Act }) {
  const { row, teachers, busy, act } = props;
  const { toast } = useToast();
  const phase = phaseOf(row);
  const lesson = row.lesson;
  const opened = lesson?.allowedLessons ?? [];
  const lessonControlsApply = row.sessionType !== 'experience' || lesson?.teacherPaced === true;

  const suggested = useMemo(() => {
    if (lesson?.currentLesson) return lesson.currentLesson;
    const max = opened.length ? Math.max(...opened) : 0;
    return Math.min(max + 1, 6) || 1;
  }, [lesson?.currentLesson, opened]);
  const [startLesson, setStartLesson] = useState(String(suggested));
  useEffect(() => setStartLesson(String(suggested)), [suggested]);

  const [endOpen, setEndOpen] = useState(false);
  const [revokeOnEnd, setRevokeOnEnd] = useState(true);
  const [pwOpen, setPwOpen] = useState(false);
  const [newPw, setNewPw] = useState('');

  const copyId = async () => {
    try {
      await navigator.clipboard.writeText(row.classId);
      toast({ title: '수업 번호를 복사했습니다' });
    } catch {
      toast({ variant: 'destructive', title: '복사하지 못했습니다' });
    }
  };

  const toggleLesson = (n: number) => {
    const isOpen = opened.includes(n);
    void act(
      () => setLessonOpenAction(row.classId, n, !isOpen),
      isOpen ? `${n}차시를 닫았습니다` : `${n}차시를 열었습니다`
    );
  };

  return (
    <Card className="rounded-2xl border-2">
      <CardHeader className="space-y-3 pb-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <CardTitle className="truncate text-xl">{row.label ?? '(이름 없음)'}</CardTitle>
            <div className="mt-1 flex flex-wrap gap-1.5">
              <Badge className={PHASE_BADGE[phase].className}>{PHASE_BADGE[phase].label}</Badge>
              <Badge variant="outline">{SESSION_TYPE_LABEL[row.sessionType]}</Badge>
              <Badge variant="outline" className={row.hasPassword ? '' : 'border-amber-400 text-amber-700'}>
                {row.hasPassword ? '비밀번호 있음' : '비밀번호 없음'}
              </Badge>
              {!row.managed && <Badge variant="secondary">옛 기록</Badge>}
            </div>
          </div>
          <div className="text-right">
            <div className="text-xs text-muted-foreground">입장 중</div>
            <div className="text-2xl font-black tabular-nums">{row.activeStudents}명</div>
          </div>
        </div>
        <button
          type="button"
          onClick={() => void copyId()}
          className="flex w-full items-center justify-between rounded-xl bg-muted px-4 py-3 text-left hover:bg-muted/70"
          title="눌러서 복사"
        >
          <span className="text-xs text-muted-foreground">수업 번호</span>
          <span className="font-mono text-3xl font-black tracking-widest">{spacedId(row.classId)}</span>
          <Copy className="h-4 w-4 text-muted-foreground" />
        </button>
      </CardHeader>

      <CardContent className="space-y-4">
        <div>
          <div className="mb-2 flex items-center justify-between text-sm">
            <span className="font-medium">차시 (누르면 열고 닫기)</span>
            <span className="text-xs text-muted-foreground">
              {phase === 'ended'
                ? `종료 ${formatTime(lesson?.closedAt)}`
                : lesson?.currentLesson
                  ? `지금 ${lesson.currentLesson}차시`
                  : ''}
            </span>
          </div>
          <div className="grid grid-cols-6 gap-1.5">
            {LESSONS.map((n) => {
              const isOpen = opened.includes(n);
              const isCurrent = lesson?.currentLesson === n;
              return (
                <Button
                  key={n}
                  type="button"
                  size="sm"
                  variant={isOpen ? 'default' : 'outline'}
                  className={isCurrent ? 'ring-2 ring-primary ring-offset-2' : ''}
                  disabled={busy || phase === 'ended'}
                  onClick={() => toggleLesson(n)}
                >
                  {n}
                </Button>
              );
            })}
          </div>
          {!lessonControlsApply && (
            <p className="mt-2 text-xs text-amber-700">
              이 반은 옛 방식(자율 진행) 기록이라 차시를 열고 닫아도 학생 화면에는 모든 차시가 보입니다.
            </p>
          )}
          {phase === 'ended' && (
            <p className="mt-2 text-xs text-muted-foreground">
              종료된 수업입니다. 다시 열려면 아래에서 차시를 골라 “수업 시작”을 누르세요.
            </p>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {phase !== 'running' && (
            <div className="flex items-center gap-2">
              <Select value={startLesson} onValueChange={setStartLesson}>
                <SelectTrigger className="w-[100px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {LESSONS.map((n) => (
                    <SelectItem key={n} value={String(n)}>{n}차시</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                disabled={busy}
                onClick={() =>
                  void act(
                    () => startClassAction(row.classId, Number(startLesson)),
                    `수업을 시작했습니다 · ${startLesson}차시`
                  )
                }
                className="bg-emerald-600 hover:bg-emerald-700"
              >
                <Play className="mr-2 h-4 w-4" /> 수업 시작
              </Button>
            </div>
          )}
          {phase === 'running' && (
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => void act(() => setClassEntryAction(row.classId, false), '입장을 닫았습니다')}
            >
              <DoorClosed className="mr-2 h-4 w-4" /> 입장 닫기
            </Button>
          )}
          {phase === 'entry_closed' && (
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => void act(() => setClassEntryAction(row.classId, true), '입장을 열었습니다')}
            >
              <DoorOpen className="mr-2 h-4 w-4" /> 입장만 다시 열기
            </Button>
          )}
          {(phase === 'running' || phase === 'entry_closed') && (
            <Button variant="destructive" disabled={busy} onClick={() => setEndOpen(true)}>
              <Square className="mr-2 h-4 w-4" /> 수업 끝내기
            </Button>
          )}
          <Button variant="ghost" disabled={busy} onClick={() => setPwOpen(true)}>
            <KeyRound className="mr-2 h-4 w-4" /> 비밀번호
          </Button>
        </div>

        <div className="border-t pt-3 text-xs text-muted-foreground">
          담당 교사:{' '}
          {teachers.length
            ? teachers.map((t) => t.displayName ?? t.email ?? t.uid).join(', ')
            : '없음 (교사 계정 탭에서 배정)'}
        </div>
      </CardContent>

      <AlertDialog open={endOpen} onOpenChange={setEndOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{row.label ?? row.classId} 수업을 끝낼까요?</AlertDialogTitle>
            <AlertDialogDescription>
              새로 들어오는 학생을 막고 모든 차시를 닫습니다. 학생이 쓴 답과 점수는 지우지 않습니다.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={revokeOnEnd} onCheckedChange={(v) => setRevokeOnEnd(v === true)} />
            들어와 있는 학생({row.activeStudents}명)도 바로 내보내기
          </label>
          <AlertDialogFooter>
            <AlertDialogCancel>취소</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() =>
                void act(async () => {
                  const res = await endClassAction(row.classId, { revokeSessions: revokeOnEnd });
                  if (res.ok) {
                    toast({
                      title: '수업을 끝냈습니다',
                      description: revokeOnEnd ? `학생 세션 ${res.data.revoked}개를 끊었습니다.` : undefined,
                    });
                  }
                  return res;
                })
              }
            >
              수업 끝내기
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog
        open={pwOpen}
        onOpenChange={(open) => {
          setPwOpen(open);
          if (!open) setNewPw('');
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>반 입장 비밀번호</DialogTitle>
            <DialogDescription>
              암호화(해시)해서만 저장하므로 지금 비밀번호를 보여 줄 수는 없습니다. 새로 정하면
              다음에 들어오는 학생부터 적용되고, 이미 들어온 학생은 그대로입니다.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor={`pw-${row.classId}`}>새 비밀번호 (4자 이상)</Label>
            <Input
              id={`pw-${row.classId}`}
              type="password"
              autoComplete="new-password"
              value={newPw}
              onChange={(e) => setNewPw(e.target.value)}
            />
          </div>
          <DialogFooter className="gap-2 sm:justify-between">
            <Button
              variant="ghost"
              disabled={busy || !row.hasPassword}
              onClick={async () => {
                const done = await act(() => setClassPasswordAction(row.classId, null), '비밀번호를 없앴습니다');
                if (done !== null) setPwOpen(false);
              }}
            >
              비밀번호 없애기
            </Button>
            <Button
              disabled={busy || !newPw}
              onClick={async () => {
                const done = await act(() => setClassPasswordAction(row.classId, newPw), '비밀번호를 바꿨습니다');
                if (done !== null) {
                  setNewPw('');
                  setPwOpen(false);
                }
              }}
            >
              저장
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

/* ────────────────────────── 교사 계정 ────────────────────────── */

function ClassChecklist(props: {
  classes: AdminClassRow[];
  value: string[];
  onChange: (next: string[]) => void;
  idPrefix: string;
}) {
  if (props.classes.length === 0) {
    return <p className="text-sm text-muted-foreground">먼저 반을 만들어 주세요.</p>;
  }
  return (
    <div className="grid max-h-56 gap-2 overflow-y-auto rounded-lg border p-3 sm:grid-cols-2">
      {props.classes.map((c) => {
        const checked = props.value.includes(c.classId);
        return (
          <label key={c.classId} className="flex items-center gap-2 text-sm">
            <Checkbox
              id={`${props.idPrefix}-${c.classId}`}
              checked={checked}
              onCheckedChange={(v) =>
                props.onChange(
                  v === true
                    ? [...props.value, c.classId]
                    : props.value.filter((id) => id !== c.classId)
                )
              }
            />
            <span className="truncate">
              {c.label ?? '(이름 없음)'} <span className="font-mono text-xs text-muted-foreground">{c.classId}</span>
            </span>
          </label>
        );
      })}
    </div>
  );
}

function TeachersPanel(props: { data: AdminConsoleData | null; busy: boolean; act: Act }) {
  const { data, busy, act } = props;
  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [classIds, setClassIds] = useState<string[]>([]);

  const [editing, setEditing] = useState<AdminTeacherRow | null>(null);
  const [editClassIds, setEditClassIds] = useState<string[]>([]);
  const [resetting, setResetting] = useState<AdminTeacherRow | null>(null);
  const [resetPw, setResetPw] = useState('');

  const classes = data?.classes ?? [];
  const labelOf = (id: string) => classes.find((c) => c.classId === id)?.label ?? id;

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    const created = await act(
      () => createTeacherAction({ email, displayName, password, classIds }),
      '교사 계정을 만들었습니다'
    );
    if (created) {
      setEmail('');
      setDisplayName('');
      setPassword('');
      setClassIds([]);
    }
  };

  return (
    <>
      <Card className="rounded-2xl border-2 border-primary/20">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <UserPlus className="h-5 w-5" /> 교사 계정 만들기
          </CardTitle>
          <CardDescription>
            교사는 이 계정으로 교사 화면(/teacher)에 로그인해 배정된 반의 학생 진행만 봅니다.
            비밀번호는 Firebase 인증이 암호화해 보관하며 이 앱은 원문을 저장하지 않습니다.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={create} className="space-y-4">
            <div className="grid gap-4 md:grid-cols-3">
              <div className="space-y-2">
                <Label htmlFor="t-email">계정(이메일)</Label>
                <Input id="t-email" type="email" autoComplete="off" value={email} onChange={(e) => setEmail(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="t-name">표시 이름 (선택)</Label>
                <Input id="t-name" value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="예: 5-3 담임" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="t-pw">처음 비밀번호 (8자 이상)</Label>
                <Input id="t-pw" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
              </div>
            </div>
            <div className="space-y-2">
              <Label>담당 반</Label>
              <ClassChecklist classes={classes} value={classIds} onChange={setClassIds} idPrefix="new" />
            </div>
            <Button type="submit" disabled={busy || !email || !password}>
              <UserPlus className="mr-2 h-4 w-4" /> 계정 만들기
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card className="rounded-2xl">
        <CardHeader>
          <CardTitle className="text-lg">교사 계정 목록</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          {!data ? (
            <Skeleton className="h-32 w-full" />
          ) : data.teachers.length === 0 ? (
            <p className="text-sm text-muted-foreground">아직 교사 계정이 없습니다.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>계정</TableHead>
                  <TableHead>담당 반</TableHead>
                  <TableHead>상태</TableHead>
                  <TableHead className="text-right">관리</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.teachers.map((t) => (
                  <TableRow key={t.uid}>
                    <TableCell>
                      <div className="font-medium">{t.displayName ?? t.email ?? t.uid}</div>
                      {t.displayName && <div className="text-xs text-muted-foreground">{t.email}</div>}
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {t.classResearchIds.length
                          ? t.classResearchIds.map((id) => (
                              <Badge key={id} variant="outline">{labelOf(id)}</Badge>
                            ))
                          : <span className="text-xs text-muted-foreground">없음</span>}
                      </div>
                    </TableCell>
                    <TableCell>
                      {t.disabled ? <Badge variant="secondary">사용 중지</Badge> : <Badge variant="outline">사용 중</Badge>}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex flex-wrap justify-end gap-1">
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={busy}
                          onClick={() => {
                            setEditing(t);
                            setEditClassIds(t.classResearchIds);
                          }}
                        >
                          담당 반
                        </Button>
                        <Button size="sm" variant="outline" disabled={busy} onClick={() => setResetting(t)}>
                          비밀번호
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={busy}
                          onClick={() =>
                            void act(
                              () => setTeacherDisabledAction(t.uid, !t.disabled),
                              t.disabled ? '다시 쓸 수 있게 했습니다' : '사용을 중지했습니다'
                            )
                          }
                        >
                          {t.disabled ? '다시 쓰기' : '중지'}
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={editing !== null} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>담당 반 바꾸기</DialogTitle>
            <DialogDescription>{editing?.displayName ?? editing?.email}</DialogDescription>
          </DialogHeader>
          <ClassChecklist classes={classes} value={editClassIds} onChange={setEditClassIds} idPrefix="edit" />
          <DialogFooter>
            <Button
              disabled={busy}
              onClick={async () => {
                if (!editing) return;
                const done = await act(() => setTeacherClassesAction(editing.uid, editClassIds), '담당 반을 바꿨습니다');
                if (done !== null) setEditing(null);
              }}
            >
              저장
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={resetting !== null}
        onOpenChange={(open) => {
          if (!open) {
            setResetting(null);
            setResetPw('');
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>교사 비밀번호 새로 정하기</DialogTitle>
            <DialogDescription>
              {resetting?.displayName ?? resetting?.email} — 저장하면 그 교사의 기존 로그인은 모두 끊깁니다.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="reset-pw">새 비밀번호 (8자 이상)</Label>
            <Input id="reset-pw" type="password" autoComplete="new-password" value={resetPw} onChange={(e) => setResetPw(e.target.value)} />
          </div>
          <DialogFooter>
            <Button
              disabled={busy || !resetPw}
              onClick={async () => {
                if (!resetting) return;
                const done = await act(() => resetTeacherPasswordAction(resetting.uid, resetPw), '비밀번호를 바꿨습니다');
                if (done !== null) {
                  setResetting(null);
                  setResetPw('');
                }
              }}
            >
              저장
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/* ────────────────────────── 설정 ────────────────────────── */

function SettingsPanel(props: { status: AdminStatus; busy: boolean; act: Act }) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const mismatch = next.length > 0 && confirm.length > 0 && next !== confirm;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (next !== confirm) return;
    const done = await props.act(() => changeAdminPasswordAction(current, next), '관리자 비밀번호를 바꿨습니다');
    if (done !== null) {
      setCurrent('');
      setNext('');
      setConfirm('');
    }
  };

  return (
    <>
      <Card className="rounded-2xl">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <KeyRound className="h-5 w-5" /> 관리자 비밀번호 바꾸기
          </CardTitle>
          <CardDescription>
            지금 비밀번호 출처:{' '}
            {props.status.setup.credential === 'stored'
              ? '이 화면에서 바꾼 비밀번호(해시로 저장됨)'
              : '배포 환경 변수 ADMIN_PASSWORD'}
            . 바꾸면 새 비밀번호는 암호화(scrypt 해시)해서 Firestore에만 저장되고, 그 뒤로는
            ADMIN_PASSWORD로 들어올 수 없습니다. 다른 기기의 관리자 로그인도 끊깁니다.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={submit} className="grid max-w-3xl gap-4 md:grid-cols-3 md:items-end">
            <div className="space-y-2">
              <Label htmlFor="cur-pw">지금 비밀번호</Label>
              <Input id="cur-pw" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="next-pw">새 비밀번호 (10자 이상)</Label>
              <Input id="next-pw" type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="confirm-pw">새 비밀번호 확인</Label>
              <Input id="confirm-pw" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
            </div>
            <Button type="submit" disabled={props.busy || !current || !next || next !== confirm} className="md:col-span-3 md:w-fit">
              바꾸기
            </Button>
          </form>
          {mismatch && <p className="mt-2 text-sm text-destructive">새 비밀번호 두 칸이 다릅니다.</p>}
          <p className="mt-4 text-xs text-muted-foreground">
            비밀번호를 잊었으면 Firebase 콘솔에서 Firestore의 admin_config/console 문서를 지운 뒤
            ADMIN_PASSWORD로 다시 들어오면 됩니다.
          </p>
        </CardContent>
      </Card>

      <Card className="rounded-2xl">
        <CardHeader>
          <CardTitle className="text-lg">운영 순서</CardTitle>
        </CardHeader>
        <CardContent>
          <ol className="list-decimal space-y-2 pl-5 text-sm">
            <li><strong>수업 운영</strong>에서 반을 만들고 입장 비밀번호를 정합니다.</li>
            <li><strong>교사 계정</strong>에서 담임 계정을 만들고 그 반을 배정합니다.</li>
            <li>수업 날 <strong>수업 시작</strong>을 누르고, 칠판에 수업 번호와 비밀번호를 적습니다.</li>
            <li>학생은 첫 화면에서 수업 번호·비밀번호·자기 번호로 그 반에만 들어갑니다.</li>
            <li>교사는 교사 화면의 <strong>학생 현황</strong>에서 누가 몇 문항을 했는지 봅니다.</li>
            <li>끝나면 <strong>수업 끝내기</strong>로 입장과 차시를 닫습니다. 기록은 지워지지 않습니다.</li>
          </ol>
        </CardContent>
      </Card>

      {props.status.research && (
        <Alert>
          <ShieldCheck className="h-4 w-4" />
          <AlertTitle>연구 준비 상태: {props.status.research.ready ? '준비됨' : '준비 전'}</AlertTitle>
          <AlertDescription>
            {props.status.research.ready ? (
              '연구 수업·연구 검사 반을 만들 수 있습니다.'
            ) : (
              <ul className="list-disc pl-5 text-sm">
                {props.status.research.blockers.map((b) => (
                  <li key={b}>{b}</li>
                ))}
              </ul>
            )}
          </AlertDescription>
        </Alert>
      )}
    </>
  );
}
