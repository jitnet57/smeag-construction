// ============================================================================
// AUTH — login accounts, roles and session.
// ----------------------------------------------------------------------------
// Roles:
//   admin        full access + account management (admin, admin1)
//   manager      full access except account management (accounting manager)
//   team_leader  field screens for their own crew; the only role allowed to
//                edit the morning check-in (AM IN) after the 07:00 cutoff
//
// Supabase build: accounts live in public.app_accounts and are reached only
// through SECURITY DEFINER RPCs (supabase/migrations/20261126_app_accounts.sql);
// passwords are bcrypt-hashed in the database.
// Other builds (local / Express dev): a browser-only store in localStorage,
// seeded with the same accounts, for development.
// ============================================================================
import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { sb } from './supabaseApi';
import {
  forgetOfflineLogin,
  isNetworkError,
  offlineLogin,
  offlineSession,
  rememberOfflineLogin,
} from './offline';

export type Role = 'admin' | 'manager' | 'team_leader';

export interface Account {
  username: string;
  displayName: string;
  role: Role;
  crewId: string | null;
  active: boolean;
  createdAt?: string;
}

export interface Session extends Account {
  token: string;
}

export interface AccountInput {
  username: string;
  displayName: string;
  role: Role;
  crewId: string | null;
  password: string; // empty on update = keep current password
  active: boolean;
}

const USE_SUPABASE = import.meta.env.VITE_USE_SUPABASE === '1';
const TOKEN_KEY = 'brightem.session';

export const isAdmin = (s: Session | null) => s?.role === 'admin';
export const isTeamLeader = (s: Session | null) => s?.role === 'team_leader';

// ---- Backend: Supabase RPCs ------------------------------------------------
async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await sb().rpc(fn, args);
  if (error) throw new Error(error.message);
  return data as T;
}

const supabaseAuth = {
  // Online: verify with the server and remember the session for offline use.
  // No network: accept the same credentials last used on this device.
  async login(username: string, password: string): Promise<Session | null> {
    try {
      const s = await rpc<Session | null>('app_login', { p_username: username, p_password: password });
      if (s) await rememberOfflineLogin(username, password, s);
      else forgetOfflineLogin(username); // wrong / changed password or disabled
      return s;
    } catch (e) {
      if (isNetworkError(e)) return offlineLogin<Session>(username, password);
      throw e;
    }
  },
  async session(token: string): Promise<Session | null> {
    try {
      return await rpc<Session | null>('app_session', { p_token: token });
    } catch (e) {
      if (isNetworkError(e)) return offlineSession<Session>(token);
      throw e;
    }
  },
  logout: (token: string) => rpc<void>('app_logout', { p_token: token }),
  list: (token: string) => rpc<Account[]>('app_list_accounts', { p_token: token }),
  save: (token: string, a: AccountInput) =>
    rpc<Account>('app_save_account', {
      p_token: token,
      p_username: a.username,
      p_display_name: a.displayName,
      p_role: a.role,
      p_crew_id: a.crewId,
      p_password: a.password,
      p_active: a.active,
    }),
  remove: (token: string, username: string) =>
    rpc<void>('app_delete_account', { p_token: token, p_username: username }),
  changePassword: (token: string, oldPw: string, newPw: string) =>
    rpc<boolean>('app_change_password', { p_token: token, p_old: oldPw, p_new: newPw }),
};

// ---- Backend: browser-only store (dev builds without Supabase) -------------
type LocalAccount = Account & { hash: string };
const LOCAL_KEY = 'brightem.accounts';
const LOCAL_SESS = 'brightem.sessions';
// Dev-only browser store; set VITE_DEV_INITIAL_PASSWORD locally (never committed).
const INITIAL_PASSWORD = import.meta.env.VITE_DEV_INITIAL_PASSWORD ?? 'changeme123';
const LOCAL_CREWS = ['ANTHONY', 'JASON', 'RICO', 'JUNIE', 'ABEL', 'GERRY', 'PLUSTERING',
  'NANTE', 'ELECTRICAL', 'SCAFFOLDING', 'JERRY'];

