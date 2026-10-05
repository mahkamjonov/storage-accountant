import { useState, type FormEvent } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { Icon } from '../components/Icon.tsx';
import { useSession } from '../session.tsx';

export function LoginPage() {
  const { user, login } = useSession();
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from ?? '/';
  const [form, setForm] = useState({ login: '', password: '' });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (user) return <Navigate to={from} replace />;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!form.login.trim() || !form.password) {
      setError('Login va parolni kiriting.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await login(form.login, form.password);
      navigate(from, { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  }

  return (
    <div className="login">
      <form className="login__card" onSubmit={submit} noValidate>
        <span className="brand__mark brand__mark--lg" aria-hidden="true">
          <Icon name="box" size={28} />
        </span>
        <h1 className="login__title">Ombor hisobi</h1>
        <p className="login__sub">Omborim va Uzumdagi qoldiq bir joyda</p>

        <div className="field">
          <label htmlFor="login" className="field-label">
            Login
          </label>
          <input
            id="login"
            className="input"
            autoComplete="username"
            autoCapitalize="none"
            value={form.login}
            onChange={(e) => setForm({ ...form, login: e.target.value })}
          />
        </div>
        <div className="field">
          <label htmlFor="password" className="field-label">
            Parol
          </label>
          <input
            id="password"
            className="input"
            type="password"
            autoComplete="current-password"
            value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })}
          />
        </div>
        {error && (
          <p className="notice notice--error" role="alert">
            {error}
          </p>
        )}
        <button type="submit" className="btn btn--primary btn--block btn--lg" disabled={busy}>
          {busy ? 'Kirilmoqda…' : 'Kirish'}
        </button>
      </form>
    </div>
  );
}
