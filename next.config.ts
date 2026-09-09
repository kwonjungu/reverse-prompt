import type {NextConfig} from 'next';

const nextConfig: NextConfig = {
  typescript: {
    ignoreBuildErrors: true,
  },
  eslint: {
    ignoreDuringBuilds: true,
  },
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'placehold.co',
        port: '',
        pathname: '/**',
      },
    ],
  },
  // Vercel의 서버 함수는 import된 파일만 번들에 넣는다. 채점은 공개 이미지도
  // 바이트로 읽어 Gemini에 전달하므로 public/questions를 명시적으로 포함한다.
  // 이 설정이 없으면 브라우저에서는 이미지가 보여도 서버 채점에서 L01 등을
  // 읽지 못해 "문항 이미지를 열 수 없습니다"로 제출 전체가 실패할 수 있다.
  outputFileTracingIncludes: {
    '/*': ['./public/questions/**/*'],
  },
  experimental: {
    serverActions: {
      bodySizeLimit: '5mb',
    },
  },
};

export default nextConfig;
