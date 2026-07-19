/**
 * 경험치(XP)·레벨(칭호) 시스템 단일 진실.
 *
 * XP 획득 규칙:
 *  - 게임/타임어택: 문제당 score를 그대로 합산.
 *  - 연습: Math.round(score / 2) — 무한 반복 어뷰징 완화.
 *
 * Firestore 저장 위치: classes/{classCode}/students/{attendanceNumber}
 *  { xp: increment(획득량), updatedAt: serverTimestamp() } (merge: true)
 */

export interface Title {
  /** 이 칭호를 얻기 시작하는 누적 XP (구간 하한, 포함) */
  minXp: number;
  /** 칭호 이름 (이모지 포함) */
  name: string;
}

/**
 * 칭호 테이블 (누적 XP 구간). minXp 오름차순으로 정렬되어 있어야 한다.
 */
export const TITLES: Title[] = [
  { minXp: 0, name: '프롬프트 견습생 🌱' },
  { minXp: 500, name: '프롬프트 수련생 ✏️' },
  { minXp: 1500, name: '프롬프트 마법사 🪄' },
  { minXp: 3000, name: '프롬프트 대마법사 🔮' },
  { minXp: 5000, name: '프롬프트 마스터 👑' },
];

/**
 * 연습 1회 채점 점수를 XP로 변환 (절반).
 */
export function practiceXp(score: number): number {
  return Math.round(score / 2);
}

/**
 * 게임/타임어택 세션 결과의 총 XP (문제당 score 그대로 합산).
 */
export function sessionXp(scores: number[]): number {
  return scores.reduce((sum, s) => sum + s, 0);
}

/**
 * 누적 XP에 해당하는 현재 칭호를 반환.
 * xp가 음수이거나 비정상이어도 최소 칭호를 반환 (방어적).
 */
export function getTitle(xp: number): Title {
  const safeXp = Number.isFinite(xp) ? xp : 0;
  let current = TITLES[0];
  for (const title of TITLES) {
    if (safeXp >= title.minXp) {
      current = title;
    } else {
      break;
    }
  }
  return current;
}

export interface NextLevelInfo {
  /** 다음 칭호 이름 */
  nextTitle: string;
  /** 다음 칭호까지 남은 XP */
  remaining: number;
  /** 현재 구간 내 진행률 0~100 (정수 반올림) */
  progressPercent: number;
}

/**
 * 다음 레벨까지의 정보를 반환. 이미 마지막 레벨이면 null.
 * progressPercent는 "현재 칭호 하한 → 다음 칭호 하한" 구간 내 진행률.
 */
export function getNextLevelInfo(xp: number): NextLevelInfo | null {
  const safeXp = Number.isFinite(xp) && xp > 0 ? xp : 0;
  // 현재 칭호 인덱스 찾기
  let currentIndex = 0;
  for (let i = 0; i < TITLES.length; i++) {
    if (safeXp >= TITLES[i].minXp) {
      currentIndex = i;
    } else {
      break;
    }
  }

  const nextIndex = currentIndex + 1;
  if (nextIndex >= TITLES.length) {
    return null; // 마지막 레벨 (마스터)
  }

  const currentMin = TITLES[currentIndex].minXp;
  const nextMin = TITLES[nextIndex].minXp;
  const span = nextMin - currentMin;
  const gained = safeXp - currentMin;
  const remaining = Math.max(0, nextMin - safeXp);
  const progressPercent = span > 0 ? Math.min(100, Math.round((gained / span) * 100)) : 0;

  return {
    nextTitle: TITLES[nextIndex].name,
    remaining,
    progressPercent,
  };
}
