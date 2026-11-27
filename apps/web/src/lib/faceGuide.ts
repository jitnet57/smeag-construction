// Face guide for the check camera: finds the face in the live preview so the
// photo can only be taken once one face sits in the middle of the oval.
// MediaPipe's BlazeFace (short range) runs in the browser; the library is
// loaded only when the camera opens, and its wasm + model come from a CDN.
// If they cannot be loaded (no internet), the caller falls back to letting
// the photo be taken without the guide, so check-in is never blocked.
import type { FaceDetector } from '@mediapipe/tasks-vision';

const WASM_URL = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.2.3/wasm';
const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite';
const LOAD_TIMEOUT_MS = 15000;

let loading: Promise<FaceDetector> | null = null;

export function loadFaceDetector(): Promise<FaceDetector> {
  loading ??= (async () => {
    const { FilesetResolver, FaceDetector } = await import('@mediapipe/tasks-vision');
    const fileset = await FilesetResolver.forVisionTasks(WASM_URL);
    const create = (delegate: 'GPU' | 'CPU') =>
      FaceDetector.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: MODEL_URL, delegate },
        runningMode: 'VIDEO',
        minDetectionConfidence: 0.6,
      });
    try {
      return await create('GPU');
    } catch {
      return await create('CPU');
    }
  })();
  const p = loading;
  // A failed load may be retried the next time the camera opens.
  p.catch(() => {
    if (loading === p) loading = null;
  });
  return Promise.race([
    p,
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error('face guide timeout')), LOAD_TIMEOUT_MS)),
  ]);
}

/** Oval guide, as fractions of the preview box (which is 3:4, portrait). */
export const OVAL = { cx: 0.5, cy: 0.46, rx: 0.3, ry: 0.3 * (3 / 4) * 1.3 };

export type FaceFix = 'ok' | 'none' | 'center' | 'closer' | 'back';

/**
 * Judge the largest face against the oval. `box` is in video pixels; the
 * preview shows the video with object-fit: cover in a `w`×`h` box, so the
 * face is mapped to what the worker actually sees.
 */
export function judgeFace(
  box: { originX: number; originY: number; width: number; height: number } | undefined,
  video: { w: number; h: number },
  view: { w: number; h: number }
): FaceFix {
  if (!box || !video.w || !view.w) return 'none';
  const scale = Math.max(view.w / video.w, view.h / video.h);
  const offX = (video.w * scale - view.w) / 2;
  const offY = (video.h * scale - view.h) / 2;
  // Face centre and width as fractions of the preview box. Mirroring the
  // front camera flips x around the middle, which does not change the
  // distance to the centre line, so it can be ignored here.
  const fx = ((box.originX + box.width / 2) * scale - offX) / view.w;
  const fy = ((box.originY + box.height / 2) * scale - offY) / view.h;
  const fw = (box.width * scale) / view.w;
  if (fw < 0.26) return 'closer';
  if (fw > 0.72) return 'back';
  if (Math.abs(fx - OVAL.cx) > 0.09 || Math.abs(fy - OVAL.cy) > 0.08) return 'center';
  return 'ok';
}
