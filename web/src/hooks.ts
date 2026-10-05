import { useCallback, useEffect, useRef, useState } from 'react';
import { dataChanged } from './api.ts';

export interface AsyncState<T> {
  data: T | undefined;
  error: Error | undefined;
  loading: boolean;
  reload: () => void;
}

/** Ma'lumot yuklash: yuklanish, xato va qayta yuklash holatlari bilan. Qayta yuklashda eski ma'lumot ko'rinib turadi. */
export function useAsync<T>(fn: () => Promise<T>, deps: unknown[]): AsyncState<T> {
  const [data, setData] = useState<T>();
  const [error, setError] = useState<Error>();
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);
  const fnRef = useRef(fn);
  fnRef.current = fn;

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(undefined);
    fnRef.current().then(
      (d) => {
        if (!alive) return;
        setData(d);
        setLoading(false);
      },
      (e: unknown) => {
        if (!alive) return;
        setError(e instanceof Error ? e : new Error(String(e)));
        setLoading(false);
      },
    );
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);

  const reload = useCallback(() => setTick((t) => t + 1), []);

  // Boshqa joyda ma'lumot o'zgarsa (masalan, xabardagi "Bekor qilish"), qayta yuklaymiz.
  useEffect(() => {
    dataChanged.addEventListener('change', reload);
    return () => dataChanged.removeEventListener('change', reload);
  }, [reload]);

  return { data, error, loading, reload };
}

/** Matn qidiruvi uchun: katta-kichik harf va apostrof turlarini farqlamaydi. */
export function normalizeSearch(s: string): string {
  return s
    .toLowerCase()
    .replace(/[ʻʼ‘’`´]/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const onChange = () => setMatches(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [query]);
  return matches;
}
