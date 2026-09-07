/**
 * Node 스크립트에서 서버 전용 모듈을 불러오기 위한 준비.
 *
 * `src/server/**`는 클라이언트 번들에 섞이지 않도록 `import 'server-only'`를 쓴다.
 * 그 패키지는 Node의 기본 조건에서 곧바로 예외를 던지므로, 연구용 CLI 스크립트에서는
 * 빈 모듈로 대신 채워 둔다. `--conditions=react-server`를 쓰면 React 18이 깨지므로
 * 조건을 바꾸는 대신 이 방법을 쓴다.
 *
 * 이 파일은 Next 런타임에 들어가지 않는다. 스크립트에서만 --import로 불러온다.
 */

import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

try {
  const resolved = require.resolve('server-only');
  require.cache[resolved] = {
    id: resolved,
    filename: resolved,
    loaded: true,
    children: [],
    paths: [],
    exports: {},
  };
} catch {
  // server-only가 없으면 아무것도 하지 않는다.
}
