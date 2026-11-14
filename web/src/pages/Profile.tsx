// Profil: hisob, do'kon tanlash, Uzum bilan bog'lanish (yangilash, hisob boshlangan sana) va chiqish. Faqat sozlamalar.
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { formatDateLabel } from '../../../domain/index.ts';
import { api } from '../api.ts';
import { Icon } from '../components/Icon.tsx';
import { PageHeader } from '../components/Layout.tsx';
import { ShopSwitcher } from '../components/ShopSwitcher.tsx';
import { useToast } from '../components/Toast.tsx';
import { ErrorBox, SkeletonList } from '../components/ui.tsx';
import { timeAgo } from '../format.ts';
import { useAsync } from '../hooks.ts';
import { useSession } from '../session.tsx';
import { applyTheme, readTheme, type Theme } from '../theme.ts';

export function ProfilePage() {
  const { user, logout } = useSession();
  const navigate = useNavigate();
  const name = user?.displayName || 'Sotuvchi';

  return (
    <div className="page profile">
      <PageHeader title="Profil" />

      <section className="profile-user" aria-label="Hisob">
        <span className="profile-user__avatar" aria-hidden="true">
          {name.trim().charAt(0).toUpperCase()}
        </span>
        <span className="profile-user__name">{name}</span>
      </section>

      <ShopSwitcher />

      <section className="profile-group" aria-labelledby="uzum-title">
        <h2 id="uzum-title" className="profile-group__title">
          Uzum Market
        </h2>
        <UzumConnection />
      </section>

      <section className="profile-group" aria-labelledby="theme-title">
        <h2 id="theme-title" className="profile-group__title">
          Ko'rinish
        </h2>
        <ThemePicker />
      </section>

      <button
        type="button"
        className="profile-logout"
        onClick={async () => {
          await logout();
          navigate('/kirish');
        }}
      >
        <Icon name="logout" size={20} />
        Chiqish
      </button>
    </div>
  );
}

const THEMES: { id: Theme; label: string; icon: 'sync' | 'sun' | 'moon' }[] = [
  { id: 'system', label: 'Avto', icon: 'sync' },
  { id: 'light', label: "Yorug'", icon: 'sun' },
  { id: 'dark', label: "Qorong'i", icon: 'moon' },
];

/** Yorug' / qorong'i ko'rinish. "Avto" — telefon yoki kompyuter sozlamasi bo'yicha. */
function ThemePicker() {
  const [theme, setTheme] = useState<Theme>(() => readTheme());
  return (
    <div className="theme-picker" role="radiogroup" aria-label="Ko'rinish">
      {THEMES.map((t) => (
        <button
          key={t.id}
          type="button"
          role="radio"
          aria-checked={theme === t.id}
          className={`theme-picker__option${theme === t.id ? ' is-active' : ''}`}
          onClick={() => {
            applyTheme(t.id);
            setTheme(t.id);
          }}
        >
          <Icon name={t.icon} size={18} />
          {t.label}
        </button>
      ))}
    </div>
  );
}

