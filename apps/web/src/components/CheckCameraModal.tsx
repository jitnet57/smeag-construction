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

export function speak(text: string) {
  try {
    const synth = window.speechSynthesis;
    if (!synth) return;
    synth.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'en-US';
    u.rate = 0.95;
    synth.speak(u);
  } catch {
    /* speech not supported — the photo is still saved */
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
