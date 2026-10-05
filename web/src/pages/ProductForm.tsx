// Kartochka qo'shish va tahrirlash. Xususiyatlar (Rang, O'lcham, ...) va qiymatlaridan barcha variantlar yasaladi — Uzumdagi kabi.
import { useEffect, useId, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  buildVariantMatrix,
  suggestCode,
  variantLabel,
  type Attribute,
  type Characteristic,
  type ProductWithStock,
  type VariantWithStock,
} from '../../../domain/index.ts';
import { api } from '../api.ts';
import { Icon } from '../components/Icon.tsx';
import { PageHeader } from '../components/Layout.tsx';
import { useToast } from '../components/Toast.tsx';
import { ConfirmDialog, ErrorBox, Loading } from '../components/ui.tsx';
import { num, variantName } from '../format.ts';
import { useAsync } from '../hooks.ts';

const digits = (s: string) => s.replace(/\D/g, '').slice(0, 7);
const toInt = (s: string) => (s === '' ? 0 : Number(s));
const attrKey = (attrs: readonly Attribute[]) => attrs.map((a) => `${a.name}=${a.value}`.toLowerCase()).join('|');
const SUGGESTED = ['Rang', "O'lcham", 'Hajm', 'Model', 'Material'];

// ---------------------------------------------------------------------------
// Yangi kartochka
// ---------------------------------------------------------------------------

interface RowState {
  code: string;
  codeTouched: boolean;
  own: string;
  uzum: string;
}

