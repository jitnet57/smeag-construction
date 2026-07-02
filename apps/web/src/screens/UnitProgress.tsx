import { useState, useEffect, useMemo } from 'react';
import { UNIT_WORK_ITEMS } from '@brightem/shared';
import type { UnitWorkItem, TaskProgress } from '@brightem/shared';
import { api } from '../api';
import { useI18n } from '../i18n';
import type { TKey } from '../i18n';

const FLOORS = [4, 5, 6, 7, 8, 9, 10, 11];
const ROOMS_PER_FLOOR = 26;
const TOTAL_ITEMS = ROOMS_PER_FLOOR * UNIT_WORK_ITEMS.length;

// Color of the little status square inside each room's 3×3 grid.
const DOT: Record<TaskProgress, string> = {
  pending: 'bg-gray-200',
  in_progress: 'bg-amber-400',
  done: 'bg-green-500',
};

// Color of the labeled chips in the room detail panel.
const CHIP: Record<TaskProgress, string> = {
  pending: 'bg-gray-100 text-gray-600 border-gray-200',
  in_progress: 'bg-amber-100 text-amber-800 border-amber-200',
  done: 'bg-green-100 text-green-800 border-green-200',
};

const nextStatus = (s: TaskProgress): TaskProgress =>
  s === 'pending' ? 'in_progress' : s === 'in_progress' ? 'done' : 'pending';

const key = (room: number, item: UnitWorkItem) => `${room}-${item}`;