function UzumConnection() {
  const toast = useToast();
  const status = useAsync(() => api.uzumStatus(), []);
  const [syncing, setSyncing] = useState(false);
  const s = status.data;

  if (status.loading && !s) return <SkeletonList rows={2} />;
  if (status.error) return <ErrorBox error={status.error} onRetry={status.reload} />;
  if (!s?.configured) return <NotConfigured />;
  if (!s.shopLinked) {
    return (
      <div className="profile-card">
        <p className="profile-row__hint">Bu do'kon Uzumga bog'lanmagan. Yuqorida Uzum do'konini tanlang.</p>
      </div>
    );
  }

  async function sync() {
    setSyncing(true);
    try {
      // Serverda bitta so'rov vaqt bilan cheklangan bo'lishi mumkin (Netlify) — tugaguncha davom ettiramiz.
      let imported = 0;
      let applied = 0;
      for (let i = 0; i < 20; i++) {
        const { report } = await api.uzumSync();
        imported += report.imported;
        applied += report.changes.applied;
        if (report.done) break;
      }
      const parts = [imported && `${imported} ta yangi SKU`, applied && `${applied} ta yangi yozuv`].filter(Boolean);
      toast.show({ tone: 'ok', message: parts.length ? `Yangilandi: ${parts.join(', ')}` : 'Yangilandi' });
    } catch (err) {
      toast.show({ tone: 'error', message: err instanceof Error ? err.message : String(err) });
    } finally {
      setSyncing(false);
      status.reload();
    }
  }

  const busy = syncing || s.running;
  return (
    <div className="profile-card">
      <div className="profile-row">
        <span className={`profile-row__icon ${s.lastError ? 'is-error' : 'is-ok'}`} aria-hidden="true">
          <Icon name={s.lastError ? 'written_off' : 'check'} size={18} />
        </span>
        <span className="profile-row__text">
          <span className="profile-row__title">{s.lastError ? "Bog'lanishda muammo" : "Bog'langan"}</span>
          <span className="profile-row__hint">{busy ? 'Yangilanmoqda…' : s.lastSyncAt ? `Yangilandi ${timeAgo(s.lastSyncAt)}` : 'Hali yangilanmagan'}</span>
        </span>
        <button type="button" className="btn btn--secondary btn--sm" onClick={sync} disabled={busy}>
          <Icon name="sync" size={18} className={busy ? 'spin' : undefined} />
          Yangilash
        </button>
      </div>
      {s.lastError && <p className="profile-card__error">{s.lastError}</p>}
      <SyncFrom value={s.syncFrom} onSaved={status.reload} />
    </div>
  );
}

function SyncFrom({ value, onSaved }: { value: string | null; onSaved: () => void }) {
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [date, setDate] = useState(value ?? '');

  return (
    <div className="profile-row profile-row--stack">
      <button type="button" className="profile-row__button" onClick={() => setEditing((e) => !e)} aria-expanded={editing}>
        <span className="profile-row__icon" aria-hidden="true">
          <Icon name="calendar" size={18} />
        </span>
        <span className="profile-row__text">
          <span className="profile-row__title">Hisob boshlangan sana</span>
          <span className="profile-row__hint">{value ? formatDateLabel(value) : 'Belgilanmagan'}</span>
        </span>
        <Icon name="expand" size={18} className={`profile-row__chevron${editing ? ' is-open' : ''}`} />
      </button>
      {editing && (
        <div className="profile-row__editor">
          <p className="profile-row__hint">
            Shu sanadan oldingi Uzum hujjatlari hisobga olinmaydi. Oldinga surish yozilganlarni o'chirmaydi; orqaga surish eski hujjatlarni ham
            yozadi.
          </p>
          <div className="row-actions">
            <input type="date" className="input input--short" value={date} onChange={(e) => setDate(e.target.value)} />
            <button
              type="button"
              className="btn btn--primary btn--sm"
              onClick={async () => {
                try {
                  await api.uzumSetSyncFrom(date);
                  toast.show({ tone: 'ok', message: 'Sana saqlandi' });
                  setEditing(false);
                  onSaved();
                } catch (err) {
                  toast.show({ tone: 'error', message: err instanceof Error ? err.message : String(err) });
                }
              }}
            >
              Saqlash
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function NotConfigured() {
  return (
    <div className="profile-card setup">
      <p className="profile-row__title">Uzum hali ulanmagan</p>
      <p className="profile-row__hint">Ulangandan keyin nakladnoylar, sotuv va qaytarishlar o'zi yoziladi.</p>
      <ol className="steps">
        <li>
          Uzum sotuvchi kabinetida <b>Sozlamalar → API kalitlari</b> bo'limidan kalit yarating.
        </li>
        <li>
          Netlify'da: <b>Site configuration → Environment variables</b> → <code>UZUM_API_KEY</code> qo'shing.
        </li>
        <li>Saytni qayta joylang (Deploys → Trigger deploy).</li>
      </ol>
      <p className="profile-row__hint">Kalitni hech kimga yubormang.</p>
    </div>
  );
}
