/**
 * 검사·연습 문항 이미지의 인증 스트리밍 경로.
 *
 * 검사 이미지는 public/ 아래에 두지 않고 이 경로로만 내려보낸다. 요청마다 서버가
 * 신원·역할·세션 성격·동의를 다시 확인하며 클라이언트가 보낸 값을 믿지 않는다.
 * 응답에는 private·no-store와 noindex를 붙여 공유 캐시와 색인에 남지 않게 한다.
 *
 * 이미지 바이트는 registry.loadImage()로 서버가 직접 읽는다. 외부 모델에 보낼 때도
 * 임시 URL을 만들지 않고 바이트를 그대로 넘기며, 이 경로의 URL·질의문자열·신원 ID·
 * 인증 토큰을 로그에 남기지 않는다.
 *
 * 한계: 허용된 검사 중 학생 화면에 표시된 이미지를 화면 캡처·재촬영·저장으로
 * 복제하는 것은 이 경로에서 막지 못한다. 여기서 막는 것은 인증되지 않은 요청과
 * 공개 경로 노출까지이며, 그 이상을 방지했다고 보지 않는다.
 *
 * 대응 문서: 프로그램_수정_프롬프트설계서_v7 §2, §6, 수용시험 12
 */

import { auth } from '@/server/auth';
import { AuthError } from '@/server/auth/contract';
import { registry } from '@/server/registry';
import { RegistryError } from '@/server/registry/contract';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** 학생 화면에 그대로 보여도 되는 문구만 쓴다. 구현 용어를 노출하지 않는다. */
function deny(status: number, message: string): Response {
  return new Response(JSON.stringify({ message }), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'private, no-store',
      'X-Robots-Tag': 'noindex, nofollow, noimageindex',
    },
  });
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ questionId: string }> },
): Promise<Response> {
  const { questionId } = await context.params;

  try {
    // 익명 요청은 여기서 끝난다.
    const principal = await auth.requirePrincipal();

    // 세션 성격에 맞지 않는 문항이면 requireEntry가 거부한다.
    const entry = registry.requireEntry(questionId, principal.sessionType);

    if (entry.kind === 'assessment') {
      // 검사 세션이 열려 있지 않으면 서버가 부여한 sessionType이
      // research_assessment가 아니므로 위에서 이미 거부된다. 여기서는 학급 소속과
      // 동의, 그리고 연구 시작 가능 여부를 한 번 더 확인한다.
      const ready = registry.readiness();
      if (!ready.researchReady) {
        return deny(409, '지금은 이 활동을 열 수 없어요. 선생님께 알려 주세요.');
      }

      if (principal.role === 'student') {
        if (!principal.researchId || !principal.classResearchId) {
          return deny(403, '지금은 이 활동을 할 수 없어요.');
        }
        // 미동의·철회 참가자의 검사 자산 접근을 수집 단계에서 막는다.
        await auth.requireActiveResearchConsent(principal.researchId);
      } else if (!principal.classResearchIds.length) {
        return deny(403, '접근 권한이 없습니다.');
      }
    }

    const image = await registry.loadImage(entry.questionId);

    return new Response(new Uint8Array(image.bytes), {
      status: 200,
      headers: {
        'Content-Type': image.contentType,
        'Content-Length': String(image.bytes.byteLength),
        'Content-Disposition': 'inline',
        'Cache-Control': 'private, no-store, max-age=0, must-revalidate',
        'X-Robots-Tag': 'noindex, nofollow, noimageindex',
        'X-Content-Type-Options': 'nosniff',
        'Referrer-Policy': 'no-referrer',
      },
    });
  } catch (error) {
    if (error instanceof AuthError) {
      // 코드만 남긴다. 요청 URL·신원 ID·토큰은 기록하지 않는다.
      if (error.code === 'unauthenticated') return deny(401, '먼저 로그인해 주세요.');
      if (error.code === 'not_configured') return deny(503, '지금은 이 활동을 열 수 없어요.');
      return deny(403, '접근 권한이 없습니다.');
    }
    if (error instanceof RegistryError) {
      if (error.code === 'unknown_question') return deny(404, '문항을 찾을 수 없어요.');
      if (error.code === 'not_allowed') return deny(403, '지금은 볼 수 없는 문항이에요.');
      return deny(404, '그림을 불러오지 못했어요. 선생님께 알려 주세요.');
    }
    console.error('[research-asset] 처리 실패');
    return deny(500, '그림을 불러오지 못했어요. 잠시 뒤 다시 시도해 주세요.');
  }
}
