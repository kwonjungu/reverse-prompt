/**
 * 연습 화면의 순서 진행 — 순수 함수.
 *
 * 열린 단계(allowedLessons) 안에서 문항을 번호(level) 순서로 풀게 한다.
 * 관리 화면의 수업 시작이 1~6단계를 한 번에 열므로, 보통은 36문항을 1번부터 끝까지 순서대로 푼다.
 *   - 들어오면 아직 내지 않은 가장 낮은 번호 문항(진행 위치)으로 간다.
 *   - 진행 위치보다 뒤 문항은 보이지도, 고르지도 못한다. 낸 문항과 진행 위치까지만 열린다.
 *   - 단계 단추도 열린 문항이 하나라도 있는 단계만 보인다.
 *
 * 열리지 않은 단계(예전 방식으로 일부만 연 반)는 계산에 넣지 않는다.
 * 이 계산은 화면 표시다. 차시 접근 권한은 서버가 따로 판정한다.
 */

export interface ProgressQuestion {
  /** L01~L36 */
  id: string;
  /** 1~36. 순서의 기준 */
  level: number;
  /** 1~6 */
  chasi: number;
}

/** 교사가 연 단계의 문항을 번호 순서로. */
export function openQuestionsInOrder<Q extends ProgressQuestion>(
  questions: readonly Q[],
  allowedLessons: readonly number[]
): Q[] {
  const allowed = new Set(allowedLessons);
  return questions.filter((q) => allowed.has(q.chasi)).sort((a, b) => a.level - b.level);
}

/** 아직 내지 않은 가장 낮은 번호 문항. 모두 냈으면 null. */
export function progressFrontier<Q extends ProgressQuestion>(
  ordered: readonly Q[],
  submitted: ReadonlySet<string>
): Q | null {
  return ordered.find((q) => !submitted.has(q.id)) ?? null;
}

/** 이 문항을 열어 볼 수 있는가. 낸 문항이거나 진행 위치까지다. 모두 냈으면 전부 열린다. */
export function isReachable(q: ProgressQuestion, frontier: ProgressQuestion | null): boolean {
  return frontier === null || q.level <= frontier.level;
}

/** 단추를 보여 줄 단계. 열린 문항이 하나라도 있는 단계만, 번호 순서로. */
export function reachableLessons(
  ordered: readonly ProgressQuestion[],
  frontier: ProgressQuestion | null
): number[] {
  const lessons = new Set<number>();
  for (const q of ordered) if (isReachable(q, frontier)) lessons.add(q.chasi);
  return [...lessons].sort((a, b) => a - b);
}

/**
 * 들어갈 문항.
 *   - lesson을 주면(단계 단추를 누른 경우) 그 단계에서 아직 내지 않은 가장 낮은 문항,
 *     그 단계를 다 냈으면 그 단계 첫 문항. 그 단계에 열린 문항이 없으면 무시한다.
 *   - 그 밖에는 진행 위치. 모두 냈으면 fallbackLesson(서버가 정한 진입 단계)의 첫 문항.
 */
export function landingQuestion<Q extends ProgressQuestion>(
  ordered: readonly Q[],
  submitted: ReadonlySet<string>,
  opts: { lesson: number | null; fallbackLesson: number | null }
): Q | null {
  const frontier = progressFrontier(ordered, submitted);
  if (opts.lesson !== null) {
    const inLesson = ordered.filter((q) => q.chasi === opts.lesson && isReachable(q, frontier));
    if (inLesson.length) return inLesson.find((q) => !submitted.has(q.id)) ?? inLesson[0];
  }
  if (frontier) return frontier;
  return ordered.find((q) => q.chasi === opts.fallbackLesson) ?? ordered[0] ?? null;
}

/**
 * '다음 문제'. 번호 순서의 다음 문항이며 단계를 넘어갈 수 있다. 끝이면 처음으로 돈다.
 * 다음 문항이 아직 열리지 않았으면(지금 문항을 내지 못한 경우) null.
 */
export function nextQuestionInOrder<Q extends ProgressQuestion>(
  ordered: readonly Q[],
  submitted: ReadonlySet<string>,
  currentLevel: number
): Q | null {
  if (!ordered.length) return null;
  const frontier = progressFrontier(ordered, submitted);
  const at = ordered.findIndex((q) => q.level === currentLevel);
  if (at < 0) return frontier ?? ordered[0];
  const next = ordered[(at + 1) % ordered.length];
  return isReachable(next, frontier) ? next : null;
}
