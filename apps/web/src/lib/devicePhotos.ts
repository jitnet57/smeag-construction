// Attendance photos (check-in / check-out / break) stay on this phone only:
// nothing is uploaded. Each photo is
//   1. saved to the phone as a JPEG file (browser download → Downloads /
//      Files / gallery, depending on the phone), and
//   2. kept in this browser's IndexedDB so the attendance screen can show the
//      thumbnails and know who is still on break.
import type { AttendancePhoto, AttendancePhotoKind } from '@brightem/shared';

const DB_NAME = 'brightem-attendance-photos';
const STORE = 'photos';

interface StoredPhoto {
  id: string;
  employeeId: string;
  date: string;
  kind: AttendancePhotoKind;
  takenAt: string;
  blob: Blob;
}

// Ask the browser to keep this data: persistent storage is not evicted when
// the phone runs low on space (only a manual "clear site data" removes it).
let persistAsked = false;
function askPersist() {
  if (persistAsked) return;
  persistAsked = true;
  void navigator.storage?.persist?.().catch(() => undefined);
}

function openDb(): Promise<IDBDatabase> {
  askPersist();
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const store = req.result.createObjectStore(STORE, { keyPath: 'id' });
      store.createIndex('date', 'date');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

// Object URLs handed out for thumbnails, reused per photo id.
const urls = new Map<string, string>();
function toPhoto(p: StoredPhoto): AttendancePhoto {
  let url = urls.get(p.id);
  if (!url) {
    url = URL.createObjectURL(p.blob);
    urls.set(p.id, url);
  }
  return { id: p.id, employeeId: p.employeeId, date: p.date, kind: p.kind, takenAt: p.takenAt, url };
}

export async function getDevicePhotos(date: string): Promise<AttendancePhoto[]> {
  const db = await openDb();
  const rows: StoredPhoto[] = await new Promise((resolve, reject) => {
    const req = db.transaction(STORE).objectStore(STORE).index('date').getAll(date);
    req.onsuccess = () => resolve(req.result as StoredPhoto[]);
    req.onerror = () => reject(req.error);
  });
  db.close();
  return rows.sort((a, b) => (a.takenAt < b.takenAt ? -1 : 1)).map(toPhoto);
}

function slug(s: string) {
  return s.replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

// Hand the JPEG to the phone as a file download.
function saveToPhone(blob: Blob, fileName: string) {
  const a = document.createElement('a');
  const url = URL.createObjectURL(blob);
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export async function addDevicePhoto(
  employeeId: string,
  employeeName: string,
  date: string,
  kind: AttendancePhotoKind,
  blob: Blob,
  clock: string // "07:05", Manila time, for the file name
): Promise<AttendancePhoto> {
  const rec: StoredPhoto = {
    id: `${date}-${employeeId}-${kind}-${Date.now()}`,
    employeeId,
    date,
    kind,
    takenAt: new Date().toISOString(),
    blob,
  };
  saveToPhone(blob, `baydream_${kind}_${slug(employeeName)}_${date}_${clock.replace(':', '')}.jpg`);
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(rec);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
  return toPhoto(rec);
}