export function NewProductPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const toast = useToast();
  const ids = useId();
  // Harakat kiritishdan kelgan bo'lsa, qo'shilgandan keyin o'sha yerga qaytamiz.
  const next = params.get('keyin');
  const safeNext = next && next.startsWith('/') && !next.startsWith('//') ? next : null;

  const [name, setName] = useState(params.get('nom') ?? '');
  const [baseCode, setBaseCode] = useState('');
  const [threshold, setThreshold] = useState('10');
  const [chars, setChars] = useState<Characteristic[]>([]);
  const [rows, setRows] = useState<Record<string, RowState>>({});
  const [nameError, setNameError] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const matrix = useMemo(() => buildVariantMatrix(chars), [chars]);

  function row(attrs: Attribute[]): RowState {
    const saved = rows[attrKey(attrs)];
    const auto = baseCode.trim() ? suggestCode(baseCode, attrs) : '';
    if (!saved) return { code: auto, codeTouched: false, own: '', uzum: '' };
    return saved.codeTouched ? saved : { ...saved, code: auto };
  }

  function setRow(attrs: Attribute[], patch: Partial<RowState>) {
    setRows((prev) => ({ ...prev, [attrKey(attrs)]: { ...row(attrs), ...patch } }));
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      setNameError(true);
      document.getElementById(`${ids}-name`)?.focus();
      return;
    }
    const incomplete = chars.find((c) => c.name.trim() && c.values.length === 0);
    if (incomplete) {
      setError(`"${incomplete.name}" uchun kamida bitta qiymat qo'shing (masalan, Qora) yoki bu xususiyatni olib tashlang.`);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const { product } = await api.createProduct({
        name,
        lowStockThreshold: toInt(threshold),
        variants: matrix.map((attributes) => {
          const r = row(attributes);
          return { attributes, code: r.code, initialOwn: toInt(r.own), initialUzum: toInt(r.uzum) };
        }),
      });
      toast.show({ tone: 'ok', message: `"${product.name}" qo'shildi: ${product.variants.length} ta variant` });
      if (safeNext) {
        const sep = safeNext.includes('?') ? '&' : '?';
        const target = product.variants.length === 1 ? `variant=${product.variants[0]!.id}` : `kartochka=${product.id}`;
        navigate(`${safeNext}${sep}${target}`, { replace: true, state: { from: '/' } });
      } else {
        navigate(`/mahsulotlar/${product.id}`, { replace: true });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  }

  return (
    <div className="page">
      <PageHeader title="Yangi mahsulot" back={safeNext ?? '/mahsulotlar'} />
      <form className="form form--wide" onSubmit={submit} noValidate>
        <section className="form-section">
          <div className="field">
            <label htmlFor={`${ids}-name`} className="field-label">
              Nomi
            </label>
            <input
              id={`${ids}-name`}
              className="input"
              value={name}
              maxLength={200}
              placeholder="Masalan: Hoodie oversize, paxta"
              aria-invalid={nameError}
              autoFocus={!name}
              onChange={(e) => {
                setNameError(false);
                setName(e.target.value);
              }}
            />
            {nameError && <p className="field-error">Mahsulot nomini yozing.</p>}
          </div>
        </section>

        <section className="form-section">
          <h2 className="form-section__title">Xususiyatlar</h2>
          <p className="field-hint">
            Rang, o'lcham va boshqalar. Har bir kombinatsiya alohida variant bo'ladi (Qora M, Qora L, Oq M ...). Bitta xil
            mahsulot bo'lsa — bo'sh qoldiring.
          </p>
          {chars.map((c, i) => (
            <CharacteristicEditor
              key={i}
              value={c}
              onChange={(v) => setChars(chars.map((x, j) => (j === i ? v : x)))}
              onRemove={() => setChars(chars.filter((_, j) => j !== i))}
            />
          ))}
          <div className="chip-actions">
            {SUGGESTED.filter((s) => !chars.some((c) => c.name.toLowerCase() === s.toLowerCase()))
              .slice(0, 3)
              .map((s) => (
                <button key={s} type="button" className="btn btn--secondary btn--sm" onClick={() => setChars([...chars, { name: s, values: [] }])}>
                  <Icon name="plus" size={18} />
                  {s}
                </button>
              ))}
            <button type="button" className="btn btn--ghost btn--sm" onClick={() => setChars([...chars, { name: '', values: [] }])}>
              <Icon name="plus" size={18} />
              Boshqa xususiyat
            </button>
          </div>
        </section>

        <section className="form-section">
          <h2 className="form-section__title">
            {matrix.length > 1 ? `Variantlar — ${matrix.length} ta` : 'Artikul va hozirgi qoldiq'}
          </h2>
          <div className="field">
            <label htmlFor={`${ids}-base`} className="field-label">
              Asosiy artikul <span className="optional">(ixtiyoriy)</span>
            </label>
            <input
              id={`${ids}-base`}
              className="input"
              value={baseCode}
              maxLength={80}
              placeholder="Masalan: HOODIE"
              autoCapitalize="characters"
              onChange={(e) => setBaseCode(e.target.value)}
            />
            <p className="field-hint">
              Har bir variant artikuli shundan yasaladi: HOODIE-QORA-L. Uzumdagi artikul bilan bir xil bo'lsa, ilova Uzumdagi
              jo'natish va sotuvlarni o'zi taniydi.
            </p>
          </div>

          <ul className="variant-editor" role="list">
            {matrix.map((attrs) => {
              const r = row(attrs);
              const key = attrKey(attrs);
              return (
                <li key={key} className="variant-editor__row">
                  <span className="variant-editor__label">{variantLabel(attrs) || name.trim() || 'Mahsulot'}</span>
                  <label className="variant-editor__code">
                    <span className="visually-hidden">Artikul</span>
                    <input
                      className="input input--mono"
                      value={r.code}
                      placeholder="Artikul"
                      maxLength={200}
                      autoCapitalize="characters"
                      onChange={(e) => setRow(attrs, { code: e.target.value, codeTouched: true })}
                    />
                  </label>
                  <label className="variant-editor__qty">
                    <span className="variant-editor__qty-label">Omborimda</span>
                    <input className="input" inputMode="numeric" placeholder="0" value={r.own} onChange={(e) => setRow(attrs, { own: digits(e.target.value) })} />
                  </label>
                  <label className="variant-editor__qty">
                    <span className="variant-editor__qty-label">Uzumda</span>
                    <input className="input" inputMode="numeric" placeholder="0" value={r.uzum} onChange={(e) => setRow(attrs, { uzum: digits(e.target.value) })} />
                  </label>
                </li>
              );
            })}
          </ul>
          <p className="field-hint">Hozir qancha borligini sanab yozing (ixtiyoriy) — qoldiq shundan boshlanadi.</p>
        </section>

        <section className="form-section">
          <div className="field">
            <label htmlFor={`${ids}-threshold`} className="field-label">
              Nechta qolganda ogohlantirsin?
            </label>
            <input
              id={`${ids}-threshold`}
              className="input input--short"
              inputMode="numeric"
              value={threshold}
              onChange={(e) => setThreshold(digits(e.target.value))}
            />
            <p className="field-hint">Har bir variant uchun: jami qoldig'i shu songa tushsa, bosh sahifada ko'rinadi.</p>
          </div>
        </section>

        {error && (
          <p className="notice notice--error" role="alert">
            {error}
          </p>
        )}

        <div className="form-bar">
          <button type="submit" className="btn btn--primary btn--lg btn--block" disabled={busy}>
            {busy ? 'Saqlanmoqda…' : matrix.length > 1 ? `Qo'shish — ${matrix.length} ta variant` : "Qo'shish"}
          </button>
        </div>
      </form>
    </div>
  );
}

