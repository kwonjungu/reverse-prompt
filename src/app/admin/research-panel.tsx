'use client';

/**
 * 통합 관리 화면의 '연구 자료' 탭(논문 v12, 공통 루브릭 v12-2).
 *
 *   - 연구 세션 연습 기록의 문항 요약(앱 종합 4수준 분포·영역별 평균)을 보고,
 *     시도별·학생×문항·문항 요약 CSV를 받는다.
 *   - 문항 셋(A·B·C 하나씩)을 골라 학생×문항 행에 제외 표시(무관한 내용 / 개인정보 포함)를 단다.
 *   - 제외 뒤 앱 종합 4수준별로 문항마다 n개(기본 5)를 고정 시드로 뽑아 저장하고, 세 파일로 내보낸다:
 *     전문가용(새 사례번호·사진ID·학생 문장만), 연구자용(대응표 + 앱 판정), 뺀 수와 사유.
 *   - 추출 사례를 운영 채점기로 2·3회차 다시 채점해 따로 저장하고, 영역별 세 번 일치 비율을 CSV로 낸다.
 *   - 옛 v7 기록(5수준·100점)은 요약·추출에서 빠진다. 뺀 수만 보여 준다.
 *   - 개인정보 점검으로 멈춘 제출은 건수만 보인다(글은 남기지 않는다).
 *
 * 계산과 권한은 모두 서버(src/server/admin/research-actions.ts)가 한다. 이 화면은 요청만 보낸다.
 * 학생 화면에는 나오지 않는다. 100점 점수는 어디에도 없다.
 */

import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import {
  drawSampleAction,
  exportExtractionCsvAction,
  exportRepeatScoresCsvAction,
  exportResearchCsvAction,
  exportSampleCsvAction,
  listSamplesAction,
  loadExtractionAction,
  loadResearchOverviewAction,
  rescoreSampleBatchAction,
  setExclusionAction,
  type ExtractionView,
  type ResearchCsvKind,
  type ResearchOverview,
  type SampleFileKind,
  type SampleListItem,
  type SampleView,
} from '@/server/admin/research-actions';
import { EXCLUSION_COUNT_LABEL, type ExclusionReason } from '@/server/export/practice-summary';
import { PRACTICE_QUESTIONS } from '@/lib/questions';
import { AREA_IDS, AREA_LABEL, type AreaJudgments, type AreaLevels, type AreaLevelValue } from '@/lib/scoring';
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

/** 앱 종합 수준의 값(1~4). 추출 층도 같다. */
const APP_LEVELS = [1, 2, 3, 4] as const;

const EXCLUSION_LABEL: Record<ExclusionReason, string> = {
  irrelevant: '무관한 내용',
  personal_info: '개인정보 포함',
};

function titleOf(questionId: string): string {
  const q = PRACTICE_QUESTIONS.find((p) => `L${String(p.level).padStart(2, '0')}` === questionId);
  return q ? q.koreanTitle : questionId;
}

/** 영역 수준 한 칸. 연구 화면이라 해당 없음도 드러내 보인다(학생 화면은 숨긴다). */
function levelText(v: AreaLevelValue | null | undefined): string {
  if (v === null || v === undefined) return '결측';
  return v === 'not_applicable' ? '해당 없음' : String(v);
}

/** 영역별 수준을 한 줄로: '대상 2 · 특징 3 · 관계 해당 없음' */
function levelsText(levels: AreaLevels | null): string {
  if (!levels) return '결측';
  return AREA_IDS.map((a) => `${AREA_LABEL[a]} ${levelText(levels[a])}`).join(' · ');
}

