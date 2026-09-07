'use client';

/**
 * 교사·연구자 세션 쿠키를 서버에 요청하는 클라이언트 헬퍼.
 *
 * 클라이언트는 Firebase 로그인으로 받은 ID 토큰만 서버에 넘긴다.
 * 역할·소속 학급은 서버가 users 문서에서 조회한다. 클라이언트가 보낸 값을 쓰지 않는다.
 * 세션 토큰은 HttpOnly 쿠키로만 오가므로 이 파일이 토큰을 보관하지 않는다.
 */

export async function postStaffSession(idToken: string): Promise<{ role: string }> {
  const response = await fetch('/api/auth/staff', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ idToken }),
  });
  if (!response.ok) {
    throw new Error('세션을 만들 수 없습니다.');
  }
  return (await response.json()) as { role: string };
}

export async function clearStaffSession(): Promise<void> {
  await fetch('/api/auth/staff', { method: 'DELETE' }).catch(() => undefined);
}
