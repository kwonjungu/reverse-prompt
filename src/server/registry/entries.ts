/**
 * 문항 레지스트리의 정적 메타데이터 — 단서·앵커·제작 프롬프트를 담지 않는다.
 *
 * 이 파일은 파일 시스템도 환경 변수도 읽지 않는 순수 모듈이다. 그래서
 * 'server-only'를 import 하지 않으며 순수 함수 테스트와 manifest 스크립트가
 * 그대로 불러 쓸 수 있다. 비공개 자산(검사 이미지·단서 팩)을 실제로 여는 일은
 * 같은 디렉터리의 index.ts가 맡는다.
 *
 * 검사 문항의 밴드·제한시간·해시·상태 값은 검사문항_명세_v7.json과 일치시킨다.
 * 그 JSON을 저장소에 복사하지 않고 값만 상수로 둔다. status는 명세 그대로
 * candidate이며, 전문가 확정 전에 코드가 frozen으로 올리지 않는다.
 *
 * 대응 문서: 프로그램_수정_프롬프트설계서_v7 §2, 수용시험 8
 */

import { PRACTICE_QUESTIONS } from '@/lib/questions';
import { bandOf } from '@/lib/scoring';
import type { SessionType } from '@/lib/research/types';
import type { RegistryEntry } from './contract';

/** 검사 순서. 사전·사후가 같은 파일·같은 순서를 쓴다. */
export const ASSESSMENT_ORDER = ['T1', 'T2_v7', 'T3'] as const;

/** 검사 문항 이미지의 자산 디렉터리 내 상대 경로 */
const ASSESSMENT_IMAGE_FILES: Record<string, string> = {
  T1: 'images/T1.png',
  T2_v7: 'images/T2_v7.png',
  T3: 'images/T3.png',
};

/**
 * 검사 문항 3개. 값의 출처는 검사문항_명세_v7.json이다.
 * approvedAt이 null이고 status가 candidate인 상태를 그대로 반영한다.
 * 단색 배경의 이전 T2는 T2_v7으로 대체되었으므로 표에 두지 않는다.
 */
const ASSESSMENT_ENTRIES: RegistryEntry[] = [
  {
    questionId: 'T1',
    kind: 'assessment',
    band: 'A',
    lesson: null,
    imageVersion: 'v7',
    imageSha256: 'f4734f7d626c58835c18d5c1a6f5362e7a23c9c9cd4b35b48c49971d5636755a',
    cueVersion: 'v7-candidate',
    rubricVersion: 'v7-candidate',
    status: 'candidate',
    approvedAt: null,
    allowedSessionTypes: ['research_assessment'],
    durationSeconds: 420,
    cuesLoaded: false,
  },
  {
    questionId: 'T2_v7',
    kind: 'assessment',
    band: 'B',
    lesson: null,
    imageVersion: 'v7',
    imageSha256: '629dcc35322913f73c5db308b9ab3d6ac1ce4f9b47a701ad736720307de685f7',
    cueVersion: 'v7-candidate',
    rubricVersion: 'v7-candidate',
    status: 'candidate',
    approvedAt: null,
    allowedSessionTypes: ['research_assessment'],
    durationSeconds: 480,
    cuesLoaded: false,
  },
  {
    questionId: 'T3',
    kind: 'assessment',
    band: 'C',
    lesson: null,
    imageVersion: 'v7',
    imageSha256: 'e5f3e07939c55e44ea33e4cca1f0f5a36573f62c01697a366ed29a94fbda5cb9',
    cueVersion: 'v7-candidate',
    rubricVersion: 'v7-candidate',
    status: 'candidate',
    approvedAt: null,
    allowedSessionTypes: ['research_assessment'],
    durationSeconds: 600,
    cuesLoaded: false,
  },
];

/**
 * 전문가 확정 전이라 검사 문항의 단서·루브릭 버전은 candidate 꼬리표를 단다.
 * 연습 문항의 단서도 같은 팩에서 읽으므로 같은 버전 문자열을 쓴다.
 */
const PRACTICE_CUE_VERSION = 'v7-candidate';
const PRACTICE_RUBRIC_VERSION = 'v7-candidate';

/** 연습 문항 ID는 L01~L36. 이미지 파일명과 같은 규칙을 쓴다. */
export function practiceQuestionId(level: number): string {
  return `L${String(level).padStart(2, '0')}`;
}

/**
 * 연습 문항 36개는 src/lib/questions.ts에서 파생한다.
 * 공개 학습용 이미지이므로 해시를 명세로 고정하지 않고 빈 문자열로 둔다.
 * 없는 값을 지어내지 않기 위한 것이며, 실제 해시는 loadImage가 읽을 때 계산한다.
 */
const PRACTICE_ENTRIES: RegistryEntry[] = PRACTICE_QUESTIONS.map((q) => ({
  questionId: practiceQuestionId(q.level),
  kind: 'practice',
  band: bandOf(q.level),
  lesson: q.chasi,
  imageVersion: 'v7',
  imageSha256: '',
  cueVersion: PRACTICE_CUE_VERSION,
  rubricVersion: PRACTICE_RUBRIC_VERSION,
  status: 'candidate',
  approvedAt: null,
  allowedSessionTypes: ['experience', 'research_practice'],
  durationSeconds: null,
  cuesLoaded: false,
}));

