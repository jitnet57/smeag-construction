import { useState, useEffect, useMemo } from 'react';
import { UNIT_WORK_ITEMS, MATERIAL_STAGES } from '@brightem/shared';
import type { UnitWorkItem, MaterialStage, RoomDelivery } from '@brightem/shared';
import { api } from '../api';
import { useI18n } from '../i18n';
import type { TKey } from '../i18n';
import RoomPhotoModal from '../components/RoomPhotoModal';

const FLOORS = [4, 5, 6, 7, 8, 9, 10, 11];
const ROOMS_PER_FLOOR = 26;
const ROOM_OFFSETS = Array.from({ length: ROOMS_PER_FLOOR }, (_, i) => i + 1);

// Cell background for each supply-pipeline stage.
const CELL: Record<MaterialStage, string> = {
  pending: 'bg-gray-100 text-gray-500 border-gray-200 hover:bg-gray-200',
  ordered: 'bg-blue-100 text-blue-800 border-blue-300 hover:bg-blue-200',
  shipping: 'bg-amber-100 text-amber-800 border-amber-300 hover:bg-amber-200',
  delivering: 'bg-orange-100 text-orange-800 border-orange-300 hover:bg-orange-200',
  delivered: 'bg-green-100 text-green-800 border-green-300 hover:bg-green-200',
};

// Legend swatch (solid) for each stage.
const SWATCH: Record<MaterialStage, string> = {
  pending: 'bg-gray-300',
  ordered: 'bg-blue-500',
  shipping: 'bg-amber-500',
  delivering: 'bg-orange-500',
  delivered: 'bg-green-600',
};

const STAGE_ICON: Record<MaterialStage, string> = {
  pending: '·',
  ordered: '🛒',
  shipping: '🚚',
  delivering: '🛵',
  delivered: '📦',
};

const key = (floor: number, material: UnitWorkItem) => `${floor}-${material}`;

// Cycle used for the pre-delivery stages: pending → ordered → shipping → delivering.
const advance = (s: MaterialStage): MaterialStage => {
  const order: MaterialStage[] = ['pending', 'ordered', 'shipping', 'delivering'];
  const i = order.indexOf(s);
  return i < 0 || i === order.length - 1 ? 'delivering' : order[i + 1];
};

const isDelivery = (s: MaterialStage) => s === 'delivering' || s === 'delivered';