/** Bitta xususiyat: nomi va qiymatlari (chip ko'rinishida). */
function CharacteristicEditor({
  value,
  onChange,
  onRemove,
}: {
  value: Characteristic;
  onChange: (v: Characteristic) => void;
  onRemove: () => void;
}) {
  const ids = useId();
  const [draft, setDraft] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);

  // Qo'shilganda: nomi tayyor bo'lsa — qiymat yozishga, bo'lmasa — nom yozishga.
  useEffect(() => {
    (value.name ? inputRef : nameRef).current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function add(raw: string) {
    const parts = raw
      .split(',')
      .map((s) => s.replace(/\s+/g, ' ').trim())
      .filter(Boolean);
    const fresh = parts.filter((p) => !value.values.some((v) => v.toLowerCase() === p.toLowerCase()));
    if (fresh.length) onChange({ ...value, values: [...value.values, ...fresh] });
    setDraft('');
  }

  function onKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      add(draft);
    } else if (e.key === 'Backspace' && draft === '' && value.values.length) {
      onChange({ ...value, values: value.values.slice(0, -1) });
    }
  }

  const placeholder = /rang/i.test(value.name) ? 'Masalan: Qora' : /o.lcham|razmer/i.test(value.name) ? 'Masalan: M' : 'Qiymat';

  return (
    <div className="char">
      <div className="char__head">
        <label className="visually-hidden" htmlFor={`${ids}-n`}>
          Xususiyat nomi
        </label>
        <input
          id={`${ids}-n`}
          ref={nameRef}
          className="input char__name"
          value={value.name}
          placeholder="Xususiyat nomi"
          maxLength={60}
          onChange={(e) => onChange({ ...value, name: e.target.value })}
        />
        <button type="button" className="icon-btn" aria-label={`"${value.name || 'Xususiyat'}"ni olib tashlash`} onClick={onRemove}>
          <Icon name="trash" size={20} />
        </button>
      </div>
      <div className="char__values" onClick={() => inputRef.current?.focus()}>
        {value.values.map((v) => (
          <span key={v} className="value-chip">
            {v}
            <button
              type="button"
              aria-label={`${v} ni olib tashlash`}
              onClick={(e) => {
                e.stopPropagation();
                onChange({ ...value, values: value.values.filter((x) => x !== v) });
              }}
            >
              <Icon name="close" size={14} />
            </button>
          </span>
        ))}
        <input
          ref={inputRef}
          className="char__input"
          value={draft}
          placeholder={value.values.length ? "Yana qo'shing" : placeholder}
          maxLength={100}
          enterKeyHint="enter"
          aria-label={`${value.name || 'Xususiyat'} qiymati`}
          onChange={(e) => {
            if (e.target.value.includes(',')) add(e.target.value);
            else setDraft(e.target.value);
          }}
          onKeyDown={onKey}
          onBlur={() => draft.trim() && add(draft)}
        />
        {draft.trim() && (
          <button type="button" className="btn btn--secondary btn--sm" onMouseDown={(e) => e.preventDefault()} onClick={() => add(draft)}>
            Qo'shish
          </button>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tahrirlash
// ---------------------------------------------------------------------------

export function EditProductPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const state = useAsync(() => api.product(id), [id]);
  const [confirmArchive, setConfirmArchive] = useState(false);
  const product = state.data?.product;

  return (
    <div className="page">
      <PageHeader title="Tahrirlash" back={`/mahsulotlar/${id}`} />
      {state.loading && !product ? (
        <Loading />
      ) : state.error ? (
        <ErrorBox error={state.error} onRetry={state.reload} />
      ) : product ? (
        <div className="form form--wide">
          <CardFields product={product} />
          <VariantsEditor product={product} />
          <section className="form-section archive">
            <h2 className="form-section__title">Arxiv</h2>
            {product.archived ? (
              <>
                <p>Bu mahsulot arxivda: ro'yxatlarda ko'rinmaydi va unga harakat kiritib bo'lmaydi.</p>
                <button
                  type="button"
                  className="btn btn--secondary"
                  onClick={async () => {
                    await api.updateProduct(id, { archived: false });
                    toast.show({ tone: 'ok', message: 'Arxivdan chiqarildi' });
                  }}
                >
                  Arxivdan chiqarish
                </button>
              </>
            ) : (
              <>
                <p>Endi sotilmaydigan mahsulotni arxivga o'tkazing. Tarix o'chmaydi.</p>
                <button type="button" className="btn btn--secondary" onClick={() => setConfirmArchive(true)}>
                  Arxivga o'tkazish
                </button>
              </>
            )}
          </section>
          <ConfirmDialog
            open={confirmArchive}
            title="Arxivga o'tkazasizmi?"
            confirmLabel="Ha, arxivga"
            onClose={() => setConfirmArchive(false)}
            onConfirm={async () => {
              await api.updateProduct(id, { archived: true });
              toast.show({ tone: 'ok', message: `"${product.name}" arxivga o'tkazildi` });
              navigate('/mahsulotlar', { replace: true });
            }}
          >
            <p>Kartochka va uning barcha variantlari ro'yxatlardan yashiriladi. Tarix saqlanib qoladi, keyin qaytarish mumkin.</p>
          </ConfirmDialog>
        </div>
      ) : null}
    </div>
  );
}

function CardFields({ product }: { product: ProductWithStock }) {
  const toast = useToast();
  const ids = useId();
  const [name, setName] = useState(product.name);
  const [threshold, setThreshold] = useState(String(product.lowStockThreshold));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const dirty = name !== product.name || threshold !== String(product.lowStockThreshold);

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      setError('Mahsulot nomini yozing.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.updateProduct(product.id, { name, lowStockThreshold: toInt(threshold) });
      toast.show({ tone: 'ok', message: "O'zgarishlar saqlandi" });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="form-section" onSubmit={save} noValidate>
      <div className="field">
        <label htmlFor={`${ids}-name`} className="field-label">
          Nomi
        </label>
        <input id={`${ids}-name`} className="input" value={name} maxLength={200} onChange={(e) => setName(e.target.value)} />
      </div>
      <div className="field">
        <label htmlFor={`${ids}-t`} className="field-label">
          Nechta qolganda ogohlantirsin?
        </label>
        <input id={`${ids}-t`} className="input input--short" inputMode="numeric" value={threshold} onChange={(e) => setThreshold(digits(e.target.value))} />
      </div>
      {error && (
        <p className="notice notice--error" role="alert">
          {error}
        </p>
      )}
      {dirty && (
        <button type="submit" className="btn btn--primary" disabled={busy}>
          {busy ? 'Saqlanmoqda…' : 'Saqlash'}
        </button>
      )}
    </form>
  );
}

function VariantsEditor({ product }: { product: ProductWithStock }) {
  const [adding, setAdding] = useState(false);
  // Mavjud xususiyat nomlari (yangi variant uchun maydonlar).
  const names = useMemo(() => {
    const list: string[] = [];
    for (const v of product.variants) for (const a of v.attributes) if (!list.includes(a.name)) list.push(a.name);
    return list;
  }, [product.variants]);

  return (
    <section className="form-section">
      <h2 className="form-section__title">Variantlar — {product.variants.filter((v) => !v.archived).length} ta</h2>
      <ul className="list" role="list">
        {product.variants.map((v) => (
          <VariantEditRow key={v.id} variant={v} />
        ))}
      </ul>
      {adding ? (
        <AddVariantForm product={product} names={names} onDone={() => setAdding(false)} />
      ) : (
        <button type="button" className="btn btn--secondary" onClick={() => setAdding(true)}>
          <Icon name="plus" size={20} />
          Variant qo'shish
        </button>
      )}
    </section>
  );
}

function VariantEditRow({ variant: v }: { variant: VariantWithStock }) {
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [code, setCode] = useState(v.code ?? '');
  const [attrs, setAttrs] = useState(v.attributes);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await api.updateVariant(v.id, { code, attributes: attrs });
      toast.show({ tone: 'ok', message: 'Variant saqlandi' });
      setEditing(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function toggleArchive() {
    try {
      await api.updateVariant(v.id, { archived: !v.archived });
      toast.show({ tone: 'ok', message: v.archived ? 'Variant arxivdan chiqarildi' : "Variant arxivga o'tkazildi" });
    } catch (err) {
      toast.show({ tone: 'error', message: err instanceof Error ? err.message : String(err) });
    }
  }

  if (!editing) {
    return (
      <li className={`variant-line${v.archived ? ' is-archived' : ''}`}>
        <span className="row__main">
          <span className="row__title">
            {variantName(v)}
            {v.archived && <span className="badge badge--muted">Arxivda</span>}
            {v.uzumSkuId !== null && <span className="badge badge--uzum">Uzum</span>}
          </span>
          <span className="row__meta">
            {v.code ?? 'Artikul yo\'q'} · jami {num(v.stock.total)} ta
          </span>
        </span>
        <span className="variant-line__actions">
          <button type="button" className="link-btn link-btn--plain" onClick={() => setEditing(true)}>
            O'zgartirish
          </button>
          <button type="button" className="link-btn link-btn--plain" onClick={toggleArchive}>
            {v.archived ? 'Qaytarish' : 'Arxivga'}
          </button>
        </span>
      </li>
    );
  }

  return (
    <li className="variant-line variant-line--editing">
      {attrs.map((a, i) => (
        <label key={a.name} className="field">
          <span className="field-label">{a.name}</span>
          <input className="input" value={a.value} onChange={(e) => setAttrs(attrs.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))} />
        </label>
      ))}
      <label className="field">
        <span className="field-label">Artikul</span>
        <input className="input input--mono" value={code} autoCapitalize="characters" onChange={(e) => setCode(e.target.value)} />
      </label>
      {error && (
        <p className="notice notice--error" role="alert">
          {error}
        </p>
      )}
      <div className="row-actions">
        <button type="button" className="btn btn--primary btn--sm" onClick={save} disabled={busy}>
          {busy ? 'Saqlanmoqda…' : 'Saqlash'}
        </button>
        <button
          type="button"
          className="btn btn--ghost btn--sm"
          onClick={() => {
            setEditing(false);
            setCode(v.code ?? '');
            setAttrs(v.attributes);
            setError(null);
          }}
        >
          Bekor
        </button>
      </div>
    </li>
  );
}

function AddVariantForm({ product, names, onDone }: { product: ProductWithStock; names: string[]; onDone: () => void }) {
  const toast = useToast();
  const [values, setValues] = useState<Record<string, string>>({});
  const [code, setCode] = useState('');
  const [own, setOwn] = useState('');
  const [uzum, setUzum] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fieldNames = names.length ? names : ['Variant'];

  async function save(e: FormEvent) {
    e.preventDefault();
    const attributes = fieldNames.map((n) => ({ name: n, value: (values[n] ?? '').trim() })).filter((a) => a.value);
    if (attributes.length === 0) {
      setError(`${fieldNames.join(', ')} qiymatini yozing.`);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.addVariant(product.id, { attributes, code, initialOwn: toInt(own), initialUzum: toInt(uzum) });
      toast.show({ tone: 'ok', message: `"${variantLabel(attributes)}" varianti qo'shildi` });
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  }

  return (
    <form className="card card--quiet add-variant" onSubmit={save} noValidate>
      <h3 className="card__title">Yangi variant</h3>
      <div className="field-row field-row--tight">
        {fieldNames.map((n) => (
          <label key={n} className="field">
            <span className="field-label">{n}</span>
            <input className="input" value={values[n] ?? ''} onChange={(e) => setValues({ ...values, [n]: e.target.value })} />
          </label>
        ))}
      </div>
      <label className="field">
        <span className="field-label">Artikul</span>
        <input className="input input--mono" value={code} autoCapitalize="characters" onChange={(e) => setCode(e.target.value)} />
      </label>
      <div className="field-row field-row--tight">
        <label className="field">
          <span className="field-label">Omborimda</span>
          <input className="input" inputMode="numeric" placeholder="0" value={own} onChange={(e) => setOwn(digits(e.target.value))} />
        </label>
        <label className="field">
          <span className="field-label">Uzumda</span>
          <input className="input" inputMode="numeric" placeholder="0" value={uzum} onChange={(e) => setUzum(digits(e.target.value))} />
        </label>
      </div>
      {error && (
        <p className="notice notice--error" role="alert">
          {error}
        </p>
      )}
      <div className="row-actions">
        <button type="submit" className="btn btn--primary" disabled={busy}>
          {busy ? 'Saqlanmoqda…' : "Qo'shish"}
        </button>
        <button type="button" className="btn btn--ghost" onClick={onDone}>
          Bekor
        </button>
      </div>
    </form>
  );
}
