import { useState, useEffect, useRef } from 'react';
import type { RoomPhoto } from '@brightem/shared';
import { api } from '../api';
import { useI18n } from '../i18n';

/**
 * A shared modal that shows all photos for one physical room (floor + room)
 * and lets the user add more (upload from device / take a photo on mobile).
 * Used by both Unit Progress and Material Readiness.
 */
export default function RoomPhotoModal({
  floor,
  room,
  onClose,
}: {
  floor: number;
  room: number;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const [photos, setPhotos] = useState<RoomPhoto[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [viewer, setViewer] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    api
      .getRoomPhotos(floor, room)
      .then((list) => {
        if (alive) setPhotos(list);
      })
      .catch(() => {
        if (alive) setPhotos([]);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [floor, room]);

  const onPick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = ''; // allow re-selecting the same file
    if (!files.length) return;
    setBusy(true);
    try {
      for (const f of files) {
        const p = await api.addRoomPhoto(floor, room, f);
        setPhotos((prev) => [p, ...prev]);
      }
    } catch {
      alert(t('photo.uploadError'));
    } finally {
      setBusy(false);
    }
  };

  const onDelete = async (id: string) => {
    if (!confirm(t('photo.deleteConfirm'))) return;
    const prev = photos;
    setPhotos((p) => p.filter((x) => x.id !== id));
    try {
      await api.deleteRoomPhoto(id);
    } catch {
      alert(t('photo.deleteError'));
      setPhotos(prev);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col rounded-xl bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-line px-5 py-3">
          <div className="text-base font-semibold text-dark">
            📷 {t('photo.title')} · {room}
          </div>
          <button
            onClick={onClose}
            className="text-xl leading-none text-muted hover:text-dark px-1"
            aria-label={t('photo.close')}
          >
            ✕
          </button>
        </div>

        {/* Body */}
        <div className="px-5 py-4 overflow-y-auto">
          {loading ? (
            <p className="text-sm text-muted py-8 text-center">{t('photo.loading')}</p>
          ) : photos.length === 0 ? (
            <p className="text-sm text-muted py-8 text-center">{t('photo.empty')}</p>
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {photos.map((p) => (
                <div key={p.id} className="group relative">
                  <img
                    src={p.url}
                    alt=""
                    onClick={() => setViewer(p.url)}
                    className="aspect-square w-full cursor-zoom-in rounded-lg border border-line object-cover"
                  />
                  <button
                    onClick={() => onDelete(p.id)}
                    className="absolute right-1.5 top-1.5 rounded-full bg-black/60 px-2 py-0.5 text-xs text-white opacity-0 transition-opacity group-hover:opacity-100"
                    aria-label={t('photo.delete')}
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer / add */}
        <div className="flex items-center justify-between gap-2 border-t border-line px-5 py-3">
          <span className="text-xs text-muted">
            {photos.length} {t('photo.count')}
          </span>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            capture="environment"
            multiple
            onChange={onPick}
            className="hidden"
          />
          <button
            onClick={() => fileRef.current?.click()}
            disabled={busy}
            className="rounded-md border border-primary bg-primary px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
          >
            {busy ? t('photo.uploading') : `＋ ${t('photo.add')}`}
          </button>
        </div>
      </div>

      {/* Full-size viewer */}
      {viewer && (
        <div
          className="fixed inset-0 z-[70] flex items-center justify-center bg-black/80 p-4"
          onClick={(e) => {
            e.stopPropagation();
            setViewer(null);
          }}
        >
          <img src={viewer} alt="" className="max-h-full max-w-full rounded-lg object-contain" />
        </div>
      )}
    </div>
  );
}
