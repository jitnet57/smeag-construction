import { useEffect, useState } from 'react';
import type { Crew } from '@brightem/shared';
import { api } from '../api';
import { authApi, phoneLast4, useAuth } from '../auth';
import type { Account, AccountInput, Role } from '../auth';
import { useI18n } from '../i18n';
import type { TKey } from '../i18n';

export const ROLE_LABEL: Record<Role, TKey> = {
  admin: 'role.admin',
  manager: 'role.manager',
  team_leader: 'role.teamLeader',
};

const EMPTY: AccountInput = {
  username: '',
  displayName: '',
  role: 'team_leader',
  crewId: null,
  phone: '',
  password: '',
  active: true,
};

export default function Accounts() {
  const { t } = useI18n();
  const { session } = useAuth();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [crews, setCrews] = useState<Crew[]>([]);
  const [form, setForm] = useState<AccountInput | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [error, setError] = useState('');

  const token = session?.token ?? '';

  const reload = () =>
    authApi
      .list(token)
      .then(setAccounts)
      .catch((e) => setError(String(e.message ?? e)));

  useEffect(() => {
    reload();
    api.getCrews().then((c) => setCrews(c.filter((x) => x.id !== 'UNASSIGNED')));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const openNew = () => {
    setForm({ ...EMPTY, crewId: crews[0]?.id ?? null });
    setIsNew(true);
    setError('');
  };
  const openEdit = (a: Account) => {
    setForm({ ...a, phone: a.phone ?? '', password: '' });
    setIsNew(false);
    setError('');
  };

  const save = async () => {
    if (!form) return;
    if (!form.username.trim() || !form.displayName.trim()) {
      setError(t('acct.required'));
      return;
    }
    if (isNew && form.password.length < 6) {
      setError(t('acct.pwShort'));
      return;
    }
    if (isNew && accounts.some((a) => a.username === form.username.trim().toLowerCase())) {
      setError(t('acct.duplicate'));
      return;
    }
    const last4 = phoneLast4(form.phone);
    if (form.phone.trim() && !last4) {
      setError(t('acct.phoneShort'));
      return;
    }
    if (last4 && form.active && accounts.some(
      (a) => a.username !== form.username.trim().toLowerCase() && a.active && phoneLast4(a.phone) === last4
    )) {
      setError(t('acct.phoneDup'));
      return;
    }
    try {
      await authApi.save(token, form);
      setForm(null);
      reload();
    } catch (e) {
      setError(String((e as Error).message ?? e));
    }
  };

  const remove = async (a: Account) => {
    if (!confirm(`${t('acct.confirmDelete')} ${a.username}?`)) return;
    try {
      await authApi.remove(token, a.username);
      reload();
    } catch (e) {
      alert(String((e as Error).message ?? e));
    }
  };

  return (
    <div className="w-full space-y-4">
      <div className="panel">
        <div className="flex items-center justify-between gap-2 mb-3">
          <h3 className="text-sm font-bold text-dark">
            <span className="inline-block w-1 h-4 bg-primary rounded mr-2" />
            {t('acct.title')} ({accounts.length})
          </h3>
          <button className="btn" onClick={openNew}>
            {t('acct.add')}
          </button>
        </div>
        {error && !form && <div className="text-sm text-red-600 mb-2">{error}</div>}
        <div className="overflow-x-auto">
          <table>
            <thead>
              <tr>
                <th>{t('auth.username')}</th>
                <th>{t('acct.name')}</th>
                <th>{t('acct.role')}</th>
                <th>{t('acct.crew')}</th>
                <th>{t('acct.phone')}</th>
                <th className="text-center">{t('acct.active')}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {accounts.map((a) => (
                <tr key={a.username}>
                  <td className="font-mono">{a.username}</td>
                  <td>{a.displayName}</td>
                  <td>{t(ROLE_LABEL[a.role])}</td>
                  <td>{a.crewId ?? '—'}</td>
                  <td className="font-mono">{a.phone || '—'}</td>
                  <td className="text-center">{a.active ? '✓' : '—'}</td>
                  <td className="text-right whitespace-nowrap">
                    <button className="btn ghost" onClick={() => openEdit(a)}>
                      {t('acct.edit')}
                    </button>{' '}
                    {a.username !== session?.username && (
                      <button className="btn gray" onClick={() => remove(a)}>
                        {t('acct.delete')}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="note">{t('acct.note')}</div>
      </div>

      {form && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl p-5 w-full max-w-md space-y-3">
            <h3 className="font-bold text-dark">{isNew ? t('acct.add') : t('acct.edit')}</h3>
            <label className="block text-sm">
              <span className="font-bold text-dark">{t('auth.username')}</span>
              <input
                className="border border-line rounded px-3 py-2 w-full font-mono"
                value={form.username}
                disabled={!isNew}
                autoCapitalize="none"
                placeholder="tl.anthony"
                onChange={(e) => setForm({ ...form, username: e.target.value })}
              />
            </label>
            <label className="block text-sm">
              <span className="font-bold text-dark">{t('acct.name')}</span>
              <input
                className="border border-line rounded px-3 py-2 w-full"
                value={form.displayName}
                onChange={(e) => setForm({ ...form, displayName: e.target.value })}
              />
            </label>
            <label className="block text-sm">
              <span className="font-bold text-dark">{t('acct.role')}</span>
              <select
                className="border border-line rounded px-3 py-2 w-full bg-white"
                value={form.role}
                onChange={(e) => {
                  const role = e.target.value as Role;
                  setForm({
                    ...form,
                    role,
                    crewId: role === 'team_leader' ? form.crewId ?? crews[0]?.id ?? null : null,
                  });
                }}
              >
                {(Object.keys(ROLE_LABEL) as Role[]).map((r) => (
                  <option key={r} value={r}>
                    {t(ROLE_LABEL[r])}
                  </option>
                ))}
              </select>
            </label>
            {form.role === 'team_leader' && (
              <label className="block text-sm">
                <span className="font-bold text-dark">{t('acct.crew')}</span>
                <select
                  className="border border-line rounded px-3 py-2 w-full bg-white"
                  value={form.crewId ?? ''}
                  onChange={(e) => setForm({ ...form, crewId: e.target.value })}
                >
                  {crews.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <label className="block text-sm">
              <span className="font-bold text-dark">{t('acct.phone')}</span>
              <input
                type="tel"
                inputMode="tel"
                className="border border-line rounded px-3 py-2 w-full font-mono"
                value={form.phone}
                placeholder="0917 123 4567"
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
              />
              <span className="text-xs text-muted">{t('acct.phoneHelp')}</span>
            </label>
            <label className="block text-sm">
              <span className="font-bold text-dark">
                {isNew ? t('auth.password') : t('acct.newPassword')}
              </span>
              <input
                type="password"
                autoComplete="new-password"
                className="border border-line rounded px-3 py-2 w-full"
                value={form.password}
                placeholder={isNew ? '' : t('acct.keepPassword')}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
              />
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={form.active}
                onChange={(e) => setForm({ ...form, active: e.target.checked })}
              />
              {t('acct.active')}
            </label>
            {error && <div className="text-sm text-red-600">{error}</div>}
            <div className="flex justify-end gap-2 pt-1">
              <button className="btn ghost" onClick={() => setForm(null)}>
                {t('acct.cancel')}
              </button>
              <button className="btn" onClick={save}>
                {t('acct.save')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
