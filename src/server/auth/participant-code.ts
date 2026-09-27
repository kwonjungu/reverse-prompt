/**
 * 연구 참가코드의 해시와 입력 정리 — 학생 입장(대조)과 관리 화면(발급)이 함께 쓰는 단일 지점.
 *
 * 참가코드는 원문을 저장하지 않는다. research_classes/{수업ID}/participants/{연구ID}.codeHash에
 * PARTICIPANT_CODE_PEPPER와 함께 만든 SHA-256만 남긴다. 해시 방식을 여기 하나로 두어
 * 발급과 대조가 다른 계산을 쓰는 일이 없게 한다.
 *
 * 이 파일은 'server-only'를 import 하지 않는다. node:crypto만 쓰는 순수 모듈이라
 * 테스트에서 그대로 불러 쓴다. pepper는 인자로 받는다(읽는 함수만 따로 둔다).
 */

import { createHash } from 'node:crypto';

/**
 * 참가코드 글자. 헷갈리는 0·O·1·I를 뺀 32자다.
 * 학생이 소문자로 적거나 사이에 '-'·빈칸을 넣어도 normalizeParticipantCode가 맞춰 준다.
 */
export const PARTICIPANT_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** 서버 설정의 pepper. 없으면 빈 문자열이고, 발급·대조 모두 하지 않는다. */
export function readParticipantCodePepper(env: Record<string, string | undefined> = process.env): string {
  return env.PARTICIPANT_CODE_PEPPER?.trim() || '';
}

/**
 * 저장·대조에 쓰는 해시. sha256(`${pepper}:${code.trim()}`).
 * 예전부터 학생 입장이 쓰던 식 그대로다. 바꾸면 이미 발급한 참가코드가 모두 맞지 않게 된다.
 */
export function hashParticipantCode(code: string, pepper: string): string {
  if (!pepper) throw new Error('참가코드 pepper가 없습니다.');
  return createHash('sha256').update(`${pepper}:${code.trim()}`).digest('hex');
}

/** 학생이 적은 참가코드를 발급 때의 모양(대문자, 빈칸·'-' 없음)으로 맞춘다. */
export function normalizeParticipantCode(input: string): string {
  return String(input ?? '')
    .normalize('NFKC')
    .replace(/[\s\-_.]/g, '')
    .toUpperCase();
}

/**
 * 학생 입장에서 찾아볼 해시 목록.
 * 관리 화면이 발급한 코드는 정리한 모양으로 해시되어 있다. 손으로 넣었던 옛 코드는
 * 적은 그대로(앞뒤 빈칸만 뺀 값) 해시되어 있을 수 있어 그 값도 함께 찾는다.
 */
export function participantCodeLookupHashes(input: string, pepper: string): string[] {
  const hashes: string[] = [];
  const normalized = normalizeParticipantCode(input);
  if (normalized) hashes.push(hashParticipantCode(normalized, pepper));
  const raw = String(input ?? '').trim();
  if (raw) {
    const rawHash = hashParticipantCode(raw, pepper);
    if (!hashes.includes(rawHash)) hashes.push(rawHash);
  }
  return hashes;
}