/**
 * 일반 체험 전용 문항(게임·시간 제한 모드). 연구 자료가 아니다.
 *
 * 두 모드는 처치에서 쓰지 않으므로 allowedSessionTypes를 'experience'로만 둔다.
 * 이미지는 이미 public/questions에 있는 정적 파일이며 문항별 단서를 두지 않으므로
 * 채점은 공통 루브릭 문언만으로 이루어진다. 밴드는 그림에 실제로 배경·행동·분위기가
 * 있는지를 보고 정했다. 사전 확정한 필수 단서가 없으므로 이 점수는 연구 자료로 쓰지 않는다.
 */
const EXPERIENCE_BANDS: Record<string, 'A' | 'B' | 'C'> = {
  'game-01': 'B', 'game-02': 'B', 'game-03': 'B', 'game-04': 'A', 'game-05': 'C',
  'game-06': 'C', 'game-07': 'C', 'game-08': 'C', 'game-09': 'C', 'game-10': 'C',
  'ta-01': 'C', 'ta-02': 'B', 'ta-04': 'C', 'ta-05': 'C',
  'ta-06': 'C', 'ta-07': 'C', 'ta-08': 'C',
};

const EXPERIENCE_ENTRIES: RegistryEntry[] = Object.entries(EXPERIENCE_BANDS).map(
  ([questionId, band]) => ({
    questionId,
    kind: 'practice',
    band,
    lesson: null,
    imageVersion: 'v7',
    imageSha256: '',
    cueVersion: PRACTICE_CUE_VERSION,
    rubricVersion: PRACTICE_RUBRIC_VERSION,
    status: 'candidate',
    approvedAt: null,
    allowedSessionTypes: ['experience'],
    durationSeconds: null,
    cuesLoaded: false,
  }),
);

/** 체험 문항의 학생용 안내. 문항별 정답 단서가 아니라 일반 안내다. */
const EXPERIENCE_INSTRUCTION =
  '그림에 있는 것을 그대로 설명해 봐요. 무엇이 있는지, 어떻게 생겼는지, 어디에서 무엇을 하는지 써 보세요.';

/** questionId → 기본 항목. cuesLoaded는 단서 팩을 확인한 뒤 index.ts가 채운다. */
const BASE_ENTRIES: ReadonlyMap<string, RegistryEntry> = new Map(
  [...ASSESSMENT_ENTRIES, ...PRACTICE_ENTRIES, ...EXPERIENCE_ENTRIES].map((e) => [e.questionId, e]),
);

function copyEntry(entry: RegistryEntry): RegistryEntry {
  return { ...entry, allowedSessionTypes: [...entry.allowedSessionTypes] };
}

/** 등록된 전체 항목의 복사본 */
export function baseEntries(): RegistryEntry[] {
  return [...BASE_ENTRIES.values()].map(copyEntry);
}

/** 검사 문항만, 명세가 정한 순서대로 */
export function assessmentBaseEntries(): RegistryEntry[] {
  return ASSESSMENT_ORDER.map((id) => copyEntry(BASE_ENTRIES.get(id) as RegistryEntry));
}

/** 등록되지 않은 ID이면 null. 반환값은 복사본이라 호출자가 고쳐도 표가 바뀌지 않는다. */
export function findBaseEntry(questionId: string): RegistryEntry | null {
  const found = BASE_ENTRIES.get(questionId);
  return found ? copyEntry(found) : null;
}

export function isSessionTypeAllowed(entry: RegistryEntry, sessionType: SessionType): boolean {
  return entry.allowedSessionTypes.includes(sessionType);
}

/** 검사 문항의 자산 디렉터리 내 상대 경로. 연습 문항은 공개 경로를 쓰므로 null. */
export function assessmentImageFile(questionId: string): string | null {
  return ASSESSMENT_IMAGE_FILES[questionId] ?? null;
}

/** 연습 문항의 공개 이미지 경로. 검사 문항은 공개 경로로 서빙하지 않으므로 null. */
export function practiceImagePath(entry: RegistryEntry): string | null {
  if (entry.kind !== 'practice') return null;
  return `/questions/${entry.questionId}.jpg`;
}

/** 검사 이미지는 인증 스트리밍 경로로만 내려보낸다. */
export function assessmentImageUrl(questionId: string): string {
  return `/api/research/asset/${encodeURIComponent(questionId)}`;
}

/** 연습 문항의 차시별 학생 안내. questions.ts의 공개 문구를 그대로 쓴다. */
const PRACTICE_INSTRUCTIONS: Record<string, string> = Object.fromEntries(
  PRACTICE_QUESTIONS.map((q) => [practiceQuestionId(q.level), q.rubric]),
);

