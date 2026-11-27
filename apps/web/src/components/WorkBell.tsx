import { useEffect, useRef, useState } from 'react';
import { useI18n } from '../i18n';

// Daily work bell: at each time below the open app plays a chime and
// Samantha (the English voice on iPhone / Mac) reads the announcement.
// Times are the device's local clock (the phones on site run Philippine time).
export const BELLS: { time: string; text: string }[] = [
  { time: '07:00', text: "Good morning, everyone. It's 7 a.m. Let's start work." },
  { time: '10:00', text: "It's 10 a.m. It's break time." },
  { time: '10:15', text: "It's 10:15. Break time is over. Please return to work." },
  { time: '16:00', text: "It's 4 p.m. Work is finished for today. Thank you for your hard work, everyone." },
];

const ON_KEY = 'workBell.on'; // '0' = muted on this device
const LAST_KEY = 'workBell.last'; // "<YYYY-MM-DD> <HH:MM>" of the last bell rung

// Samantha first; other devices fall back to a female / US English voice.
function pickVoice(): SpeechSynthesisVoice | null {
  const voices = window.speechSynthesis?.getVoices() ?? [];
  const en = voices.filter((v) => /^en[-_]/i.test(v.lang));
  return (
    en.find((v) => /samantha/i.test(v.name)) ??
    en.find((v) => /female/i.test(v.name)) ??
    en.find((v) => v.name === 'Google US English') ??
    en.find((v) => /en[-_]US/i.test(v.lang)) ??
    en[0] ??
    null
  );
}

function say(text: string) {
  try {
    const synth = window.speechSynthesis;
    if (!synth) return;
    synth.cancel();
    const u = new SpeechSynthesisUtterance(text);
    const voice = pickVoice();
    if (voice) u.voice = voice;
    u.lang = voice?.lang ?? 'en-US';
    u.rate = 0.95;
    synth.speak(u);
  } catch {
    /* no speech on this device */
  }
}

let audioCtx: AudioContext | null = null;
function getAudio(): AudioContext | null {
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return null;
    audioCtx ??= new Ctx();
    return audioCtx;
  } catch {
    return null;
  }
}

// Phones only allow sound after a tap; call this from one.
function unlock() {
  const ctx = getAudio();
  if (ctx?.state === 'suspended') void ctx.resume().catch(() => undefined);
  try {
    const synth = window.speechSynthesis;
    if (synth && !synth.speaking) synth.speak(new SpeechSynthesisUtterance(''));
  } catch {
    /* no speech */
  }
}

// "Ding-dong-ding" chime, then the announcement.
function ring(text: string) {
  const ctx = getAudio();
  let delayMs = 0;
  if (ctx) {
    try {
      if (ctx.state === 'suspended') void ctx.resume().catch(() => undefined);
      const start = ctx.currentTime + 0.05;
      [784, 659, 523, 784].forEach((freq, i) => {
        const t0 = start + i * 0.5;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0.0001, t0);
        gain.gain.exponentialRampToValueAtTime(0.4, t0 + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.9);
        osc.connect(gain).connect(ctx.destination);
        osc.start(t0);
        osc.stop(t0 + 0.95);
      });
      delayMs = 2400;
    } catch {
      /* no sound — speech only */
    }
  }
  window.setTimeout(() => say(text), delayMs);
}

const pad = (n: number) => String(n).padStart(2, '0');

/** Top-bar bell button. While the app is open it rings at each BELLS time. */
export default function WorkBell() {
  const { t } = useI18n();
  const [on, setOn] = useState(() => {
    try {
      return localStorage.getItem(ON_KEY) !== '0';
    } catch {
      return true;
    }
  });
  const onRef = useRef(on);
  onRef.current = on;

  // Any first tap in the app unlocks sound, so the bell can ring later.
  useEffect(() => {
    const handler = () => unlock();
    document.addEventListener('pointerdown', handler, { once: true });
    return () => document.removeEventListener('pointerdown', handler);
  }, []);

  useEffect(() => {
    const check = () => {
      if (!onRef.current) return;
      const now = new Date();
      const hm = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
      const bell = BELLS.find((b) => b.time === hm);
      if (!bell) return;
      const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${hm}`;
      try {
        if (localStorage.getItem(LAST_KEY) === stamp) return; // already rung (other tab / reload)
        localStorage.setItem(LAST_KEY, stamp);
      } catch {
        /* private mode — may ring once per tab */
      }
      ring(bell.text);
    };
    check();
    const id = window.setInterval(check, 10_000);
    return () => window.clearInterval(id);
  }, []);

  const toggle = () => {
    unlock();
    const next = !on;
    setOn(next);
    try {
      localStorage.setItem(ON_KEY, next ? '1' : '0');
    } catch {
      /* not remembered */
    }
    if (next) say('Work bell is on.');
  };

  return (
    <button
      type="button"
      onClick={toggle}
      className="text-base leading-none flex-shrink-0"
      title={`${on ? t('bell.on') : t('bell.off')} · ${BELLS.map((b) => b.time).join(' · ')}`}
      aria-label={on ? t('bell.on') : t('bell.off')}
    >
      {on ? '🔔' : '🔕'}
    </button>
  );
}
