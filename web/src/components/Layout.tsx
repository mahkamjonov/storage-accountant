import type { ReactNode } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { Icon, type IconName } from './Icon.tsx';

const NAV: { to: string; label: string; icon: IconName; end?: boolean }[] = [
  { to: '/', label: 'Bosh sahifa', icon: 'home', end: true },
  { to: '/mahsulotlar', label: 'Mahsulotlar', icon: 'box' },
  { to: '/tarix', label: 'Tarix', icon: 'clock' },
  { to: '/uzum', label: 'Uzum', icon: 'uzum' },
];

/** Asosiy sahifalar: telefonda pastda tablar, kompyuterda chapda menyu. */
export function Layout() {
  const { pathname } = useLocation();
  // Kiritish ekranlarida telefondagi pastki menyu yashiriladi: diqqat bitta vazifada, "Saqlash" pastda.
  const focus = pathname.startsWith('/kiritish') || pathname.endsWith('/yangi') || pathname.endsWith('/tahrirlash');

  return (
    <div className={`shell${focus ? ' shell--focus' : ''}`}>
      <aside className="sidebar" aria-label="Asosiy menyu">
        <Link to="/" className="brand">
          <span className="brand__mark" aria-hidden="true">
            <Icon name="box" size={20} />
          </span>
          Ombor hisobi
        </Link>
        <nav className="sidebar__nav">
          {NAV.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.end} className="sidebar__link">
              <Icon name={n.icon} />
              {n.label}
            </NavLink>
          ))}
        </nav>
      </aside>

      <main className="main">
        <Outlet />
      </main>

      <nav className="tabbar" aria-label="Asosiy menyu">
        {NAV.map((n) => (
          <NavLink key={n.to} to={n.to} end={n.end} className="tabbar__link">
            <Icon name={n.icon} />
            <span>{n.label}</span>
          </NavLink>
        ))}
      </nav>
    </div>
  );
}

export function PageHeader({
  title,
  back,
  actions,
  subtitle,
}: {
  title: ReactNode;
  back?: string | (() => void);
  actions?: ReactNode;
  subtitle?: ReactNode;
}) {
  const navigate = useNavigate();
  return (
    <header className="page-header">
      {back && (
        <button
          type="button"
          className="icon-btn page-header__back"
          aria-label="Orqaga"
          onClick={() => (typeof back === 'function' ? back() : navigate(back))}
        >
          <Icon name="back" />
        </button>
      )}
      <div className="page-header__text">
        <h1 className="page-header__title">{title}</h1>
        {subtitle && <p className="page-header__sub">{subtitle}</p>}
      </div>
      {actions && <div className="page-header__actions">{actions}</div>}
    </header>
  );
}
