// ============================================================================
// TEAM MESSAGES — in-app messages between login accounts.
// Supabase build: SECURITY DEFINER RPCs in
// supabase/migrations/20261205_app_messages.sql (token-checked, no table access).
// Other builds: a browser-only store in localStorage, same rules.
// Same rules as pelham-shift's Messages tab: admin / manager see every
// message, team leaders the ones they sent or received; each recipient
// confirms with "Mark as read"; only an admin deletes (for everyone).
// ============================================================================
import { sb } from './supabaseApi';
import { localDirectory, localWhoAmI } from './auth';
import type { Role } from './auth';

export interface Recipient {
  username: string;
  displayName: string;
  role: Role;
  crewId: string | null;
}

export interface MessageTo {
  username: string;
  name: string;
  readAt: string | null;
}

export interface Message {
  id: number;
  from: string | null;
  fromName: string;
  body: string;
  replyTo: number | null;
  replyToBody: string | null;
  replyToName: string | null;
  createdAt: string;
  to: MessageTo[];
}

const USE_SUPABASE = import.meta.env.VITE_USE_SUPABASE === '1';

async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await sb().rpc(fn, args);
  if (error) throw new Error(error.message);
  return data as T;
}

const supabaseMessages = {
  recipients: (token: string) => rpc<Recipient[]>('app_message_recipients', { p_token: token }),
  list: (token: string) => rpc<Message[]>('app_messages', { p_token: token, p_limit: 200 }),
  unread: (token: string) => rpc<number>('app_message_unread', { p_token: token }),
  send: (token: string, to: string[], body: string, replyTo: number | null) =>
    rpc<number>('app_send_message', { p_token: token, p_to: to, p_body: body, p_reply_to: replyTo }),
  markRead: (token: string, ids: number[]) =>
    rpc<number>('app_mark_messages_read', { p_token: token, p_ids: ids }),
  remove: (token: string, id: number) => rpc<void>('app_delete_message', { p_token: token, p_id: id }),
};

// ---- dev store --------------------------------------------------------------
type LocalMsg = Omit<Message, 'replyToBody' | 'replyToName'>;
const KEY = 'brightem.messages';
const load = (): LocalMsg[] => JSON.parse(localStorage.getItem(KEY) ?? '[]');
const save = (l: LocalMsg[]) => localStorage.setItem(KEY, JSON.stringify(l));

const localMessages: typeof supabaseMessages = {
  async recipients(token) {
    const me = await localWhoAmI(token);
    return (await localDirectory())
      .filter((a) => a.active && a.username !== me.username)
      .map(({ username, displayName, role, crewId }) => ({ username, displayName, role, crewId }));
  },
  async list(token) {
    const me = await localWhoAmI(token);
    const all = load();
    const office = me.role === 'admin' || me.role === 'manager';
    return all
      .filter((m) => office || m.from === me.username || m.to.some((r) => r.username === me.username))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, 200)
      .map((m) => {
        const p = all.find((x) => x.id === m.replyTo);
        return {
          ...m,
          replyToBody: p ? p.body.slice(0, 140) : null,
          replyToName: p?.fromName ?? null,
        };
      });
  },
  async unread(token) {
    const me = await localWhoAmI(token);
    return load().filter((m) => m.to.some((r) => r.username === me.username && !r.readAt)).length;
  },
  async send(token, to, body, replyTo) {
    const me = await localWhoAmI(token);
    const text = body.trim();
    if (!text) throw new Error('message is empty');
    const dir = await localDirectory();
    const rcpt = dir.filter((a) => a.active && a.username !== me.username && to.includes(a.username));
    if (!rcpt.length) throw new Error('choose at least one recipient');
    const list = load();
    const id = list.reduce((n, m) => Math.max(n, m.id), 0) + 1;
    list.push({
      id, from: me.username, fromName: me.displayName, body: text,
      replyTo: list.some((m) => m.id === replyTo) ? replyTo : null,
      createdAt: new Date().toISOString(),
      to: rcpt.map((a) => ({ username: a.username, name: a.displayName, readAt: null })),
    });
    save(list);
    return id;
  },
  async markRead(token, ids) {
    const me = await localWhoAmI(token);
    const now = new Date().toISOString();
    let n = 0;
    const list = load().map((m) => ({
      ...m,
      to: m.to.map((r) =>
        r.username === me.username && !r.readAt && ids.includes(m.id) ? (n++, { ...r, readAt: now }) : r),
    }));
    save(list);
    return n;
  },
  async remove(token, id) {
    const me = await localWhoAmI(token);
    if (me.role !== 'admin') throw new Error('only an admin can delete messages');
    save(load().filter((x) => x.id !== id));
  },
};

export const messagesApi = USE_SUPABASE ? supabaseMessages : localMessages;

/** Fired after this tab sends / marks read / deletes, so the menu badge refreshes. */
export const MESSAGES_CHANGED = 'brightem:messages-changed';
export const notifyMessagesChanged = () => window.dispatchEvent(new Event(MESSAGES_CHANGED));
