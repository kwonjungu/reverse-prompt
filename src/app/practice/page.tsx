
'use client';

import { useState, useTransition, useMemo, useEffect } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { evaluatePrompt, type EvaluatePromptOutput } from '@/ai/flows/evaluate-prompt';
import { useFirestore } from '@/firebase';
import { collection, addDoc, serverTimestamp } from 'firebase/firestore';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { ArrowRight, Wand2, RefreshCw, BookOpen, Star, Home, RotateCcw } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from "@/hooks/use-toast";
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';

// 난이도:
//   1~3단계  — 흰 배경, 단일 사물, 색깔·모양만 묘사
//   4~6단계  — 흰 배경, 캐릭터 표정·특징·동작 추가
//   7~8단계  — 배경 첫 등장 (단색)
//   9~11단계 — 배경 + 2~3가지 요소
//   12~15단계— 복합 씬 (여러 요소 + 분위기)
// 문항 이미지는 사전에 제작·검수한 정적 파일이다. sourcePrompt는 그 이미지를 생성할 때
// 사용한 원 프롬프트로, 연구 자료로만 기록하며 학습자에게는 노출하지 않는다.
const questions = [
  { level:  1, chasi: 1, koreanTitle: "빨간 사과 한 개", imageUrl: '/questions/L01.jpg',
    sourcePrompt: "A single glossy red apple, stem visible. Pure flat white background. No shadow, no floor line, no background texture whatsoever. Children's educational illustration, soft digital painting with clearly visible surface texture, even neutral lighting, simple and unambiguous composition, no text, no letters, no numbers, no logos, no brand marks, no signage, not a real identifiable person, no violence, the illustration fills the entire canvas edge to edge, no picture frame, no border, no mat, no wall behind it, not a photo of a framed painting, high detail on the main subject.",
    rubric: "이 그림을 한 번도 못 본 친구에게 문자로 보낸다면?\
\
무엇이 있는지 이름을 정확하게 써 봐요. 그림 하나로 딱 정해지는 이름일수록 좋아요!" },
  { level:  2, chasi: 1, koreanTitle: "접힌 노란 우산", imageUrl: '/questions/L02.jpg',
    sourcePrompt: "A folded yellow umbrella lying flat. Pure flat white background. No shadow, no floor line, no background texture whatsoever. Children's educational illustration, soft digital painting with clearly visible surface texture, even neutral lighting, simple and unambiguous composition, no text, no letters, no numbers, no logos, no brand marks, no signage, not a real identifiable person, no violence, the illustration fills the entire canvas edge to edge, no picture frame, no border, no mat, no wall behind it, not a photo of a framed painting, high detail on the main subject.",
    rubric: "이 그림을 한 번도 못 본 친구에게 문자로 보낸다면?\
\
무엇이 있는지 이름을 정확하게 써 봐요. 그림 하나로 딱 정해지는 이름일수록 좋아요!" },
  { level:  3, chasi: 1, koreanTitle: "갈색 가죽 축구공", imageUrl: '/questions/L03.jpg',
    sourcePrompt: "A brown leather ball with visible stitched seams. Pure flat white background. No shadow, no floor line, no background texture whatsoever. Children's educational illustration, soft digital painting with clearly visible surface texture, even neutral lighting, simple and unambiguous composition, no text, no letters, no numbers, no logos, no brand marks, no signage, not a real identifiable person, no violence, the illustration fills the entire canvas edge to edge, no picture frame, no border, no mat, no wall behind it, not a photo of a framed painting, high detail on the main subject.",
    rubric: "이 그림을 한 번도 못 본 친구에게 문자로 보낸다면?\
\
무엇이 있는지 이름을 정확하게 써 봐요. 그림 하나로 딱 정해지는 이름일수록 좋아요!" },
  { level:  4, chasi: 1, koreanTitle: "파란 물뿌리개", imageUrl: '/questions/L04.jpg',
    sourcePrompt: "A blue metal watering can. Pure flat white background. No shadow, no floor line, no background texture whatsoever. Children's educational illustration, soft digital painting with clearly visible surface texture, even neutral lighting, simple and unambiguous composition, no text, no letters, no numbers, no logos, no brand marks, no signage, not a real identifiable person, no violence, the illustration fills the entire canvas edge to edge, no picture frame, no border, no mat, no wall behind it, not a photo of a framed painting, high detail on the main subject.",
    rubric: "이 그림을 한 번도 못 본 친구에게 문자로 보낸다면?\
\
무엇이 있는지 이름을 정확하게 써 봐요. 그림 하나로 딱 정해지는 이름일수록 좋아요!" },
  { level:  5, chasi: 1, koreanTitle: "초록 선인장 화분", imageUrl: '/questions/L05.jpg',
    sourcePrompt: "A small round green cactus in a terracotta pot. Pure flat white background. No shadow, no floor line, no background texture whatsoever. Children's educational illustration, soft digital painting with clearly visible surface texture, even neutral lighting, simple and unambiguous composition, no text, no letters, no numbers, no logos, no brand marks, no signage, not a real identifiable person, no violence, the illustration fills the entire canvas edge to edge, no picture frame, no border, no mat, no wall behind it, not a photo of a framed painting, high detail on the main subject.",
    rubric: "이 그림을 한 번도 못 본 친구에게 문자로 보낸다면?\
\
무엇이 있는지 이름을 정확하게 써 봐요. 그림 하나로 딱 정해지는 이름일수록 좋아요!" },
  { level:  6, chasi: 1, koreanTitle: "은색 열쇠 하나", imageUrl: '/questions/L06.jpg',
    sourcePrompt: "A single silver key. Pure flat white background. No shadow, no floor line, no background texture whatsoever. Children's educational illustration, soft digital painting with clearly visible surface texture, even neutral lighting, simple and unambiguous composition, no text, no letters, no numbers, no logos, no brand marks, no signage, not a real identifiable person, no violence, the illustration fills the entire canvas edge to edge, no picture frame, no border, no mat, no wall behind it, not a photo of a framed painting, high detail on the main subject.",
    rubric: "이 그림을 한 번도 못 본 친구에게 문자로 보낸다면?\
\
무엇이 있는지 이름을 정확하게 써 봐요. 그림 하나로 딱 정해지는 이름일수록 좋아요!" },
  { level:  7, chasi: 2, koreanTitle: "크기가 다른 주황색 공 세 개", imageUrl: '/questions/L07.jpg',
    sourcePrompt: "Three orange balls of clearly different sizes in a row. Flat single-colour pastel background with no objects in it. Only the colour suggests nothing but space. Children's educational illustration, soft digital painting with clearly visible surface texture, even neutral lighting, simple and unambiguous composition, no text, no letters, no numbers, no logos, no brand marks, no signage, not a real identifiable person, no violence, the illustration fills the entire canvas edge to edge, no picture frame, no border, no mat, no wall behind it, not a photo of a framed painting, high detail on the main subject.",
    rubric: "눈을 감고도 떠올릴 수 있게 설명해 봐요.\
\
색깔, 모양, 크기, 개수까지 써 주면 AI가 똑같은 그림을 만들 수 있어요!" },
  { level:  8, chasi: 2, koreanTitle: "줄무늬 머그컵 하나", imageUrl: '/questions/L08.jpg',
    sourcePrompt: "One mug with bold horizontal stripes. Flat single-colour pastel background with no objects in it. Only the colour suggests nothing but space. Children's educational illustration, soft digital painting with clearly visible surface texture, even neutral lighting, simple and unambiguous composition, no text, no letters, no numbers, no logos, no brand marks, no signage, not a real identifiable person, no violence, the illustration fills the entire canvas edge to edge, no picture frame, no border, no mat, no wall behind it, not a photo of a framed painting, high detail on the main subject.",
    rubric: "눈을 감고도 떠올릴 수 있게 설명해 봐요.\
\
색깔, 모양, 크기, 개수까지 써 주면 AI가 똑같은 그림을 만들 수 있어요!" },
  { level:  9, chasi: 2, koreanTitle: "길쭉한 초록 병과 짧은 갈색 병", imageUrl: '/questions/L09.jpg',
    sourcePrompt: "One tall slim green glass bottle beside one short wide brown bottle. Flat single-colour pastel background with no objects in it. Only the colour suggests nothing but space. Children's educational illustration, soft digital painting with clearly visible surface texture, even neutral lighting, simple and unambiguous composition, no text, no letters, no numbers, no logos, no brand marks, no signage, not a real identifiable person, no violence, the illustration fills the entire canvas edge to edge, no picture frame, no border, no mat, no wall behind it, not a photo of a framed painting, high detail on the main subject.",
    rubric: "눈을 감고도 떠올릴 수 있게 설명해 봐요.\
\
색깔, 모양, 크기, 개수까지 써 주면 AI가 똑같은 그림을 만들 수 있어요!" },
  { level: 10, chasi: 2, koreanTitle: "별 모양 쿠키 다섯 개", imageUrl: '/questions/L10.jpg',
    sourcePrompt: "Five yellow star-shaped cookies arranged apart from each other. Flat single-colour pastel background with no objects in it. Only the colour suggests nothing but space. Children's educational illustration, soft digital painting with clearly visible surface texture, even neutral lighting, simple and unambiguous composition, no text, no letters, no numbers, no logos, no brand marks, no signage, not a real identifiable person, no violence, the illustration fills the entire canvas edge to edge, no picture frame, no border, no mat, no wall behind it, not a photo of a framed painting, high detail on the main subject.",
    rubric: "눈을 감고도 떠올릴 수 있게 설명해 봐요.\
\
색깔, 모양, 크기, 개수까지 써 주면 AI가 똑같은 그림을 만들 수 있어요!" },
  { level: 11, chasi: 2, koreanTitle: "커다란 보라색 나비 한 마리", imageUrl: '/questions/L11.jpg',
    sourcePrompt: "One large purple butterfly with wings fully open. Flat single-colour pastel background with no objects in it. Only the colour suggests nothing but space. Children's educational illustration, soft digital painting with clearly visible surface texture, even neutral lighting, simple and unambiguous composition, no text, no letters, no numbers, no logos, no brand marks, no signage, not a real identifiable person, no violence, the illustration fills the entire canvas edge to edge, no picture frame, no border, no mat, no wall behind it, not a photo of a framed painting, high detail on the main subject.",
    rubric: "눈을 감고도 떠올릴 수 있게 설명해 봐요.\
\
색깔, 모양, 크기, 개수까지 써 주면 AI가 똑같은 그림을 만들 수 있어요!" },
  { level: 12, chasi: 2, koreanTitle: "크고 작은 회색 돌 네 개", imageUrl: '/questions/L12.jpg',
    sourcePrompt: "Four grey stones of clearly different sizes. Flat single-colour pastel background with no objects in it. Only the colour suggests nothing but space. Children's educational illustration, soft digital painting with clearly visible surface texture, even neutral lighting, simple and unambiguous composition, no text, no letters, no numbers, no logos, no brand marks, no signage, not a real identifiable person, no violence, the illustration fills the entire canvas edge to edge, no picture frame, no border, no mat, no wall behind it, not a photo of a framed painting, high detail on the main subject.",
    rubric: "눈을 감고도 떠올릴 수 있게 설명해 봐요.\
\
색깔, 모양, 크기, 개수까지 써 주면 AI가 똑같은 그림을 만들 수 있어요!" },
  { level: 13, chasi: 3, koreanTitle: "잔디밭에서 뛰는 갈색 강아지", imageUrl: '/questions/L13.jpg',
    sourcePrompt: "A small brown puppy running on grass, legs mid-stride. Very simple background suggesting one place, with at most two plain background shapes. Children's educational illustration, soft digital painting with clearly visible surface texture, even neutral lighting, simple and unambiguous composition, no text, no letters, no numbers, no logos, no brand marks, no signage, not a real identifiable person, no violence, the illustration fills the entire canvas edge to edge, no picture frame, no border, no mat, no wall behind it, not a photo of a framed painting, high detail on the main subject.",
    rubric: "어디에서 무엇을 하고 있는지까지 써 봐요.\
\
대상의 이름과 색·모양에 더해, 배경과 행동을 함께 알려 주세요." },
  { level: 14, chasi: 3, koreanTitle: "나뭇가지에 앉은 파란 새", imageUrl: '/questions/L14.jpg',
    sourcePrompt: "A blue bird perched on a bare branch. Very simple background suggesting one place, with at most two plain background shapes. Children's educational illustration, soft digital painting with clearly visible surface texture, even neutral lighting, simple and unambiguous composition, no text, no letters, no numbers, no logos, no brand marks, no signage, not a real identifiable person, no violence, the illustration fills the entire canvas edge to edge, no picture frame, no border, no mat, no wall behind it, not a photo of a framed painting, high detail on the main subject.",
    rubric: "어디에서 무엇을 하고 있는지까지 써 봐요.\
\
대상의 이름과 색·모양에 더해, 배경과 행동을 함께 알려 주세요." },
  { level: 15, chasi: 3, koreanTitle: "헤엄치는 주황색 물고기", imageUrl: '/questions/L15.jpg',
    sourcePrompt: "An orange fish swimming underwater, fins spread. Very simple background suggesting one place, with at most two plain background shapes. Children's educational illustration, soft digital painting with clearly visible surface texture, even neutral lighting, simple and unambiguous composition, no text, no letters, no numbers, no logos, no brand marks, no signage, not a real identifiable person, no violence, the illustration fills the entire canvas edge to edge, no picture frame, no border, no mat, no wall behind it, not a photo of a framed painting, high detail on the main subject.",
    rubric: "어디에서 무엇을 하고 있는지까지 써 봐요.\
\
대상의 이름과 색·모양에 더해, 배경과 행동을 함께 알려 주세요." },
  { level: 16, chasi: 3, koreanTitle: "책상에 앉아 책을 읽는 아이", imageUrl: '/questions/L16.jpg',
    sourcePrompt: "A child sitting at a desk reading an open book. Very simple background suggesting one place, with at most two plain background shapes. Children's educational illustration, soft digital painting with clearly visible surface texture, even neutral lighting, simple and unambiguous composition, no text, no letters, no numbers, no logos, no brand marks, no signage, not a real identifiable person, no violence, the illustration fills the entire canvas edge to edge, no picture frame, no border, no mat, no wall behind it, not a photo of a framed painting, high detail on the main subject.",
    rubric: "어디에서 무엇을 하고 있는지까지 써 봐요.\
\
대상의 이름과 색·모양에 더해, 배경과 행동을 함께 알려 주세요." },
  { level: 17, chasi: 3, koreanTitle: "공중으로 뛰어오르는 회색 고양이", imageUrl: '/questions/L17.jpg',
    sourcePrompt: "A grey cat leaping upward with front paws stretched. Very simple background suggesting one place, with at most two plain background shapes. Children's educational illustration, soft digital painting with clearly visible surface texture, even neutral lighting, simple and unambiguous composition, no text, no letters, no numbers, no logos, no brand marks, no signage, not a real identifiable person, no violence, the illustration fills the entire canvas edge to edge, no picture frame, no border, no mat, no wall behind it, not a photo of a framed painting, high detail on the main subject.",
    rubric: "어디에서 무엇을 하고 있는지까지 써 봐요.\
\
대상의 이름과 색·모양에 더해, 배경과 행동을 함께 알려 주세요." },
  { level: 18, chasi: 3, koreanTitle: "우산을 쓰고 걷는 아이", imageUrl: '/questions/L18.jpg',
    sourcePrompt: "A child walking while holding an open umbrella. Very simple background suggesting one place, with at most two plain background shapes. Children's educational illustration, soft digital painting with clearly visible surface texture, even neutral lighting, simple and unambiguous composition, no text, no letters, no numbers, no logos, no brand marks, no signage, not a real identifiable person, no violence, the illustration fills the entire canvas edge to edge, no picture frame, no border, no mat, no wall behind it, not a photo of a framed painting, high detail on the main subject.",
    rubric: "어디에서 무엇을 하고 있는지까지 써 봐요.\
\
대상의 이름과 색·모양에 더해, 배경과 행동을 함께 알려 주세요." },
  { level: 19, chasi: 4, koreanTitle: "웅크리고 자는 흰 고양이", imageUrl: '/questions/L19.jpg',
    sourcePrompt: "A fluffy white cat curled up asleep, individual fur strands visible. A simple background that clearly indicates one place with at most two plain background shapes, muted so that it does not compete with the subject's texture. Children's educational illustration, soft digital painting with clearly visible surface texture, even neutral lighting, simple and unambiguous composition, no text, no letters, no numbers, no logos, no brand marks, no signage, not a real identifiable person, no violence, the illustration fills the entire canvas edge to edge, no picture frame, no border, no mat, no wall behind it, not a photo of a framed painting, high detail on the main subject.",
    rubric: "만져 본 느낌과 자세까지 말해 봐요.\
\
반질반질한지 거친지, 어떤 자세인지, 배경은 어떤 곳인지 함께 써 주세요." },
  { level: 20, chasi: 4, koreanTitle: "반질반질한 금속 주전자", imageUrl: '/questions/L20.jpg',
    sourcePrompt: "A polished metal kettle with bright specular highlights. A simple background that clearly indicates one place with at most two plain background shapes, muted so that it does not compete with the subject's texture. Children's educational illustration, soft digital painting with clearly visible surface texture, even neutral lighting, simple and unambiguous composition, no text, no letters, no numbers, no logos, no brand marks, no signage, not a real identifiable person, no violence, the illustration fills the entire canvas edge to edge, no picture frame, no border, no mat, no wall behind it, not a photo of a framed painting, high detail on the main subject.",
    rubric: "만져 본 느낌과 자세까지 말해 봐요.\
\
반질반질한지 거친지, 어떤 자세인지, 배경은 어떤 곳인지 함께 써 주세요." },
  { level: 21, chasi: 4, koreanTitle: "무릎을 굽히고 앉은 아이", imageUrl: '/questions/L21.jpg',
    sourcePrompt: "A child crouching with knees bent and arms around the knees. A simple background that clearly indicates one place with at most two plain background shapes, muted so that it does not compete with the subject's texture. Children's educational illustration, soft digital painting with clearly visible surface texture, even neutral lighting, simple and unambiguous composition, no text, no letters, no numbers, no logos, no brand marks, no signage, not a real identifiable person, no violence, the illustration fills the entire canvas edge to edge, no picture frame, no border, no mat, no wall behind it, not a photo of a framed painting, high detail on the main subject.",
    rubric: "만져 본 느낌과 자세까지 말해 봐요.\
\
반질반질한지 거친지, 어떤 자세인지, 배경은 어떤 곳인지 함께 써 주세요." },
  { level: 22, chasi: 4, koreanTitle: "거친 나무껍질의 나무 밑동", imageUrl: '/questions/L22.jpg',
    sourcePrompt: "The base of a thick tree trunk with deeply rough bark. A simple background that clearly indicates one place with at most two plain background shapes, muted so that it does not compete with the subject's texture. Children's educational illustration, soft digital painting with clearly visible surface texture, even neutral lighting, simple and unambiguous composition, no text, no letters, no numbers, no logos, no brand marks, no signage, not a real identifiable person, no violence, the illustration fills the entire canvas edge to edge, no picture frame, no border, no mat, no wall behind it, not a photo of a framed painting, high detail on the main subject.",
    rubric: "만져 본 느낌과 자세까지 말해 봐요.\
\
반질반질한지 거친지, 어떤 자세인지, 배경은 어떤 곳인지 함께 써 주세요." },
  { level: 23, chasi: 4, koreanTitle: "구겨진 종이비행기", imageUrl: '/questions/L23.jpg',
    sourcePrompt: "A crumpled paper plane with sharp creases and folds. A simple background that clearly indicates one place with at most two plain background shapes, muted so that it does not compete with the subject's texture. Children's educational illustration, soft digital painting with clearly visible surface texture, even neutral lighting, simple and unambiguous composition, no text, no letters, no numbers, no logos, no brand marks, no signage, not a real identifiable person, no violence, the illustration fills the entire canvas edge to edge, no picture frame, no border, no mat, no wall behind it, not a photo of a framed painting, high detail on the main subject.",
    rubric: "만져 본 느낌과 자세까지 말해 봐요.\
\
반질반질한지 거친지, 어떤 자세인지, 배경은 어떤 곳인지 함께 써 주세요." },
  { level: 24, chasi: 4, koreanTitle: "젖어서 축 늘어진 수건", imageUrl: '/questions/L24.jpg',
    sourcePrompt: "A soaked towel hanging limp and heavy, dripping. A simple background that clearly indicates one place with at most two plain background shapes, muted so that it does not compete with the subject's texture. Children's educational illustration, soft digital painting with clearly visible surface texture, even neutral lighting, simple and unambiguous composition, no text, no letters, no numbers, no logos, no brand marks, no signage, not a real identifiable person, no violence, the illustration fills the entire canvas edge to edge, no picture frame, no border, no mat, no wall behind it, not a photo of a framed painting, high detail on the main subject.",
    rubric: "만져 본 느낌과 자세까지 말해 봐요.\
\
반질반질한지 거친지, 어떤 자세인지, 배경은 어떤 곳인지 함께 써 주세요." },
  { level: 25, chasi: 5, koreanTitle: "노을 지는 저녁 바닷가", imageUrl: '/questions/L25.jpg',
    sourcePrompt: "An empty seashore at sunset, warm orange sky, long shadows. Full scene background in which the time of day and the mood are unmistakable. Besides the setting itself the scene contains at most three clearly separable objects. Children's educational illustration, soft digital painting with clearly visible surface texture, even neutral lighting, simple and unambiguous composition, no text, no letters, no numbers, no logos, no brand marks, no signage, not a real identifiable person, no violence, the illustration fills the entire canvas edge to edge, no picture frame, no border, no mat, no wall behind it, not a photo of a framed painting, high detail on the main subject.",
    rubric: "언제인지, 어떤 느낌인지 담아 써 봐요.\
\
분위기를 쓸 때는 그림 속 무엇 때문에 그렇게 느꼈는지 근거도 함께 써 주세요." },
  { level: 26, chasi: 5, koreanTitle: "비 오는 날 창가", imageUrl: '/questions/L26.jpg',
    sourcePrompt: "A window with rain streaks, grey daylight outside, calm quiet mood. Full scene background in which the time of day and the mood are unmistakable. Besides the setting itself the scene contains at most three clearly separable objects. Children's educational illustration, soft digital painting with clearly visible surface texture, even neutral lighting, simple and unambiguous composition, no text, no letters, no numbers, no logos, no brand marks, no signage, not a real identifiable person, no violence, the illustration fills the entire canvas edge to edge, no picture frame, no border, no mat, no wall behind it, not a photo of a framed painting, high detail on the main subject.",
    rubric: "언제인지, 어떤 느낌인지 담아 써 봐요.\
\
분위기를 쓸 때는 그림 속 무엇 때문에 그렇게 느꼈는지 근거도 함께 써 주세요." },
  { level: 27, chasi: 5, koreanTitle: "눈 내리는 밤 가로등 아래", imageUrl: '/questions/L27.jpg',
    sourcePrompt: "A street lamp at night with snow falling through its light. Full scene background in which the time of day and the mood are unmistakable. Besides the setting itself the scene contains at most three clearly separable objects. Children's educational illustration, soft digital painting with clearly visible surface texture, even neutral lighting, simple and unambiguous composition, no text, no letters, no numbers, no logos, no brand marks, no signage, not a real identifiable person, no violence, the illustration fills the entire canvas edge to edge, no picture frame, no border, no mat, no wall behind it, not a photo of a framed painting, high detail on the main subject.",
    rubric: "언제인지, 어떤 느낌인지 담아 써 봐요.\
\
분위기를 쓸 때는 그림 속 무엇 때문에 그렇게 느꼈는지 근거도 함께 써 주세요." },
  { level: 28, chasi: 5, koreanTitle: "아침 햇살이 드는 교실", imageUrl: '/questions/L28.jpg',
    sourcePrompt: "An empty classroom with bright morning sunlight across the desks. Full scene background in which the time of day and the mood are unmistakable. Besides the setting itself the scene contains at most three clearly separable objects. Children's educational illustration, soft digital painting with clearly visible surface texture, even neutral lighting, simple and unambiguous composition, no text, no letters, no numbers, no logos, no brand marks, no signage, not a real identifiable person, no violence, the illustration fills the entire canvas edge to edge, no picture frame, no border, no mat, no wall behind it, not a photo of a framed painting, high detail on the main subject.",
    rubric: "언제인지, 어떤 느낌인지 담아 써 봐요.\
\
분위기를 쓸 때는 그림 속 무엇 때문에 그렇게 느꼈는지 근거도 함께 써 주세요." },
  { level: 29, chasi: 5, koreanTitle: "안개 낀 이른 아침 숲길", imageUrl: '/questions/L29.jpg',
    sourcePrompt: "A forest path in early morning fog, soft pale light. Full scene background in which the time of day and the mood are unmistakable. Besides the setting itself the scene contains at most three clearly separable objects. Children's educational illustration, soft digital painting with clearly visible surface texture, even neutral lighting, simple and unambiguous composition, no text, no letters, no numbers, no logos, no brand marks, no signage, not a real identifiable person, no violence, the illustration fills the entire canvas edge to edge, no picture frame, no border, no mat, no wall behind it, not a photo of a framed painting, high detail on the main subject.",
    rubric: "언제인지, 어떤 느낌인지 담아 써 봐요.\
\
분위기를 쓸 때는 그림 속 무엇 때문에 그렇게 느꼈는지 근거도 함께 써 주세요." },
  { level: 30, chasi: 5, koreanTitle: "해 질 무렵 텅 빈 놀이터", imageUrl: '/questions/L30.jpg',
    sourcePrompt: "An empty playground at dusk, swings still, lonely mood. Full scene background in which the time of day and the mood are unmistakable. Besides the setting itself the scene contains at most three clearly separable objects. Children's educational illustration, soft digital painting with clearly visible surface texture, even neutral lighting, simple and unambiguous composition, no text, no letters, no numbers, no logos, no brand marks, no signage, not a real identifiable person, no violence, the illustration fills the entire canvas edge to edge, no picture frame, no border, no mat, no wall behind it, not a photo of a framed painting, high detail on the main subject.",
    rubric: "언제인지, 어떤 느낌인지 담아 써 봐요.\
\
분위기를 쓸 때는 그림 속 무엇 때문에 그렇게 느꼈는지 근거도 함께 써 주세요." },
  { level: 31, chasi: 6, koreanTitle: "저녁 공원 벤치의 아이와 강아지", imageUrl: '/questions/L31.jpg',
    sourcePrompt: "One child sitting on a park bench reading, a dog beside, at dusk. Full scene background with a clear time of day. Around the figure there are exactly three everyday objects and nothing else; keep the scene uncluttered. Children's educational illustration, soft digital painting with clearly visible surface texture, even neutral lighting, simple and unambiguous composition, no text, no letters, no numbers, no logos, no brand marks, no signage, not a real identifiable person, no violence, the illustration fills the entire canvas edge to edge, no picture frame, no border, no mat, no wall behind it, not a photo of a framed painting, high detail on the main subject.",
    rubric: "지금까지 배운 것을 모두 넣어 써 봐요.\
\
무엇이 있는지, 어떻게 생겼는지, 어디에서 언제 어떤 느낌인지 — 세 가지를 빠짐없이!" },
  { level: 32, chasi: 6, koreanTitle: "비 오는 날 우산을 나눠 쓴 두 아이", imageUrl: '/questions/L32.jpg',
    sourcePrompt: "Two children sharing one umbrella in the rain, puddles around. Full scene background with a clear time of day. Around the figure there are exactly three everyday objects and nothing else; keep the scene uncluttered. Children's educational illustration, soft digital painting with clearly visible surface texture, even neutral lighting, simple and unambiguous composition, no text, no letters, no numbers, no logos, no brand marks, no signage, not a real identifiable person, no violence, the illustration fills the entire canvas edge to edge, no picture frame, no border, no mat, no wall behind it, not a photo of a framed painting, high detail on the main subject.",
    rubric: "지금까지 배운 것을 모두 넣어 써 봐요.\
\
무엇이 있는지, 어떻게 생겼는지, 어디에서 언제 어떤 느낌인지 — 세 가지를 빠짐없이!" },
  { level: 33, chasi: 6, koreanTitle: "아침 부엌의 아이", imageUrl: '/questions/L33.jpg',
    sourcePrompt: "One child at a kitchen table in morning light, bread and a glass of milk. Full scene background with a clear time of day. Around the figure there are exactly three everyday objects and nothing else; keep the scene uncluttered. Children's educational illustration, soft digital painting with clearly visible surface texture, even neutral lighting, simple and unambiguous composition, no text, no letters, no numbers, no logos, no brand marks, no signage, not a real identifiable person, no violence, the illustration fills the entire canvas edge to edge, no picture frame, no border, no mat, no wall behind it, not a photo of a framed painting, high detail on the main subject.",
    rubric: "지금까지 배운 것을 모두 넣어 써 봐요.\
\
무엇이 있는지, 어떻게 생겼는지, 어디에서 언제 어떤 느낌인지 — 세 가지를 빠짐없이!" },
  { level: 34, chasi: 6, koreanTitle: "눈사람을 만드는 두 아이", imageUrl: '/questions/L34.jpg',
    sourcePrompt: "Two children building a snowman on a snowy afternoon. Full scene background with a clear time of day. Around the figure there are exactly three everyday objects and nothing else; keep the scene uncluttered. Children's educational illustration, soft digital painting with clearly visible surface texture, even neutral lighting, simple and unambiguous composition, no text, no letters, no numbers, no logos, no brand marks, no signage, not a real identifiable person, no violence, the illustration fills the entire canvas edge to edge, no picture frame, no border, no mat, no wall behind it, not a photo of a framed painting, high detail on the main subject.",
    rubric: "지금까지 배운 것을 모두 넣어 써 봐요.\
\
무엇이 있는지, 어떻게 생겼는지, 어디에서 언제 어떤 느낌인지 — 세 가지를 빠짐없이!" },
  { level: 35, chasi: 6, koreanTitle: "오후 도서관의 아이", imageUrl: '/questions/L35.jpg',
    sourcePrompt: "One child choosing a book from a shelf in an afternoon library. Full scene background with a clear time of day. Around the figure there are exactly three everyday objects and nothing else; keep the scene uncluttered. Children's educational illustration, soft digital painting with clearly visible surface texture, even neutral lighting, simple and unambiguous composition, no text, no letters, no numbers, no logos, no brand marks, no signage, not a real identifiable person, no violence, the illustration fills the entire canvas edge to edge, no picture frame, no border, no mat, no wall behind it, not a photo of a framed painting, high detail on the main subject.",
    rubric: "지금까지 배운 것을 모두 넣어 써 봐요.\
\
무엇이 있는지, 어떻게 생겼는지, 어디에서 언제 어떤 느낌인지 — 세 가지를 빠짐없이!" },
  { level: 36, chasi: 6, koreanTitle: "노을 지는 운동장의 아이", imageUrl: '/questions/L36.jpg',
    sourcePrompt: "One child holding a ball on a schoolyard at sunset. Full scene background with a clear time of day. Around the figure there are exactly three everyday objects and nothing else; keep the scene uncluttered. Children's educational illustration, soft digital painting with clearly visible surface texture, even neutral lighting, simple and unambiguous composition, no text, no letters, no numbers, no logos, no brand marks, no signage, not a real identifiable person, no violence, the illustration fills the entire canvas edge to edge, no picture frame, no border, no mat, no wall behind it, not a photo of a framed painting, high detail on the main subject.",
    rubric: "지금까지 배운 것을 모두 넣어 써 봐요.\
\
무엇이 있는지, 어떻게 생겼는지, 어디에서 언제 어떤 느낌인지 — 세 가지를 빠짐없이!" },
];

