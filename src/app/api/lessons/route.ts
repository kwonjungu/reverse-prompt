/**
 * 학생 화면이 쓰는 차시 상태 조회.
 *
 * 열람 가능한 차시는 서버가 정한다. 클라이언트가 보낸 lesson 값은 요청일 뿐이며
 * 허용되지 않으면 서버가 다시 정한다(설계서 §4, 수용시험 6).
 */

import { NextResponse } from 'next/server';
import { getLessonStateAction } from '@/server/lessons/actions';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const url = new URL(request.url);
  const raw = url.searchParams.get('lesson');
  const requested = raw === null ? null : Number(raw);
  const lesson = Number.isFinite(requested) ? (requested as number) : null;

  const state = await getLessonStateAction(lesson);
  return NextResponse.json(state, {
    headers: { 'Cache-Control': 'no-store' },
  });
}
