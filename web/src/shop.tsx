// Joriy do'kon. Har bir do'konning hisobi alohida — tanlangan do'kon barcha so'rovlarga qo'shiladi.
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { ShopWithStats } from '../../domain/index.ts';
import { api, dataChanged, setCurrentShopId } from './api.ts';
import { useSession } from './session.tsx';

const STORAGE_KEY = 'ombor.shop';
/** Mahsulotlar ro'yxati: bitta do'kon yoki barcha do'konlar birga. */
const SCOPE_KEY = 'ombor.allShops';

function readAll(): boolean {
  try {
    return localStorage.getItem(SCOPE_KEY) === '1';
  } catch {
    return false;
  }
}

function writeAll(all: boolean) {
  try {
    localStorage.setItem(SCOPE_KEY, all ? '1' : '0');
  } catch {
    // xotira yopiq bo'lsa ham ishlayveradi
  }
}

function readStored(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function writeStored(id: string) {
  try {
    localStorage.setItem(STORAGE_KEY, id);
  } catch {
    // xotira yopiq bo'lsa ham ishlayveradi
  }
}

interface ShopValue {
  shops: ShopWithStats[];
  shop: ShopWithStats | null;
  /** Uzum bilan bog'langan do'kon: jo'natish, sotuv, qaytarish avtomatik keladi. */
  uzumLinked: boolean;
  select: (id: string) => void;
  /** Mahsulotlar ro'yxatida barcha do'konlar birga ko'rsatiladimi. */
  allShops: boolean;
  setAllShops: (all: boolean) => void;
  reload: () => void;
}

const ShopContext = createContext<ShopValue | null>(null);

export function ShopProvider({ children }: { children: ReactNode }) {
  const { user } = useSession();
  const [shops, setShops] = useState<ShopWithStats[]>([]);
  const [currentId, setCurrentId] = useState<string | null>(() => readStored());
  const [ready, setReady] = useState(false);
  const [allShops, setAllShopsState] = useState(() => readAll());
  const [tick, setTick] = useState(0);

  // Avval saqlangan do'kon bilan so'rovlar boshlanadi — sahifalar noto'g'ri do'konni yuklamasligi uchun.
  setCurrentShopId(currentId);

  useEffect(() => {
    if (!user) return;
    let alive = true;
    api.shops().then(
      (r) => {
        if (!alive) return;
        // Marketplace'ga ulangan do'konlar bo'lsa — faqat ular ko'rsatiladi ("Mening do'konim" kabi qo'lda ochilganlar yashiriladi,
        // ma'lumoti o'chmaydi).
        const linked = r.shops.filter((s) => s.uzumShopId != null);
        const visible = linked.length ? linked : r.shops;
        setShops(visible);
        const valid = visible.find((s) => s.id === currentId) ? currentId : (visible.find((s) => s.id === r.current) ?? visible[0])?.id ?? null;
        if (valid !== currentId) {
          setCurrentShopId(valid);
          setCurrentId(valid);
          if (valid) writeStored(valid);
        }
        setReady(true);
      },
      () => setReady(true),
    );
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, tick]);

  // Uzumdan yangi do'kon kelishi yoki nomi o'zgarishi mumkin — ma'lumot o'zgarganda ro'yxatni ham yangilaymiz.
  useEffect(() => {
    const onChange = () => setTick((t) => t + 1);
    dataChanged.addEventListener('change', onChange);
    return () => dataChanged.removeEventListener('change', onChange);
  }, []);

  const select = useCallback((id: string) => {
    setCurrentShopId(id);
    setCurrentId(id);
    writeStored(id);
    // Hamma ochiq sahifa yangi do'kon ma'lumotini yuklaydi.
    dataChanged.dispatchEvent(new Event('change'));
  }, []);

  const setAllShops = useCallback((all: boolean) => {
    setAllShopsState(all);
    writeAll(all);
  }, []);

  const shop = shops.find((s) => s.id === currentId) ?? null;
  const value = useMemo(
    () => ({
      shops,
      shop,
      uzumLinked: shop?.uzumShopId != null,
      select,
      allShops: allShops && shops.length > 1,
      setAllShops,
      reload: () => setTick((t) => t + 1),
    }),
    [shops, shop, select, allShops, setAllShops],
  );

  if (user && !ready) return null;
  return <ShopContext.Provider value={value}>{children}</ShopContext.Provider>;
}

export function useShop(): ShopValue {
  const v = useContext(ShopContext);
  if (!v) throw new Error("ShopProvider yo'q");
  return v;
}