export function practiceInstruction(questionId: string): string {
  return PRACTICE_INSTRUCTIONS[questionId] ?? EXPERIENCE_INSTRUCTION;
}

/**
 * 검사 문항의 학생용 일반 안내. 문항 제목·단서 목록·앵커·점수를 담지 않는다.
 * 세 문항이 같은 문구를 쓴다(설계서 §5의 동일한 일반 안내).
 */
export const ASSESSMENT_INSTRUCTION =
  '그림을 보고, 무엇이 있고 어떻게 보이는지 자세히 써 봐요.\n\n' +
  '다 썼으면 제출을 눌러요. 제출한 뒤에는 고칠 수 없어요.';

/* ────────────────────────── 연구 시작 가능 여부 ────────────────────────── */

/**
 * readiness 판정에 필요한 바깥 상태. 코드가 만들어 낼 수 없는 값은
 * 호출자가 실제로 확인한 것만 넘긴다. 여기서 기본값으로 채우지 않는다.
 */
export interface ReadinessInput {
  /** src/server/config.ts의 RESEARCH_ASSET_DIR */
  researchAssetDir: string;
  /** src/server/config.ts의 CONSENT_VERSION */
  consentVersion: string;
  /** src/server/config.ts의 IRB_APPROVAL */
  irbApproval: string;
  /** src/server/config.ts의 MODEL_ACCESS_VERIFIED */
  modelAccessVerified: boolean;
  /** 비공개 단서 팩 파일을 읽어 해석하는 데 성공했는가 */
  cuePackLoaded: boolean;
  /**
   * 적재한 팩이 스스로 cueVersion을 밝혔는가.
   * 밝히지 않으면 채점 기록의 단서 버전이 코드 상수로 남아 어떤 단서로 채점했는지
   * 뒤에 확인할 수 없다. 값을 지어내지 않고 미확정 사유로 남긴다.
   */
  cuePackVersion?: string | null;
  /** 단서가 없거나 필수 항목이 빈 검사 문항 ID */
  assessmentCuesMissing: string[];
  /** 자산 디렉터리에서 파일을 찾지 못한 검사 문항 ID */
  assessmentImagesMissing: string[];
  /** 파일은 있으나 SHA-256이 명세와 다른 검사 문항 ID */
  assessmentImageHashMismatch: string[];
}

/**
 * 연구 시작을 막는 사유를 모은다. 하나라도 있으면 researchReady=false다.
 * 승인·계약·전문가 확정처럼 코드가 만들어 낼 수 없는 값은 누락 상태 그대로 남긴다.
 */
export function collectBlockers(input: ReadinessInput): string[] {
  const blockers: string[] = [];

  if (!input.researchAssetDir) {
    blockers.push('RESEARCH_ASSET_DIR이 설정되지 않아 비공개 연구 자산을 열 수 없습니다.');
  }
  if (!input.consentVersion) {
    blockers.push('CONSENT_VERSION이 설정되지 않아 연구 동의 버전을 확정할 수 없습니다.');
  }
  if (!input.irbApproval) {
    blockers.push('IRB_APPROVAL이 비어 있습니다. 승인 번호는 코드가 만들어 낼 수 없습니다.');
  }
  if (!input.modelAccessVerified) {
    blockers.push('모델 접근·출력 스키마 확인 기록(EVALUATION_MODEL_VERIFIED)이 없습니다.');
  }
  if (!input.cuePackLoaded) {
    blockers.push('비공개 단서 팩(cue-pack.json)을 적재하지 못했습니다.');
  } else if (input.cuePackVersion !== undefined && !input.cuePackVersion) {
    blockers.push(
      '단서 팩이 cueVersion을 밝히지 않았습니다. 어떤 단서로 채점했는지 기록할 수 없습니다.',
    );
  }
  if (input.assessmentCuesMissing.length) {
    blockers.push(`검사 문항 단서가 비어 있습니다: ${input.assessmentCuesMissing.join(', ')}`);
  }
  if (input.assessmentImagesMissing.length) {
    blockers.push(`검사 이미지 파일을 찾지 못했습니다: ${input.assessmentImagesMissing.join(', ')}`);
  }
  if (input.assessmentImageHashMismatch.length) {
    blockers.push(
      `검사 이미지 SHA-256이 명세와 다릅니다: ${input.assessmentImageHashMismatch.join(', ')}`,
    );
  }

  const candidates = ASSESSMENT_ENTRIES.filter((e) => e.status !== 'frozen').map((e) => e.questionId);
  if (candidates.length) {
    blockers.push(
      `검사 문항이 전문가 확정 전 candidate 상태입니다: ${candidates.join(', ')}. ` +
        '전문가 검토와 예비 채점 기록 없이 frozen으로 올리지 않습니다.',
    );
  }
  const notApproved = ASSESSMENT_ENTRIES.filter((e) => !e.approvedAt).map((e) => e.questionId);
  if (notApproved.length) {
    blockers.push(`검사 문항 확정일(approvedAt)이 비어 있습니다: ${notApproved.join(', ')}`);
  }

  return blockers;
}
