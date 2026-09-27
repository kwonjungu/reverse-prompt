'use client';

/**
 * 통합 관리 화면 — 연구 수업의 '참가자' 창.
 *
 * 참가 번호를 한 번에 여러 개 발급해 인쇄하고, 참가자마다 보호자 동의·학생 승낙을 체크하고,
 * 철회를 기록한다. 이름·출석 번호는 받지도 보이지도 않는다. 누구에게 몇 번을 주었는지
 * (실명 대응표)는 학교가 종이로 따로 보관한다.
 *
 * 참가 번호는 발급한 이 창에서 한 번만 보인다. 서버에는 해시만 남으므로 닫으면 다시 볼 수 없다.
 * 인쇄는 이 목록만 나오게 한다(아래 PrintSheet).
 */

import { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  issueParticipantCodesAction,
  listParticipantsAction,
  setParticipantConsentAction,
  withdrawParticipantAction,
  type IssuedParticipants,
  type ParticipantConsentField,
  type ParticipantList,
  type ParticipantRow,
} from '@/server/admin/participant-actions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
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
import { AlertTriangle, Loader2, Printer, RefreshCw, Ticket } from 'lucide-react';

function spacedId(id: string): string {
  return /^[0-9]{6}$/.test(id) ? `${id.slice(0, 3)} ${id.slice(3)}` : id;
}

