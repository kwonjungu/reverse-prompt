'use client';

/**
 * 통합 관리 화면의 '연구 자료' 탭(논문 v12).
 *
 *   - 연구 세션 연습 기록의 문항 요약을 보고, 시도별·학생×문항·문항 요약 CSV를 받는다.
 *   - 문항 셋(A·B·C 하나씩)을 골라 학생×문항 행에 제외 표시(무관한 내용 / 개인정보 포함)를 단다.
 *   - 제외 뒤 앱 AI 5수준별로 문항마다 n개를 고정 시드로 뽑아 사례 ID를 붙이고 저장·내보낸다.
 *
 * 계산과 권한은 모두 서버(src/server/admin/research-actions.ts)가 한다. 이 화면은 요청만 보낸다.
 * 학생 화면에는 나오지 않는다.
 */

import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import {
  drawSampleAction,
  exportExtractionCsvAction,
  exportResearchCsvAction,
  exportSampleCsvAction,
  listSamplesAction,
  loadExtractionAction,
  loadResearchOverviewAction,
  setExclusionAction,
  type ExtractionView,
  type ResearchCsvKind,
  type ResearchOverview,
  type SampleListItem,
  type SampleView,
} from '@/server/admin/research-actions';
import type { ExclusionReason } from '@/server/export/practice-summary';
import { PRACTICE_QUESTIONS } from '@/lib/questions';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Skeleton } from '@/components/ui/skeleton';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useToast } from '@/hooks/use-toast';
import { AlertTriangle, Download, Loader2, RefreshCw, Shuffle } from 'lucide-react';

const ALL = '__all__';

const EXCLUSION_LABEL: Record<ExclusionReason, string> = {
  irrelevant: '무관한 내용',
  personal_info: '개인정보 포함',
};

function titleOf(questionId: string): string {
  const q = PRACTICE_QUESTIONS.find((p) => `L${String(p.level).padStart(2, '0')}` === questionId);
  return q ? q.koreanTitle : questionId;
}

/** 엑셀이 한글을 UTF-8로 읽도록 붙이는 BOM. 서버 응답을 거치며 빠질 수 있어 여기서 다시 확인한다. */
const BOM = '\uFEFF';

