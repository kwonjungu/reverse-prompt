/**
 * 기술 실패 보고 API.
 *
 * 네트워크 장애처럼 학생 잘못이 아닌 사유를 남긴다. 이 기록은 결측 사유일 뿐
 * 점수가 아니며, 화면에 남아 있던 타이핑 초안을 연구 응답으로 확정하지 않는다.
 */

import { NextResponse } from 'next/server';
import { reportTechnicalFailure } from '@/server/assessment/actions';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const questionId = typeof body.questionId === 'string' ? body.questionId : '';
    const reason = typeof body.reason === 'string' ? body.reason : 'unknown';
    if (!questionId) return NextResponse.json({ ok: false }, { status: 400 });
    const result = await reportTechnicalFailure({ questionId, reason });
    return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store, max-age=0' } });
  } catch {
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