async function hashPw(username: string, pw: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${username}:${pw}`));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function localAccounts(): Promise<LocalAccount[]> {
  const raw = localStorage.getItem(LOCAL_KEY);
  if (raw) return JSON.parse(raw);
  const seed: Omit<LocalAccount, 'hash'>[] = [
    { username: 'admin', displayName: 'Emmeline Hwang', role: 'admin', crewId: null, active: true },
    { username: 'admin1', displayName: 'Jaesun Hwang', role: 'admin', crewId: null, active: true },
    { username: 'manager', displayName: 'Carlo Ongos', role: 'manager', crewId: null, active: true },
    ...LOCAL_CREWS.map((c) => ({
      username: `tl.${c.toLowerCase()}`, displayName: `${c} Team Leader`,
      role: 'team_leader' as Role, crewId: c, active: true,
    })),
  ];
  const out: LocalAccount[] = [];
  for (const a of seed) out.push({ ...a, hash: await hashPw(a.username, INITIAL_PASSWORD) });
  localStorage.setItem(LOCAL_KEY, JSON.stringify(out));
  return out;
}
const saveLocal = (list: LocalAccount[]) => localStorage.setItem(LOCAL_KEY, JSON.stringify(list));
const localSessions = (): Record<string, string> =>
  JSON.parse(localStorage.getItem(LOCAL_SESS) ?? '{}');
const strip = ({ hash: _h, ...a }: LocalAccount): Account => a;

async function localMe(token: string): Promise<LocalAccount> {
  const u = localSessions()[token];
  const me = (await localAccounts()).find((a) => a.username === u && a.active);
  if (!me) throw new Error('not authorized');
  return me;
}
async function localAdmin(token: string): Promise<LocalAccount> {
  const me = await localMe(token);
  if (me.role !== 'admin') throw new Error('not authorized');
  return me;
}

const localAuth: typeof supabaseAuth = {
  async login(username, password) {
    const u = username.trim().toLowerCase();
    const a = (await localAccounts()).find((x) => x.username === u && x.active);
    if (!a || a.hash !== (await hashPw(u, password))) return null;
    const token = crypto.randomUUID();
    localStorage.setItem(LOCAL_SESS, JSON.stringify({ ...localSessions(), [token]: u }));
    return { ...strip(a), token };
  },
  async session(token) {
    try {
      return { ...strip(await localMe(token)), token };
    } catch {
      return null;
    }
  },
  async logout(token) {
    const s = localSessions();
    delete s[token];
    localStorage.setItem(LOCAL_SESS, JSON.stringify(s));
  },
  async list(token) {
    await localAdmin(token);
    return (await localAccounts()).map(strip);
  },
  async save(token, input) {
    const me = await localAdmin(token);
    const u = input.username.trim().toLowerCase();
    if (!/^[a-z0-9._-]{3,32}$/.test(u)) throw new Error('invalid username');
    if (input.role === 'team_leader' && !input.crewId) throw new Error('team leader needs a crew');
    if (u === me.username && (input.role !== 'admin' || !input.active))
      throw new Error('cannot demote or disable yourself');
    const list = await localAccounts();
    const i = list.findIndex((a) => a.username === u);
    const crewId = input.role === 'team_leader' ? input.crewId : null;
    if (i < 0 && input.password.length < 6) throw new Error('password too short');
    const hash = input.password ? await hashPw(u, input.password) : list[i].hash;
    const row: LocalAccount = {
      username: u, displayName: input.displayName, role: input.role, crewId,
      active: input.active, hash, createdAt: list[i]?.createdAt ?? new Date().toISOString(),
    };
    if (i >= 0) list[i] = row;
    else list.push(row);
    saveLocal(list);
    return strip(row);
  },
  async remove(token, username) {
    const me = await localAdmin(token);
    if (username === me.username) throw new Error('cannot delete yourself');
    saveLocal((await localAccounts()).filter((a) => a.username !== username));
  },
  async changePassword(token, oldPw, newPw) {
    const me = await localMe(token);
    if (me.hash !== (await hashPw(me.username, oldPw))) return false;
    if (newPw.length < 6) throw new Error('password too short');
    const list = await localAccounts();
    const i = list.findIndex((a) => a.username === me.username);
    list[i] = { ...list[i], hash: await hashPw(me.username, newPw) };
    saveLocal(list);
    return true;
  },
};

export const authApi = USE_SUPABASE ? supabaseAuth : localAuth;

// ---- React context ---------------------------------------------------------
interface AuthCtx {
  session: Session | null;
  ready: boolean;
  login: (username: string, password: string) => Promise<boolean>;
  logout: () => Promise<void>;
}

const Ctx = createContext<AuthCtx | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const token = localStorage.getItem(TOKEN_KEY);
    if (!token) {
      setReady(true);
      return;
    }
    authApi
      .session(token)
      .then((s) => {
        if (s) setSession(s);
        else localStorage.removeItem(TOKEN_KEY);
      })
      .catch(() => undefined)
      .finally(() => setReady(true));
  }, []);

  const login = useCallback(async (username: string, password: string) => {
    const s = await authApi.login(username, password);
    if (!s) return false;
    localStorage.setItem(TOKEN_KEY, s.token);
    setSession(s);
    return true;
  }, []);

  const logout = useCallback(async () => {
    const token = localStorage.getItem(TOKEN_KEY);
    localStorage.removeItem(TOKEN_KEY);
    setSession(null);
    if (token) await authApi.logout(token).catch(() => undefined);
  }, []);

  return <Ctx.Provider value={{ session, ready, login, logout }}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error('useAuth must be used within AuthProvider');
  return c;
}

// ---- Morning check-in cutoff ----------------------------------------------
// AM IN for a work date may be entered by anyone until 07:00 (Asia/Manila) on
// that date. After the cutoff only a team leader may change it.
export const CHECKIN_CUTOFF_HOUR = 7;

/** Current date (YYYY-MM-DD) and decimal hour in the site's time zone. */
function manilaNow(): { date: string; hour: number } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date());
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '00';
  return {
    date: `${get('year')}-${get('month')}-${get('day')}`,
    hour: Number(get('hour')) + Number(get('minute')) / 60,
  };
}

/** True once the 07:00 check-in window for `workDate` has closed. */
export function isCheckinClosed(workDate: string): boolean {
  const now = manilaNow();
  if (workDate < now.date) return true;
  if (workDate > now.date) return false;
  return now.hour >= CHECKIN_CUTOFF_HOUR;
}

/** Whether this session may edit AM IN for `workDate`. */
export function canEditCheckin(s: Session | null, workDate: string): boolean {
  return isTeamLeader(s) || !isCheckinClosed(workDate);
}
