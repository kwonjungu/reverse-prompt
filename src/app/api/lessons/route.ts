/**
 * 학생 화면이 쓰는 차시 상태 조회.
 *
 * 열람 가능한 차시는 서버가 정한다. 클라이언트가 보낸 lesson 값은 요청일 뿐이며
 * 허용되지 않으면 서버가 다시 정한다(설계서 §4, 수용시험 6).
 *
 * 세션이 없거나 서버 설정이 없으면 차시를 알려 주지 않는다. 일반 체험으로
 * 강등해 열어 주지 않는다(감사 A-3).
 */

import { NextResponse } from 'next/server';
import { getLessonStateAction } from '@/server/lessons/actions';
import { authErrorResponse } from '../auth/errors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const url = new URL(request.url);
  const raw = url.searchParams.get('lesson');
  const requested = raw === null ? null : Number(raw);
  const lesson = Number.isFinite(requested) ? (requested as number) : null;

  try {
    const state = await getLessonStateAction(lesson);
    return NextResponse.json(state, {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    return authErrorResponse(error);
  }
}
