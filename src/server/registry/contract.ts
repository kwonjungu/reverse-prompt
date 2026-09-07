import 'server-only';

/**
 * 문항 레지스트리 계약. 구현은 src/server/registry/index.ts에 둔다.
 *
 * 검사 이미지·문항별 단서·앵커는 공개 번들·public 경로·익명 요청에 노출하지 않는다.
 * 따라서 이 모듈은 서버 전용이며, 클라이언트에는 PublicQuestionView만 내보낸다.
 *
 * 대응 문서: 프로그램_수정_프롬프트설계서_v7 §2
 */

import type { Band } from '@/lib/scoring';
import type { QuestionKind, RegistryStatus, SessionType } from '@/lib/research/types';

/** 학생 화면에 내려보내도 되는 정보만 담는다. 단서·앵커·제작 프롬프트 금지. */
export interface PublicQuestionView {
  questionId: string;
  kind: QuestionKind;
  lesson: number | null;
  /** 인증된 경로로만 실제 이미지를 받는다. */
  imageUrl: string;
  /** 검사 문항의 제한 시간(초). 연습 문항은 null. */
  durationSeconds: number | null;
  /** 학생용 일반 안내. 정답 단서가 아니다. */
  instruction: string;
}

/** 문항별 채점 단서. 서버 밖으로 내보내지 않는다. */
export interface QuestionCues {
  /** 핵심 대상 목록 */
  coreObjects: string[];
  /** 필수 속성 목록 */
  requiredAttributes: string[];
  /** 필수 맥락 단서 목록. A밴드는 빈 배열. */
  requiredContext: string[];
  /** 허용 표현·동의어 */
  acceptedExpressions: string[];
  /** 필수로 요구하지 않는 항목 */
  notRequired: string[];
  /** 모순 예 */
  contradictions: string[];
  /** 축별 수준 경계와 앵커. key: 'object' | 'specificity' | 'context' */
  anchors: Record<string, Record<string, string>>;
}

export interface RegistryEntry {
  questionId: string;
  kind: QuestionKind;
  band: Band;
  lesson: number | null;
  imageVersion: string;
  imageSha256: string;
  cueVersion: string;
  rubricVersion: string;
  status: RegistryStatus;
  approvedAt: string | null;
  allowedSessionTypes: SessionType[];
  durationSeconds: number | null;
  /** 단서가 실제로 작성·적재되었는지. 미작성 문항을 채점에 통과시키지 않는다. */
  cuesLoaded: boolean;
}

export class RegistryError extends Error {
  constructor(
    message: string,
    readonly code: 'unknown_question' | 'not_allowed' | 'cues_missing' | 'asset_missing',
  ) {
    super(message);
    this.name = 'RegistryError';
  }
}

export interface RegistryApi {
  /** 등록되지 않은 questionId는 거부한다. */
  getEntry(questionId: string): RegistryEntry;
  /** 세션 성격에서 쓸 수 있는 문항인지 확인하고 반환한다. */
  requireEntry(questionId: string, sessionType: SessionType): RegistryEntry;
  /** 채점에 쓸 단서. 미작성이면 RegistryError('cues_missing'). */
  getCues(questionId: string): QuestionCues;
  /** 실제 이미지 바이트. 서명·인증 경로에서만 호출한다. */
  loadImage(questionId: string): Promise<{ bytes: Buffer; contentType: string; sha256: string }>;
  /** 학생 화면에 내려보낼 정보 */
  toPublicView(entry: RegistryEntry): PublicQuestionView;
  /** 검사 순서 T1 → T2_v7 → T3 */
  assessmentOrder(): string[];
  /** 연구 시작 가능 여부와 막는 사유 */
  readiness(): { researchReady: boolean; blockers: string[] };
}