export default function PracticePage() {
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
  const [studentPrompt, setStudentPrompt] = useState('');
  const [evaluation, setEvaluation] = useState<EvaluatePromptOutput | null>(null);
  const [generatedImageUrl, setGeneratedImageUrl] = useState<string | null>(null);
  const [isGeneratingImage, setIsGeneratingImage] = useState(true);
  const [imageGenerationError, setImageGenerationError] = useState(false);
  const [isEvaluating, startEvaluationTransition] = useTransition();
  // attemptCounts: questionIndex → 시도 횟수 (현재 세션 기준)
  const [attemptCounts, setAttemptCounts] = useState<Record<number, number>>({});
  const { toast } = useToast();
  const db = useFirestore();

  const isPending = isGeneratingImage || isEvaluating;
  const currentQuestion = questions[currentQuestionIndex];
  const currentAttempts = attemptCounts[currentQuestionIndex] ?? 0;

  useEffect(() => {
    generateNewImage();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentQuestionIndex]);

  const generateNewImage = async () => {
    // 문항 이미지는 사전에 제작·검수한 정적 파일을 사용한다.
    // 실행 중 생성하지 않으므로 학습자에게는 검수된 이미지만 제시된다.
    setImageGenerationError(false);
    setEvaluation(null);
    setStudentPrompt('');
    setGeneratedImageUrl(currentQuestion.imageUrl);
    setIsGeneratingImage(false);
  };

  const toDataURL = async (url: string): Promise<string> => {
    if (url.startsWith('data:')) return url;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Failed to fetch image: ${res.statusText}`);
    const blob = await res.blob();
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  };

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!studentPrompt.trim()) {
      toast({ variant: 'destructive', title: '프롬프트가 비어 있습니다', description: '이미지에 대한 설명을 작성해 주세요.' });
      return;
    }
    setEvaluation(null);

    startEvaluationTransition(async () => {
      try {
        if (!generatedImageUrl) throw new Error('Image not available for evaluation.');
        const photoDataUri = await toDataURL(generatedImageUrl);
        const result = await evaluatePrompt({ studentPrompt, photoDataUri, questionLevel: currentQuestion.level });
        setEvaluation(result);

        // 시도 횟수 증가
        setAttemptCounts(prev => ({ ...prev, [currentQuestionIndex]: (prev[currentQuestionIndex] ?? 0) + 1 }));

        // Firestore 저장
        const classCode = sessionStorage.getItem('classCode');
        const attendanceNumber = sessionStorage.getItem('attendanceNumber');
        if (db && classCode && attendanceNumber) {
          addDoc(collection(db, 'classes', classCode, 'practice_attempts'), {
            attendanceNumber,
            questionIndex: currentQuestionIndex,
            questionLevel: currentQuestion.level,
            questionTitle: currentQuestion.koreanTitle,
            originalPrompt: currentQuestion.sourcePrompt,
            studentPrompt,
            score: result.score,
            feedback: result.feedback,
            // 축별 자료 (논문 <표 Ⅲ-4>·<표 Ⅲ-7>) — 결합 전후를 모두 남긴다
            band: result.band,
            levels: result.levels,
            axisScores: result.axisScores,
            rawCalls: result.calls,
            extraCall: result.extraCall,
            missing: result.missing,
            chasi: currentQuestion.chasi,
            createdAt: serverTimestamp(),
          }).catch((err) => console.error('연습 기록 저장 실패:', err));
        }
      } catch (error) {
        console.error('Evaluation failed:', error);
        toast({ variant: 'destructive', title: '평가 실패', description: 'AI로부터 피드백을 받을 수 없습니다.' });
      }
    });
  };

  const handleRetry = () => {
    setEvaluation(null);
    // studentPrompt는 유지 — 학생이 이전 답을 보고 수정할 수 있도록
  };

  const handleNextQuestion = () => {
    setCurrentQuestionIndex((prev) => (prev + 1) % questions.length);
  };

  const levelColor = (lv: number) => {
    if (lv <= 3) return 'bg-green-100 text-green-800 border-green-200';
    if (lv <= 6) return 'bg-yellow-100 text-yellow-800 border-yellow-200';
    if (lv <= 8) return 'bg-orange-100 text-orange-800 border-orange-200';
    if (lv <= 11) return 'bg-red-100 text-red-800 border-red-200';
    return 'bg-purple-100 text-purple-800 border-purple-200';
  };

  return (
    <div className="min-h-screen bg-background font-sans">
      <header className="p-4 flex justify-between items-center">
        <div className="flex items-center gap-3">
          <Badge variant="outline" className={`text-sm px-3 py-1 border ${levelColor(currentQuestion.level)}`}>
            Lv.{currentQuestion.level}
          </Badge>
          <span className="text-sm text-muted-foreground">
            문제 {currentQuestionIndex + 1} / {questions.length}
          </span>
          {currentAttempts > 0 && (
            <Badge variant="secondary" className="text-xs">
              이 문제 {currentAttempts}번 도전
            </Badge>
          )}
        </div>
        <Link href="/" passHref>
          <Button variant="outline" size="sm"><Home className="mr-2 h-4 w-4" />홈</Button>
        </Link>
      </header>

      <div className="px-4 pb-2">
        <Progress value={((currentQuestionIndex) / questions.length) * 100} className="h-2" />
      </div>

      <main className="container mx-auto p-4 sm:p-6 lg:p-8">
        <div className="text-center mb-8">
          <h1 className="text-4xl font-bold tracking-tight text-transparent bg-clip-text bg-gradient-to-r from-primary via-purple-400 to-pink-500 sm:text-5xl font-headline">연습 모드</h1>
          <p className="mt-2 text-muted-foreground">AI 그림을 보고 설명을 써보세요. 몇 번이든 다시 도전할 수 있어요!</p>
        </div>

        <Card className="max-w-4xl mx-auto shadow-2xl shadow-primary/20 rounded-2xl overflow-hidden border-2 border-primary/20 bg-card/80 backdrop-blur-sm">
          <div className="grid md:grid-cols-5 gap-0">
            <div className="md:col-span-3">
              <div className="relative w-full aspect-[4/3] bg-black/10">
                {isGeneratingImage ? (
                  <div className="w-full h-full bg-muted animate-pulse rounded-tl-2xl md:rounded-l-2xl flex items-center justify-center">
                    <div className="flex flex-col items-center gap-2">
                      <Wand2 className="h-8 w-8 text-muted-foreground animate-pulse" />
                      <p className="text-muted-foreground">이미지 생성 중...</p>
                    </div>
                  </div>
                ) : imageGenerationError ? (
                  <div className="w-full h-full bg-muted rounded-tl-2xl md:rounded-l-2xl flex flex-col items-center justify-center gap-4 p-4 text-center">
                    <p className="text-destructive font-semibold">이미지 생성에 실패했습니다.</p>
                    <Button onClick={generateNewImage} disabled={isGeneratingImage}>
                      <RefreshCw className="mr-2 h-4 w-4" /> 다시 생성하기
                    </Button>
                  </div>
                ) : generatedImageUrl ? (
                  <Image
                    src={generatedImageUrl}
                    alt="AI 생성 평가 이미지"
                    fill
                    className="object-contain rounded-tl-2xl md:rounded-l-2xl"
                    priority
                    sizes="(max-width: 768px) 100vw, 60vw"
                  />
                ) : null}
              </div>
            </div>

            <div className="md:col-span-2 flex flex-col">
              <CardContent className="p-6 flex-grow flex flex-col">
                <Alert className="mb-4 bg-accent/80 border-accent/50 rounded-lg">
                  <BookOpen className="h-4 w-4 text-accent-foreground" />
                  <AlertTitle className="font-semibold text-accent-foreground">힌트</AlertTitle>
                  <AlertDescription className="text-accent-foreground/90 font-body whitespace-pre-line text-sm">
                    {currentQuestion.rubric}
                  </AlertDescription>
                </Alert>

                <form onSubmit={handleSubmit} className="flex-grow flex flex-col">
                  <div className="grid w-full gap-2 flex-grow">
                    <Label htmlFor="prompt-input" className="text-base font-medium">나의 설명 ✨</Label>
                    <Textarea
                      id="prompt-input"
                      placeholder="이 그림은..."
                      value={studentPrompt}
                      onChange={(e) => setStudentPrompt(e.target.value)}
                      rows={5}
                      className="text-base flex-grow bg-input/50 focus:bg-input/80 transition-colors"
                      disabled={isPending || imageGenerationError}
                    />
                  </div>
                  <Button type="submit" size="lg" className="mt-4 w-full" disabled={isPending || imageGenerationError}>
                    {isEvaluating ? <RefreshCw className="mr-2 h-4 w-4 animate-spin" /> : <Wand2 className="mr-2 h-4 w-4" />}
                    평가 받기
                  </Button>
                </form>
              </CardContent>
            </div>
          </div>

          {isEvaluating && (
            <div className="p-6 space-y-4">
              <Skeleton className="h-8 w-1/3" />
              <div className="flex items-center gap-6">
                <Skeleton className="h-24 w-24 rounded-full" />
                <div className="space-y-2 flex-1">
                  <Skeleton className="h-6 w-full" />
                  <Skeleton className="h-6 w-5/6" />
                </div>
              </div>
            </div>
          )}

          {evaluation && !isEvaluating && (
            <div className="p-6 animate-in fade-in-50 duration-500">
              <Card className="bg-card/80 backdrop-blur-sm rounded-xl">
                <CardHeader>
                  <CardTitle className="text-2xl font-headline tracking-tight flex items-center gap-2">
                    AI 선생님의 피드백
                    {currentAttempts > 1 && (
                      <Badge variant="outline" className="text-xs font-normal ml-2">
                        {currentAttempts}번째 도전
                      </Badge>
                    )}
                  </CardTitle>
                </CardHeader>
                <CardContent className="flex flex-col sm:flex-row items-center gap-6">
                  <div className="flex flex-col items-center">
                    <div className="relative flex items-center justify-center size-32 bg-gradient-to-br from-primary/20 to-accent/30 rounded-full">
                      <p className="text-5xl font-bold text-primary">{evaluation.score}</p>
                    </div>
                    <p className="text-muted-foreground mt-2 font-semibold">/ 100점</p>
                  </div>
                  <div className="flex-1">
                    <h4 className="font-semibold text-lg mb-2 flex items-center gap-2"><Star className="text-yellow-400" fill="currentColor" />칭찬 및 개선점</h4>
                    <p className="mt-2 text-muted-foreground whitespace-pre-wrap font-body text-base leading-loose">{evaluation.feedback}</p>
                  </div>
                </CardContent>
                <CardFooter className="flex flex-col sm:flex-row gap-3">
                  <Button onClick={handleRetry} variant="outline" className="w-full sm:w-auto">
                    <RotateCcw className="mr-2 h-4 w-4" />
                    다시 도전하기
                    {currentAttempts > 0 && <span className="ml-1 text-xs text-muted-foreground">({currentAttempts}번째)</span>}
                  </Button>
                  <Button onClick={handleNextQuestion} className="w-full sm:w-auto ml-auto" variant="outline">
                    다음 문제 <ArrowRight className="ml-2 h-4 w-4" />
                  </Button>
                </CardFooter>
              </Card>
            </div>
          )}
        </Card>
      </main>
    </div>
  );
}
