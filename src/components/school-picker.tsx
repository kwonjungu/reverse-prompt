'use client';

import { useState, useEffect, useRef, useTransition } from 'react';
import { searchSchools, type SchoolMatch } from '@/lib/school-search';
import { Input } from '@/components/ui/input';
import { School, Loader2, X } from 'lucide-react';

interface SchoolPickerProps {
  value: SchoolMatch | null;
  onChange: (school: SchoolMatch | null) => void;
}

export function SchoolPicker({ value, onChange }: SchoolPickerProps) {
  const [query, setQuery] = useState(value?.name ?? '');
  const [results, setResults] = useState<SchoolMatch[]>([]);
  const [showDropdown, setShowDropdown] = useState(false);
  const [isPending, startTransition] = useTransition();
  const containerRef = useRef<HTMLDivElement>(null);

  // 외부에서 value가 바뀌면 표시 텍스트 동기화
  useEffect(() => {
    setQuery(value?.name ?? '');
  }, [value]);

  // 검색어가 바뀌면 디바운스 후 NEIS 호출
  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < 2 || (value && value.name === trimmed)) {
      setResults([]);
      return;
    }
    const timer = setTimeout(() => {
      startTransition(async () => {
        const r = await searchSchools(trimmed);
        setResults(r);
        setShowDropdown(true);
      });
    }, 300);
    return () => clearTimeout(timer);
  }, [query, value]);

  // 바깥 클릭하면 닫기
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setShowDropdown(false);
      }
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  return (
    <div ref={containerRef} className="relative">
      <div className="relative">
        <School className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
        <Input
          placeholder="학교 이름 검색 (2글자 이상)"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            if (value) onChange(null);
          }}
          onFocus={() => {
            if (results.length > 0) setShowDropdown(true);
          }}
          className="h-12 text-lg pl-10 pr-10"
        />
        {isPending ? (
          <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground animate-spin" />
        ) : value ? (
          <button
            type="button"
            onClick={() => {
              onChange(null);
              setQuery('');
              setResults([]);
            }}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            aria-label="학교 선택 지우기"
          >
            <X className="h-4 w-4" />
          </button>
        ) : null}
      </div>

      {showDropdown && results.length > 0 && !value && (
        <div className="absolute z-50 w-full mt-1 max-h-72 overflow-auto bg-popover border-2 rounded-lg shadow-xl">
          {results.map((s) => (
            <button
              key={s.code}
              type="button"
              onClick={() => {
                onChange(s);
                setShowDropdown(false);
              }}
              className="w-full text-left px-4 py-3 hover:bg-accent border-b last:border-b-0 transition-colors"
            >
              <div className="font-bold text-sm">{s.name}</div>
              <div className="text-xs text-muted-foreground mt-0.5">
                {s.region}{s.address ? ` · ${s.address}` : ''}
              </div>
            </button>
          ))}
        </div>
      )}
      {showDropdown && query.trim().length >= 2 && results.length === 0 && !isPending && !value && (
        <div className="absolute z-50 w-full mt-1 px-4 py-3 bg-popover border-2 rounded-lg shadow-xl text-sm text-muted-foreground">
          검색 결과가 없어요. 학교 이름을 다시 확인해주세요.
        </div>
      )}
    </div>
  );
}
