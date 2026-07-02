import { useState, useEffect, useMemo } from 'react';
import { UNIT_WORK_ITEMS, MATERIAL_STAGES } from '@brightem/shared';
import type { UnitWorkItem, MaterialStage } from '@brightem/shared';
import { api } from '../api';
import { useI18n } from '../i18n';
import type { TKey } from '../i18n';

const FLOORS = [4, 5, 6, 7, 8, 9, 10, 11];

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

const nextStage = (s: MaterialStage): MaterialStage => {
  const i = MATERIAL_STAGES.indexOf(s);
  return MATERIAL_STAGES[(i + 1) % MATERIAL_STAGES.length];
};

export default function MaterialReadiness() {
  const { t } = useI18n();
  const [stages, setStages] = useState<Record<string, MaterialStage>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});

  // Load readiness for ALL floors once.
  useEffect(() => {
    Promise.all(FLOORS.map((f) => api.getMaterialReadiness(f))).then((lists) => {
      const m: Record<string, MaterialStage> = {};
      const n: Record<string, string> = {};
      lists.flat().forEach((r) => {
        m[key(r.floor, r.material)] = r.stage;
        if (r.note) n[key(r.floor, r.material)] = r.note;
      });
      setStages(m);
      setNotes(n);
    });
  }, []);

  const stageOf = (floor: number, material: UnitWorkItem): MaterialStage =>
    stages[key(floor, material)] ?? 'pending';

  const noteOf = (floor: number, material: UnitWorkItem): string =>
    notes[key(floor, material)] ?? '';

  const save = (floor: number, material: UnitWorkItem, stage: MaterialStage, note: string) => {
    api.saveMaterialReadiness({ floor, material, stage, note }).catch(() => {
      alert(t('matr.saveError'));
    });
  };

  const setStage = (floor: number, material: UnitWorkItem, stage: MaterialStage) => {
    setStages((prev) => ({ ...prev, [key(floor, material)]: stage }));
    save(floor, material, stage, noteOf(floor, material));
  };

  const setNote = (floor: number, material: UnitWorkItem, note: string) => {
    setNotes((prev) => ({ ...prev, [key(floor, material)]: note }));
    save(floor, material, stageOf(floor, material), note);
  };

  const cycle = (floor: number, material: UnitWorkItem) =>
    setStage(floor, material, nextStage(stageOf(floor, material)));

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
                  return (
                    <td key={f} className="border border-line p-1 align-top">
                      <div
                        role="button"
                        tabIndex={0}
                        onClick={() => cycle(f, m)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            cycle(f, m);
                          }
                        }}
                        title={`${matLabel(m)} · ${f}${t('unit.floorSuffix')} — ${stageLabel(s)}`}
                        className={`w-full min-w-[64px] rounded border px-1 py-2 text-xs font-medium transition-colors cursor-pointer text-center ${CELL[s]}`}
                      >
                        <span className="block text-base leading-none">{STAGE_ICON[s]}</span>
                        <span className="block mt-0.5 leading-tight">{stageLabel(s)}</span>
                        {s === 'delivering' && (
                          <input
                            type="text"
                            inputMode="numeric"
                            value={noteOf(f, m)}
                            placeholder={t('matr.countPlaceholder')}
                            onClick={(e) => e.stopPropagation()}
                            onKeyDown={(e) => e.stopPropagation()}
                            onChange={(e) => setNote(f, m, e.target.value)}
                            className="mt-1 w-full rounded border border-orange-300 bg-white/80 px-1 py-0.5 text-center text-[11px] text-orange-900 placeholder:text-orange-300 focus:outline-none focus:ring-1 focus:ring-orange-400"
                          />
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
    </div>
  );
}
