// Team messages — same layout and rules as pelham-shift's Messages tab
// (~/pelham-shift/app/shift-app.tsx, "팀 메시지"): message cards with the
// sender's colour square, "→ recipients", time; footer with read status and
// Mark as read / Reply / Delete; compose dialog with a "To (n/total)" list.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '../auth';
import type { Role } from '../auth';
import { useI18n } from '../i18n';
import { ROLE_LABEL } from './Accounts';
import { messagesApi, notifyMessagesChanged } from '../messages';
import type { Message, Recipient } from '../messages';

const REFRESH_MS = 30_000;
const TIME_ZONE = 'Asia/Manila';
const GREEN = '#087e6d';
// Colour square per person (pelham-shift staff colours).
const COLORS = ['#20a69a', '#5579cf', '#c48537', '#9864c3', '#e17b57', '#5c9d61', '#d26395', '#628597', '#a89643'];
const colorFor = (s: string) => COLORS[[...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % COLORS.length];
// Name tint per role, like pelham-shift's role groups.
const ROLE_TINT: Record<Role, string> = { admin: '#2f62c0', manager: '#b06d1f', team_leader: '#2d7d5f' };

const btn =
  'inline-flex items-center justify-center gap-2 border border-[#dce4e1] bg-white px-[15px] py-[10px] rounded-[7px] text-sm whitespace-nowrap hover:bg-[#eef5f2] disabled:opacity-50 disabled:cursor-not-allowed';
const btnPrimary = `${btn} !bg-[#087e6d] !border-[#087e6d] text-white hover:!bg-[#076b5d]`;

export default function Messages() {
  const { t, lang } = useI18n();
  const { session } = useAuth();
  const me = session!;
  const token = me.token;
  const office = me.role === 'admin' || me.role === 'manager';
  const locale = lang === 'ko' ? 'ko-KR' : 'en-US';

  const [messages, setMessages] = useState<Message[]>([]);
  const [people, setPeople] = useState<Recipient[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [compose, setCompose] = useState<{ to: string[]; replyTo: number | null } | null>(null);
  const loading = useRef(false);

  const reload = useCallback(async () => {
    if (loading.current) return;
    loading.current = true;
    try {
      setMessages(await messagesApi.list(token));
      setError('');
    } catch (e) {
      setError(String((e as Error).message ?? e));
    } finally {
      loading.current = false;
      setLoaded(true);
    }
  }, [token]);

  useEffect(() => {
    void reload();
    messagesApi.recipients(token).then(setPeople).catch(() => undefined);
    const id = window.setInterval(() => {
      if (document.visibilityState === 'visible') void reload();
    }, REFRESH_MS);
    return () => window.clearInterval(id);
  }, [reload, token]);

  const roleOf = (username: string | null) =>
    username === me.username ? me.role : people.find((p) => p.username === username)?.role;

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await fn();
      notifyMessagesChanged();
      await reload();
    } catch (e) {
      alert(String((e as Error).message ?? e));
    } finally {
      setBusy(false);
    }
  };

  const status = (m: Message) => {
    const mine = m.from === me.username;
    const myCopy = m.to.find((r) => r.username === me.username);
    if (myCopy && !mine) return myCopy.readAt ? t('msg.read') : t('msg.notRead');
    if (m.to.length > 1) {
      const unread = m.to.filter((r) => !r.readAt);
      const line = t('msg.readCount')
        .replace('{read}', String(m.to.length - unread.length))
        .replace('{total}', String(m.to.length));
      return unread.length ? `${line} · ${t('msg.unread')}: ${unread.map((r) => r.name).join(', ')}` : line;
    }
    return m.to[0]?.readAt ? t('msg.readByRecipient') : t('msg.notRead');
  };

  const newMessage = () =>
    setCompose({
      // Office: everyone ticked, as in pelham-shift. Team leader: the first admin.
      to: office ? people.map((p) => p.username) : people.filter((p) => p.role === 'admin').slice(0, 1).map((p) => p.username),
      replyTo: null,
    });

  return (
    <div className="w-full">
      <div className="bg-white border border-[#e2e8e7] rounded-[10px] p-[18px] sm:p-[26px] text-[#203332]">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-[13px] sm:gap-5 mb-[18px] sm:mb-6">
          <div>
            <h2 className="text-[19px] sm:text-[21px] font-semibold m-0 mb-[9px]">{t('msg.teamTitle')}</h2>
            <p className="text-sm text-[#83928a] m-0">{office ? t('msg.sub') : t('msg.subStaff')}</p>
          </div>
          <button className={`${btnPrimary} w-full sm:w-auto`} onClick={newMessage}>
            <span className="text-base leading-none">＋</span> {t('msg.new')}
          </button>
        </div>

        {error && <p role="alert" className="p-3 bg-[#fff0e7] text-[#965936] rounded-md text-sm">{error}</p>}

        {messages.map((m) => {
          const myCopy = m.to.find((r) => r.username === me.username);
          const canMark = !!myCopy && !myCopy.readAt && m.from !== me.username;
          const canReply = !!m.from && m.from !== me.username;
          const tint = ROLE_TINT[roleOf(m.from) ?? 'team_leader'];
          return (
            <article key={m.id} className="border border-[#e2e8e7] p-4 sm:p-[23px] rounded-lg my-4">
              <div className="flex flex-wrap sm:flex-nowrap items-center gap-x-[15px] gap-y-1 text-[13px] text-[#79907f]">
                <span className="inline-flex items-center gap-[10px] font-semibold text-sm whitespace-nowrap">
                  <i className="w-[11px] h-[11px] rounded-[2px] inline-block flex-shrink-0" style={{ background: colorFor(m.fromName) }} />
                  <span style={{ color: tint }}>{m.fromName}</span>
                </span>
                <span>→ {m.to.map((r) => r.name).join(', ')}</span>
                <time className="sm:ml-auto text-xs whitespace-nowrap">
                  {new Date(m.createdAt).toLocaleString(locale, { timeZone: TIME_ZONE })}
                </time>
              </div>
              <p className="text-[15px] sm:text-base leading-[1.9] whitespace-pre-wrap [overflow-wrap:anywhere] my-[19px]">{m.body}</p>
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-[15px] text-[13px] text-[#6f8777]">
                <span className="sm:mr-auto">{status(m)}</span>
                {canMark && (
                  <button disabled={busy} className={`${btn} w-full sm:w-auto`}
                    onClick={() => run(() => messagesApi.markRead(token, [m.id]))}>
                    ✓ {t('msg.markRead')}
                  </button>
                )}
                {canReply && (
                  <button disabled={busy} className={`${btn} w-full sm:w-auto`}
                    onClick={() => setCompose({ to: [m.from!], replyTo: m.id })}>
                    <span className="text-base leading-none">↩</span> {t('msg.reply')}
                  </button>
                )}
                {me.role === 'admin' && (
                  <button disabled={busy} className={`${btn} w-full sm:w-auto`}
                    onClick={() => {
                      if (confirm(t('msg.confirmDelete'))) void run(() => messagesApi.remove(token, m.id));
                    }}>
                    ✕ {t('msg.delete')}
                  </button>
                )}
              </div>
            </article>
          );
        })}

        {loaded && !messages.length && !error && (
          <div className="text-center px-5 py-[65px] text-[#74857d]">
            <div className="text-3xl mb-[18px] text-[#8eac9a]">💬</div>
            <h3 className="text-lg text-[#455f4f] m-0 mb-3">{t('msg.empty')}</h3>
          </div>
        )}
      </div>

      {compose && (
        <Compose
          token={token}
          people={people}
          multi={office}
          initialTo={compose.to}
          replyTo={compose.replyTo}
          onClose={() => setCompose(null)}
          onSent={() => {
            setCompose(null);
            notifyMessagesChanged();
            void reload();
          }}
        />
      )}
    </div>
  );
}

function Compose({
  token, people, multi, initialTo, replyTo, onClose, onSent,
}: {
  token: string;
  people: Recipient[];
  multi: boolean;
  initialTo: string[];
  replyTo: number | null;
  onClose: () => void;
  onSent: () => void;
}) {
  const { t } = useI18n();
  const [to, setTo] = useState<string[]>(initialTo);
  const [body, setBody] = useState('');
  const [error, setError] = useState('');
  const [sending, setSending] = useState(false);

  const groups = useMemo(() => {
    const order: Role[] = ['admin', 'manager', 'team_leader'];
    return order
      .map((role) => ({ role, list: people.filter((p) => p.role === role) }))
      .filter((g) => g.list.length);
  }, [people]);
  const all = people.length > 0 && people.every((p) => to.includes(p.username));
  const toggle = (u: string, on: boolean) =>
    setTo((l) => (on ? [...new Set([...l, u])] : l.filter((x) => x !== u)));

  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!to.length || !body.trim()) return;
    setSending(true);
    try {
      await messagesApi.send(token, to, body, replyTo);
      onSent();
    } catch (err) {
      setError(String((err as Error).message ?? err));
      setSending(false);
    }
  };

  const label = 'flex flex-col gap-2 text-sm text-[#50685b] mb-4';
  const input = 'border border-[#d3dfd9] rounded-md bg-white px-[11px] py-[9px] min-h-[39px] w-full text-sm text-[#243e31]';

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <form
        onSubmit={send}
        onClick={(e) => e.stopPropagation()}
        className="bg-white w-full max-w-[490px] max-h-[90vh] overflow-y-auto p-[22px] sm:p-7 rounded-[13px] text-[#203332]"
      >
        <div className="flex items-start justify-between mb-4">
          <h3 className="text-[22px] font-[650] m-0">{replyTo ? t('msg.reply') : t('msg.new')}</h3>
          <button type="button" className="text-[#79907f] text-lg leading-none px-1" onClick={onClose} aria-label="Close">✕</button>
        </div>

        {multi ? (
          <fieldset className="border border-[#d3dfd9] rounded-md px-[14px] pt-[10px] pb-3 mb-4 min-w-0">
            <legend className="text-sm text-[#50685b] px-1.5">
              {t('msg.toCount').replace('{n}', String(to.length)).replace('{total}', String(people.length))}
            </legend>
            <label className="flex items-center gap-[10px] text-sm py-1.5 cursor-pointer font-semibold border-b border-[#e8eeeb] pb-[10px] mb-1">
              <input type="checkbox" className="accent-[#087e6d] w-4 h-4" checked={all}
                onChange={(e) => setTo(e.target.checked ? people.map((p) => p.username) : [])} />
              {t('msg.all')}
            </label>
            {groups.map((g) => (
              <div key={g.role}>
                <div className="text-xs text-[#83928a] mt-2 mb-0.5">{t(ROLE_LABEL[g.role])}</div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-[15px]">
                  {g.list.map((p) => (
                    <label key={p.username} className="flex items-center gap-[10px] text-sm py-1.5 cursor-pointer min-w-0">
                      <input type="checkbox" className="accent-[#087e6d] w-4 h-4 flex-shrink-0" checked={to.includes(p.username)}
                        onChange={(e) => toggle(p.username, e.target.checked)} />
                      <span className="truncate">{p.displayName}{p.crewId ? ` · ${p.crewId}` : ''}</span>
                    </label>
                  ))}
                </div>
              </div>
            ))}
          </fieldset>
        ) : (
          <label className={label}>
            {t('msg.to')}
            <select className={input} value={to[0] ?? ''} onChange={(e) => setTo(e.target.value ? [e.target.value] : [])}>
              <option value="" disabled>—</option>
              {groups.map((g) => (
                <optgroup key={g.role} label={t(ROLE_LABEL[g.role])}>
                  {g.list.map((p) => (
                    <option key={p.username} value={p.username}>{p.displayName}{p.crewId ? ` · ${p.crewId}` : ''}</option>
                  ))}
                </optgroup>
              ))}
            </select>
          </label>
        )}

        <label className={label}>
          {t('msg.field')}
          <textarea required maxLength={2000} className={`${input.replace('min-h-[39px]', 'min-h-[130px]')} resize-y`} value={body}
            onChange={(e) => setBody(e.target.value)} autoFocus />
        </label>

        {error && <p role="alert" className="p-3 bg-[#fff0e7] text-[#965936] rounded-md text-sm">{error}</p>}

        <button type="submit" className={`${btnPrimary} w-full mt-3`} disabled={sending || !to.length}
          style={{ background: GREEN }}>
          {sending ? t('msg.sending') : multi ? t('msg.sendTo').replace('{n}', String(to.length)) : t('msg.send')}
        </button>
      </form>
    </div>
  );
}