/** 영역별 첫→최종: '대상 1→3' */
function areaChange(first: AreaLevels | null, final: AreaLevels | null) {
  return AREA_IDS.map((a) => ({
    area: a,
    text: `${AREA_LABEL[a]} ${levelText(first?.[a])}→${levelText(final?.[a])}`,
  }));
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

  const [perLevel, setPerLevel] = useState('5');
  const [seed, setSeed] = useState(defaultSeed);
  const [sample, setSample] = useState<SampleView | null>(null);
  const [samples, setSamples] = useState<SampleListItem[]>([]);
  /** 반복 채점 진행('S-…|2' → '12/60') */
  const [repeatRunning, setRepeatRunning] = useState<string | null>(null);

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
    if (data) {
      setOverview(data);
      // 대표 문항 설정값(RESEARCH_SAMPLE_QUESTIONS)이 있으면 아직 아무것도 고르지 않았을 때 미리 고른다.
      setPicked((prev) => (prev.length === 0 && data.representativeQuestions.length ? data.representativeQuestions : prev));
    }
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
      for (const f of data.files) downloadCsv(f.filename, f.csv);
      void loadSamples();
    }
  };

  const downloadSampleFile = async (sampleId: string, kind: SampleFileKind) => {
    const file = await call(() => exportSampleCsvAction(sampleId, kind));
    if (file) downloadCsv(file.filename, file.csv);
  };

  /** 2·3회차 반복 채점. 서버 함수 시간 제한 때문에 사례 하나씩 이어 부른다. */
  const runRepeat = async (sampleId: string, repeatIndex: 2 | 3) => {
    setRepeatRunning(`${sampleId}|${repeatIndex}|…`);
    try {
      for (;;) {
        const res = await rescoreSampleBatchAction({ sampleId, repeatIndex, limit: 1 });
        if (!res.ok) {
          if (res.signedOut) onSignedOut();
          toast({ variant: 'destructive', title: '반복 채점을 멈췄습니다', description: res.error });
          break;
        }
        setRepeatRunning(`${sampleId}|${repeatIndex}|${res.data.done}/${res.data.total}`);
        if (res.data.done >= res.data.total || res.data.scoredNow + res.data.skippedNow === 0) {
          toast({ title: `${repeatIndex}회차 반복 채점을 마쳤습니다`, description: `${res.data.done}/${res.data.total}` });
          break;
        }
      }
    } catch {
      toast({ variant: 'destructive', title: '반복 채점을 멈췄습니다', description: '잠시 뒤 이어서 해 주세요. 이미 채점한 사례는 다시 부르지 않습니다.' });
    } finally {
      setRepeatRunning(null);
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
              <div className="grid grid-cols-2 gap-3 md:grid-cols-6">
                {[
                  { label: '시도(v12-2)', value: `${overview.attemptCount}건` },
                  { label: '학생', value: `${overview.studentCount}명` },
                  { label: '동의 없음·철회로 뺀 학생', value: `${overview.consentExcludedStudents}명` },
                  { label: '옛 기록(v7)으로 뺀 시도', value: `${overview.legacyAttemptCount}건` },
                  { label: '개인정보 점검으로 멈춘 제출', value: `${overview.privacyHoldCount}건` },
                  { label: '고른 문항', value: `${picked.length}/3` },
                ].map((t) => (
                  <div key={t.label} className="rounded-xl bg-muted/50 p-4">
                    <div className="text-xs text-muted-foreground">{t.label}</div>
                    <div className="text-2xl font-black tabular-nums">{t.value}</div>
                  </div>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">
                루브릭 {overview.rubricVersion}(대상·특징·관계 3영역 4수준). {overview.appLevelRule} 결측(채점 못 함)은
                분포·평균에 넣지 않고 따로 셉니다. 영역 평균은 해당 없음을 빼고 계산하며 반올림하지 않습니다.
              </p>
              {overview.legacyAttemptCount > 0 && (
                <p className="text-xs text-amber-700">
                  옛 기준(v7, 5수준·100점)으로 채점된 시도 {overview.legacyAttemptCount}건은 요약과 추출에서
                  뺐습니다. 시도별 CSV에는 legacy_rubric=true와 옛 값(v7_* 열)으로 남아 있습니다.
                </p>
              )}
              {overview.representativeProblem && (
                <p className="text-xs text-amber-700">{overview.representativeProblem}</p>
              )}
              {overview.representativeQuestions.length === 0 && !overview.representativeProblem && (
                <p className="text-xs text-muted-foreground">
                  대표 사진(A·B·C밴드 하나씩)은 아직 정하지 않았습니다(설정값 RESEARCH_SAMPLE_QUESTIONS 비어 있음). 아래
                  표에서 직접 고르세요.
                </p>
              )}
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
                      <TableHead className="text-right">단계</TableHead>
                      <TableHead>밴드</TableHead>
                      <TableHead className="text-right">학생</TableHead>
                      <TableHead className="text-right">평균 시도</TableHead>
                      {APP_LEVELS.map((n) => (
                        <TableHead key={n} className="text-right">종합 {n}수준</TableHead>
                      ))}
                      {AREA_IDS.map((a) => (
                        <TableHead key={a} className="text-right">{AREA_LABEL[a]} 평균</TableHead>
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
                          <TableCell className="text-right tabular-nums">{q.chasi ?? '-'}</TableCell>
                          <TableCell>{q.band}</TableCell>
                          <TableCell className="text-right tabular-nums">{q.students}</TableCell>
                          <TableCell className="text-right tabular-nums">
                            {q.meanAttempts === null ? '-' : q.meanAttempts.toFixed(2)}
                          </TableCell>
                          {q.finalLevelCounts.map((c, i) => (
                            <TableCell key={i} className="text-right tabular-nums">{c || '·'}</TableCell>
                          ))}
                          {AREA_IDS.map((a) => {
                            const mean = q.finalAreaMeans[a];
                            const na = q.finalAreaNotApplicable[a];
                            return (
                              <TableCell key={a} className="text-right tabular-nums">
                                {mean === null ? '-' : mean.toFixed(2)}
                                {na > 0 && (
                                  <span className="ml-1 text-[10px] text-muted-foreground" title="해당 없음으로 판정된 학생 수">
                                    (해당 없음 {na})
                                  </span>
                                )}
                              </TableCell>
                            );
                          })}
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
            빠지고, 사유는 지우지 않고 기록으로 남습니다. 제외 뒤 앱 종합 4수준별로 문항마다 n개(기본 5)를
            고정 시드로 뽑아 사례 ID(예: 01-31 = L01의 종합 3수준 첫째)를 붙입니다. 옛 기준(v7)으로 채점된
            시도는 후보에 들지 않습니다.
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
            {picked.length > 0 && (bandsPicked.size < picked.length || picked.length < 3) && (
              <span className="text-xs text-amber-700">
                논문 절차는 A·B·C밴드에서 한 문항씩입니다. 지금 고른 문항은 그렇지 않습니다(추출은 막지 않습니다).
              </span>
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
              {extraction.bandWarning && <p className="text-xs text-amber-700">{extraction.bandWarning}</p>}
              <p className="text-sm text-muted-foreground">
                후보 {extraction.rows.length}행 · 제외 {excludedCount}행 · 동의 없음·철회로 뺀 학생{' '}
                {extraction.consentExcludedStudents}명 · 옛 기록(v7)으로 뺀 시도 {extraction.legacyAttemptCount}건.
                행을 누르면 첫·최종 프롬프트, 영역별 근거·빠진 정보, 피드백을 봅니다.
              </p>
              <div className="max-h-[560px] overflow-auto rounded-lg border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>문항</TableHead>
                      <TableHead>연구ID</TableHead>
                      <TableHead className="text-right">시도</TableHead>
                      <TableHead className="text-right">종합 첫→최종</TableHead>
                      <TableHead>영역 첫→최종</TableHead>
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
                            <TableCell className="whitespace-nowrap text-xs tabular-nums">
                              {areaChange(r.firstLevels, r.finalLevels).map((c) => (
                                <div key={c.area}>{c.text}</div>
                              ))}
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
                              <TableCell colSpan={8} className="space-y-2 p-4 text-sm">
                                <p>
                                  <strong>첫 프롬프트</strong> (종합 {r.firstAppLevel ?? '결측'} · {levelsText(r.firstLevels)}):{' '}
                                  <span className="whitespace-pre-wrap">{r.firstPrompt}</span>
                                </p>
                                <p>
                                  <strong>최종 프롬프트</strong> (종합 {r.finalAppLevel ?? '결측'}
                                  {r.finalAppLevelRaw !== null ? `, 평균 ${r.finalAppLevelRaw.toFixed(2)}` : ''} ·{' '}
                                  {levelsText(r.finalLevels)}):{' '}
                                  <span className="whitespace-pre-wrap">{r.finalPrompt}</span>
                                </p>
                                <FinalAreaDetails areas={r.finalAreas} />
                                {r.legacyAttemptCount > 0 && (
                                  <p className="text-xs text-amber-700">
                                    이 학생의 이 문항 시도 가운데 옛 기준(v7) {r.legacyAttemptCount}건은 요약에서 뺐습니다.
                                  </p>
                                )}
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
                  <p className="text-[11px] text-muted-foreground">종합 1~4수준마다(기본 5)</p>
                </div>
                <div className="space-y-1">
                  <Label htmlFor="seed">시드</Label>
                  <div className="flex gap-2">
                    <Input id="seed" value={seed} onChange={(e) => setSeed(e.target.value)} className="w-56 font-mono text-xs" />
                    <Button variant="ghost" size="sm" onClick={() => setSeed(defaultSeed())}>새 시드</Button>
                  </div>
                </div>
                <Button disabled={busy} onClick={() => void draw()} className="ml-auto">
                  <Shuffle className="mr-2 h-4 w-4" /> 추출하고 CSV 세 개 받기
                </Button>
                <p className="w-full text-xs text-muted-foreground">
                  같은 시드·같은 후보면 같은 결과가 나옵니다. 시드와 후보 목록, 제외 목록, 뽑힌 사례를 함께 저장합니다.
                  후보가 모자란 층은 있는 만큼만 뽑고 다른 층에서 채우지 않습니다(부족분으로 남깁니다).
                  파일은 셋입니다: 전문가용(새 사례번호·사진ID·학생 문장만, 앱 판정 없음), 연구자용(전문가용 번호 대응표 +
                  앱 판정), 뺀 수와 사유(무관한 내용·개인정보·동의 없음·최종 결측).
                </p>
              </div>
            </>
          )}

          {sample && (
            <div className="space-y-3 rounded-xl border p-4">
              <p className="text-sm">
                <strong>{sample.sampleId}</strong> · 시드 <code>{sample.seed}</code> · 사례 {sample.cases.length}개 ·
                제외 {sample.excludedCount}행 · 결측으로 빠진 {sample.unlevelledCount}행 · 옛 기록(v7)으로 뺀 시도{' '}
                {sample.legacyAttemptCount}건
              </p>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>문항</TableHead>
                      {APP_LEVELS.map((n) => (
                        <TableHead key={n} className="text-center">종합 {n}수준 (뽑힘/후보)</TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {sample.questionIds.map((qid) => (
                      <TableRow key={qid}>
                        <TableCell className="font-mono text-xs">{qid}</TableCell>
                        {APP_LEVELS.map((lv) => {
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
              {sample.bandWarning && <p className="text-xs text-amber-700">{sample.bandWarning}</p>}
              <p className="text-xs text-muted-foreground">
                뺀 수:{' '}
                {sample.questionIds
                  .map((qid) =>
                    `${qid} ` +
                    sample.exclusionCounts
                      .filter((c) => c.questionId === qid && c.count > 0)
                      .map((c) => `${EXCLUSION_COUNT_LABEL[c.reason]} ${c.count}`)
                      .join(', ')
                  )
                  .join(' / ')}
              </p>
              <p className="text-xs text-muted-foreground">
                전문가에게는 전문가용 파일만 주세요. 앱 사례 ID(01-31의 “3”이 종합 수준)와 앱 판정은 연구자용 파일에만
                있습니다.
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
                    <TableHead>받기</TableHead>
                    <TableHead>반복 채점(2·3회차)</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {samples.map((s) => (
                    <TableRow key={s.sampleId}>
                      <TableCell className="font-mono text-xs">
                        {s.sampleId}
                        {s.legacy && (
                          <Badge variant="outline" className="ml-1 text-[10px]" title="옛 앱 AI 5수준(v7 100점 환산) 층으로 뽑은 추출 — 내보내지 않습니다">
                            옛 5수준
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="font-mono text-xs">{s.seed}</TableCell>
                      <TableCell className="text-xs">{s.questionIds.join(', ')}</TableCell>
                      <TableCell className="text-right tabular-nums">{s.perLevel}</TableCell>
                      <TableCell className="text-right tabular-nums">{s.caseCount}</TableCell>
                      <TableCell className="text-right tabular-nums">{s.shortfall}</TableCell>
                      <TableCell>
                        {s.legacy ? (
                          <span className="text-xs text-muted-foreground">내보내지 않음</span>
                        ) : (
                          <div className="flex flex-wrap gap-1">
                            {(
                              [
                                ['expert', '전문가용'],
                                ['researcher', '연구자용'],
                                ['exclusions', '뺀 수'],
                              ] as const
                            ).map(([kind, label]) => (
                              <Button key={kind} size="sm" variant="outline" disabled={busy} onClick={() => void downloadSampleFile(s.sampleId, kind)}>
                                <Download className="mr-1 h-3 w-3" /> {label}
                              </Button>
                            ))}
                          </div>
                        )}
                      </TableCell>
                      <TableCell>
                        {!s.legacy && (
                          <div className="flex flex-wrap items-center gap-1">
                            {([2, 3] as const).map((n) => {
                              const running = repeatRunning?.startsWith(`${s.sampleId}|${n}|`);
                              return (
                                <Button
                                  key={n}
                                  size="sm"
                                  variant="outline"
                                  disabled={busy || repeatRunning !== null || s.repeatDone[n] >= s.caseCount}
                                  onClick={() => void runRepeat(s.sampleId, n)}
                                  title="운영 채점기와 같은 설정으로 다시 채점해 따로 저장합니다. 1회차(주 자료)는 바꾸지 않습니다."
                                >
                                  {running ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : null}
                                  {n}회차 {running ? repeatRunning!.split('|')[2] : `${s.repeatDone[n]}/${s.caseCount}`}
                                </Button>
                              );
                            })}
                            <Button size="sm" variant="ghost" disabled={busy} onClick={async () => {
                              const file = await call(() => exportRepeatScoresCsvAction({ sampleId: s.sampleId, kind: 'cases' }));
                              if (file) downloadCsv(file.filename, file.csv);
                            }}>
                              <Download className="mr-1 h-3 w-3" /> 회차별
                            </Button>
                            <Button size="sm" variant="ghost" disabled={busy} onClick={async () => {
                              const file = await call(() => exportRepeatScoresCsvAction({ sampleId: s.sampleId, kind: 'agreement' }));
                              if (file) downloadCsv(file.filename, file.csv);
                            }}>
                              <Download className="mr-1 h-3 w-3" /> 일치 비율
                            </Button>
                          </div>
                        )}
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

/** 최종 시도의 영역별 근거(학생 원문)와 빠진 정보. 전문가 검토의 맥락으로 본다. */
function FinalAreaDetails({ areas }: { areas: AreaJudgments | null }) {
  if (!areas) return <p className="text-xs text-muted-foreground">최종 시도의 영역 판정: 결측(채점 못 함)</p>;
  return (
    <div>
      <strong>최종 시도의 영역 판정</strong>
      <ul className="mt-1 space-y-1 pl-1">
        {AREA_IDS.map((a) => {
          const j = areas[a];
          if (j.level === 'not_applicable') {
            return (
              <li key={a} className="text-muted-foreground">
                {AREA_LABEL[a]}: 해당 없음
              </li>
            );
          }
          return (
            <li key={a}>
              <span className="font-semibold">
                {AREA_LABEL[a]} {j.level}수준
              </span>
              {' · 근거 '}
              {j.evidence ? <q className="whitespace-pre-wrap">{j.evidence}</q> : <span className="text-muted-foreground">없음</span>}
              {' · 빠진 정보 '}
              {j.missing.length ? j.missing.join(', ') : <span className="text-muted-foreground">없음</span>}
              {j.evidenceMissing.length > 0 && (
                <span className="text-muted-foreground"> · 대상이 빠져 확인 못 함: {j.evidenceMissing.join(', ')}</span>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
