import { useEffect, useState } from 'react';
import { MESSAGES_CHANGED, messagesApi } from '../messages';

const POLL_MS = 30_000;

/** Number of unread messages to me; polled every 30 s while the tab is visible. */
export function useUnreadMessages(token: string): number {
  const [n, setN] = useState(0);
  useEffect(() => {
    let alive = true;
    const check = () => {
      if (document.visibilityState !== 'visible') return;
      messagesApi
        .unread(token)
        .then((v) => alive && setN(Number(v) || 0))
        .catch(() => undefined); // offline / not migrated yet — keep the last count
    };
    check();
    const id = window.setInterval(check, POLL_MS);
    window.addEventListener(MESSAGES_CHANGED, check);
    document.addEventListener('visibilitychange', check);
    return () => {
      alive = false;
      window.clearInterval(id);
      window.removeEventListener(MESSAGES_CHANGED, check);
      document.removeEventListener('visibilitychange', check);
    };
  }, [token]);
  return n;
}