export default function MaterialReadiness() {
  const { t } = useI18n();
  const [stages, setStages] = useState<Record<string, MaterialStage>>({});
  const [rooms, setRooms] = useState<Record<string, number[]>>({});
  // Per-room pieces + memo details, keyed the same as stages/rooms.
  const [details, setDetails] = useState<Record<string, RoomDelivery[]>>({});
  // Key of the cell whose per-room delivery panel is open, or null.
  const [openCell, setOpenCell] = useState<{ floor: number; material: UnitWorkItem } | null>(null);
  // Room whose photo gallery modal is open (null = closed).
  const [photoRoom, setPhotoRoom] = useState<number | null>(null);

  // Load readiness for ALL floors once.
  useEffect(() => {
    Promise.all(FLOORS.map((f) => api.getMaterialReadiness(f))).then((lists) => {
      const m: Record<string, MaterialStage> = {};
      const r: Record<string, number[]> = {};
      const d: Record<string, RoomDelivery[]> = {};
      lists.flat().forEach((row) => {
        m[key(row.floor, row.material)] = row.stage;
        if (row.deliveredRooms && row.deliveredRooms.length)
          r[key(row.floor, row.material)] = [...row.deliveredRooms];
        if (row.roomDetails && row.roomDetails.length)
          d[key(row.floor, row.material)] = row.roomDetails.map((x) => ({ ...x }));
      });
      setStages(m);
      setRooms(r);
      setDetails(d);
    });
  }, []);

  const stageOf = (floor: number, material: UnitWorkItem): MaterialStage =>
    stages[key(floor, material)] ?? 'pending';

  const roomsOf = (floor: number, material: UnitWorkItem): number[] =>
    rooms[key(floor, material)] ?? [];

  const detailsOf = (floor: number, material: UnitWorkItem): RoomDelivery[] =>
    details[key(floor, material)] ?? [];

  const save = (
    floor: number,
    material: UnitWorkItem,
    stage: MaterialStage,
    deliveredRooms: number[],
    roomDetails: RoomDelivery[]
  ) => {
    api
      .saveMaterialReadiness({ floor, material, stage, deliveredRooms, roomDetails })
      .catch(() => {
        alert(t('matr.saveError'));
      });
  };

  // Set/replace one room's pieces + memo, and save. Entering pieces>0 also
  // marks the room delivered so it counts in the delivered total.
  const setRoomDetail = (
    floor: number,
    material: UnitWorkItem,
    off: number,
    pieces: number,
    memo: string
  ) => {
    const k = key(floor, material);
    const cur = detailsOf(floor, material).filter((d) => d.room !== off);
    const hasData = pieces > 0 || memo.trim().length > 0;
    const nextDetails = hasData
      ? [...cur, { room: off, pieces, memo: memo.trim() || undefined }].sort(
          (a, b) => a.room - b.room
        )
      : cur;

    // Keep delivered set in sync: pieces>0 => delivered.
    const curRooms = roomsOf(floor, material);
    const nextRooms =
      pieces > 0
        ? curRooms.includes(off)
          ? curRooms
          : [...curRooms, off].sort((a, b) => a - b)
        : curRooms;
    const stage: MaterialStage =
      nextRooms.length === ROOMS_PER_FLOOR ? 'delivered' : 'delivering';

    setDetails((prev) => ({ ...prev, [k]: nextDetails }));
    setRooms((prev) => ({ ...prev, [k]: nextRooms }));
    setStages((prev) => ({ ...prev, [k]: stage }));
    save(floor, material, stage, nextRooms, nextDetails);
  };

  const setStage = (floor: number, material: UnitWorkItem, stage: MaterialStage) => {
    const k = key(floor, material);
    // Leaving the delivery phase clears the room checklist and details.
    const inDelivery = isDelivery(stage);
    const nextRooms = inDelivery ? roomsOf(floor, material) : [];
    const nextDetails = inDelivery ? detailsOf(floor, material) : [];
    setStages((prev) => ({ ...prev, [k]: stage }));
    setRooms((prev) => ({ ...prev, [k]: nextRooms }));
    setDetails((prev) => ({ ...prev, [k]: nextDetails }));
    save(floor, material, stage, nextRooms, nextDetails);
  };

  // Tap a cell: pre-delivery stages advance one step; delivery stages open the
  // per-room panel instead of cycling.
  const onCell = (floor: number, material: UnitWorkItem) => {
    const s = stageOf(floor, material);
    if (isDelivery(s)) {
      setOpenCell({ floor, material });
    } else {
      const next = advance(s);
      setStage(floor, material, next);
      if (next === 'delivering') setOpenCell({ floor, material });
    }
  };

  // Toggle a single room's delivered flag; stage follows the room count.
  const toggleRoom = (floor: number, material: UnitWorkItem, off: number) => {
    const k = key(floor, material);
    const cur = roomsOf(floor, material);
    const next = cur.includes(off)
      ? cur.filter((x) => x !== off)
      : [...cur, off].sort((a, b) => a - b);
    const stage: MaterialStage = next.length === ROOMS_PER_FLOOR ? 'delivered' : 'delivering';
    // Removing a room's delivered flag also drops its pieces/memo detail.
    const nextDetails = next.includes(off)
      ? detailsOf(floor, material)
      : detailsOf(floor, material).filter((d) => d.room !== off);
    setRooms((prev) => ({ ...prev, [k]: next }));
    setDetails((prev) => ({ ...prev, [k]: nextDetails }));
    setStages((prev) => ({ ...prev, [k]: stage }));
    save(floor, material, stage, next, nextDetails);
  };

  const setAllRooms = (floor: number, material: UnitWorkItem, all: boolean) => {
    const k = key(floor, material);
    const next = all ? [...ROOM_OFFSETS] : [];
    const stage: MaterialStage = all ? 'delivered' : 'delivering';
    const nextDetails = all ? detailsOf(floor, material) : [];
    setRooms((prev) => ({ ...prev, [k]: next }));
    setDetails((prev) => ({ ...prev, [k]: nextDetails }));
    setStages((prev) => ({ ...prev, [k]: stage }));
    save(floor, material, stage, next, nextDetails);
  };

  const matLabel = (m: UnitWorkItem) => t(`unit.wi.${m}` as TKey);
  const stageLabel = (s: MaterialStage) => t(`matr.stage.${s}` as TKey);

  // Per-stage totals across the whole building (materials × floors).
  const totals = useMemo(() => {
    const c: Record<MaterialStage, number> = {
      pending: 0,
      ordered: 0,
      shipping: 0,
      delivering: 0,
      delivered: 0,
    };
    FLOORS.forEach((f) =>
      UNIT_WORK_ITEMS.forEach((m) => {
        c[stageOf(f, m)] += 1;
      })
    );
    return c;
  }, [stages]);

  const cellCount = FLOORS.length * UNIT_WORK_ITEMS.length;

  // Building-wide room-delivery totals (how many individual rooms delivered).
  const roomsDelivered = useMemo(() => {
    let n = 0;
    FLOORS.forEach((f) =>
      UNIT_WORK_ITEMS.forEach((m) => {
        n += (rooms[key(f, m)] ?? []).length;
      })
    );
    return n;
  }, [rooms]);
  const totalRooms = cellCount * ROOMS_PER_FLOOR;

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-dark">{t('matr.title')}</h2>
        <p className="text-sm text-muted mt-0.5">{t('matr.intro')}</p>
      </div>

      {/* Legend + summary */}
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 bg-white border border-line rounded-lg px-4 py-3">
        {MATERIAL_STAGES.map((s) => (
          <div key={s} className="flex items-center gap-2 text-sm">
            <span className={`inline-block w-4 h-4 rounded ${SWATCH[s]}`} />
            <span className="text-dark">
              {STAGE_ICON[s]} {stageLabel(s)}
            </span>
            <span className="text-muted">
              {totals[s]}/{cellCount}
            </span>
          </div>
        ))}
        {/* Building-wide room-delivery total */}
        <div className="ml-auto flex items-center gap-2 rounded-md bg-green-50 border border-green-200 px-3 py-1 text-sm">
          <span>🛵</span>
          <span className="font-semibold text-green-800">{t('matr.totalRoomsDelivered')}</span>
          <span className="font-bold text-green-700">
            {roomsDelivered}/{totalRooms}
          </span>
        </div>
      </div>

      <p className="text-xs text-muted">{t('matr.hint')}</p>

      {/* Material × Floor matrix */}
      <div className="overflow-x-auto bg-white border border-line rounded-lg">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr>
              <th className="sticky left-0 bg-gray-50 border border-line px-3 py-2 text-left font-semibold text-dark z-10">
                {t('matr.material')}
              </th>
              {FLOORS.map((f) => (
                <th
                  key={f}
                  className="border border-line px-2 py-2 text-center font-semibold text-dark whitespace-nowrap"
                >
                  {f}
                  {t('unit.floorSuffix')}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {UNIT_WORK_ITEMS.map((m) => (
              <tr key={m}>
                <th className="sticky left-0 bg-gray-50 border border-line px-3 py-2 text-left font-medium text-dark whitespace-nowrap z-10">
                  {matLabel(m)}
                </th>
                {FLOORS.map((f) => {
                  const s = stageOf(f, m);
                  const done = roomsOf(f, m).length;
                  return (
                    <td key={f} className="border border-line p-1 align-top">
                      <div
                        role="button"
                        tabIndex={0}
                        onClick={() => onCell(f, m)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            onCell(f, m);
                          }
                        }}
                        title={`${matLabel(m)} · ${f}${t('unit.floorSuffix')} — ${stageLabel(s)}`}
                        className={`w-full min-w-[64px] rounded border px-1 py-2 text-xs font-medium transition-colors cursor-pointer text-center ${CELL[s]}`}
                      >
                        <span className="block text-base leading-none">{STAGE_ICON[s]}</span>
                        <span className="block mt-0.5 leading-tight">{stageLabel(s)}</span>
                        {isDelivery(s) && (
                          <span className="mt-1 block rounded bg-white/70 px-1 text-[11px] font-semibold leading-tight">
                            {done}/{ROOMS_PER_FLOOR}
                          </span>
                        )}
                      </div>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Per-room delivery panel (opens for delivery-stage cells) */}
      {openCell && (
        <RoomPanel
          floor={openCell.floor}
          material={openCell.material}
          matLabel={matLabel(openCell.material)}
          delivered={roomsOf(openCell.floor, openCell.material)}
          details={detailsOf(openCell.floor, openCell.material)}
          onToggle={(off) => toggleRoom(openCell.floor, openCell.material, off)}
          onAll={(all) => setAllRooms(openCell.floor, openCell.material, all)}
          onDetail={(off, pieces, memo) =>
            setRoomDetail(openCell.floor, openCell.material, off, pieces, memo)
          }
          onPhoto={(off) => setPhotoRoom(openCell.floor * 100 + off)}
          onBack={() => {
            setStage(openCell.floor, openCell.material, 'shipping');
            setOpenCell(null);
          }}
          onClose={() => setOpenCell(null)}
        />
      )}

      {photoRoom !== null && (
        <RoomPhotoModal
          floor={Math.floor(photoRoom / 100)}
          room={photoRoom}
          onClose={() => setPhotoRoom(null)}
        />
      )}
    </div>
  );
}

function RoomPanel(props: {
  floor: number;
  material: UnitWorkItem;
  matLabel: string;
  delivered: number[];
  details: RoomDelivery[];
  onToggle: (off: number) => void;
  onAll: (all: boolean) => void;
  onDetail: (off: number, pieces: number, memo: string) => void;
  onPhoto: (off: number) => void;
  onBack: () => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const { floor, matLabel, delivered, details, onToggle, onAll, onDetail, onPhoto, onBack, onClose } =
    props;
  const done = delivered.length;
  const totalPieces = details.reduce((n, d) => n + (d.pieces || 0), 0);

  // Room currently open in the pieces/memo editor.
  const [sel, setSel] = useState<number | null>(null);
  const detailOf = (off: number) => details.find((d) => d.room === off);
  const [pieceInput, setPieceInput] = useState('');
  const [memoInput, setMemoInput] = useState('');

  // Load the editor fields whenever the selected room changes.
  useEffect(() => {
    if (sel === null) return;
    const d = details.find((x) => x.room === sel);
    setPieceInput(d && d.pieces ? String(d.pieces) : '');
    setMemoInput(d?.memo ?? '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sel]);

  const commit = (off: number, pieces: string, memo: string) => {
    onDetail(off, Math.max(0, Math.floor(Number(pieces) || 0)), memo);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg rounded-xl bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between border-b border-line px-5 py-3">
          <div>
            <div className="text-base font-semibold text-dark">
              🛵 {matLabel} · {floor}
              {t('unit.floorSuffix')}
            </div>
            <div className="text-xs text-muted mt-0.5">
              {done}/{ROOMS_PER_FLOOR} {t('matr.roomsDelivered')}
              {totalPieces > 0 && (
                <span className="ml-2 text-green-700 font-semibold">
                  · {totalPieces} {t('matr.piecesUnit')}
                </span>
              )}
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-xl leading-none text-muted hover:text-dark px-1"
            aria-label={t('matr.close')}
          >
            ✕
          </button>
        </div>

        {/* Room grid */}
        <div className="px-5 py-4">
          <p className="mb-3 text-xs text-muted">{t('matr.deliverHint')}</p>
          <div className="grid grid-cols-6 gap-1.5 sm:grid-cols-7">
            {ROOM_OFFSETS.map((off) => {
              const on = delivered.includes(off);
              const d = detailOf(off);
              const isSel = sel === off;
              return (
                <div key={off} className="relative">
                  <button
                    onClick={() => setSel(isSel ? null : off)}
                    className={`w-full rounded border py-2 text-xs font-semibold transition-colors ${
                      isSel ? 'ring-2 ring-primary ' : ''
                    }${
                      on
                        ? 'border-green-500 bg-green-500 text-white'
                        : 'border-gray-300 bg-gray-50 text-gray-600 hover:bg-gray-100'
                    }`}
                  >
                    {floor * 100 + off}
                    {d && d.pieces > 0 && (
                      <span className="mt-0.5 block rounded bg-white/80 px-1 text-[10px] font-bold leading-tight text-green-700">
                        ×{d.pieces}
                      </span>
                    )}
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onPhoto(off);
                    }}
                    title={t('photo.title')}
                    aria-label={t('photo.title')}
                    className="absolute -right-1 -top-1 rounded-full bg-white border border-line px-1 text-[10px] leading-tight shadow-sm hover:bg-gray-100"
                  >
                    📷
                  </button>
                </div>
              );
            })}
          </div>

          {/* Per-room pieces + memo editor */}
          {sel !== null && (
            <div className="mt-4 rounded-lg border border-line bg-gray-50 p-3">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-sm font-semibold text-dark">
                  {t('matr.room')} {floor * 100 + sel}
                </span>
                <button
                  onClick={() => onToggle(sel)}
                  className={`rounded-md border px-2.5 py-1 text-xs font-semibold ${
                    delivered.includes(sel)
                      ? 'border-green-500 bg-green-500 text-white'
                      : 'border-gray-300 bg-white text-gray-600 hover:bg-gray-100'
                  }`}
                >
                  {delivered.includes(sel) ? `✓ ${t('matr.delivered')}` : t('matr.markDelivered')}
                </button>
              </div>
              <div className="flex flex-wrap items-end gap-3">
                <label className="flex flex-col text-xs text-muted">
                  {t('matr.pieces')}
                  <input
                    type="number"
                    min={0}
                    inputMode="numeric"
                    value={pieceInput}
                    onChange={(e) => setPieceInput(e.target.value)}
                    onBlur={() => commit(sel, pieceInput, memoInput)}
                    className="mt-1 w-24 rounded border border-line px-2 py-1.5 text-sm text-dark"
                    placeholder="0"
                  />
                </label>
                <label className="flex flex-1 flex-col text-xs text-muted">
                  {t('matr.memo')}
                  <input
                    type="text"
                    value={memoInput}
                    onChange={(e) => setMemoInput(e.target.value)}
                    onBlur={() => commit(sel, pieceInput, memoInput)}
                    className="mt-1 w-full rounded border border-line px-2 py-1.5 text-sm text-dark"
                    placeholder={t('matr.memoPlaceholder')}
                  />
                </label>
              </div>
            </div>
          )}
        </div>

        {/* Footer actions */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line px-5 py-3">
          <div className="flex gap-2">
            <button
              onClick={() => onAll(true)}
              className="rounded-md border border-green-500 bg-green-50 px-3 py-1.5 text-xs font-semibold text-green-700 hover:bg-green-100"
            >
              {t('matr.allRooms')}
            </button>
            <button
              onClick={() => onAll(false)}
              className="rounded-md border border-line bg-white px-3 py-1.5 text-xs font-semibold text-muted hover:bg-gray-50"
            >
              {t('matr.clearRooms')}
            </button>
          </div>
          <button
            onClick={onBack}
            className="rounded-md border border-amber-400 bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-800 hover:bg-amber-100"
          >
            ◀ {t('matr.backToShipping')}
          </button>
        </div>
      </div>
    </div>
  );
}
