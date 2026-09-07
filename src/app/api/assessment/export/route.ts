/**
 * 연구 자료 CSV 내려받기 경로.
 *
 * 연구자가 실제로 자료를 받는 실행 경로다. 직렬화 규칙(null 유지·수준 소수 유지·
 * 기준 버전 포함·수식 주입 방지·UTF-8 BOM)은 src/server/export가 지키고,
 * 이 route는 권한 확인 결과와 파일 응답만 맡는다.
 *
 * 권한은 server action 안에서 다시 확인한다(연구자·관리자, 배정된 학급만).
 * 응답은 private·no-store이며 캐시·색인에 남기지 않는다.
 */

import { NextResponse } from 'next/server';
import { exportAssessmentCsv } from '@/server/export/actions';
import { CSV_CONTENT_TYPE, toCsvBytes } from '@/server/export/csv';
import { AuthError } from '@/server/auth/contract';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function deny(status: number, message: string): Response {
  return NextResponse.json(
    { ok: false, message },
    { status, headers: { 'Cache-Control': 'private, no-store' } }
  );
}

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const classResearchId = url.searchParams.get('classResearchId') ?? '';
  const repeatRaw = url.searchParams.get('repeat');
  const kindRaw = url.searchParams.get('kind');

  if (!classResearchId) return deny(400, '학급을 지정해 주세요.');
  const kind = kindRaw === 'calls' ? 'calls' : 'submissions';
  const repeatIndex = repeatRaw ? Number(repeatRaw) : 1;
  if (!Number.isInteger(repeatIndex)) return deny(400, '반복 번호가 올바르지 않습니다.');

  try {
    const result = await exportAssessmentCsv({ classResearchId, repeatIndex, kind });
    const bytes = toCsvBytes(result.csv);
    return new Response(bytes, {
      status: 200,
      headers: {
        'Content-Type': CSV_CONTENT_TYPE,
        'Content-Length': String(bytes.byteLength),
        'Content-Disposition': `attachment; filename="${result.filename}"`,
        // 격자 점검 결과를 함께 알린다. 중복·결손을 숨기고 파일만 주지 않는다.
        'X-Export-Row-Count': String(result.rowCount),
        'X-Export-Complete-Students': String(result.completeness.completeStudentCount),
        'X-Export-Duplicate-Cells': String(
          result.completeness.issues.filter((i) => i.kind === 'duplicate').length
        ),
        'Cache-Control': 'private, no-store, max-age=0, must-revalidate',
        'X-Robots-Tag': 'noindex, nofollow',
      },
    });
  } catch (error) {
    if (error instanceof AuthError) {
      if (error.code === 'unauthenticated') return deny(401, '먼저 로그인해 주세요.');
      if (error.code === 'not_configured') return deny(503, '지금은 내보낼 수 없습니다.');
      return deny(403, '접근 권한이 없습니다.');
    }
    // 실패 사유를 그대로 노출하지 않는다.
    return deny(500, '내보내기에 실패했습니다.');
  }
}