function downloadCsv(filename: string, csv: string) {
  const body = csv.startsWith(BOM) ? csv : BOM + csv;
  const blob = new Blob([body], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function defaultSeed(): string {
  const d = new Date();
  const ymd = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  return `v12-${ymd}-${Math.random().toString(36).slice(2, 6)}`;
}

type Result<T> = { ok: true; data: T } | { ok: false; error: string; signedOut: boolean };

export function ResearchPanel({ onSignedOut }: { onSignedOut: () => void }) {
  const { toast } = useToast();
  const [scope, setScope] = useState<string>(ALL);
  const [overview, setOverview] = useState<ResearchOverview | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);

  const [picked, setPicked] = useState<string[]>([]);
  const [extraction, setExtraction] = useState<ExtractionView | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});

  const [perLevel, setPerLevel] = useState('4');
  const [seed, setSeed] = useState(defaultSeed);
  const [sample, setSample] = useState<SampleView | null>(null);
  const [samples, setSamples] = useState<SampleListItem[]>([]);

  const classResearchId = scope === ALL ? null : scope;

  /** 서버 결과를 받아 오류를 알리고 데이터만 돌려준다. */
  const call = useCallback(
    async <T,>(fn: () => Promise<Result<T>>, success?: string): Promise<T | null> => {
      setBusy(true);
      try {
        const res = await fn();
        if (!res.ok) {
          if (res.signedOut) onSignedOut();
          toast({ variant: 'destructive', title: '처리하지 못했습니다', description: res.error });
          return null;
        }
        if (success) toast({ title: success });
        return res.data;
      } catch {
        toast({ variant: 'destructive', title: '처리하지 못했습니다', description: '잠시 뒤 다시 해 주세요.' });
        return null;
      } finally {
        setBusy(false);
      }
    },
    [onSignedOut, toast]
  );

  const loadOverview = useCallback(async () => {
    setLoading(true);
    const data = await call(() => loadResearchOverviewAction({ classResearchId }));
    if (data) setOverview(data);
    setLoading(false);
  }, [call, classResearchId]);

  const loadSamples = useCallback(async () => {
    const data = await call(() => listSamplesAction());
    if (data) setSamples(data);
  }, [call]);

  useEffect(() => {
    void loadOverview();
    setExtraction(null);
    setSample(null);
  }, [loadOverview]);

  useEffect(() => {
    void loadSamples();
  }, [loadSamples]);

  const exportCsv = async (kind: ResearchCsvKind) => {
    const file = await call(() => exportResearchCsvAction({ kind, classResearchId }));
    if (file) downloadCsv(file.filename, file.csv);
  };

  const togglePick = (questionId: string, on: boolean) => {
    setPicked((prev) => {
      if (on) return prev.includes(questionId) || prev.length >= 3 ? prev : [...prev, questionId].sort();
      return prev.filter((id) => id !== questionId);
    });
  };

  const loadCandidates = async () => {
    const data = await call(() => loadExtractionAction({ questionIds: picked, classResearchId }));
    if (data) {
      setExtraction(data);
      setSample(null);
      setNotes(
        Object.fromEntries(
          data.rows.filter((r) => r.exclusion?.note).map((r) => [`${r.researchId}|${r.questionId}`, r.exclusion!.note ?? ''])
        )
      );
    }
  };

  const setExclusion = async (researchId: string, questionId: string, reason: ExclusionReason | null) => {
    const note = notes[`${researchId}|${questionId}`] ?? '';
    const mark = await call(() => setExclusionAction({ researchId, questionId, reason, note }));
    if (mark === null && reason !== null) return;
    setExtraction((prev) =>
      prev
        ? {
            ...prev,
            rows: prev.rows.map((r) =>
              r.researchId === researchId && r.questionId === questionId ? { ...r, exclusion: mark } : r
            ),
          }
        : prev
    );
  };

  const draw = async () => {
    const data = await call(
      () => drawSampleAction({ questionIds: picked, perLevel: Number(perLevel), seed, classResearchId }),
      '추출을 저장했습니다'
    );
    if (data) {
      setSample(data);
      downloadCsv(data.filename, data.csv);
      void loadSamples();
    }
  };

  const excludedCount = useMemo(() => extraction?.rows.filter((r) => r.exclusion).length ?? 0, [extraction]);

  const bandsPicked = useMemo(() => {
    const bands = new Set(
      picked.map((id) => overview?.questionSummary.find((q) => q.questionId === id)?.band).filter(Boolean)
    );
    return bands;
  }, [picked, overview]);

  return (
    <div className="space-y-6">
      <Card className="rounded-2xl border-2 border-primary/20">
        <CardHeader>
          <CardTitle className="text-lg">연구 자료 — 연습 시도 기록</CardTitle>
          <CardDescription>
            연구 수업 반의 연습 제출만 모읍니다(일반 수업 기록은 섞지 않습니다). 보호자 동의와 학생 승낙이
            지금 유효한 학생만 셉니다. 요약은 저장된 기록에서 계산하며 원문을 바꾸지 않습니다. 학생 화면에는
            나오지 않습니다.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1">
              <Label>범위</Label>
              <Select value={scope} onValueChange={setScope}>
                <SelectTrigger className="w-[260px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>모든 연구 반</SelectItem>
                  {(overview?.classes ?? []).map((c) => (
                    <SelectItem key={c.classResearchId} value={c.classResearchId}>
                      {c.label ?? '(이름 없음)'} · {c.classResearchId}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button variant="outline" onClick={() => void loadOverview()} disabled={loading}>
              <RefreshCw className={`mr-2 h-4 w-4 ${loading ? 'animate-spin' : ''}`} /> 새로 고침
            </Button>
            <div className="ml-auto flex flex-wrap gap-2">
              <Button variant="outline" disabled={busy} onClick={() => void exportCsv('attempts')}>
                <Download className="mr-2 h-4 w-4" /> 시도별 CSV
              </Button>
              <Button variant="outline" disabled={busy} onClick={() => void exportCsv('student_question')}>
                <Download className="mr-2 h-4 w-4" /> 학생×문항 요약 CSV
              </Button>
              <Button variant="outline" disabled={busy} onClick={() => void exportCsv('question')}>
                <Download className="mr-2 h-4 w-4" /> 문항 요약 CSV
              </Button>
            </div>
          </div>

          {!overview ? (
            <Skeleton className="h-40 w-full" />
          ) : (
            <>
              <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                {[
                  { label: '시도', value: `${overview.attemptCount}건` },
                  { label: '학생', value: `${overview.studentCount}명` },
                  { label: '동의 없음·철회로 뺀 학생', value: `${overview.consentExcludedStudents}명` },
                  { label: '고른 문항', value: `${picked.length}/3` },
                ].map((t) => (
                  <div key={t.label} className="rounded-xl bg-muted/50 p-4">
                    <div className="text-xs text-muted-foreground">{t.label}</div>
                    <div className="text-2xl font-black tabular-nums">{t.value}</div>
                  </div>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">
                {overview.appLevelRule} 결측(채점 못 함)은 분포에 넣지 않고 따로 셉니다.
              </p>
              {overview.attemptCount === 0 && (
                <p className="text-sm text-amber-700">
                  아직 모인 연구 기록이 없습니다. 연구 수업 반에서 동의한 학생이 연습을 제출하면 여기에 쌓입니다.
                </p>
              )}

              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-[48px]">고르기</TableHead>
                      <TableHead>문항</TableHead>
                      <TableHead>밴드</TableHead>
                      <TableHead className="text-right">학생</TableHead>
                      <TableHead className="text-right">평균 시도</TableHead>
                      {[1, 2, 3, 4, 5].map((n) => (
                        <TableHead key={n} className="text-right">{n}수준</TableHead>
                      ))}
                      <TableHead className="text-right">결측</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {overview.questionSummary.map((q) => {
                      const on = picked.includes(q.questionId);
                      return (
                        <TableRow key={q.questionId} className={on ? 'bg-primary/5' : ''}>
                          <TableCell>
                            <Checkbox
                              checked={on}
                              disabled={!on && picked.length >= 3}
                              onCheckedChange={(v) => togglePick(q.questionId, v === true)}
                            />
                          </TableCell>
                          <TableCell className="whitespace-nowrap">
                            <span className="font-mono text-xs">{q.questionId}</span> {titleOf(q.questionId)}
                          </TableCell>
                          <TableCell>{q.band}</TableCell>
                          <TableCell className="text-right tabular-nums">{q.students}</TableCell>
                          <TableCell className="text-right tabular-nums">
                            {q.meanAttempts === null ? '-' : q.meanAttempts.toFixed(2)}
                          </TableCell>
                          {q.finalLevelCounts.map((c, i) => (
                            <TableCell key={i} className="text-right tabular-nums">{c || '·'}</TableCell>
                          ))}
                          <TableCell className="text-right tabular-nums">{q.finalMissing || '·'}</TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <Card className="rounded-2xl">
        <CardHeader>
          <CardTitle className="text-lg">연구용 추출</CardTitle>
          <CardDescription>
            위 표에서 문항을 셋까지 고르세요(A·B·C 밴드 하나씩 권장). 행마다 제외 표시를 달면 추출에서
            빠지고, 사유는 지우지 않고 기록으로 남습니다. 제외 뒤 앱 AI 5수준별로 문항마다 n개를 고정
            시드로 뽑아 사례 ID(예: 01-31 = L01의 3수준 첫째)를 붙입니다.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            {picked.length === 0 ? (
              <span className="text-sm text-muted-foreground">고른 문항이 없습니다.</span>
            ) : (
              picked.map((id) => (
                <Badge key={id} variant="outline" className="text-sm">
                  {id} {titleOf(id)}
                </Badge>
              ))
            )}
            {picked.length > 0 && bandsPicked.size < picked.length && (
              <span className="text-xs text-amber-700">같은 밴드의 문항을 둘 이상 골랐습니다.</span>
            )}
            <div className="ml-auto flex gap-2">
              <Button disabled={busy || picked.length === 0} onClick={() => void loadCandidates()}>
                {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null} 후보 불러오기
              </Button>
              <Button
                variant="outline"
                disabled={busy || picked.length === 0}
                onClick={async () => {
                  const file = await call(() => exportExtractionCsvAction({ questionIds: picked, classResearchId }));
                  if (file) downloadCsv(file.filename, file.csv);
                }}
              >
                <Download className="mr-2 h-4 w-4" /> 고른 문항 요약 CSV
              </Button>
            </div>
          </div>

          {extraction && (
            <>
              <p className="text-sm text-muted-foreground">
                후보 {extraction.rows.length}행 · 제외 {excludedCount}행 · 동의 없음·철회로 뺀 학생{' '}
                {extraction.consentExcludedStudents}명. 행을 누르면 첫·최종 프롬프트와 피드백을 봅니다.
              </p>
              <div className="max-h-[560px] overflow-auto rounded-lg border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>문항</TableHead>
                      <TableHead>연구ID</TableHead>
                      <TableHead className="text-right">시도</TableHead>
                      <TableHead className="text-right">첫→최종 수준</TableHead>
                      <TableHead>최종 프롬프트</TableHead>
                      <TableHead className="w-[170px]">제외</TableHead>
                      <TableHead className="w-[180px]">메모</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {extraction.rows.map((r) => {
                      const key = `${r.researchId}|${r.questionId}`;
                      const open = expanded === key;
                      return (
                        <Fragment key={key}>
                          <TableRow className={r.exclusion ? 'opacity-60' : ''}>
                            <TableCell className="font-mono text-xs">{r.questionId}</TableCell>
                            <TableCell className="font-mono text-xs">{r.researchId}</TableCell>
                            <TableCell className="text-right tabular-nums">{r.attemptCount}</TableCell>
                            <TableCell className="text-right tabular-nums">
                              {r.firstAppLevel ?? '결측'} → {r.finalAppLevel ?? '결측'}
                            </TableCell>
                            <TableCell
                              className="max-w-[320px] cursor-pointer"
                              onClick={() => setExpanded(open ? null : key)}
                            >
                              <span className={open ? 'whitespace-pre-wrap' : 'line-clamp-2'}>{r.finalPrompt}</span>
                              {r.piiSuspected && (
                                <Badge variant="destructive" className="ml-1 align-middle text-[10px]">
                                  <AlertTriangle className="mr-1 h-3 w-3" /> 개인정보 의심
                                </Badge>
                              )}
                            </TableCell>
                            <TableCell>
                              <Select
                                value={r.exclusion?.reason ?? 'none'}
                                onValueChange={(v) =>
                                  void setExclusion(r.researchId, r.questionId, v === 'none' ? null : (v as ExclusionReason))
                                }
                              >
                                <SelectTrigger className="h-8 text-xs">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="none">포함</SelectItem>
                                  <SelectItem value="irrelevant">{EXCLUSION_LABEL.irrelevant}</SelectItem>
                                  <SelectItem value="personal_info">{EXCLUSION_LABEL.personal_info}</SelectItem>
                                </SelectContent>
                              </Select>
                            </TableCell>
                            <TableCell>
                              <Input
                                className="h-8 text-xs"
                                placeholder="사유 메모(선택)"
                                value={notes[key] ?? ''}
                                onChange={(e) => setNotes((prev) => ({ ...prev, [key]: e.target.value }))}
                                onBlur={() => {
                                  if (r.exclusion && (notes[key] ?? '') !== (r.exclusion.note ?? '')) {
                                    void setExclusion(r.researchId, r.questionId, r.exclusion.reason);
                                  }
                                }}
                              />
                            </TableCell>
                          </TableRow>
                          {open && (
                            <TableRow className="bg-muted/30 hover:bg-muted/30">
                              <TableCell colSpan={7} className="space-y-2 p-4 text-sm">
                                <p>
                                  <strong>첫 프롬프트</strong> ({r.firstAppLevel ?? '결측'}수준):{' '}
                                  <span className="whitespace-pre-wrap">{r.firstPrompt}</span>
                                </p>
                                <p>
                                  <strong>최종 프롬프트</strong> ({r.finalAppLevel ?? '결측'}수준):{' '}
                                  <span className="whitespace-pre-wrap">{r.finalPrompt}</span>
                                </p>
                                <div>
                                  <strong>받은 피드백(시도 순서)</strong>
                                  <ol className="mt-1 list-decimal space-y-1 pl-5">
                                    {r.feedbacks.split(' | ').map((f, i) => (
                                      <li key={i} className="whitespace-pre-wrap text-muted-foreground">{f}</li>
                                    ))}
                                  </ol>
                                </div>
                              </TableCell>
                            </TableRow>
                          )}
                        </Fragment>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>

              <div className="flex flex-wrap items-end gap-3 rounded-xl bg-muted/40 p-4">
                <div className="space-y-1">
                  <Label htmlFor="per-level">수준마다 뽑을 수</Label>
                  <Input id="per-level" type="number" min={1} max={9} value={perLevel} onChange={(e) => setPerLevel(e.target.value)} className="w-24" />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="seed">시드</Label>
                  <div className="flex gap-2">
                    <Input id="seed" value={seed} onChange={(e) => setSeed(e.target.value)} className="w-56 font-mono text-xs" />
                    <Button variant="ghost" size="sm" onClick={() => setSeed(defaultSeed())}>새 시드</Button>
                  </div>
                </div>
                <Button disabled={busy} onClick={() => void draw()} className="ml-auto">
                  <Shuffle className="mr-2 h-4 w-4" /> 추출하고 CSV 받기
                </Button>
                <p className="w-full text-xs text-muted-foreground">
                  같은 시드·같은 후보면 같은 결과가 나옵니다. 시드와 후보 목록, 제외 목록, 뽑힌 사례를 함께 저장합니다.
                  후보가 모자란 층은 있는 만큼만 뽑고 다른 층에서 채우지 않습니다.
                </p>
              </div>
            </>
          )}

          {sample && (
            <div className="space-y-3 rounded-xl border p-4">
              <p className="text-sm">
                <strong>{sample.sampleId}</strong> · 시드 <code>{sample.seed}</code> · 사례 {sample.cases.length}개 ·
                제외 {sample.excludedCount}행 · 결측으로 빠진 {sample.unlevelledCount}행
              </p>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>문항</TableHead>
                      {[1, 2, 3, 4, 5].map((n) => (
                        <TableHead key={n} className="text-center">{n}수준 (뽑힘/후보)</TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {sample.questionIds.map((qid) => (
                      <TableRow key={qid}>
                        <TableCell className="font-mono text-xs">{qid}</TableCell>
                        {[1, 2, 3, 4, 5].map((lv) => {
                          const s = sample.strata.find((x) => x.questionId === qid && x.level === lv);
                          return (
                            <TableCell key={lv} className={`text-center tabular-nums ${s && s.shortfall > 0 ? 'text-amber-700' : ''}`}>
                              {s ? `${s.drawn}/${s.candidates}` : '-'}
                              {s && s.shortfall > 0 ? ` (−${s.shortfall})` : ''}
                            </TableCell>
                          );
                        })}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              <p className="text-xs text-muted-foreground">
                사례 ID에는 앱 AI 수준이 들어 있습니다(01-31의 “3”). 전문가에게 수준을 가리고 줄 때는 case_id·app_level
                열을 빼고 다른 번호를 붙여 주세요.
              </p>
            </div>
          )}

          <div className="space-y-2">
            <h3 className="text-sm font-semibold">지난 추출</h3>
            {samples.length === 0 ? (
              <p className="text-sm text-muted-foreground">아직 없습니다.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>추출 번호</TableHead>
                    <TableHead>시드</TableHead>
                    <TableHead>문항</TableHead>
                    <TableHead className="text-right">n</TableHead>
                    <TableHead className="text-right">사례</TableHead>
                    <TableHead className="text-right">부족</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {samples.map((s) => (
                    <TableRow key={s.sampleId}>
                      <TableCell className="font-mono text-xs">{s.sampleId}</TableCell>
                      <TableCell className="font-mono text-xs">{s.seed}</TableCell>
                      <TableCell className="text-xs">{s.questionIds.join(', ')}</TableCell>
                      <TableCell className="text-right tabular-nums">{s.perLevel}</TableCell>
                      <TableCell className="text-right tabular-nums">{s.caseCount}</TableCell>
                      <TableCell className="text-right tabular-nums">{s.shortfall}</TableCell>
                      <TableCell className="text-right">
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={busy}
                          onClick={async () => {
                            const file = await call(() => exportSampleCsvAction(s.sampleId));
                            if (file) downloadCsv(file.filename, file.csv);
                          }}
                        >
                          <Download className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
