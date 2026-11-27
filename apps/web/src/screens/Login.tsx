import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../auth';
import { useI18n } from '../i18n';
import type { Lang } from '../i18n';

// Team leaders / managers type only the last 4 digits of their phone; the
// 4th digit logs them in straight away (no button press). Admins can switch to
// user ID + password.
export default function Login() {
  const { login, loginPhone } = useAuth();
  const { t, lang, setLang } = useI18n();
  const [adminMode, setAdminMode] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [digits, setDigits] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const digitsRef = useRef<HTMLInputElement>(null);
  // Back to the digits box after a failed try.
  useEffect(() => {
    if (!busy && !adminMode) digitsRef.current?.focus();
  }, [busy, adminMode]);

  const doLogin = async (pin: string) => {
    setBusy(true);
    setError('');
    try {
      const ok = adminMode ? await login(username, password) : await loginPhone(pin);
      if (!ok) {
        setError(t(adminMode ? 'auth.invalid' : 'auth.phoneInvalid'));
        if (!adminMode) setDigits(''); // ready for another try
      }
    } catch {
      setError(t('auth.error'));
      if (!adminMode) setDigits('');
    } finally {
      setBusy(false);
    }
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    void doLogin(digits);
  };

  // The 4th digit logs in immediately.
  const typeDigits = (v: string) => {
    const d = v.replace(/\D/g, '').slice(0, 4);
    setDigits(d);
    if (d.length < 4) {
      if (d) setError('');
      return;
    }
    if (!busy) void doLogin(d);
  };

  const switchMode = () => {
    setAdminMode((on) => !on);
    setError('');
    setUsername('');
    setPassword('');
    setDigits('');
  };

  return (
    <div className="min-h-screen bg-bg flex items-center justify-center p-4">
      <form onSubmit={submit} className="w-full max-w-sm bg-white border border-line rounded-xl shadow-sm p-6">
        <div className="flex items-start justify-between mb-5">
          <div>
            <b className="text-dark text-xl block">BRIGHTEM</b>
            <span className="text-xs text-muted">{t('app.brandSub')}</span>
          </div>
          <div className="flex items-center rounded-full border border-line overflow-hidden">
            {(['en', 'ko'] as Lang[]).map((l) => (
              <button
                type="button"
                key={l}
                onClick={() => setLang(l)}
                className={`px-2.5 py-1 text-xs font-bold ${lang === l ? 'bg-primary text-white' : 'bg-white text-muted'}`}
              >
                {l === 'en' ? 'EN' : '한국어'}
              </button>
            ))}
          </div>
        </div>
        <p className="text-sm text-muted mb-4">{t(adminMode ? 'auth.adminHint' : 'auth.phoneHint')}</p>

        {adminMode ? (
          <>
            <label className="block text-sm font-bold text-dark mb-1">{t('auth.username')}</label>
            <input
              className="border border-line rounded px-3 py-2 w-full mb-3"
              autoCapitalize="none"
              autoComplete="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
              autoFocus
            />
            <label className="block text-sm font-bold text-dark mb-1">{t('auth.password')}</label>
            <input
              type="password"
              className="border border-line rounded px-3 py-2 w-full mb-3"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </>
        ) : (
          <>
            <label className="block text-sm font-bold text-dark mb-1">{t('auth.phoneDigits')}</label>
            <input
              type="password"
              inputMode="numeric"
              pattern="\d{4}"
              maxLength={4}
              autoComplete="off"
              className="border border-line rounded px-3 py-2 w-full mb-3 tracking-widest text-center text-lg"
              value={digits}
              ref={digitsRef}
              onChange={(e) => typeDigits(e.target.value)}
              readOnly={busy}
              required
              autoFocus
            />
          </>
        )}

        {error && <div className="text-sm text-red-600 mb-3">{error}</div>}
        <button
          type="submit"
          className="btn w-full"
          disabled={busy || (!adminMode && digits.length !== 4)}
        >
          {busy ? t('app.loading') : t('auth.login')}
        </button>
        <button type="button" className="block mx-auto mt-4 text-xs text-muted underline" onClick={switchMode}>
          {t(adminMode ? 'auth.asPhone' : 'auth.asAdmin')}
        </button>
      </form>
    </div>
  );
}
