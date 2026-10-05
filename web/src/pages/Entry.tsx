// Kiritish: kartochkani tanlang → har bir varianti uchun son → bir marta saqlang.
// "Mahsulot keldi"da odatda bir partiyada bir nechta rang/o'lcham keladi — hammasi bitta ekranda.
import { useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  adjustmentFromCount,
  formatDateLabel,
  formatRuleError,
  LOCATION_LABEL,
  needsLocation,
  previewMovement,
  todayIso,
  TYPE_LABEL,
  type Location,
  type MovementType,
  type ProductWithStock,
  type Stock,
  type VariantWithStock,
} from '../../../domain/index.ts';
import { api } from '../api.ts';
import { Icon } from '../components/Icon.tsx';
import { PageHeader } from '../components/Layout.tsx';
import { matchesVariant } from '../components/ProductPicker.tsx';
import { useToast } from '../components/Toast.tsx';
import { Empty, ErrorBox, SearchInput, SkeletonList } from '../components/ui.tsx';
import { num, signed, variantName } from '../format.ts';
import { useAsync } from '../hooks.ts';
import { entryPath, typeFromSlug } from '../movementUi.ts';

export function EntryPage() {
  const { slug } = useParams();
  const type = typeFromSlug(slug);
  if (!type) {
    return (
      <div className="page">
        <PageHeader title="Topilmadi" back="/" />
        <Empty title="Bunday sahifa yo'q">Bosh sahifadan kerakli amalni tanlang.</Empty>
      </div>
    );
  }
  return <Entry key={type} type={type} />;
}

const QUESTION: Partial<Record<MovementType, string>> = {
  received: 'Nechta keldi?',
  adjustment: 'Sanaganda nechta chiqdi?',
  written_off: "Nechtasi brak yoki yo'qolgan?",
};

function Entry({ type }: { type: MovementType }) {
  const navigate = useNavigate();
  const location = useLocation();
  const [params, setParams] = useSearchParams();
  const cardId = params.get('kartochka');
  const variantId = params.get('variant');
  const from = (location.state as { from?: string } | null)?.from ?? '/';
  const pickedHere = (location.state as { picked?: boolean } | null)?.picked === true;

  const products = useAsync(() => api.products(), []);
  const all = products.data?.products ?? [];
  const product = useMemo(
    () => all.find((p) => p.id === cardId) ?? (variantId ? all.find((p) => p.variants.some((v) => v.id === variantId)) : undefined) ?? null,
    [all, cardId, variantId],
  );

  function pick(p: ProductWithStock, focusVariant?: string) {
    const next = new URLSearchParams();
    next.set('kartochka', p.id);
    if (focusVariant) next.set('variant', focusVariant);
    setParams(next, { state: { from, picked: true } });
  }

  function goBack() {
    if (product && pickedHere) navigate(-1);
    else navigate(from);
  }

  return (
    <div className="page page--entry">
      <PageHeader title={TYPE_LABEL[type]} back={goBack} />
      {products.loading && !products.data ? (
        <SkeletonList />
      ) : products.error ? (
        <ErrorBox error={products.error} onRetry={products.reload} />
      ) : !product ? (
        <>
          <h2 className="step-title">Qaysi mahsulot?</h2>
          <CardPicker products={all} onPick={pick} createNext={entryPath(type)} />
        </>
      ) : (
        <BatchForm
          key={product.id}
          type={type}
          product={product}
          focusVariantId={variantId}
          onChangeProduct={() => setParams({}, { state: { from } })}
          onSaved={() => navigate(from, { replace: true })}
        />
      )}
    </div>
  );
}

function recent(a: string | null, b: string | null): number {
  if (a && b) return b.localeCompare(a);
  if (a) return -1;
  if (b) return 1;
  return 0;
}

