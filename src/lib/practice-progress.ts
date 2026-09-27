/**
 * 연습 화면의 순서 진행 — 순수 함수.
 *
 * 열린 단계(allowedLessons) 안에서 문항을 제시 순서(order)대로 풀게 한다. 문항 번호(level) 순서가 아니다.
 * 논문 v12의 6단계 배치에서 3단계(특징)는 L19–L24, 4단계(관계)는 L13–L18이므로
 * L12 다음은 L19, L24 다음은 L13, L18 다음은 L25다. 제시 순서의 정의는 src/lib/stages.ts 하나에 있다.
 *
 * 관리 화면의 수업 시작이 1~6단계를 한 번에 열므로, 보통은 36문항을 제시 순서의 처음부터 끝까지 푼다.
 *   - 들어오면 아직 내지 않은 제시 순서상 가장 앞 문항(진행 위치)으로 간다.
 *   - 진행 위치보다 뒤 문항은 보이지도, 고르지도 못한다. 낸 문항과 진행 위치까지만 열린다.
 *   - 단계 단추도 열린 문항이 하나라도 있는 단계만 보인다.
 *
 * 열리지 않은 단계(예전 방식으로 일부만 연 반)는 계산에 넣지 않는다.
 * 이 계산은 화면 표시다. 차시 접근 권한은 서버가 따로 판정한다.
 */

export interface ProgressQuestion {
  /** L01~L36 */
  id: string;
  /** 1~36. 문항 번호(문항 ID·밴드의 기준). 순서의 기준이 아니다. */
  level: number;
  /** 1~6 */
  chasi: number;
  /** 1~36. 제시 순서. 진행의 기준이다(src/lib/stages.ts의 presentationOrderOf). */
  order: number;
}

/** 교사가 연 단계의 문항을 제시 순서대로. */
export function openQuestionsInOrder<Q extends ProgressQuestion>(
  questions: readonly Q[],
  allowedLessons: readonly number[]
): Q[] {
  const allowed = new Set(allowedLessons);
  return questions.filter((q) => allowed.has(q.chasi)).sort((a, b) => a.order - b.order);
}

/** 아직 내지 않은 제시 순서상 가장 앞 문항. 모두 냈으면 null. */
export function progressFrontier<Q extends ProgressQuestion>(
  ordered: readonly Q[],
  submitted: ReadonlySet<string>
): Q | null {
  let frontier: Q | null = null;
  for (const q of ordered) {
    if (submitted.has(q.id)) continue;
    if (frontier === null || q.order < frontier.order) frontier = q;
  }
  return frontier;
}

/** 이 문항을 열어 볼 수 있는가. 낸 문항이거나 진행 위치까지다. 모두 냈으면 전부 열린다. */
export function isReachable(q: ProgressQuestion, frontier: ProgressQuestion | null): boolean {
  return frontier === null || q.order <= frontier.order;
}

/** 단추를 보여 줄 단계. 열린 문항이 하나라도 있는 단계만, 단계 번호 순서로. */
export function reachableLessons(
  ordered: readonly ProgressQuestion[],
  frontier: ProgressQuestion | null
): number[] {
  const lessons = new Set<number>();
  for (const q of ordered) if (isReachable(q, frontier)) lessons.add(q.chasi);
  return [...lessons].sort((a, b) => a - b);
}

/** 제시 순서로 정렬한 사본. 호출하는 쪽이 정렬하지 않은 목록을 넘겨도 같은 답을 낸다. */
function byOrder<Q extends ProgressQuestion>(questions: readonly Q[]): Q[] {
  return [...questions].sort((a, b) => a.order - b.order);
}

/**
 * 들어갈 문항.
 *   - lesson을 주면(단계 단추를 누른 경우) 그 단계에서 아직 내지 않은 제시 순서상 가장 앞 문항,
 *     그 단계를 다 냈으면 그 단계 첫 문항. 그 단계에 열린 문항이 없으면 무시한다.
 *   - 그 밖에는 진행 위치. 모두 냈으면 fallbackLesson(서버가 정한 진입 단계)의 첫 문항.
 */
export function landingQuestion<Q extends ProgressQuestion>(
  ordered: readonly Q[],
  submitted: ReadonlySet<string>,
  opts: { lesson: number | null; fallbackLesson: number | null }
): Q | null {
  const sorted = byOrder(ordered);
  const frontier = progressFrontier(sorted, submitted);
  if (opts.lesson !== null) {
    const inLesson = sorted.filter((q) => q.chasi === opts.lesson && isReachable(q, frontier));
    if (inLesson.length) return inLesson.find((q) => !submitted.has(q.id)) ?? inLesson[0];
  }
  if (frontier) return frontier;
  return sorted.find((q) => q.chasi === opts.fallbackLesson) ?? sorted[0] ?? null;
}

/**
 * '다음 문제'. 제시 순서의 다음 문항이며 단계를 넘어갈 수 있다. 끝이면 처음으로 돈다.
 * currentLevel은 지금 문항의 번호(level)다. 위치는 번호로 찾고, 다음은 제시 순서로 정한다.
 * 다음 문항이 아직 열리지 않았으면(지금 문항을 내지 못한 경우) null.
 */
export function nextQuestionInOrder<Q extends ProgressQuestion>(
  ordered: readonly Q[],
  submitted: ReadonlySet<string>,
  currentLevel: number
): Q | null {
  if (!ordered.length) return null;
  const sorted = byOrder(ordered);
  const frontier = progressFrontier(sorted, submitted);
  const at = sorted.findIndex((q) => q.level === currentLevel);
  if (at < 0) return frontier ?? sorted[0];
  const next = sorted[(at + 1) % sorted.length];
  return isReachable(next, frontier) ? next : null;
}

/**
 * 이 제출이 제시 순서를 건너뛴 것인가(99-1 B3). 서버가 제출을 받을 때 막지 않고 기록만 한다.
 * 이미 낸 문항을 다시 내는 것(고쳐 쓰기)은 건너뛴 것이 아니다. 진행 위치보다 뒤이면서 아직 내지 않은 문항이면 true.
 * 열린 단계에 없는 문항은 판정하지 않는다(false) — 그런 제출은 차시 판정에서 따로 막힌다.
 */
export function isOutOfOrderSubmission(
  questions: readonly ProgressQuestion[],
  allowedLessons: readonly number[],
  submitted: ReadonlySet<string>,
  questionId: string
): boolean {
  if (submitted.has(questionId)) return false;
  const ordered = openQuestionsInOrder(questions, allowedLessons);
  const q = ordered.find((x) => x.id === questionId);
  if (!q) return false;
  const frontier = progressFrontier(ordered, submitted);
  return !isReachable(q, frontier);
}
