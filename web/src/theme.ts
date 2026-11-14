// Ko'rinish: tizim bo'yicha (avto), yorug' yoki qorong'i. Tanlov shu brauzerda saqlanadi.
export type Theme = 'system' | 'light' | 'dark';

const KEY = 'ombor.theme';

export function readTheme(): Theme {
  try {
    const t = localStorage.getItem(KEY);
    return t === 'light' || t === 'dark' ? t : 'system';
  } catch {
    return 'system';
  }
}

export function applyTheme(theme: Theme) {
  const root = document.documentElement;
  if (theme === 'system') delete root.dataset.theme;
  else root.dataset.theme = theme;
  try {
    if (theme === 'system') localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, theme);
  } catch {
    // xotira yopiq bo'lsa ham shu sahifada ishlaydi
  }
}
