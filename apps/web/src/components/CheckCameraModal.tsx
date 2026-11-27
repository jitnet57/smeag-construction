import { useEffect, useRef, useState } from 'react';
import type { AttendancePhotoKind } from '@brightem/shared';
import { useI18n } from '../i18n';
import { OVAL, judgeFace, loadFaceDetector, type FaceFix } from '../lib/faceGuide';

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

type Facing = 'user' | 'environment';

// The side last used on this phone is remembered, so a team leader who
// photographs the crew with the back camera does not have to flip every time.
const FACING_KEY = 'checkCamera.facing';
function loadFacing(): Facing {
  try {
    return localStorage.getItem(FACING_KEY) === 'environment' ? 'environment' : 'user';
  } catch {
    return 'user';
  }
}
function saveFacing(f: Facing) {
  try {
    localStorage.setItem(FACING_KEY, f);
  } catch {
    /* private mode — just not remembered */
  }
}

/**
 * Open the camera on the wanted side. Some phones ignore `facingMode`, so when
 * flipping (`avoidId` = the camera being left) a stream that comes back on the
 * same camera is dropped and the other cameras are tried one by one.
 */
async function openCamera(want: Facing, avoidId?: string): Promise<MediaStream> {
  const md = navigator.mediaDevices;
  const attempts: MediaTrackConstraints[] = [{ facingMode: { exact: want } }, { facingMode: want }];
  for (const video of attempts) {
    try {
      const stream = await md.getUserMedia({ video, audio: false });
      const id = stream.getVideoTracks()[0]?.getSettings().deviceId;
      if (avoidId && id === avoidId) {
        stream.getTracks().forEach((tr) => tr.stop());
        continue;
      }
      return stream;
    } catch {
      /* try the next way */
    }
  }
  if (avoidId) {
    const cams = (await md.enumerateDevices()).filter((d) => d.kind === 'videoinput' && d.deviceId !== avoidId);
    for (const cam of cams) {
      try {
        return await md.getUserMedia({ video: { deviceId: { exact: cam.deviceId } }, audio: false });
      } catch {
        /* try the next camera */
      }
    }
  }
  throw new Error('camera unavailable');
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
  const [facing, setFacing] = useState<Facing>(loadFacing);
  // Which way the open camera really points (phones may ignore facingMode);
  // only the front camera is shown mirrored.
  const [actual, setActual] = useState<Facing>(facing);
  const [live, setLive] = useState(false);
  const [failed, setFailed] = useState(false);
  const [flipFailed, setFlipFailed] = useState(false);
  // Set by flip(): the camera we are leaving and the side to go back to if
  // the other camera cannot be opened.
  const flipRef = useRef<{ from?: string; back: Facing } | null>(null);
  const deviceRef = useRef<string | undefined>(undefined);
  // Face guide: 'loading' while the detector loads, 'off' when it cannot be
  // loaded (then the photo may be taken without it), else the latest verdict.
  const [guide, setGuide] = useState<'loading' | 'off' | FaceFix>('loading');

  useEffect(() => {
    if (!live) return;
    let alive = true;
    let timer = 0;
    let lastTs = 0;
    let errors = 0;
    loadFaceDetector()
      .then((detector) => {
        if (!alive) return;
        setGuide('none');
        const tick = () => {
          if (!alive) return;
          const v = videoRef.current;
          if (v && v.readyState >= 2 && v.videoWidth) {
            try {
              const ts = Math.max(performance.now(), lastTs + 1);
              lastTs = ts;
              const faces = detector.detectForVideo(v, ts).detections;
              const box = faces
                .map((d) => d.boundingBox)
                .filter((b): b is NonNullable<typeof b> => !!b)
                .sort((a, b) => b.width * b.height - a.width * a.height)[0];
              const r = v.getBoundingClientRect();
              setGuide(judgeFace(box, { w: v.videoWidth, h: v.videoHeight }, { w: r.width, h: r.height }));
              errors = 0;
            } catch {
              // One bad frame (e.g. while the stream resizes) must not drop
              // the guide; only give up after many failures in a row.
              if (++errors >= 20) {
                setGuide('off');
                return;
              }
            }
          }
          timer = window.setTimeout(tick, 150);
        };
        tick();
      })
      .catch(() => {
        if (alive) setGuide('off');
      });
    return () => {
      alive = false;
      clearTimeout(timer);
      setGuide('loading');
    };
  }, [live]);
  const canShoot = live && (guide === 'ok' || guide === 'off');

  useEffect(() => {
    let alive = true;
    setLive(false);
    if (!navigator.mediaDevices?.getUserMedia) {
      setFailed(true);
      return;
    }
    const flip = flipRef.current;
    flipRef.current = null;
    openCamera(facing, flip?.from)
      .then((stream) => {
        if (!alive) {
          stream.getTracks().forEach((tr) => tr.stop());
          return;
        }
        const settings = stream.getVideoTracks()[0]?.getSettings();
        deviceRef.current = settings?.deviceId;
        setActual(settings?.facingMode === 'user' || settings?.facingMode === 'environment' ? settings.facingMode : facing);
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          void videoRef.current.play().catch(() => undefined);
        }
        saveFacing(facing);
        setFailed(false);
        setLive(true);
      })
      .catch(() => {
        if (!alive) return;
        if (flip) {
          // The other camera would not open: go back to the one that worked.
          setFlipFailed(true);
          setFacing(flip.back);
        } else {
          setFailed(true);
        }
      });
    return () => {
      alive = false;
      streamRef.current?.getTracks().forEach((tr) => tr.stop());
      streamRef.current = null;
    };
  }, [facing]);

  const flipCamera = () => {
    setFlipFailed(false);
    if (failed) {
      // Live camera unavailable: the phone's camera app opens on the other side.
      setFacing((f) => (f === 'user' ? 'environment' : 'user'));
      return;
    }
    flipRef.current = { from: deviceRef.current, back: facing };
    setFacing((f) => (f === 'user' ? 'environment' : 'user'));
  };

  const shoot = async () => {
    const v = videoRef.current;
    if (!v || !v.videoWidth || !canShoot) return;
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
              className={`h-full w-full object-cover ${actual === 'user' ? '-scale-x-100' : ''}`}
            />
          )}
          {!failed && (
            <span className="absolute left-2 top-2 rounded-full bg-black/60 px-2.5 py-1 text-xs font-semibold text-white">
              {facing === 'user' ? t('att.cameraFront') : t('att.cameraBack')}
            </span>
          )}
          {!failed && (
            <>
              <svg className="pointer-events-none absolute inset-0 h-full w-full" viewBox="0 0 300 400" preserveAspectRatio="none">
                <defs>
                  <mask id="face-oval-mask">
                    <rect width="300" height="400" fill="white" />
                    <ellipse cx={OVAL.cx * 300} cy={OVAL.cy * 400} rx={OVAL.rx * 300} ry={OVAL.ry * 400} fill="black" />
                  </mask>
                </defs>
                <rect width="300" height="400" fill="rgba(0,0,0,0.35)" mask="url(#face-oval-mask)" />
                <ellipse
                  cx={OVAL.cx * 300}
                  cy={OVAL.cy * 400}
                  rx={OVAL.rx * 300}
                  ry={OVAL.ry * 400}
                  fill="none"
                  stroke={guide === 'ok' ? '#22c55e' : guide === 'loading' ? '#d1d5db' : guide === 'off' ? '#ffffff' : '#ef4444'}
                  strokeWidth="4"
                  strokeDasharray={guide === 'loading' ? '10 8' : undefined}
                  vectorEffect="non-scaling-stroke"
                />
              </svg>
              <div
                className={`absolute inset-x-6 bottom-3 rounded-full px-3 py-1.5 text-center text-xs font-semibold text-white ${
                  guide === 'ok' ? 'bg-green-600/90' : guide === 'loading' || guide === 'off' ? 'bg-black/60' : 'bg-red-600/90'
                }`}
              >
                {t(`att.face.${guide}`)}
              </div>
            </>
          )}
          {flipFailed && (
            <div className="absolute inset-x-2 bottom-2 rounded-md bg-black/70 px-3 py-2 text-center text-xs text-white">
              {t('att.cameraFlipFailed')}
            </div>
          )}
          {failed && (
            <div className="flex h-full items-center justify-center p-6 text-center text-sm text-white">
              {t('att.cameraUnavailable')}
            </div>
          )}
        </div>
        <input ref={fileRef} type="file" accept="image/*" capture={facing} className="hidden" onChange={onPick} />
        <div className="flex items-center justify-between gap-2 px-4 py-3">
          <button className="btn ghost" onClick={flipCamera} disabled={!failed && !live}>
            🔄 {facing === 'user' ? t('att.cameraToBack') : t('att.cameraToFront')}
          </button>
          {failed ? (
            <button className="btn" onClick={() => fileRef.current?.click()}>
              📷 {t('att.cameraOpen')}
            </button>
          ) : (
            <button className="btn" onClick={shoot} disabled={!canShoot}>
              📸 {t('att.cameraShoot')}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
