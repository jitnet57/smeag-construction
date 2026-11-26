import { useState, useEffect, useMemo, useCallback } from 'react';
import type { MaterialStock as Stock, StockMove } from '@brightem/shared';
import { api } from '../api';
import { useI18n } from '../i18n';

// Starter list offered when the stock list is empty.
const STARTER: { name: string; unit: string; minQty: number }[] = [
  { name: 'Cement', unit: 'bags', minQty: 20 },
  { name: 'Tile Adhesive', unit: 'bags', minQty: 20 },
  { name: 'Metal Furring', unit: 'pcs', minQty: 50 },
  { name: 'Gypsum Board', unit: 'sheets', minQty: 20 },
  { name: 'Skim Coat', unit: 'bags', minQty: 10 },
  { name: 'Tile Grout', unit: 'bags', minQty: 10 },
  { name: 'Epoxy Primer', unit: 'gal', minQty: 2 },
  { name: 'Primero Multi Seal', unit: 'gal', minQty: 2 },
  { name: 'Leakplug', unit: 'kg', minQty: 2 },
  { name: 'Flexicrete', unit: 'kits', minQty: 2 },
  { name: 'Paint', unit: 'gal', minQty: 5 },
  { name: 'Red Oxide Primer', unit: 'gal', minQty: 2 },
  { name: 'Lacquer Thinner', unit: 'gal', minQty: 2 },
  { name: 'Silicone Sealant', unit: 'tubes', minQty: 10 },
  { name: 'Duct Tape', unit: 'rolls', minQty: 5 },
  { name: 'Nails', unit: 'kg', minQty: 5 },
  { name: 'Screws', unit: 'boxes', minQty: 5 },
  { name: 'Pipe', unit: 'pcs', minQty: 10 },
  { name: 'Wires', unit: 'rolls', minQty: 2 },
  { name: 'Rebars', unit: 'pcs', minQty: 20 },
];

const today = () => new Date().toISOString().slice(0, 10);
const uuid = () => crypto.randomUUID();
const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2));

type Level = 'ok' | 'low' | 'out';
const levelOf = (s: Stock): Level => (s.qty <= 0 ? 'out' : s.qty <= s.minQty ? 'low' : 'ok');
const LEVEL_STYLE: Record<Level, string> = {
  ok: 'bg-green-100 text-green-800',
  low: 'bg-amber-100 text-amber-800',
  out: 'bg-red-100 text-red-700',
};

// Open dialog state: editing an item, or recording a movement for one.
type Dialog =
  | { kind: 'edit'; item: Stock; isNew: boolean }
  | { kind: 'move'; item: Stock; dir: 1 | -1; qty: string; date: string; note: string };

