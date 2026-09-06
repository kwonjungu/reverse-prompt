'use client';

import { useState, useRef, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { verifyPassword } from './actions';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Lock, Delete } from 'lucide-react';

export default function AuthPage() {
  const [digits, setDigits] = useState<string[]>([]);
  const [error, setError] = useState(false);
  const [checking, setChecking] = useState(false);
  const router = useRouter();
  const searchParams = useSearchParams();

  const handleDigit = async (d: string) => {
    if (checking) return;
    const next = [...digits, d];
    setDigits(next);
    setError(false);

    if (next.length === 4) {
      setChecking(true);
      const ok = await verifyPassword(next.join(''));
      if (ok) {
        const from = searchParams.get('from') ?? '/';
        router.replace(from);
      } else {
        setError(true);
        setDigits([]);
        setChecking(false);
      }
    }
  };

  const handleDelete = () => {
    setDigits(prev => prev.slice(0, -1));
    setError(false);
  };

  const pad = ['1','2','3','4','5','6','7','8','9','','0','⌫'];

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-gradient-to-br from-primary/20 via-transparent to-primary/20 opacity-30" />
      <Card className="relative z-10 w-full max-w-xs shadow-2xl shadow-primary/10 rounded-2xl bg-card/80 backdrop-blur-sm border-2 border-primary/20">
        <CardHeader className="text-center pb-2">
          <Lock className="h-10 w-10 mx-auto text-primary mb-2" />
          <CardTitle className="font-headline text-2xl">비밀번호 입력</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="flex justify-center gap-3">
            {[0, 1, 2, 3].map(i => (
              <div
                key={i}
                className={`w-4 h-4 rounded-full border-2 transition-all ${
                  i < digits.length
                    ? error ? 'bg-destructive border-destructive' : 'bg-primary border-primary'
                    : 'border-muted-foreground/40'
                }`}
              />
            ))}
          </div>

          {error && <p className="text-center text-destructive text-sm font-medium">비밀번호가 틀렸습니다.</p>}

          <div className="grid grid-cols-3 gap-3">
            {pad.map((key, i) => {
              if (key === '') return <div key={i} />;
              if (key === '⌫') {
                return (
                  <Button key={i} variant="outline" className="h-14 text-xl" onClick={handleDelete}>
                    <Delete className="h-5 w-5" />
                  </Button>
                );
              }
              return (
                <Button
                  key={i}
                  variant="outline"
                  className="h-14 text-2xl font-bold"
                  onClick={() => handleDigit(key)}
                  disabled={digits.length >= 4 || checking}
                >
                  {key}
                </Button>
              );
            })}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