function formatTime(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function statusOf(row: ParticipantRow, consentOpen: boolean): { label: string; className: string } {
  if (row.withdrawn) return { label: '철회', className: 'bg-slate-500 text-white hover:bg-slate-500' };
  if (row.active) return { label: '수집 가능', className: 'bg-emerald-600 text-white hover:bg-emerald-600' };
  if (!consentOpen) return { label: '수집 안 됨', className: 'bg-muted text-muted-foreground' };
  if (row.consentVersion && !row.versionCurrent) {
    return { label: '동의서 버전 다름', className: 'border-amber-400 text-amber-700' };
  }
  return { label: '동의 확인 전', className: 'bg-muted text-muted-foreground' };
}

/** 지금 동의서 버전으로 받은 동의만 체크된 것으로 보인다. */
const grantedNow = (row: ParticipantRow, field: ParticipantConsentField) =>
  row[field] === 'granted' && row.versionCurrent;

export function ParticipantsDialog(props: {
  classId: string;
  classLabel: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSignedOut: () => void;
}) {
  const { classId, open, onOpenChange, onSignedOut } = props;
  const { toast } = useToast();

  const [list, setList] = useState<ParticipantList | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [rowBusy, setRowBusy] = useState<string | null>(null);
  const [count, setCount] = useState('30');
  const [issued, setIssued] = useState<IssuedParticipants | null>(null);
  const [printed, setPrinted] = useState(false);
  const [withdrawTarget, setWithdrawTarget] = useState<ParticipantRow | null>(null);

  const fail = useCallback(
    (res: { error: string; signedOut: boolean }) => {
      if (res.signedOut) onSignedOut();
      toast({ variant: 'destructive', title: '처리하지 못했습니다', description: res.error });
    },
    [onSignedOut, toast]
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await listParticipantsAction(classId);
      if (res.ok) setList(res.data);
      else fail(res);
    } catch {
      toast({ variant: 'destructive', title: '불러오지 못했습니다' });
    } finally {
      setLoading(false);
    }
  }, [classId, fail, toast]);

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  const replaceRow = (row: ParticipantRow) =>
    setList((prev) =>
      prev ? { ...prev, rows: prev.rows.map((r) => (r.researchId === row.researchId ? row : r)) } : prev
    );

  const clearIssued = () => {
    setIssued(null);
    setPrinted(false);
  };

  /** 참가 번호가 떠 있는 채로 닫으면 다시 볼 수 없으므로 한 번 묻는다. */
  const handleOpenChange = (next: boolean) => {
    if (!next && issued && !printed) {
      const ok = window.confirm('참가 번호를 인쇄하지 않았습니다. 닫으면 다시 볼 수 없습니다. 닫을까요?');
      if (!ok) return;
    }
    if (!next) clearIssued();
    onOpenChange(next);
  };

  const leaveIssued = () => {
    if (!printed && !window.confirm('인쇄하지 않았습니다. 이 목록은 다시 볼 수 없습니다. 넘어갈까요?')) return;
    clearIssued();
  };

  const issue = async () => {
    const n = Number(count);
    setBusy(true);
    try {
      const res = await issueParticipantCodesAction(classId, n);
      if (!res.ok) return fail(res);
      setIssued(res.data);
      setPrinted(false);
      void load();
    } catch {
      toast({ variant: 'destructive', title: '처리하지 못했습니다', description: '잠시 뒤 다시 해 주세요.' });
    } finally {
      setBusy(false);
    }
  };

  const setConsent = async (row: ParticipantRow, field: ParticipantConsentField, granted: boolean) => {
    setRowBusy(row.researchId);
    try {
      const res = await setParticipantConsentAction({ classId, researchId: row.researchId, field, granted });
      if (res.ok) replaceRow(res.data);
      else fail(res);
    } catch {
      toast({ variant: 'destructive', title: '처리하지 못했습니다', description: '잠시 뒤 다시 해 주세요.' });
    } finally {
      setRowBusy(null);
    }
  };

  const withdraw = async (row: ParticipantRow) => {
    setRowBusy(row.researchId);
    try {
      const res = await withdrawParticipantAction({ classId, researchId: row.researchId });
      if (res.ok) {
        replaceRow(res.data);
        toast({ title: `${row.seq ? `${row.seq}번 ` : ''}참가자의 철회를 기록했습니다` });
      } else fail(res);
    } catch {
      toast({ variant: 'destructive', title: '처리하지 못했습니다', description: '잠시 뒤 다시 해 주세요.' });
    } finally {
      setRowBusy(null);
    }
  };

  const print = () => {
    setPrinted(true);
    window.print();
  };

  const rows = list?.rows ?? [];
  const consentOpen = !!list?.consentVersion;
  const activeCount = rows.filter((r) => r.active).length;
  const withdrawnCount = rows.filter((r) => r.withdrawn).length;
  const label = list?.label ?? props.classLabel;

  return (
    <>
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>참가자 · {label ?? '(이름 없음)'}</DialogTitle>
            <DialogDescription>
              수업 번호 {spacedId(classId)}. 이름과 출석 번호는 이 앱에 적지 않습니다. 누구에게 몇 번
              참가 번호를 주었는지(실명 대응표)는 학교에서 따로 보관해 주세요.
            </DialogDescription>
          </DialogHeader>

          {issued ? (
            <IssuedView issued={issued} printed={printed} onPrint={print} onDone={leaveIssued} />
          ) : (
            <div className="space-y-5">
              {list && !list.codeIssuable && (
                <Alert className="border-destructive/40 bg-destructive/5">
                  <AlertTriangle className="h-4 w-4 text-destructive" />
                  <AlertTitle>참가 번호를 발급할 수 없습니다</AlertTitle>
                  <AlertDescription className="text-sm">
                    서버 환경 변수 PARTICIPANT_CODE_PEPPER가 없습니다. 넣고 다시 배포해 주세요.
                  </AlertDescription>
                </Alert>
              )}
              {list && !consentOpen && (
                <Alert className="border-amber-400 bg-amber-50/60 dark:bg-amber-950/20">
                  <AlertTriangle className="h-4 w-4 text-amber-600" />
                  <AlertTitle>동의를 기록할 수 없습니다</AlertTitle>
                  <AlertDescription className="text-sm">
                    동의서 버전(CONSENT_VERSION)이 설정되지 않았습니다. 버전이 정해진 동의서로 받은 뒤
                    환경 변수에 넣고 다시 배포해 주세요. 그 전에는 누구도 연구 자료로 모이지 않습니다.
                  </AlertDescription>
                </Alert>
              )}

              <div className="flex flex-wrap items-end gap-3 rounded-xl border p-4">
                <div className="space-y-2">
                  <Label htmlFor={`issue-count-${classId}`}>새로 발급할 수 (1~{list?.batchMax ?? ''})</Label>
                  <Input
                    id={`issue-count-${classId}`}
                    type="number"
                    min={1}
                    max={list?.batchMax}
                    value={count}
                    onChange={(e) => setCount(e.target.value)}
                    className="w-32"
                  />
                </div>
                <Button onClick={() => void issue()} disabled={busy || !list?.codeIssuable || !count}>
                  {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Ticket className="mr-2 h-4 w-4" />}
                  참가 번호 발급
                </Button>
                <p className="w-full text-xs text-muted-foreground">
                  발급한 번호는 바로 다음 화면에서 한 번만 보입니다. 서버에는 알아볼 수 없게 바꾼 값(해시)만
                  남습니다. 순번은 이 반 안에서 이어 붙습니다.
                </p>
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="text-sm">
                    참가자 {rows.length}명 · 수집 가능 {activeCount}명
                    {withdrawnCount ? ` · 철회 ${withdrawnCount}명` : ''}
                    {list?.consentVersion ? (
                      <span className="text-muted-foreground"> · 동의서 버전 {list.consentVersion}</span>
                    ) : null}
                  </div>
                  <Button variant="ghost" size="sm" onClick={() => void load()} disabled={loading}>
                    <RefreshCw className={`mr-1 h-4 w-4 ${loading ? 'animate-spin' : ''}`} /> 새로 고침
                  </Button>
                </div>
                {!list ? (
                  <Skeleton className="h-32 w-full" />
                ) : rows.length === 0 ? (
                  <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
                    아직 발급한 참가 번호가 없습니다.
                  </p>
                ) : (
                  <div className="overflow-x-auto rounded-lg border">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="w-14">순번</TableHead>
                          <TableHead>연구ID</TableHead>
                          <TableHead className="text-center">보호자 동의</TableHead>
                          <TableHead className="text-center">학생 승낙</TableHead>
                          <TableHead>상태</TableHead>
                          <TableHead className="text-right">철회</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {rows.map((row) => {
                          const status = statusOf(row, consentOpen);
                          const locked = !consentOpen || row.withdrawn || rowBusy === row.researchId;
                          return (
                            <TableRow key={row.researchId}>
                              <TableCell className="font-bold tabular-nums">{row.seq ?? '-'}</TableCell>
                              <TableCell className="font-mono text-xs">{row.researchId}</TableCell>
                              {(['guardianConsent', 'studentAssent'] as const).map((field) => (
                                <TableCell key={field} className="text-center">
                                  <Checkbox
                                    aria-label={`${row.seq ?? row.researchId}번 ${field === 'guardianConsent' ? '보호자 동의' : '학생 승낙'}`}
                                    checked={grantedNow(row, field)}
                                    disabled={locked}
                                    onCheckedChange={(v) => void setConsent(row, field, v === true)}
                                  />
                                </TableCell>
                              ))}
                              <TableCell>
                                <Badge variant="outline" className={status.className}>{status.label}</Badge>
                                {row.withdrawnAt && (
                                  <div className="mt-0.5 text-[11px] text-muted-foreground">{formatTime(row.withdrawnAt)}</div>
                                )}
                              </TableCell>
                              <TableCell className="text-right">
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  disabled={row.withdrawn || rowBusy === row.researchId}
                                  onClick={() => setWithdrawTarget(row)}
                                >
                                  철회
                                </Button>
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </div>
                )}
                <p className="text-xs text-muted-foreground">
                  보호자 동의와 학생 승낙을 모두 체크해야 그 학생의 연습 기록이 연구 자료로 모입니다.
                  체크를 풀면 ‘확인 전’으로 돌아갑니다. 바꿀 때마다 동의 이력에 남습니다.
                </p>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <AlertDialog open={withdrawTarget !== null} onOpenChange={(o) => !o && setWithdrawTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {withdrawTarget?.seq ? `${withdrawTarget.seq}번 ` : ''}참가자의 철회를 기록할까요?
            </AlertDialogTitle>
            <AlertDialogDescription>
              되돌릴 수 없습니다. 그 학생은 바로 연구 수집에서 빠지고 들어와 있던 세션도 끊깁니다.
              이미 모은 자료는 자동으로 지우지 않습니다. 파기는 승인된 절차에 따라 따로 처리합니다.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>취소</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                if (withdrawTarget) void withdraw(withdrawTarget);
                setWithdrawTarget(null);
              }}
            >
              철회 기록
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {open && issued && <PrintSheet issued={issued} />}
    </>
  );
}

/* ────────────────────────── 발급 결과 ────────────────────────── */

function IssuedView(props: {
  issued: IssuedParticipants;
  printed: boolean;
  onPrint: () => void;
  onDone: () => void;
}) {
  const { issued } = props;
  return (
    <div className="space-y-4">
      <Alert className="border-amber-400 bg-amber-50/60 dark:bg-amber-950/20">
        <AlertTriangle className="h-4 w-4 text-amber-600" />
        <AlertTitle>지금 인쇄해 주세요 — 다시 볼 수 없습니다</AlertTitle>
        <AlertDescription className="text-sm">
          참가 번호 {issued.entries.length}개({issued.entries[0]?.seq}~{issued.entries[issued.entries.length - 1]?.seq}번)를
          발급했습니다. 서버에는 알아볼 수 없게 바꾼 값만 남아 이 창을 닫으면 다시 보여 줄 수 없습니다.
          잃어버리면 새로 발급하면 됩니다.
        </AlertDescription>
      </Alert>
      <div className="max-h-[45vh] overflow-y-auto rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-16">순번</TableHead>
              <TableHead>참가 번호</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {issued.entries.map((e) => (
              <TableRow key={e.researchId}>
                <TableCell className="font-bold tabular-nums">{e.seq}</TableCell>
                <TableCell className="font-mono text-lg font-bold tracking-widest">{e.code}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <DialogFooter className="gap-2 sm:justify-between">
        <Button variant="ghost" onClick={props.onDone}>
          {props.printed ? '다 했어요' : '인쇄하지 않고 넘어가기'}
        </Button>
        <Button onClick={props.onPrint}>
          <Printer className="mr-2 h-4 w-4" /> 인쇄
        </Button>
      </DialogFooter>
    </div>
  );
}

/**
 * 인쇄할 때만 보이는 목록. body 바로 아래에 붙이고, 인쇄할 때는 body의 다른 자식(화면·창)을
 * 모두 숨긴다. 화면에서는 보이지 않는다. 이름 칸은 두지 않는다.
 */
function PrintSheet(props: { issued: IssuedParticipants }) {
  const { issued } = props;
  if (typeof document === 'undefined') return null;
  return createPortal(
    <div className="rp-print-sheet">
      <style>{`
        .rp-print-sheet { display: none; }
        @media print {
          body > *:not(.rp-print-sheet) { display: none !important; }
          html, body { background: #fff !important; color: #000 !important; }
          .rp-print-sheet { display: block !important; color: #000; font-size: 11pt; }
          .rp-print-sheet h1 { font-size: 15pt; font-weight: 700; margin: 0 0 4pt; }
          .rp-print-sheet p { margin: 0 0 8pt; }
          .rp-print-sheet table { width: 100%; border-collapse: collapse; }
          .rp-print-sheet th, .rp-print-sheet td { border: 1px dashed #000; padding: 8pt 10pt; text-align: left; }
          .rp-print-sheet tr { break-inside: avoid; }
          .rp-print-sheet .code { font-family: ui-monospace, monospace; font-size: 18pt; font-weight: 700; letter-spacing: 0.12em; }
        }
      `}</style>
      <h1>참가 번호 · {issued.label ?? ''}</h1>
      <p>
        수업 번호 {spacedId(issued.classId)} · {formatTime(issued.issuedAt)} 발급 · 한 줄씩 잘라 학생에게 나눠 주세요.
        누구에게 몇 번을 주었는지는 학교에서 따로 보관하고 앱에는 적지 않습니다. 이 목록은 다시 출력할 수 없습니다.
      </p>
      <table>
        <thead>
          <tr>
            <th>순번</th>
            <th>수업 번호</th>
            <th>참가 번호</th>
          </tr>
        </thead>
        <tbody>
          {issued.entries.map((e) => (
            <tr key={e.researchId}>
              <td>{e.seq}</td>
              <td>{spacedId(issued.classId)}</td>
              <td className="code">{e.code}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>,
    document.body
  );
}
