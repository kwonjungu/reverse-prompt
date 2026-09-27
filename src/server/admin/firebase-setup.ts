import 'server-only';

/**
 * 통합 관리 화면의 Firebase 설정 점검 — 배선.
 *
 * 운영자가 Firebase 콘솔을 뒤지지 않아도 되도록 관리 화면이 두 가지를 직접 확인한다.
 *   1. 서버 자격증명(서비스 계정)과 웹 설정(NEXT_PUBLIC_FIREBASE_PROJECT_ID)이 같은 프로젝트인가.
 *      다르면 관리 화면이 만든 교사 계정으로 교사가 로그인하지 못한다.
 *   2. 교사 로그인(이메일/비밀번호) 방식이 켜져 있는가. 없는 계정으로 로그인을 시도해 오류 코드로 판정한다.
 *      계정을 만들거나 바꾸지 않는다. Authentication을 한 번도 시작하지 않은 프로젝트(not_initialized)는
 *      교사 계정 자체를 만들 수 없으므로 따로 알린다.
 *
 * 꺼져 있으면 서비스 계정 권한으로 켜기를 시도한다(Identity Toolkit 설정 API).
 * 권한이 없거나 실패하면 콘솔 링크를 안내한다. 실패를 성공으로 보고하지 않는다.
 * 시작하지 않은 Authentication은 코드로 시작하지 않는다. API로 시작하면 Identity Platform으로 올라가
 * 요금 체계가 달라질 수 있어, 운영자가 콘솔에서 '시작하기'를 누르게 안내만 한다.
 */

import { randomUUID } from 'node:crypto';
import { AuthError } from '@/server/auth/contract';
import { FIREBASE_ADMIN_CREDENTIAL } from '@/server/config';
import { getAdminApp, isAdminConfigured } from '@/server/firebase-admin';
import { classifyPasswordSignInProbe, projectIdOfCredential, type TeacherLoginState } from './core';

export interface FirebaseSetupCheck {
  /** 서비스 계정 JSON의 프로젝트 */
  serverProjectId: string | null;
  /** 브라우저 설정의 프로젝트(NEXT_PUBLIC_FIREBASE_PROJECT_ID) */
  clientProjectId: string | null;
  /** 두 값이 모두 있을 때만 판정한다. */
  projectMatch: boolean | null;
  teacherLogin: TeacherLoginState;
  /** 교사 로그인 방식을 켜는 Firebase 콘솔 화면 */
  providersUrl: string | null;
  /** Authentication '시작하기' 단추가 있는 Firebase 콘솔 화면 */
  authStartUrl: string | null;
}

const PROBE_TIMEOUT_MS = 5000;

function identityToolkitBase(): string {
  const emulator = process.env.FIREBASE_AUTH_EMULATOR_HOST?.trim();
  return emulator
    ? `http://${emulator}/identitytoolkit.googleapis.com`
    : 'https://identitytoolkit.googleapis.com';
}

async function probeTeacherLogin(apiKey: string): Promise<TeacherLoginState> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  try {
    const res = await fetch(
      `${identityToolkitBase()}/v1/accounts:signInWithPassword?key=${encodeURIComponent(apiKey)}`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        // 있을 수 없는 계정으로 시도한다. 판정에는 오류 코드만 쓴다.
        body: JSON.stringify({
          email: `setup-check-${randomUUID()}@example.com`,
          password: randomUUID(),
          returnSecureToken: false,
        }),
        signal: controller.signal,
        cache: 'no-store',
      }
    );
    if (res.ok) return 'enabled';
    const body = (await res.json().catch(() => null)) as { error?: { message?: unknown } } | null;
    return classifyPasswordSignInProbe(body?.error?.message);
  } catch {
    return 'unknown';
  } finally {
    clearTimeout(timer);
  }
}

export async function checkFirebaseSetup(): Promise<FirebaseSetupCheck> {
  const serverProjectId = projectIdOfCredential(FIREBASE_ADMIN_CREDENTIAL);
  const clientProjectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID?.trim() || null;
  const apiKey = process.env.NEXT_PUBLIC_FIREBASE_API_KEY?.trim() || '';
  const projectId = clientProjectId ?? serverProjectId;
  const consoleBase = projectId
    ? `https://console.firebase.google.com/project/${encodeURIComponent(projectId)}/authentication`
    : null;
  return {
    serverProjectId,
    clientProjectId,
    projectMatch:
      serverProjectId && clientProjectId ? serverProjectId === clientProjectId : null,
    teacherLogin: apiKey ? await probeTeacherLogin(apiKey) : 'unknown',
    providersUrl: consoleBase ? `${consoleBase}/providers` : null,
    authStartUrl: consoleBase,
  };
}

/**
 * 교사 로그인(이메일/비밀번호) 방식을 켠다. 이 두 필드만 바꾸고 다른 설정은 건드리지 않는다.
 * 성공하면 true. 권한이 없거나 Authentication을 한 번도 시작하지 않은 프로젝트면 false.
 */
export async function enableEmailPasswordSignIn(): Promise<boolean> {
  if (!isAdminConfigured()) {
    throw new AuthError('서버 자격증명이 없어 설정을 바꿀 수 없습니다.', 'not_configured');
  }
  const projectId = projectIdOfCredential(FIREBASE_ADMIN_CREDENTIAL);
  if (!projectId) return false;
  // 에뮬레이터는 모든 로그인 방식을 받아 준다. 바꿀 설정이 없다.
  if (process.env.FIREBASE_AUTH_EMULATOR_HOST) return true;
  try {
    const credential = getAdminApp().options.credential;
    const token = credential ? await credential.getAccessToken() : null;
    if (!token?.access_token) return false;
    const res = await fetch(
      `https://identitytoolkit.googleapis.com/admin/v2/projects/${encodeURIComponent(projectId)}/config` +
        '?updateMask=signIn.email.enabled,signIn.email.passwordRequired',
      {
        method: 'PATCH',
        headers: {
          authorization: `Bearer ${token.access_token}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ signIn: { email: { enabled: true, passwordRequired: true } } }),
        cache: 'no-store',
      }
    );
    if (!res.ok) console.error('[admin] 교사 로그인 방식을 켜지 못했습니다:', res.status);
    return res.ok;
  } catch {
    console.error('[admin] 교사 로그인 방식을 켜지 못했습니다');
    return false;
  }
}
