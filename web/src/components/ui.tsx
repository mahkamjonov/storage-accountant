import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { Stock } from '../../../domain/index.ts';
import { num } from '../format.ts';
import { Icon } from './Icon.tsx';

export function Loading({ label = 'Yuklanmoqda…' }: { label?: string }) {
  return (
    <div className="state state--loading" role="status">
      <span className="spinner" aria-hidden="true" />
      {label}
    </div>
  );
}

/** Ro'yxat yuklanayotganda ko'rinadigan kulrang qatorlar. */
export function SkeletonList({ rows = 4 }: { rows?: number }) {
  return (
    <div className="skeleton-list" role="status" aria-label="Yuklanmoqda">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="skeleton-row" />
      ))}
    </div>
  );
}

export function ErrorBox({ error, onRetry }: { error: Error; onRetry?: () => void }) {
  return (
    <div className="state state--error" role="alert">
      <p>{error.message}</p>
      {onRetry && (
        <button type="button" className="btn btn--secondary btn--sm" onClick={onRetry}>
          Qaytadan urinish
        </button>
      )}
    </div>
  );
}

export function Empty({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty">
      <p className="empty__title">{title}</p>
      {children && <p className="empty__text">{children}</p>}
      {action}
    </div>
  );
}

/** Omborimda / Uzumda / Jami */
export function StockFigures({ stock, size = 'md' }: { stock: Stock; size?: 'md' | 'lg' }) {
  return (
    <dl className={`figures figures--${size}`}>
      <div className="figure figure--own">
        <dt>Omborimda</dt>
        <dd>{num(stock.own)}</dd>
      </div>
      <div className="figure figure--uzum">
        <dt>Uzumda</dt>
        <dd>{num(stock.uzum)}</dd>
      </div>
      <div className="figure figure--total">
        <dt>Jami</dt>
        <dd>{num(stock.total)}</dd>
      </div>
    </dl>
  );
}

/** Tasdiqlash oynasi (brauzerning <dialog> elementi asosida). */
export function ConfirmDialog({
  open,
  title,
  children,
  confirmLabel,
  danger,
  onConfirm,
  onClose,
}: {
  open: boolean;
  title: string;
  children?: ReactNode;
  confirmLabel: string;
  danger?: boolean;
  onConfirm: () => Promise<void>;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      setError(null);
      setBusy(false);
      d.showModal();
    }
    if (!open && d.open) d.close();
  }, [open]);

  async function confirm() {
    setBusy(true);
    setError(null);
    try {
      await onConfirm();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }

  return (
    <dialog ref={ref} className="dialog" onClose={onClose} onCancel={onClose} aria-labelledby="dialog-title">
      <h2 id="dialog-title" className="dialog__title">
        {title}
      </h2>
      {children && <div className="dialog__body">{children}</div>}
      {error && (
        <p className="notice notice--error" role="alert">
          {error}
        </p>
      )}
      <div className="dialog__actions">
        {error ? (
          // Amal bajarib bo'lmasa, qayta urinish tugmasini ko'rsatmaymiz — sabab yuqorida yozilgan.
          <button type="button" className="btn btn--secondary" onClick={onClose}>
            Tushunarli
          </button>
        ) : (
          <>
            <button type="button" className="btn btn--secondary" onClick={onClose} disabled={busy}>
              Yo'q, qaytish
            </button>
            <button type="button" className={`btn ${danger ? 'btn--danger' : 'btn--primary'}`} onClick={confirm} disabled={busy}>
              {busy ? 'Kuting…' : confirmLabel}
            </button>
          </>
        )}
      </div>
    </dialog>
  );
}

export function SearchInput({
  value,
  onChange,
  placeholder,
  autoFocus,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  autoFocus?: boolean;
}) {
  return (
    <label className="search">
      <Icon name="search" size={20} className="search__icon" />
      <span className="visually-hidden">Qidirish</span>
      <input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoFocus={autoFocus}
        autoComplete="off"
        enterKeyHint="search"
      />
      {value && (
        <button type="button" className="search__clear" onClick={() => onChange('')} aria-label="Tozalash">
          <Icon name="close" size={18} />
        </button>
      )}
    </label>
  );
}
