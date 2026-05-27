
'use client';

import { useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Home, ArrowRight, Pencil, Palette, Sparkles, Lightbulb, Wand2 } from 'lucide-react';
import { generateImage } from '@/ai/flows/generate-image';
import { Skeleton } from '@/components/ui/skeleton';

export default function GuidePage() {
  const [generatedImageUrl, setGeneratedImageUrl] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);

  const examplePrompt = "수수께끼 같은, 고대의 숲, 빛나는 안개, 거대한 버섯, 귀여운 요정이 날아다니는, 영화 같은 조명, 판타지 아트";

  const handleGenerateClick = async () => {
    setIsGenerating(true);
    setGeneratedImageUrl(null);
    try {
      const imageUrl = await generateImage(examplePrompt);
      setGeneratedImageUrl(imageUrl);
    } catch (error) {
      console.error("Failed to generate example image", error);
      // Fallback to a placeholder if generation fails
      setGeneratedImageUrl("https://placehold.co/600x600.png");
    } finally {
      setIsGenerating(false);
    }
  };


  return (
    <div className="min-h-screen bg-background font-sans text-foreground">
      <header className="p-4 flex justify-end">
        <Link href="/" passHref>
          <Button variant="outline"><Home className="mr-2 h-4 w-4" />홈으로 돌아가기</Button>
        </Link>
      </header>
      <main className="container mx-auto p-4 sm:p-6 lg:p-8">
        <div className="max-w-4xl mx-auto">
          <div className="text-center mb-12">
            <h1 className="text-5xl md:text-6xl font-bold tracking-tight text-transparent bg-clip-text bg-gradient-to-r from-primary via-purple-400 to-pink-500 font-headline">프롬프트란 무엇일까요?</h1>
            <p className="mt-4 text-lg text-muted-foreground max-w-2xl mx-auto">AI 화가에게 내가 상상하는 그림을 그려달라고 부탁하는 '설명 편지'예요!</p>
          </div>

          <Card className="shadow-2xl shadow-primary/10 rounded-2xl bg-card/80 backdrop-blur-sm p-6 md:p-10 mb-8">
            <div className="grid md:grid-cols-1 gap-8 items-center">
              <div>
                <CardTitle className="text-3xl font-headline mb-4">🎨 AI 화가에게 편지 쓰기</CardTitle>
                <div className="text-muted-foreground text-base md:text-lg space-y-4 font-body leading-relaxed">
                  컴퓨터 속에 사는 로봇 🤖 AI 화가는 정말 그림을 잘 그려요. 하지만 AI 화가는 우리가 무엇을 그려달라고 하는지 마음을 읽을 수는 없어요.
                  <br /><br />
                  그래서 우리는 '프롬프트'라는 특별한 설명 편지를 써서, 우리가 상상하는 그림 🖼️이 어떤 모습인지 아주 아주 자세하게 알려줘야 해요.
                  <br /><br />
                  프롬프트를 잘 쓸수록 AI 화가는 우리가 상상한 그림과 똑같은 멋진 그림을 그려준답니다!
                </div>
              </div>
            </div>
          </Card>

          <div className="text-center mb-12">
            <h2 className="text-4xl font-headline font-bold">어떻게 하면 좋은 프롬프트를 쓸 수 있을까요?</h2>
            <p className="mt-3 text-lg text-muted-foreground">네 가지 비밀을 기억하세요!</p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mb-8">
            <Card className="bg-card/50 backdrop-blur-sm rounded-xl p-6">
              <CardHeader className="flex flex-row items-center gap-4 p-0 mb-4">
                <div className="bg-primary/20 p-3 rounded-lg"><Pencil className="h-8 w-8 text-primary" /></div>
                <CardTitle className="text-2xl font-headline m-0">1. 정확하게 말하기</CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <p className="font-body text-muted-foreground">그림의 주인공이 누구인지, 무엇인지 정확하게 알려주세요. '사람'보다는 '우주복을 입은 소녀'가 훨씬 좋아요.</p>
              </CardContent>
            </Card>
            <Card className="bg-card/50 backdrop-blur-sm rounded-xl p-6">
              <CardHeader className="flex flex-row items-center gap-4 p-0 mb-4">
                <div className="bg-primary/20 p-3 rounded-lg"><Palette className="h-8 w-8 text-primary" /></div>
                <CardTitle className="text-2xl font-headline m-0">2. 자세하게 꾸며주기</CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <p className="font-body text-muted-foreground">색깔, 모양, 개수, 배경 등 보이는 모든 것을 자세하게 설명해주세요. '파란색 눈동자', '뾰족한 지붕' 처럼요.</p>
              </CardContent>
            </Card>
            <Card className="bg-card/50 backdrop-blur-sm rounded-xl p-6">
              <CardHeader className="flex flex-row items-center gap-4 p-0 mb-4">
                <div className="bg-primary/20 p-3 rounded-lg"><Sparkles className="h-8 w-8 text-primary" /></div>
                <CardTitle className="text-2xl font-headline m-0">3. 분위기 더하기</CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <p className="font-body text-muted-foreground">그림이 어떤 느낌이면 좋을지 알려주세요. '신비로운', '활기찬', '조용한 새벽' 같은 표현을 사용하면 좋아요.</p>
              </CardContent>
            </Card>
            <Card className="bg-card/50 backdrop-blur-sm rounded-xl p-6">
              <CardHeader className="flex flex-row items-center gap-4 p-0 mb-4">
                <div className="bg-primary/20 p-3 rounded-lg"><Lightbulb className="h-8 w-8 text-primary" /></div>
                <CardTitle className="text-2xl font-headline m-0">4. 창의적으로 상상하기</CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <p className="font-body text-muted-foreground">나만의 이야기를 상상해서 더해보세요. '토끼가 구름 위에서 차를 마시고 있다' 처럼요! AI는 뭐든지 그릴 수 있어요.</p>
              </CardContent>
            </Card>
          </div>

          <Card className="shadow-2xl shadow-primary/10 rounded-2xl bg-card/80 backdrop-blur-sm p-6 md:p-10 mb-8">
            <div className="grid md:grid-cols-2 gap-8 items-center">
              <div>
                <CardTitle className="text-3xl font-headline mb-4">✍️ 실제 예시</CardTitle>
                <div className="text-muted-foreground text-base md:text-lg space-y-4 font-body leading-relaxed">
                  예를 들어, 아래처럼 프롬프트를 쓰면...
                  <blockquote className="border-l-4 border-primary pl-4 italic text-muted-foreground bg-muted/30 p-4 rounded-r-lg">
                    {examplePrompt}
                  </blockquote>
                  ...오른쪽 그림처럼 멋진 결과가 나온답니다. 직접 한번 그려볼까요?
                  <Button onClick={handleGenerateClick} disabled={isGenerating} size="lg">
                    <Wand2 className="mr-2" />
                    {isGenerating ? 'AI가 그리는 중...' : 'AI로 그림 그려보기!'}
                  </Button>
                </div>
              </div>
              <div className="relative aspect-square rounded-xl overflow-hidden shadow-lg">
                {isGenerating ? (
                  <div className="w-full h-full bg-muted animate-pulse flex items-center justify-center">
                    <div className="flex flex-col items-center gap-2">
                      <Wand2 className="h-8 w-8 text-muted-foreground animate-pulse" />
                      <p className="text-muted-foreground">AI 화가가 그림을 그리고 있어요...</p>
                    </div>
                  </div>
                ) : generatedImageUrl ? (
                  <Image src={generatedImageUrl} alt="AI generated art from an example prompt" fill className="object-cover" />
                ) : (
                  <div className="w-full h-full bg-muted flex items-center justify-center text-center p-4 rounded-xl">
                    <p className="text-muted-foreground">버튼을 눌러 AI가 그림을 그리게 해보세요!</p>
                  </div>
                )}
              </div>
            </div>
          </Card>

          <div className="text-center mt-12">
            <p className="text-xl text-muted-foreground mb-4">이제 프롬프트가 무엇인지 알았나요?</p>
            <Link href="/practice" passHref>
              <Button size="lg" className="font-bold text-lg">
                직접 프롬프트 쓰러 가기! <ArrowRight className="ml-2" />
              </Button>
            </Link>
          </div>
        </div>
      </main>
    </div>
  );
}