export default function MaterialStock() {
  const { t } = useI18n();
  const [items, setItems] = useState<Stock[]>([]);
  const [moves, setMoves] = useState<StockMove[]>([]);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [historyFor, setHistoryFor] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [s, m] = await Promise.all([api.getMaterialStock(), api.getStockMoves()]);
    setItems(s);
    setMoves(m);
  }, []);

  useEffect(() => {
    load().catch(() => setError(t('stk.saveError')));
  }, [load, t]);

  const counts = useMemo(() => {
    const c = { low: 0, out: 0 };
    items.forEach((s) => {
      const l = levelOf(s);
      if (l !== 'ok') c[l]++;
    });
    return c;
  }, [items]);

  const nameOf = (id: string) => items.find((s) => s.id === id)?.name ?? '—';
  const unitOf = (id: string) => items.find((s) => s.id === id)?.unit ?? '';
  const levelLabel = (l: Level) => t(l === 'ok' ? 'stk.ok' : l === 'low' ? 'stk.low' : 'stk.out');

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError('');
    try {
      await fn();
      await load();
      setDialog(null);
    } catch {
      setError(t('stk.saveError'));
    } finally {
      setBusy(false);
    }
  };

  const nextSort = () => (items.length ? Math.max(...items.map((s) => s.sort)) + 1 : 0);

  // Starter materials not yet in the list (matched by name, case-insensitive).
  const missingStarter = useMemo(() => {
    const have = new Set(items.map((s) => s.name.trim().toLowerCase()));
    return STARTER.filter((s) => !have.has(s.name.toLowerCase()));
  }, [items]);

  const addStarter = () =>
    run(async () => {
      let sort = nextSort();
      for (const s of missingStarter) {
        await api.saveMaterialStock({ id: uuid(), qty: 0, note: '', sort: sort++, ...s });
      }
    });

  const startNew = () =>
    setDialog({
      kind: 'edit',
      isNew: true,
      item: { id: uuid(), name: '', unit: '', qty: 0, minQty: 0, note: '', sort: nextSort() },
    });

  const saveItem = (item: Stock) => {
    if (!item.name.trim()) return;
    run(() => api.saveMaterialStock({ ...item, name: item.name.trim(), unit: item.unit.trim() }));
  };

  const deleteItem = (item: Stock) => {
    if (!confirm(t('stk.confirmDelete'))) return;
    run(() => api.deleteMaterialStock(item.id));
  };

  const saveMove = (d: Extract<Dialog, { kind: 'move' }>) => {
    const q = Number(d.qty);
    if (!(q > 0)) return;
    if (d.dir < 0 && q > d.item.qty) {
      setError(t('stk.notEnough'));
      return;
    }
    const delta = d.dir * q;
    run(async () => {
      await api.addStockMove({ id: uuid(), stockId: d.item.id, date: d.date, delta, note: d.note.trim() });
      await api.saveMaterialStock({ ...d.item, qty: d.item.qty + delta });
    });
  };

  const openMove = (item: Stock, dir: 1 | -1) =>
    setDialog({ kind: 'move', item, dir, qty: '', date: today(), note: '' });

  const shownMoves = historyFor ? moves.filter((m) => m.stockId === historyFor) : moves.slice(0, 20);

  const actions = (s: Stock) => (
    <div className="flex flex-wrap gap-2">
      <button className="text-xs px-2.5 py-1 rounded-md bg-green-600 text-white font-semibold" onClick={() => openMove(s, 1)}>
        + {t('stk.in')}
      </button>
      <button
        className="text-xs px-2.5 py-1 rounded-md bg-orange-500 text-white font-semibold disabled:opacity-40"
        disabled={s.qty <= 0}
        onClick={() => openMove(s, -1)}
      >
        − {t('stk.outBtn')}
      </button>
      <button className="text-xs text-gray-700 hover:underline" onClick={() => setHistoryFor(historyFor === s.id ? null : s.id)}>
        {t('stk.history')}
      </button>
      <button className="text-xs text-blue-700 hover:underline" onClick={() => setDialog({ kind: 'edit', item: { ...s }, isNew: false })}>
        {t('stk.edit')}
      </button>
      <button className="text-xs text-red-600 hover:underline" onClick={() => deleteItem(s)}>
        {t('stk.delete')}
      </button>
    </div>
  );

  return (
    <div className="w-full">
      {/* Header */}
      <div className="flex items-start justify-between gap-3 mb-3.5">
        <div>
          <h2 className="text-base font-bold text-dark">{t('stk.title')}</h2>
          <p className="text-sm text-muted mt-0.5">{t('stk.intro')}</p>
        </div>
        <button className="btn flex-shrink-0" onClick={startNew}>
          {t('stk.addItem')}
        </button>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-3 gap-3 mb-4">
        <div className="bg-white border border-line rounded-xl px-4 py-3">
          <div className="text-xs text-muted">{t('stk.items')}</div>
          <div className="text-xl font-bold text-dark">{items.length}</div>
        </div>
        <div className="bg-white border border-amber-200 rounded-xl px-4 py-3">
          <div className="text-xs text-amber-700">{t('stk.lowCount')}</div>
          <div className="text-xl font-bold text-amber-700">{counts.low}</div>
        </div>
        <div className="bg-white border border-red-200 rounded-xl px-4 py-3">
          <div className="text-xs text-red-700">{t('stk.outCount')}</div>
          <div className="text-xl font-bold text-red-700">{counts.out}</div>
        </div>
      </div>

      {error && <div className="mb-3 text-sm text-red-600">{error}</div>}

      {items.length > 0 && missingStarter.length > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-2 text-xs bg-blue-50 border border-blue-200 rounded-lg px-3 py-2">
          <span className="text-blue-800">
            {t('stk.missing')}: {missingStarter.map((s) => s.name).join(', ')}
          </span>
          <button className="ml-auto text-blue-700 font-semibold hover:underline" disabled={busy} onClick={addStarter}>
            {t('stk.addMissing')}
          </button>
        </div>
      )}

      <div className="panel">
        {items.length === 0 && (
          <div className="text-center py-6 space-y-3">
            <div className="text-muted">{t('stk.empty')}</div>
            <button className="btn ghost" disabled={busy} onClick={addStarter}>
              {t('stk.addStarter')}
            </button>
          </div>
        )}

        {/* Mobile cards */}
        <div className="md:hidden space-y-3">
          {items.map((s) => {
            const l = levelOf(s);
            return (
              <div key={s.id} className="bg-white border border-line rounded-xl p-3 shadow-sm">
                <div className="flex items-center justify-between gap-2">
                  <div className="font-bold text-sm text-dark truncate">{s.name}</div>
                  <span className={`text-xs px-2 py-0.5 rounded-full ${LEVEL_STYLE[l]}`}>{levelLabel(l)}</span>
                </div>
                <div className="flex items-baseline gap-1.5 mt-1">
                  <span className="text-2xl font-bold text-dark">{fmt(s.qty)}</span>
                  <span className="text-sm text-muted">{s.unit}</span>
                  <span className="text-xs text-muted ml-auto">
                    {t('stk.thMin')} {fmt(s.minQty)}
                  </span>
                </div>
                {s.note && <div className="text-xs text-muted mt-1">{s.note}</div>}
                <div className="pt-2 mt-2 border-t border-line">{actions(s)}</div>
              </div>
            );
          })}
        </div>

        {/* Desktop table */}
        {items.length > 0 && (
          <div className="overflow-x-auto hidden md:block">
            <table className="text-sm w-full">
              <thead>
                <tr>
                  <th className="text-left">{t('stk.thName')}</th>
                  <th className="text-right">{t('stk.thQty')}</th>
                  <th className="text-left">{t('stk.thUnit')}</th>
                  <th className="text-right">{t('stk.thMin')}</th>
                  <th className="text-center">{t('stk.thStatus')}</th>
                  <th className="text-left">{t('stk.thNote')}</th>
                  <th className="text-left">{t('stk.thActions')}</th>
                </tr>
              </thead>
              <tbody>
                {items.map((s) => {
                  const l = levelOf(s);
                  return (
                    <tr key={s.id} className={historyFor === s.id ? 'bg-blue-50' : ''}>
                      <td className="font-semibold text-dark">{s.name}</td>
                      <td className="text-right text-base font-bold">{fmt(s.qty)}</td>
                      <td className="text-muted">{s.unit}</td>
                      <td className="text-right text-muted">{fmt(s.minQty)}</td>
                      <td className="text-center">
                        <span className={`text-xs px-2 py-0.5 rounded-full ${LEVEL_STYLE[l]}`}>{levelLabel(l)}</span>
                      </td>
                      <td className="text-muted text-xs">{s.note}</td>
                      <td>{actions(s)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Movement history */}
      {items.length > 0 && (
        <div className="panel">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-bold text-dark">
              <span className="inline-block w-1 h-4 bg-primary rounded mr-2 align-middle" />
              {historyFor ? `${t('stk.history')} — ${nameOf(historyFor)}` : t('stk.recent')}
            </h3>
            {historyFor && (
              <button className="text-xs text-gray-600 hover:underline" onClick={() => setHistoryFor(null)}>
                ✕
              </button>
            )}
          </div>
          {shownMoves.length === 0 ? (
            <div className="text-center text-muted py-3 text-sm">{t('stk.noHistory')}</div>
          ) : (
            <ul className="divide-y divide-line text-sm">
              {shownMoves.map((m) => (
                <li key={m.id} className="flex items-center gap-3 py-2">
                  <span className="text-xs text-muted w-20 flex-shrink-0">{m.date}</span>
                  {!historyFor && <span className="font-medium text-dark truncate">{nameOf(m.stockId)}</span>}
                  <span className="text-xs text-muted truncate flex-1">{m.note}</span>
                  <span className={`font-bold flex-shrink-0 ${m.delta > 0 ? 'text-green-700' : 'text-orange-600'}`}>
                    {m.delta > 0 ? '+' : '−'}
                    {fmt(Math.abs(m.delta))} {unitOf(m.stockId)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* Dialog */}
      {dialog && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-end sm:items-center justify-center p-3" onClick={() => !busy && setDialog(null)}>
          <div className="bg-white rounded-xl w-full max-w-sm p-4 space-y-3" onClick={(e) => e.stopPropagation()}>
            {dialog.kind === 'edit' ? (
              <>
                <h3 className="font-bold text-dark">{dialog.isNew ? t('stk.newItem') : dialog.item.name}</h3>
                <label className="block text-xs text-muted">
                  {t('stk.thName')}
                  <input
                    className="inp w-full mt-1"
                    autoFocus
                    placeholder={t('stk.namePh')}
                    value={dialog.item.name}
                    onChange={(e) => setDialog({ ...dialog, item: { ...dialog.item, name: e.target.value } })}
                  />
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <label className="block text-xs text-muted">
                    {t('stk.thUnit')}
                    <input
                      className="inp w-full mt-1"
                      placeholder={t('stk.unitPh')}
                      value={dialog.item.unit}
                      onChange={(e) => setDialog({ ...dialog, item: { ...dialog.item, unit: e.target.value } })}
                    />
                  </label>
                  <label className="block text-xs text-muted">
                    {t('stk.thMin')}
                    <input
                      type="number"
                      min={0}
                      className="inp w-full mt-1"
                      value={dialog.item.minQty}
                      onChange={(e) => setDialog({ ...dialog, item: { ...dialog.item, minQty: Number(e.target.value) || 0 } })}
                    />
                  </label>
                </div>
                {dialog.isNew && (
                  <label className="block text-xs text-muted">
                    {t('stk.thQty')}
                    <input
                      type="number"
                      min={0}
                      className="inp w-full mt-1"
                      value={dialog.item.qty}
                      onChange={(e) => setDialog({ ...dialog, item: { ...dialog.item, qty: Number(e.target.value) || 0 } })}
                    />
                  </label>
                )}
                <label className="block text-xs text-muted">
                  {t('stk.thNote')}
                  <input
                    className="inp w-full mt-1"
                    value={dialog.item.note ?? ''}
                    onChange={(e) => setDialog({ ...dialog, item: { ...dialog.item, note: e.target.value } })}
                  />
                </label>
                <div className="flex justify-end gap-2 pt-1">
                  <button className="btn gray" disabled={busy} onClick={() => setDialog(null)}>
                    {t('stk.cancel')}
                  </button>
                  <button className="btn" disabled={busy || !dialog.item.name.trim()} onClick={() => saveItem(dialog.item)}>
                    {t('stk.save')}
                  </button>
                </div>
              </>
            ) : (
              <>
                <h3 className="font-bold text-dark">
                  {dialog.dir > 0 ? `+ ${t('stk.in')}` : `− ${t('stk.outBtn')}`} · {dialog.item.name}
                </h3>
                <div className="text-xs text-muted">
                  {t('stk.thQty')}: <b className="text-dark">{fmt(dialog.item.qty)}</b> {dialog.item.unit}
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <label className="block text-xs text-muted">
                    {t('stk.qtyLabel')} ({dialog.item.unit})
                    <input
                      type="number"
                      min={0}
                      autoFocus
                      className="inp w-full mt-1"
                      value={dialog.qty}
                      onChange={(e) => setDialog({ ...dialog, qty: e.target.value })}
                    />
                  </label>
                  <label className="block text-xs text-muted">
                    {t('stk.date')}
                    <input
                      type="date"
                      className="inp w-full mt-1"
                      value={dialog.date}
                      onChange={(e) => setDialog({ ...dialog, date: e.target.value })}
                    />
                  </label>
                </div>
                <label className="block text-xs text-muted">
                  {t('stk.thNote')}
                  <input
                    className="inp w-full mt-1"
                    placeholder={t('stk.notePh')}
                    value={dialog.note}
                    onChange={(e) => setDialog({ ...dialog, note: e.target.value })}
                  />
                </label>
                <div className="flex justify-end gap-2 pt-1">
                  <button className="btn gray" disabled={busy} onClick={() => setDialog(null)}>
                    {t('stk.cancel')}
                  </button>
                  <button className="btn" disabled={busy || !(Number(dialog.qty) > 0)} onClick={() => saveMove(dialog)}>
                    {t('stk.save')}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
