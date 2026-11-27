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
import { DEFAULT_ATTENDANCE_TIMES, hhmmToHour } from '@brightem/shared';
import type { AttendanceTimes } from '@brightem/shared';
import { sb } from './supabaseApi';
import { setApiCrewScope } from './api';
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
  phone: string; // phone login uses its last 4 digits ('' = no phone login)
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
  phone: string;
  password: string; // empty on update = keep current password
  active: boolean;
}

const USE_SUPABASE = import.meta.env.VITE_USE_SUPABASE === '1';
const TOKEN_KEY = 'brightem.session';

export const isAdmin = (s: Session | null) => s?.role === 'admin';
export const isTeamLeader = (s: Session | null) => s?.role === 'team_leader';

/** Last 4 digits of a phone number, or '' when it has fewer than 4. */
export const phoneLast4 = (p: string | null | undefined) => {
  const d = (p ?? '').replace(/\D/g, '');
  return d.length >= 4 ? d.slice(-4) : '';
};
const PHONE_KEY = (digits: string) => `phone:${digits}`;

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
  // Phone login (pelham-shift style): the last 4 digits are the whole
  // credential. Admins may use it too (admin 2222, admin1 3333); the server
  // throttles failed attempts (20261129_admin_phone_login.sql).
  async loginPhone(digits: string): Promise<Session | null> {
    try {
      const s = await rpc<Session | null>('app_login_phone', { p_digits: digits });
      if (s) await rememberOfflineLogin(PHONE_KEY(digits), digits, s);
      else forgetOfflineLogin(PHONE_KEY(digits));
      return s;
    } catch (e) {
      if (isNetworkError(e)) return offlineLogin<Session>(PHONE_KEY(digits), digits);
      throw e;
    }
  },
  /** Name of the single account these 4 digits would log in as (null if none). */
  async lookupPhone(digits: string): Promise<string | null> {
    try {
      return await rpc<string | null>('app_phone_lookup', { p_digits: digits });
    } catch (e) {
      if (isNetworkError(e))
        return offlineLogin<Session>(PHONE_KEY(digits), digits).then((s) => s?.displayName ?? null);
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
      p_phone: a.phone,
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

const ADMIN_PHONES: Record<string, string> = { admin: '2222', admin1: '3333' };

async function localAccounts(): Promise<LocalAccount[]> {
  const raw = localStorage.getItem(LOCAL_KEY);
  if (raw) {
    // Older dev stores: give admin / admin1 their phone-login digits once.
    const list = (JSON.parse(raw) as LocalAccount[]).map((a) => ({
      ...a,
      phone: a.phone || ADMIN_PHONES[a.username] || '',
    }));
    return list;
  }
  const seed: Omit<LocalAccount, 'hash'>[] = [
    { username: 'admin', displayName: 'Emmeline Hwang', role: 'admin', crewId: null, phone: '2222', active: true },
    { username: 'admin1', displayName: 'Jaesun Hwang', role: 'admin', crewId: null, phone: '3333', active: true },
    { username: 'carloongos23@gmail.com', displayName: 'Carlo Ongos', role: 'manager', crewId: null, phone: '', active: true },
    ...LOCAL_CREWS.map((c) => ({
      username: `tl.${c.toLowerCase()}`, displayName: `${c} Team Leader`,
      role: 'team_leader' as Role, crewId: c, phone: '', active: true,
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
/** Dev store: the account behind a token, and every account (for messages). */
export async function localWhoAmI(token: string): Promise<Account> {
  return strip(await localMe(token));
}
export async function localDirectory(): Promise<Account[]> {
  return (await localAccounts()).map(strip);
}
async function localAdmin(token: string): Promise<LocalAccount> {
  const me = await localMe(token);
  if (me.role !== 'admin') throw new Error('not authorized');
  return me;
}

async function localPhoneMatch(digits: string): Promise<LocalAccount | null> {
  if (!/^\d{4}$/.test(digits)) return null;
  const hits = (await localAccounts()).filter(
    (a) => a.active && phoneLast4(a.phone) === digits
  );
  return hits.length === 1 ? hits[0] : null; // shared digits → refuse, never guess
}
function localStartSession(a: LocalAccount): Session {
  const token = crypto.randomUUID();
  localStorage.setItem(LOCAL_SESS, JSON.stringify({ ...localSessions(), [token]: a.username }));
  return { ...strip(a), token };
}

const localAuth: typeof supabaseAuth = {
  async login(username, password) {
    const u = username.trim().toLowerCase();
    const a = (await localAccounts()).find((x) => x.username === u && x.active);
    if (!a || a.hash !== (await hashPw(u, password))) return null;
    return localStartSession(a);
  },
  async loginPhone(digits) {
    const a = await localPhoneMatch(digits.trim());
    return a ? localStartSession(a) : null;
  },
  async lookupPhone(digits) {
    return (await localPhoneMatch(digits.trim()))?.displayName ?? null;
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
    if (!/^[a-z0-9._@+-]{3,64}$/.test(u)) throw new Error('invalid username');
    if (input.role === 'team_leader' && !input.crewId) throw new Error('team leader needs a crew');
    const phone = input.phone.trim();
    if (phone && !phoneLast4(phone)) throw new Error('phone needs at least 4 digits');
    if (u === me.username && (input.role !== 'admin' || !input.active))
      throw new Error('cannot demote or disable yourself');
    const list = await localAccounts();
    if (phone && input.active && list.some(
      (a) => a.username !== u && a.active && phoneLast4(a.phone) === phoneLast4(phone)
    )) throw new Error('phone last 4 digits already used');
    const i = list.findIndex((a) => a.username === u);
    const crewId = input.role === 'team_leader' ? input.crewId : null;
    if (i < 0 && input.password.length < 6) throw new Error('password too short');
    const hash = input.password ? await hashPw(u, input.password) : list[i].hash;
    const row: LocalAccount = {
      username: u, displayName: input.displayName, role: input.role, crewId, phone,
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
  loginPhone: (digits: string) => Promise<boolean>;
  logout: () => Promise<void>;
}

const Ctx = createContext<AuthCtx | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSessionState] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);
  // Set the api crew scope together with the session, before any screen
  // mounts and loads data: team leaders only see their own crew's employees.
  const setSession = useCallback((s: Session | null) => {
    setApiCrewScope(s?.role === 'team_leader' ? s.crewId ?? '__none__' : null);
    setSessionState(s);
  }, []);

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

  const start = useCallback((s: Session | null) => {
    if (!s) return false;
    localStorage.setItem(TOKEN_KEY, s.token);
    setSession(s);
    return true;
  }, [setSession]);
  const login = useCallback(
    async (username: string, password: string) => start(await authApi.login(username, password)),
    [start]
  );
  const loginPhone = useCallback(
    async (digits: string) => start(await authApi.loginPhone(digits)),
    [start]
  );

  const logout = useCallback(async () => {
    const token = localStorage.getItem(TOKEN_KEY);
    localStorage.removeItem(TOKEN_KEY);
    setSession(null);
    if (token) await authApi.logout(token).catch(() => undefined);
  }, []);

  return <Ctx.Provider value={{ session, ready, login, loginPhone, logout }}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error('useAuth must be used within AuthProvider');
  return c;
}

// ---- Check-in / check-out windows -----------------------------------------
// AM IN for a work date may be entered by anyone until the check-in time
// (Settings, default 07:00 Asia/Manila) on that date; PM OUT until the
// check-out time + grace (default 17:00 + 15 min). After that only the
// override accounts (TIME_OVERRIDE_USERS) may change them. The database
// enforces the same rule on save.
let attTimes: AttendanceTimes = DEFAULT_ATTENDANCE_TIMES;

/** Use the attendance windows saved in Settings (call after loading config). */
export function setAttendanceTimes(t: AttendanceTimes): void {
  attTimes = t;
}
export function getAttendanceTimes(): AttendanceTimes {
  return attTimes;
}
/** Decimal hour when check-out closes (check-out time + grace). */
export function checkoutCloseHour(t: AttendanceTimes = attTimes): number {
  return hhmmToHour(t.checkOut) + t.checkOutGraceMin / 60;
}

// Server clock: the lock is judged by the database's time, not the phone's.
// We keep the server time at the last sync plus a monotonic timer
// (performance.now), which changing the phone's clock does not affect.
// Until the first sync succeeds (e.g. opened offline) the device clock is used;
// the database enforces the rule on save regardless.
let serverAnchor: { serverMs: number; perfMs: number } | null = null;

export async function syncServerClock(): Promise<void> {
  if (!USE_SUPABASE) return;
  try {
    const t0 = performance.now();
    const iso = await rpc<string>('app_server_time', {});
    const t1 = performance.now();
    const serverMs = Date.parse(iso);
    if (!Number.isNaN(serverMs)) serverAnchor = { serverMs, perfMs: (t0 + t1) / 2 };
  } catch {
    /* offline — keep the previous anchor */
  }
}

function trustedNow(): Date {
  if (!serverAnchor) return new Date();
  return new Date(serverAnchor.serverMs + (performance.now() - serverAnchor.perfMs));
}

if (typeof window !== 'undefined' && USE_SUPABASE) {
  void syncServerClock();
  setInterval(() => void syncServerClock(), 10 * 60_000);
  window.addEventListener('online', () => void syncServerClock());
}

/** Current date (YYYY-MM-DD) and decimal hour in the site's time zone. */
export function manilaNow(): { date: string; hour: number } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(trustedNow());
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '00';
  return {
    date: `${get('year')}-${get('month')}-${get('day')}`,
    hour: Number(get('hour')) + Number(get('minute')) / 60,
  };
}

function closedAt(workDate: string, hour: number): boolean {
  const now = manilaNow();
  if (workDate < now.date) return true;
  if (workDate > now.date) return false;
  return now.hour >= hour;
}

/** True once the morning check-in window for `workDate` has closed. */
export function isCheckinClosed(workDate: string): boolean {
  return closedAt(workDate, hhmmToHour(attTimes.checkIn));
}

/** True once the check-out window (check-out time + grace) has closed. */
export function isCheckoutClosed(workDate: string): boolean {
  return closedAt(workDate, checkoutCloseHour());
}

/** Whether this session may edit AM IN for `workDate`. */
// Accounts that may still change AM IN / PM OUT after the cutoff
// (Emmeline Hwang, Jaesun Hwang, Carlo Ongos). In the app they unlock the
// time inputs with their own 4-digit phone PIN. Keep in sync with
// supabase/migrations/20261202_attendance_once_per_day.sql.
export const TIME_OVERRIDE_USERS = ['admin', 'admin1', 'carloongos23@gmail.com'];
export const canOverrideTimes = (s: Session | null) =>
  !!s && TIME_OVERRIDE_USERS.includes(s.username.toLowerCase());

export function canEditCheckin(s: Session | null, workDate: string): boolean {
  return canOverrideTimes(s) || !isCheckinClosed(workDate);
}

/** Whether this session may edit PM OUT for `workDate`. */
export function canEditCheckout(s: Session | null, workDate: string): boolean {
  return canOverrideTimes(s) || !isCheckoutClosed(workDate);
}
