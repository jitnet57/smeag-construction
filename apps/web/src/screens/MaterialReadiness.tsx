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
  // Rooms fully delivered, and rooms currently "on going to deliver".
  const [rooms, setRooms] = useState<Record<string, number[]>>({});
  const [ongoing, setOngoing] = useState<Record<string, number[]>>({});
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
      const g: Record<string, number[]> = {};
      const d: Record<string, RoomDelivery[]> = {};
      lists.flat().forEach((row) => {
        m[key(row.floor, row.material)] = row.stage;
        if (row.deliveredRooms && row.deliveredRooms.length)
          r[key(row.floor, row.material)] = [...row.deliveredRooms];
        if (row.ongoingRooms && row.ongoingRooms.length)
          g[key(row.floor, row.material)] = [...row.ongoingRooms];
        if (row.roomDetails && row.roomDetails.length)
          d[key(row.floor, row.material)] = row.roomDetails.map((x) => ({ ...x }));
      });
      setStages(m);
      setRooms(r);
      setOngoing(g);
      setDetails(d);
    });
  }, []);

  const stageOf = (floor: number, material: UnitWorkItem): MaterialStage =>
    stages[key(floor, material)] ?? 'pending';

  const roomsOf = (floor: number, material: UnitWorkItem): number[] =>
    rooms[key(floor, material)] ?? [];

  const ongoingOf = (floor: number, material: UnitWorkItem): number[] =>
    ongoing[key(floor, material)] ?? [];

  const detailsOf = (floor: number, material: UnitWorkItem): RoomDelivery[] =>
    details[key(floor, material)] ?? [];

  const save = (
    floor: number,
    material: UnitWorkItem,
    stage: MaterialStage,
    deliveredRooms: number[],
    ongoingRooms: number[],
    roomDetails: RoomDelivery[]
  ) => {
    api
      .saveMaterialReadiness({
        floor,
        material,
        stage,
        deliveredRooms,
        ongoingRooms,
        roomDetails,
      })
      .catch(() => {
        alert(t('matr.saveError'));
      });
  };

  // Apply the mutation and persist. Stage is 'delivered' once every room is
  // delivered, otherwise 'delivering' while any delivery work remains.
  const commit = (
    floor: number,
    material: UnitWorkItem,
    del: number[],
    ong: number[],
    det: RoomDelivery[]
  ) => {
    const k = key(floor, material);
    const stage: MaterialStage = del.length === ROOMS_PER_FLOOR ? 'delivered' : 'delivering';
    setRooms((prev) => ({ ...prev, [k]: del }));
    setOngoing((prev) => ({ ...prev, [k]: ong }));
    setDetails((prev) => ({ ...prev, [k]: det }));
    setStages((prev) => ({ ...prev, [k]: stage }));
    save(floor, material, stage, del, ong, det);
  };

  // Per-room status: 'pending' | 'ongoing' | 'delivered'.
  type RoomStatus = 'pending' | 'ongoing' | 'delivered';
  const setRoomStatus = (
    floor: number,
    material: UnitWorkItem,
    off: number,
    status: RoomStatus
  ) => {
    const del = roomsOf(floor, material).filter((x) => x !== off);
    const ong = ongoingOf(floor, material).filter((x) => x !== off);
    let det = detailsOf(floor, material);
    if (status === 'delivered') del.push(off);
    else if (status === 'ongoing') ong.push(off);
    else det = det.filter((d) => d.room !== off); // pending clears its detail
    commit(floor, material, del.sort((a, b) => a - b), ong.sort((a, b) => a - b), det);
  };

  // Set/replace one room's pieces + memo. Entering data promotes a pending
  // room to "ongoing" (but never downgrades a delivered room).
  const setRoomDetail = (
    floor: number,
    material: UnitWorkItem,
    off: number,
    pieces: number,
    memo: string
  ) => {
    const cur = detailsOf(floor, material).filter((d) => d.room !== off);
    const hasData = pieces > 0 || memo.trim().length > 0;
    const det = hasData
      ? [...cur, { room: off, pieces, memo: memo.trim() || undefined }].sort(
          (a, b) => a.room - b.room
        )
      : cur;

    const del = roomsOf(floor, material);
    let ong = ongoingOf(floor, material);
    if (hasData && !del.includes(off) && !ong.includes(off))
      ong = [...ong, off].sort((a, b) => a - b);
    commit(floor, material, del, ong, det);
  };

  const setStage = (floor: number, material: UnitWorkItem, stage: MaterialStage) => {
    const k = key(floor, material);
    // Leaving the delivery phase clears the room checklist, ongoing and details.
    const inDelivery = isDelivery(stage);
    const del = inDelivery ? roomsOf(floor, material) : [];
    const ong = inDelivery ? ongoingOf(floor, material) : [];
    const det = inDelivery ? detailsOf(floor, material) : [];
    setStages((prev) => ({ ...prev, [k]: stage }));
    setRooms((prev) => ({ ...prev, [k]: del }));
    setOngoing((prev) => ({ ...prev, [k]: ong }));
    setDetails((prev) => ({ ...prev, [k]: det }));
    save(floor, material, stage, del, ong, det);
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

  const setAllRooms = (floor: number, material: UnitWorkItem, all: boolean) => {
    const del = all ? [...ROOM_OFFSETS] : [];
    const det = all ? detailsOf(floor, material) : [];
    commit(floor, material, del, [], det); // clear ongoing either way
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
          ongoing={ongoingOf(openCell.floor, openCell.material)}
          details={detailsOf(openCell.floor, openCell.material)}
          onStatus={(off, status) =>
            setRoomStatus(openCell.floor, openCell.material, off, status)
          }
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
  ongoing: number[];
  details: RoomDelivery[];
  onStatus: (off: number, status: 'pending' | 'ongoing' | 'delivered') => void;
  onAll: (all: boolean) => void;
  onDetail: (off: number, pieces: number, memo: string) => void;
  onPhoto: (off: number) => void;
  onBack: () => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const { floor, matLabel, delivered, ongoing, details, onStatus, onAll, onDetail, onPhoto, onBack, onClose } =
    props;
  const done = delivered.length;
  const onGoing = ongoing.length;
  const totalPieces = details.reduce((n, d) => n + (d.pieces || 0), 0);

  // Rooms currently selected in the pieces/memo editor (multi-select).
  const [sel, setSel] = useState<number[]>([]);
  const detailOf = (off: number) => details.find((d) => d.room === off);
  const [pieceInput, setPieceInput] = useState('');
  const [memoInput, setMemoInput] = useState('');

  const toggleSel = (off: number) =>
    setSel((prev) => (prev.includes(off) ? prev.filter((x) => x !== off) : [...prev, off]));

  const selKey = sel.join(',');
  // Load the editor fields whenever the selection changes. When exactly one
  // room is selected, prefill from its saved detail; for multiple rooms leave
  // the fields blank so a batch value can be applied to all of them.
  useEffect(() => {
    if (sel.length === 1) {
      const d = details.find((x) => x.room === sel[0]);
      setPieceInput(d && d.pieces ? String(d.pieces) : '');
      setMemoInput(d?.memo ?? '');
    } else {
      setPieceInput('');
      setMemoInput('');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selKey]);

  // Apply pieces/memo to every selected room.
  const commit = (pieces: string, memo: string) => {
    const p = Math.max(0, Math.floor(Number(pieces) || 0));
    for (const off of sel) onDetail(off, p, memo);
  };

  // Apply a status to every selected room.
  const applyStatus = (status: 'pending' | 'ongoing' | 'delivered') => {
    for (const off of sel) onStatus(off, status);
  };

  const allDelivered = sel.length > 0 && sel.every((o) => delivered.includes(o));
  const allOngoing = sel.length > 0 && sel.every((o) => ongoing.includes(o));
  const allPending =
    sel.length > 0 && sel.every((o) => !delivered.includes(o) && !ongoing.includes(o));

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
              {onGoing > 0 && (
                <span className="ml-2 text-amber-700 font-semibold">
                  · {onGoing} {t('matr.ongoing')}
                </span>
              )}
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
              const ong = ongoing.includes(off);
              const d = detailOf(off);
              const isSel = sel.includes(off);
              return (
                <div key={off} className="relative">
                  <button
                    onClick={() => toggleSel(off)}
                    className={`w-full rounded border py-2 text-xs font-semibold transition-colors ${
                      isSel ? 'ring-2 ring-primary ' : ''
                    }${
                      on
                        ? 'border-green-500 bg-green-500 text-white'
                        : ong
                          ? 'border-amber-500 bg-amber-400 text-white'
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

          {/* Selected-room pieces + memo editor (applies to all selected) */}
          {sel.length > 0 && (
            <div className="mt-4 rounded-lg border border-line bg-gray-50 p-3">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <span className="text-sm font-semibold text-dark">
                  {sel.length === 1
                    ? `${t('matr.room')} ${floor * 100 + sel[0]}`
                    : `${sel.length} ${t('matr.roomsSelected')}`}
                  <button
                    onClick={() => setSel([])}
                    className="ml-2 text-[11px] font-normal text-muted underline hover:text-dark"
                  >
                    {t('matr.clearSelection')}
                  </button>
                </span>
                <div className="flex gap-1">
                  <button
                    onClick={() => applyStatus('pending')}
                    className={`rounded-md border px-2 py-1 text-[11px] font-semibold ${
                      allPending
                        ? 'border-gray-400 bg-gray-200 text-gray-800'
                        : 'border-gray-300 bg-white text-gray-500 hover:bg-gray-100'
                    }`}
                  >
                    {t('matr.notDelivered')}
                  </button>
                  <button
                    onClick={() => applyStatus('ongoing')}
                    className={`rounded-md border px-2 py-1 text-[11px] font-semibold ${
                      allOngoing
                        ? 'border-amber-500 bg-amber-400 text-white'
                        : 'border-gray-300 bg-white text-gray-600 hover:bg-amber-50'
                    }`}
                  >
                    🛵 {t('matr.ongoing')}
                  </button>
                  <button
                    onClick={() => applyStatus('delivered')}
                    className={`rounded-md border px-2 py-1 text-[11px] font-semibold ${
                      allDelivered
                        ? 'border-green-500 bg-green-500 text-white'
                        : 'border-gray-300 bg-white text-gray-600 hover:bg-green-50'
                    }`}
                  >
                    ✓ {t('matr.delivered')}
                  </button>
                </div>
              </div>
              {sel.length > 1 && (
                <p className="mb-2 text-[11px] text-muted">{t('matr.batchHint')}</p>
              )}
              <div className="flex flex-wrap items-end gap-3">
                <label className="flex flex-col text-xs text-muted">
                  {t('matr.pieces')}
                  <input
                    type="number"
                    min={0}
                    inputMode="numeric"
                    value={pieceInput}
                    onChange={(e) => setPieceInput(e.target.value)}
                    onBlur={() => commit(pieceInput, memoInput)}
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
                    onBlur={() => commit(pieceInput, memoInput)}
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
