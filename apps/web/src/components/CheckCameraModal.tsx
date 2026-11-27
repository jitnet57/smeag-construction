import { useEffect, useRef, useState } from 'react';
import type { AttendancePhotoKind } from '@brightem/shared';
import { useI18n } from '../i18n';

// What the phone says out loud when the photo is taken.
export const KIND_SPEECH: Record<AttendancePhotoKind, string> = {
  check_in: 'Baydream check in',
  check_out: 'Baydream check out',
  break_in: 'Baydream break time in',
  break_out: 'Baydream break time out',
};

// Prefer Google's friendly English voice: "Google US English" (Chrome on a
// computer, a warm female voice), else any Google English voice (Android
// Chrome), else the best English voice the phone has (e.g. iPhone Samantha).
let chosenVoice: SpeechSynthesisVoice | null = null;
function pickVoice(): SpeechSynthesisVoice | null {
  const voices = window.speechSynthesis?.getVoices() ?? [];
  if (!voices.length) return null;
  const en = voices.filter((v) => /^en[-_]/i.test(v.lang));
  const isGoogle = (v: SpeechSynthesisVoice) => /google/i.test(v.name) || /google/i.test(v.voiceURI);
  return (
    en.find((v) => v.name === 'Google US English') ??
    en.find((v) => isGoogle(v) && /en[-_]US/i.test(v.lang)) ??
    en.find(isGoogle) ??
    en.find((v) => /samantha|female/i.test(v.name)) ??
    en.find((v) => /en[-_]US/i.test(v.lang)) ??
    en[0] ??
    null
  );
}
if (typeof window !== 'undefined' && window.speechSynthesis) {
  chosenVoice = pickVoice();
  // Voices load late in Chrome.
  window.speechSynthesis.addEventListener?.('voiceschanged', () => {
    chosenVoice = pickVoice();
  });
}

export function speak(text: string) {
  try {
    const synth = window.speechSynthesis;
    if (!synth) return;
    synth.cancel();
    const u = new SpeechSynthesisUtterance(text);
    const voice = chosenVoice ?? pickVoice();
    if (voice) u.voice = voice;
    u.lang = voice?.lang ?? 'en-US';
    u.rate = 1;
    u.pitch = 1.1; // a little brighter / friendlier
    synth.speak(u);
  } catch {
    /* speech not supported — the photo is still saved */
  }
}

// Short chime played when a check photo is taken, so the worker hears it even
// where speech is unavailable. Each kind has its own notes:
// check in rises, check out falls, break in/out are two quick beeps.
const KIND_NOTES: Record<AttendancePhotoKind, number[]> = {
  check_in: [660, 880, 1175],
  check_out: [1175, 880, 660],
  break_in: [988, 988],
  break_out: [784, 1047],
};

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

/** Call from a tap: phones (iOS) only let sound and speech start after a user gesture. */
export function unlockSound() {
  const ctx = getAudio();
  if (ctx?.state === 'suspended') void ctx.resume().catch(() => undefined);
  try {
    const synth = window.speechSynthesis;
    if (synth && !synth.speaking) synth.speak(new SpeechSynthesisUtterance(''));
  } catch {
    /* no speech */
  }
}

export function playKindSound(kind: AttendancePhotoKind) {
  const ctx = getAudio();
  if (!ctx) return;
  try {
    if (ctx.state === 'suspended') void ctx.resume().catch(() => undefined);
    const start = ctx.currentTime + 0.02;
    KIND_NOTES[kind].forEach((freq, i) => {
      const t0 = start + i * 0.16;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, t0);
      gain.gain.exponentialRampToValueAtTime(0.35, t0 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.14);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t0);
      osc.stop(t0 + 0.15);
    });
  } catch {
    /* sound not supported — the photo is still saved */
  }
}

const MAX_SIDE = 960;

// Shrink a captured frame / picked image to a JPEG of at most MAX_SIDE px.
function toJpeg(src: CanvasImageSource, w: number, h: number): Promise<Blob> {
  const scale = Math.min(1, MAX_SIDE / Math.max(w, h));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(w * scale);
  canvas.height = Math.round(h * scale);
  canvas.getContext('2d')!.drawImage(src, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('capture failed'))), 'image/jpeg', 0.8)
  );
}

/**
 * Opens the camera for a check-in / check-out / break photo. The photo is
 * required: `onCapture` runs only once a picture is taken. If the live camera
 * cannot be opened (no permission, old browser) the phone's own camera app is
 * used through a file input instead.
 */
export default function CheckCameraModal({
  title,
  onCapture,
  onClose,
}: {
  title: string;
  onCapture: (photo: Blob) => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const videoRef = useRef<HTMLVideoElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [facing, setFacing] = useState<'user' | 'environment'>('user');
  const [live, setLive] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    setLive(false);
    if (!navigator.mediaDevices?.getUserMedia) {
      setFailed(true);
      return;
    }
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: facing }, audio: false })
      .then((stream) => {
        if (!alive) {
          stream.getTracks().forEach((tr) => tr.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          void videoRef.current.play().catch(() => undefined);
        }
        setLive(true);
      })
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
      streamRef.current?.getTracks().forEach((tr) => tr.stop());
      streamRef.current = null;
    };
  }, [facing]);

  const shoot = async () => {
    const v = videoRef.current;
    if (!v || !v.videoWidth) return;
    onCapture(await toJpeg(v, v.videoWidth, v.videoHeight));
  };

  const onPick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const bmp = await createImageBitmap(file);
      onCapture(await toJpeg(bmp, bmp.width, bmp.height));
    } catch {
      onCapture(file);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-3" onClick={onClose}>
      <div className="w-full max-w-md overflow-hidden rounded-xl bg-white" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <h3 className="text-sm font-bold text-dark">📷 {title}</h3>
          <button onClick={onClose} className="text-xl leading-none text-muted" aria-label="close">
            ×
          </button>
        </div>
        <div className="relative aspect-[3/4] bg-black">
          {!failed && (
            <video
              ref={videoRef}
              playsInline
              muted
              className={`h-full w-full object-cover ${facing === 'user' ? '-scale-x-100' : ''}`}
            />
          )}
          {failed && (
            <div className="flex h-full items-center justify-center p-6 text-center text-sm text-white">
              {t('att.cameraUnavailable')}
            </div>
          )}
        </div>
        <input ref={fileRef} type="file" accept="image/*" capture={facing} className="hidden" onChange={onPick} />
        <div className="flex items-center justify-between gap-2 px-4 py-3">
          <button
            className="btn ghost"
            onClick={() => setFacing((f) => (f === 'user' ? 'environment' : 'user'))}
            disabled={failed}
          >
            🔄 {t('att.cameraFlip')}
          </button>
          {failed ? (
            <button className="btn" onClick={() => fileRef.current?.click()}>
              📷 {t('att.cameraOpen')}
            </button>
          ) : (
            <button className="btn" onClick={shoot} disabled={!live}>
              📸 {t('att.cameraShoot')}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
