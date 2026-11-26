import { useState } from 'react';
import { useAuth } from '../auth';
import { useI18n } from '../i18n';
import type { Lang } from '../i18n';

export default function Login() {
  const { login } = useAuth();
  const { t, lang, setLang } = useI18n();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const ok = await login(username, password);
      if (!ok) setError(t('auth.invalid'));
    } catch {
      setError(t('auth.error'));
    } finally {
      setBusy(false);
    }
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
        <label className="block text-sm font-bold text-dark mb-1">{t('auth.username')}</label>
        <input
          className="border border-line rounded px-3 py-2 w-full mb-3"
          autoCapitalize="none"
          autoComplete="username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          required
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
        {error && <div className="text-sm text-red-600 mb-3">{error}</div>}
        <button type="submit" className="btn w-full" disabled={busy}>
          {busy ? t('app.loading') : t('auth.login')}
        </button>
      </form>
    </div>
  );
}