export default function UnitProgress() {
  const { t } = useI18n();
  const [floor, setFloor] = useState<number>(FLOORS[0]);
  const [entries, setEntries] = useState<Record<string, TaskProgress>>({});
  const [selected, setSelected] = useState<number | null>(null);

  // Rooms on this floor: floor*100 + 1 .. floor*100 + 26.
  const rooms = useMemo(
    () => Array.from({ length: ROOMS_PER_FLOOR }, (_, i) => floor * 100 + i + 1),
    [floor]
  );

  // Load stored progress whenever the floor changes.
  useEffect(() => {
    setSelected(null);
    api.getUnitProgress(floor).then((list) => {
      const m: Record<string, TaskProgress> = {};
      list.forEach((e) => {
        m[key(e.room, e.workItem)] = e.status;
      });
      setEntries(m);
    });
  }, [floor]);

  const statusOf = (room: number, item: UnitWorkItem): TaskProgress =>
    entries[key(room, item)] ?? 'pending';

  const roomDone = (room: number) =>
    UNIT_WORK_ITEMS.reduce((n, it) => n + (statusOf(room, it) === 'done' ? 1 : 0), 0);

  const cycle = (room: number, item: UnitWorkItem) => {
    const next = nextStatus(statusOf(room, item));
    setEntries((prev) => ({ ...prev, [key(room, item)]: next }));
    api
      .saveUnitProgress({ floor, room, workItem: item, status: next })
      .catch(() => alert(t('unit.saveError')));
  };

  // Floor roll-up.
  const summary = useMemo(() => {
    let done = 0;
    let inProg = 0;
    let fullRooms = 0;
    rooms.forEach((room) => {
      let rd = 0;
      UNIT_WORK_ITEMS.forEach((it) => {
        const s = statusOf(room, it);
        if (s === 'done') {
          done += 1;
          rd += 1;
        } else if (s === 'in_progress') inProg += 1;
      });
      if (rd === UNIT_WORK_ITEMS.length) fullRooms += 1;
    });
    return { done, inProg, fullRooms, pct: Math.round((done / TOTAL_ITEMS) * 100) };
  }, [entries, rooms]);

  const wiLabel = (item: UnitWorkItem) => t(`unit.wi.${item}` as TKey);
  const stLabel = (s: TaskProgress) => t(`unit.st.${s}` as TKey);

  const topRooms = rooms.slice(0, 13);
  const bottomRooms = rooms.slice(13);

  const renderRoom = (room: number) => {
    const done = roomDone(room);
    const isSel = room === selected;
    const full = done === UNIT_WORK_ITEMS.length;
    return (
      <button
        key={room}
        onClick={() => setSelected(isSel ? null : room)}
        className={`w-[74px] shrink-0 border rounded-md p-1.5 text-left transition-colors ${
          isSel
            ? 'border-primary ring-2 ring-primary/30'
            : full
            ? 'border-green-300'
            : 'border-slate-300'
        } ${full ? 'bg-green-50' : 'bg-white'}`}
        title={`${room} — ${done}/${UNIT_WORK_ITEMS.length}`}
      >
        <div className="flex items-center justify-between mb-1">
          <span className="text-xs font-bold text-dark">{room}</span>
          <span className={`text-[10px] ${full ? 'text-green-700 font-medium' : 'text-muted'}`}>
            {done}/{UNIT_WORK_ITEMS.length}
          </span>
        </div>
        <div className="grid grid-cols-3 gap-0.5">
          {UNIT_WORK_ITEMS.map((item) => (
            <span
              key={item}
              title={`${wiLabel(item)}: ${stLabel(statusOf(room, item))}`}
              className={`w-full aspect-square rounded-sm ${DOT[statusOf(room, item)]}`}
            />
          ))}
        </div>
      </button>
    );
  };

  return (
    <div className="w-full">
      {/* Floor tabs */}
      <div className="flex gap-1.5 flex-wrap mb-3.5">
        {FLOORS.map((f) => (
          <button
            key={f}
            onClick={() => setFloor(f)}
            className={`px-3.5 py-1.5 rounded-lg text-sm font-bold border transition-colors ${
              f === floor
                ? 'bg-primary text-white border-primary'
                : 'bg-white text-muted border-line hover:bg-bg'
            }`}
          >
            {f}
            {t('unit.floorSuffix')}
          </button>
        ))}
      </div>

      {/* Floor summary */}
      <div className="panel mb-4">
        <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
          <h3 className="text-sm font-bold text-dark">
            <span className="inline-block w-1 h-4 bg-primary rounded mr-2 align-middle" />
            {floor}
            {t('unit.floorSuffix')} {t('unit.diagramTitle')}
          </h3>
          <div className="flex items-center gap-3 text-xs">
            <span className="text-muted">
              {t('unit.floorComplete')}: <b className="text-dark">{summary.pct}%</b>
            </span>
            <span className="text-green-700">
              {t('unit.roomsDone')}: <b>{summary.fullRooms}</b>/{ROOMS_PER_FLOOR}
            </span>
          </div>
        </div>

        {/* Progress bar */}
        <div className="h-2 rounded-full bg-slate-100 overflow-hidden mb-3">
          <div className="h-full bg-green-500" style={{ width: `${summary.pct}%` }} />
        </div>

        {/* Status legend */}
        <div className="flex items-center gap-4 text-[11px] text-muted mb-1">
          <span className="flex items-center gap-1">
            <i className={`w-3 h-3 rounded-sm ${DOT.pending}`} />
            {stLabel('pending')}
          </span>
          <span className="flex items-center gap-1">
            <i className={`w-3 h-3 rounded-sm ${DOT.in_progress}`} />
            {stLabel('in_progress')}
          </span>
          <span className="flex items-center gap-1">
            <i className={`w-3 h-3 rounded-sm ${DOT.done}`} />
            {stLabel('done')}
          </span>
        </div>
        {/* Work-item order legend (matches the 3×3 grid, row by row) */}
        <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-muted">
          {UNIT_WORK_ITEMS.map((item, i) => (
            <span key={item}>
              {i + 1}. {wiLabel(item)}
            </span>
          ))}
        </div>
      </div>

      {/* Floor diagram (배치도) */}
      <div className="panel mb-4 overflow-x-auto">
        <div className="inline-block border-2 border-slate-300 rounded-lg bg-slate-50 p-3">
          <div className="flex gap-2">{topRooms.map(renderRoom)}</div>
          <div className="my-2 text-center text-[11px] text-muted border-y border-dashed border-slate-300 py-1">
            {t('unit.corridor')}
          </div>
          <div className="flex gap-2">{bottomRooms.map(renderRoom)}</div>
        </div>
        <p className="text-xs text-muted mt-2">{t('unit.diagramHint')}</p>
      </div>

      {/* Room detail: click any work item to cycle pending → in progress → done */}
      {selected !== null && (
        <div className="panel">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-bold text-dark">
              <span className="inline-block w-1 h-4 bg-primary rounded mr-2 align-middle" />
              {t('unit.roomDetail')} — {selected}
            </h3>
            <span className="text-xs text-muted">
              {roomDone(selected)}/{UNIT_WORK_ITEMS.length} {t('unit.st.done')}
            </span>
          </div>
          <div className="flex flex-wrap gap-2">
            {UNIT_WORK_ITEMS.map((item) => {
              const s = statusOf(selected, item);
              return (
                <button
                  key={item}
                  onClick={() => cycle(selected, item)}
                  className={`text-xs px-3 py-1.5 rounded-md border ${CHIP[s]}`}
                >
                  <span className="font-medium">{wiLabel(item)}</span>
                  <span className="ml-1.5 opacity-80">· {stLabel(s)}</span>
                </button>
              );
            })}
          </div>
          <p className="text-xs text-muted mt-3">{t('unit.cycleHint')}</p>
        </div>
      )}
    </div>
  );
}
