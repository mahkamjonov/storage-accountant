// Saqlangandan keyingi xabar va "Bekor qilish" (Undo) tugmasi.
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { Icon } from './Icon.tsx';

interface ToastData {
  id: number;
  message: string;
  tone: 'ok' | 'error';
  action?: { label: string; run: () => Promise<string | void> };
}

interface ToastApi {
  show: (t: Omit<ToastData, 'id'>) => void;
}

const ToastContext = createContext<ToastApi | null>(null);
const DURATION_MS = 8000;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<ToastData | null>(null);
  const [busy, setBusy] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  const seq = useRef(0);

  const dismiss = useCallback(() => {
    window.clearTimeout(timer.current);
    setToast(null);
  }, []);

  const show = useCallback((t: Omit<ToastData, 'id'>) => {
    window.clearTimeout(timer.current);
    seq.current += 1;
    setBusy(false);
    setToast({ ...t, id: seq.current });
    timer.current = window.setTimeout(() => setToast(null), t.action ? DURATION_MS : 4000);
  }, []);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  async function runAction() {
    if (!toast?.action) return;
    window.clearTimeout(timer.current);
    setBusy(true);
    try {
      const msg = await toast.action.run();
      show({ message: msg || 'Bekor qilindi', tone: 'ok' });
    } catch (e) {
      show({ message: e instanceof Error ? e.message : String(e), tone: 'error' });
    }
  }

  return (
    <ToastContext.Provider value={{ show }}>
      {children}
      <div className="toast-region" role="status" aria-live="polite">
        {toast && (
          <div key={toast.id} className={`toast toast--${toast.tone}`}>
            <Icon name={toast.tone === 'ok' ? 'check' : 'written_off'} size={20} className="toast__icon" />
            <span className="toast__msg">{toast.message}</span>
            {toast.action && (
              <button type="button" className="toast__action" onClick={runAction} disabled={busy}>
                {busy ? 'Kuting…' : toast.action.label}
              </button>
            )}
            <button type="button" className="toast__close" onClick={dismiss} aria-label="Yopish">
              <Icon name="close" size={18} />
            </button>
          </div>
        )}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const v = useContext(ToastContext);
  if (!v) throw new Error('ToastProvider yo\'q');
  return v;
}