/** Kartochkani tanlash. Qidiruv nom, rang/o'lcham va artikul bo'yicha; kod to'liq yozilsa — o'sha variant belgilanadi. */
function CardPicker({
  products,
  onPick,
  createNext,
}: {
  products: ProductWithStock[];
  onPick: (p: ProductWithStock, focusVariant?: string) => void;
  createNext: string;
}) {
  const [query, setQuery] = useState('');
  const sorted = useMemo(
    () => products.filter((p) => p.variants.some((v) => !v.archived)).sort((a, b) => recent(a.lastMovementAt, b.lastMovementAt) || a.name.localeCompare(b.name)),
    [products],
  );
  const visible = sorted.filter((p) => matchesVariant(p, null, query));
  const createHref = `/mahsulotlar/yangi?keyin=${encodeURIComponent(createNext)}${query ? `&nom=${encodeURIComponent(query)}` : ''}`;

  if (sorted.length === 0) {
    return (
      <Empty
        title="Hali mahsulot yo'q"
        action={
          <div className="empty__actions">
            <Link to={createHref} className="btn btn--primary">
              <Icon name="plus" size={20} />
              Mahsulot qo'shish
            </Link>
            <Link to="/uzum" className="btn btn--secondary">
              <Icon name="uzum" size={20} />
              Uzumdan import
            </Link>
          </div>
        }
      >
        Avval mahsulot qo'shing yoki Uzumdan import qiling.
      </Empty>
    );
  }

  return (
    <div className="picker">
      <div className="picker__search">
        <SearchInput value={query} onChange={setQuery} placeholder="Nom, rang, o'lcham yoki artikul" />
      </div>
      {visible.length === 0 ? (
        <Empty
          title={`"${query}" topilmadi`}
          action={
            <Link to={createHref} className="btn btn--secondary">
              <Icon name="plus" size={20} />
              Yangi mahsulot qo'shish
            </Link>
          }
        >
          Boshqacha yozib ko'ring yoki yangi mahsulot qo'shing.
        </Empty>
      ) : (
        <ul className="list" role="list">
          {visible.map((p) => {
            const active = p.variants.filter((v) => !v.archived);
            const exact = query.trim() ? active.find((v) => v.code && v.code.toLowerCase() === query.trim().toLowerCase()) : undefined;
            return (
              <li key={p.id}>
                <button type="button" className="row row--button" onClick={() => onPick(p, exact?.id)}>
                  <span className="row__main">
                    <span className="row__title">{p.name}</span>
                    <span className="row__meta">
                      {exact
                        ? `${variantName(exact)} · ${exact.code}`
                        : active.length > 1
                          ? `${active.length} ta variant`
                          : [active[0]?.attributes.length ? variantName(active[0]) : null, active[0]?.code].filter(Boolean).join(' · ') || ' '}
                    </span>
                  </span>
                  <span className="row__stock">
                    <span className="chip chip--own is-strong">
                      Omborda <b>{num(p.stock.own)}</b>
                    </span>
                    <span className="chip chip--uzum">
                      Uzumda <b>{num(p.stock.uzum)}</b>
                    </span>
                  </span>
                  <Icon name="chevron" size={18} className="row__chevron" />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

type RowResult = { kind: 'empty' } | { kind: 'ok'; before: Stock; after: Stock; delta: number } | { kind: 'error'; message: string };

function evaluate(type: MovementType, place: Location | null, v: VariantWithStock, raw: string): RowResult {
  if (raw.trim() === '') return { kind: 'empty' };
  const value = Number(raw);
  if (!Number.isSafeInteger(value)) return { kind: 'error', message: "Butun son kiriting." };
  if (type === 'adjustment') {
    const adj = adjustmentFromCount(v.stock, place!, value);
    if (!adj.ok) return adj.error.code === 'NO_CHANGE' ? { kind: 'empty' } : { kind: 'error', message: formatRuleError(adj.error) };
    const r = previewMovement(v.stock, { type, location: place, quantity: adj.quantity, direction: adj.direction });
    return r.ok ? { kind: 'ok', before: v.stock, after: r.after, delta: adj.direction === 'increase' ? adj.quantity : -adj.quantity } : { kind: 'error', message: formatRuleError(r.error) };
  }
  if (value === 0) return { kind: 'empty' };
  const r = previewMovement(v.stock, { type, location: place, quantity: value });
  return r.ok ? { kind: 'ok', before: v.stock, after: r.after, delta: value } : { kind: 'error', message: formatRuleError(r.error) };
}

function BatchForm({
  type,
  product,
  focusVariantId,
  onChangeProduct,
  onSaved,
}: {
  type: MovementType;
  product: ProductWithStock;
  focusVariantId: string | null;
  onChangeProduct: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const variants = product.variants.filter((v) => !v.archived);
  const [place, setPlace] = useState<Location | null>(needsLocation(type) ? 'own' : null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [date, setDate] = useState(todayIso());
  const [note, setNote] = useState('');
  const [showExtras, setShowExtras] = useState(false);
  const [saving, setSaving] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const inputs = useRef<(HTMLInputElement | null)[]>([]);

  // Kod bo'yicha topilgan variantga yoki birinchi qatorga kursor.
  useEffect(() => {
    const i = Math.max(0, variants.findIndex((v) => v.id === focusVariantId));
    inputs.current[i]?.focus({ preventScroll: i === 0 });
    if (i > 0) inputs.current[i]?.scrollIntoView({ block: 'center' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const results = variants.map((v) => evaluate(type, place, v, values[v.id] ?? ''));
  const filled = results.filter((r) => r.kind === 'ok').length;
  const hasError = results.some((r) => r.kind === 'error');
  const total = results.reduce((n, r) => n + (r.kind === 'ok' ? Math.abs(r.delta) : 0), 0);
  const viewLoc: Location = place ?? (type === 'sold' || type === 'returned' ? 'uzum' : 'own');

  function onKey(e: KeyboardEvent<HTMLInputElement>, i: number) {
    if (e.key === 'Enter' && i < variants.length - 1) {
      e.preventDefault();
      inputs.current[i + 1]?.focus();
    }
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!filled || hasError || saving) return;
    setSaving(true);
    setServerError(null);
    try {
      const items = variants
        .map((v, i) => ({ v, r: results[i]! }))
        .filter(({ r }) => r.kind === 'ok')
        .map(({ v }) => (type === 'adjustment' ? { variantId: v.id, counted: Number(values[v.id]) } : { variantId: v.id, quantity: Number(values[v.id]) }));
      const result = await api.recordBatch({ type, location: place, items, date, note: note.trim() || undefined });
      const ids = result.movements.map((m) => m.id);
      const what = type === 'received' ? `${total} ta keldi` : type === 'adjustment' ? `${ids.length} ta variant tuzatildi` : `${total} ta yozildi`;
      toast.show({
        tone: 'ok',
        message: `${product.name}: ${what}`,
        action: {
          label: 'Bekor qilish',
          run: async () => {
            await api.voidBatch(ids);
            return 'Bekor qilindi. Yozuvlar tarixda qoldi.';
          },
        },
      });
      onSaved();
    } catch (err) {
      setServerError(err instanceof Error ? err.message : String(err));
      setSaving(false);
    }
  }

  return (
    <form className="entry" onSubmit={submit} noValidate>
      <div className="entry__body">
        <button type="button" className="picked" onClick={onChangeProduct}>
          <span className="picked__text">
            <span className="picked__name">{product.name}</span>
            <span className="picked__variant">{variants.length > 1 ? `${variants.length} ta variant` : variants[0]?.code ?? ''}</span>
          </span>
          <span className="picked__change">O'zgartirish</span>
        </button>

        {needsLocation(type) && (
          <fieldset className="segmented">
            <legend className="field-label">Qayerda?</legend>
            {(['own', 'uzum'] as const).map((l) => (
              <label key={l} className="segmented__option">
                <input type="radio" name="place" value={l} checked={place === l} onChange={() => setPlace(l)} />
                <span>
                  {LOCATION_LABEL[l]}
                  <small>{num(product.stock[l])} ta</small>
                </span>
              </label>
            ))}
          </fieldset>
        )}

        <div className="batch">
          <div className="batch__head">
            <span className="field-label batch__question">{QUESTION[type] ?? 'Nechta?'}</span>
            <span className="batch__col">{type === 'adjustment' ? 'Hisobda' : viewLoc === 'own' ? 'Omborda' : 'Uzumda'}</span>
          </div>
          <ul className="batch__rows" role="list">
            {variants.map((v, i) => {
              const r = results[i]!;
              const id = `qty-${v.id}`;
              return (
                <li key={v.id} className={`batch-row${r.kind === 'error' ? ' is-error' : ''}${r.kind === 'ok' ? ' is-filled' : ''}`}>
                  <label htmlFor={id} className="batch-row__label">
                    <span className="batch-row__name">{variants.length > 1 || v.attributes.length ? variantName(v) : product.name}</span>
                    {v.code && <span className="batch-row__code">{v.code}</span>}
                  </label>
                  <span className="batch-row__now">{num(v.stock[viewLoc])}</span>
                  <input
                    ref={(el) => {
                      inputs.current[i] = el;
                    }}
                    id={id}
                    className="batch-row__input"
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    autoComplete="off"
                    enterKeyHint={i < variants.length - 1 ? 'next' : 'done'}
                    placeholder={type === 'adjustment' ? '—' : '0'}
                    value={values[v.id] ?? ''}
                    aria-invalid={r.kind === 'error'}
                    onFocus={(e) => e.currentTarget.select()}
                    onKeyDown={(e) => onKey(e, i)}
                    onChange={(e) => {
                      setServerError(null);
                      setValues({ ...values, [v.id]: e.target.value.replace(/\D/g, '').replace(/^0+(?=\d)/, '').slice(0, 7) });
                    }}
                  />
                  {r.kind === 'ok' && (
                    <span className="batch-row__result">
                      {num(r.before[viewLoc])} → <b>{num(r.after[viewLoc])}</b>
                      {type === 'adjustment' && <span className={`delta delta--${r.delta > 0 ? 'in' : 'out'}`}> ({signed(r.delta)})</span>}
                    </span>
                  )}
                  {r.kind === 'error' && <span className="batch-row__error">{r.message}</span>}
                </li>
              );
            })}
          </ul>
        </div>

        {serverError && (
          <p className="notice notice--error" role="alert">
            {serverError}
          </p>
        )}

        <div className="extras">
          {!showExtras ? (
            <button type="button" className="extras__toggle" onClick={() => setShowExtras(true)}>
              <Icon name="calendar" size={20} />
              <span>
                {formatDateLabel(date)}
                {note ? ' · izoh bor' : ''}
              </span>
              <span className="extras__more">Sana yoki izoh</span>
            </button>
          ) : (
            <div className="extras__fields">
              <div className="field">
                <label htmlFor="entry-date" className="field-label">
                  Sana
                </label>
                <input id="entry-date" type="date" className="input" value={date} max={todayIso()} onChange={(e) => setDate(e.target.value || todayIso())} />
              </div>
              <div className="field">
                <label htmlFor="entry-note" className="field-label">
                  Izoh <span className="optional">(ixtiyoriy)</span>
                </label>
                <textarea
                  id="entry-note"
                  className="input"
                  rows={2}
                  maxLength={500}
                  value={note}
                  placeholder={type === 'received' ? 'Masalan: yetkazib beruvchi nomi' : ''}
                  onChange={(e) => setNote(e.target.value)}
                />
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="entry__bar">
        <button type="submit" className="btn btn--primary btn--block btn--lg" disabled={!filled || hasError || saving}>
          {saving
            ? 'Saqlanmoqda…'
            : !filled
              ? type === 'adjustment'
                ? 'Sanagan sonni kiriting'
                : 'Sonni kiriting'
              : type === 'adjustment'
                ? `Saqlash — ${filled} ta variant`
                : `Saqlash — ${num(total)} ta${filled > 1 ? ` (${filled} variant)` : ''}`}
        </button>
      </div>
    </form>
  );
}
