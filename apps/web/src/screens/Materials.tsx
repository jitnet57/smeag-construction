import { useState, useEffect, useMemo, useCallback } from 'react';
import type {
  MaterialRequest,
  MaterialItem,
  MaterialReqStatus,
  Task,
} from '@brightem/shared';
import { api } from '../api';
import { useI18n } from '../i18n';

const today = () => new Date().toISOString().slice(0, 10);

const emptyItem = (): MaterialItem => ({
  name: '',
  spec: '',
  quantity: 1,
  unit: 'ea',
  unitPrice: 0,
  supplier: '',
});

const blankRequest = (): MaterialRequest => ({
  id: '',
  requestNo: '',
  requestDate: today(),
  requester: '',
  site: '',
  neededBy: today(),
  taskId: undefined,
  status: 'requested',
  note: '',
  items: [emptyItem()],
});

const php = (n: number) =>
  '₱' + (Number(n) || 0).toLocaleString('en-PH', { maximumFractionDigits: 0 });

const reqTotal = (r: MaterialRequest) =>
  r.items.reduce((s, it) => s + (Number(it.quantity) || 0) * (Number(it.unitPrice) || 0), 0);

const STATUS_STYLE: Record<MaterialReqStatus, string> = {
  requested: 'bg-amber-100 text-amber-800',
  approved: 'bg-green-100 text-green-800',
  rejected: 'bg-red-100 text-red-700',
};

export default function Materials() {
  const { t } = useI18n();

  const [requests, setRequests] = useState<MaterialRequest[]>([]);
  const [draft, setDraft] = useState<MaterialRequest | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const list = await api.getMaterialRequests();
    setRequests(list);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Load tasks for the drafted request's date, to offer as linkable tasks.
  useEffect(() => {
    if (!draft?.requestDate) {
      setTasks([]);
      return;
    }
    api.getTasks(draft.requestDate).then(setTasks);
  }, [draft?.requestDate]);

  const startNew = () => setDraft(blankRequest());
  const startEdit = (r: MaterialRequest) =>
    setDraft({ ...r, items: r.items.map((it) => ({ ...it })) });

  const patch = (p: Partial<MaterialRequest>) =>
    setDraft((d) => (d ? { ...d, ...p } : d));

  const patchItem = (idx: number, p: Partial<MaterialItem>) =>
    setDraft((d) =>
      d
        ? { ...d, items: d.items.map((it, i) => (i === idx ? { ...it, ...p } : it)) }
        : d
    );

  const addItem = () =>
    setDraft((d) => (d ? { ...d, items: [...d.items, emptyItem()] } : d));

  const removeItem = (idx: number) =>
    setDraft((d) => (d ? { ...d, items: d.items.filter((_, i) => i !== idx) } : d));

  const handleSave = async () => {
    if (!draft) return;
    setSaving(true);
    try {
      await api.saveMaterialRequest(draft);
      await load();
      setDraft(null);
      alert(t('mat.saved'));
    } catch {
      alert(t('mat.saveError'));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm(t('mat.deleteConfirm'))) return;
    try {
      await api.deleteMaterialRequest(id);
      await load();
      if (draft?.id === id) setDraft(null);
    } catch {
      alert(t('mat.saveError'));
    }
  };

  // Change status directly from the list (saves immediately).
  const setStatus = async (r: MaterialRequest, status: MaterialReqStatus) => {
    try {
      await api.saveMaterialRequest({ ...r, status });
      await load();
      if (draft?.id === r.id) patch({ status });
    } catch {
      alert(t('mat.saveError'));
    }
  };

  const statusLabel = (s: MaterialReqStatus) =>
    s === 'approved'
      ? t('mat.stApproved')
      : s === 'rejected'
      ? t('mat.stRejected')
      : t('mat.stRequested');

  const draftTotal = useMemo(() => (draft ? reqTotal(draft) : 0), [draft]);

  return (
    <div className="w-full">
      {/* Header */}
      <div className="flex items-center justify-between mb-3.5">
        <h2 className="text-base font-bold text-dark">{t('mat.title')}</h2>
        <button className="btn" onClick={startNew}>
          {t('mat.newRequest')}
        </button>
      </div>

      {/* Requests list */}
      <div className="panel mb-4">
        <h3 className="text-sm font-bold text-dark mb-3">
          <span className="inline-block w-1 h-4 bg-primary rounded mr-2 align-middle" />
          {t('mat.listTitle')}
        </h3>
        {/* Mobile card view */}
        <div className="md:hidden space-y-3">
          {requests.length === 0 && (
            <div className="text-center text-muted py-4">{t('mat.noRequests')}</div>
          )}
          {requests.map((r) => (
            <div key={r.id} className="bg-white border border-line rounded-xl p-3 shadow-sm">
              <div className="flex items-center justify-between gap-2">
                <div className="font-bold text-sm text-dark truncate">{r.requestNo || '—'}</div>
                <span className={`text-xs px-2 py-0.5 rounded-full flex-shrink-0 ${STATUS_STYLE[r.status]}`}>
                  {statusLabel(r.status)}
                </span>
              </div>
              <div className="text-xs text-muted mt-1 truncate">
                {r.site || '—'} · {t('mat.thRequester')} {r.requester || '—'} · {r.requestDate || '—'}
              </div>
              <div className="flex items-center justify-between mt-1.5">
                <span className="text-xs text-muted">{t('mat.thItems')} {r.items.length}</span>
                <span className="font-bold text-sm text-dark">{php(reqTotal(r))}</span>
              </div>
              <div className="flex flex-wrap gap-3 pt-2 mt-2 border-t border-line">
                {r.status !== 'approved' && (
                  <button className="text-xs text-green-700 hover:underline" onClick={() => setStatus(r, 'approved')}>{t('mat.approve')}</button>
                )}
                {r.status !== 'rejected' && (
                  <button className="text-xs text-red-600 hover:underline" onClick={() => setStatus(r, 'rejected')}>{t('mat.reject')}</button>
                )}
                {r.status !== 'requested' && (
                  <button className="text-xs text-amber-700 hover:underline" onClick={() => setStatus(r, 'requested')}>{t('mat.reopen')}</button>
                )}
                <button className="text-xs text-blue-700 hover:underline" onClick={() => startEdit(r)}>{t('mat.edit')}</button>
                <button className="text-xs text-red-600 hover:underline" onClick={() => handleDelete(r.id)}>{t('mat.delete')}</button>
              </div>
            </div>
          ))}
        </div>

        {/* Desktop table view */}
        <div className="overflow-x-auto hidden md:block">
          <table className="text-sm w-full">
            <thead>
              <tr>
                <th className="text-left">{t('mat.thNo')}</th>
                <th className="text-left">{t('mat.thDate')}</th>
                <th className="text-left">{t('mat.thRequester')}</th>
                <th className="text-left">{t('mat.thSite')}</th>
                <th className="text-center">{t('mat.thItems')}</th>
                <th className="text-right">{t('mat.thTotal')}</th>
                <th className="text-center">{t('mat.thStatus')}</th>
                <th className="text-center">{t('mat.thActions')}</th>
              </tr>
            </thead>
            <tbody>
              {requests.length === 0 && (
                <tr>
                  <td colSpan={8} className="text-center text-muted py-4">
                    {t('mat.noRequests')}
                  </td>
                </tr>
              )}
              {requests.map((r) => (
                <tr key={r.id}>
                  <td>{r.requestNo || '—'}</td>
                  <td>{r.requestDate || '—'}</td>
                  <td>{r.requester || '—'}</td>
                  <td>{r.site || '—'}</td>
                  <td className="text-center">{r.items.length}</td>
                  <td className="text-right">{php(reqTotal(r))}</td>
                  <td className="text-center">
                    <span
                      className={`text-xs px-2 py-0.5 rounded-full ${STATUS_STYLE[r.status]}`}
                    >
                      {statusLabel(r.status)}
                    </span>
                  </td>
                  <td className="text-center whitespace-nowrap">
                    {r.status !== 'approved' && (
                      <button
                        className="text-xs text-green-700 hover:underline mr-2"
                        onClick={() => setStatus(r, 'approved')}
                      >
                        {t('mat.approve')}
                      </button>
                    )}
                    {r.status !== 'rejected' && (
                      <button
                        className="text-xs text-red-600 hover:underline mr-2"
                        onClick={() => setStatus(r, 'rejected')}
                      >
                        {t('mat.reject')}
                      </button>
                    )}
                    {r.status !== 'requested' && (
                      <button
                        className="text-xs text-amber-700 hover:underline mr-2"
                        onClick={() => setStatus(r, 'requested')}
                      >
                        {t('mat.reopen')}
                      </button>
                    )}
                    <button
                      className="text-xs text-blue-700 hover:underline mr-2"
                      onClick={() => startEdit(r)}
                    >
                      {t('mat.edit')}
                    </button>
                    <button
                      className="text-xs text-red-600 hover:underline"
                      onClick={() => handleDelete(r.id)}
                    >
                      {t('mat.delete')}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Editor */}
      {draft && (
        <div className="panel">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-bold text-dark">
              <span className="inline-block w-1 h-4 bg-primary rounded mr-2 align-middle" />
              {draft.id ? t('mat.editorEdit') : t('mat.editorNew')}
            </h3>
            <span
              className={`text-xs px-2 py-0.5 rounded-full ${STATUS_STYLE[draft.status]}`}
            >
              {statusLabel(draft.status)}
            </span>
          </div>

          {/* Header fields */}
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-4">
            <Field label={t('mat.fldNo')}>
              <input
                type="text"
                value={draft.requestNo}
                onChange={(e) => patch({ requestNo: e.target.value })}
                className="inp"
              />
            </Field>
            <Field label={t('mat.fldDate')}>
              <input
                type="date"
                value={draft.requestDate}
                onChange={(e) => patch({ requestDate: e.target.value })}
                className="inp"
              />
            </Field>
            <Field label={t('mat.fldNeededBy')}>
              <input
                type="date"
                value={draft.neededBy}
                onChange={(e) => patch({ neededBy: e.target.value })}
                className="inp"
              />
            </Field>
            <Field label={t('mat.fldRequester')}>
              <input
                type="text"
                value={draft.requester}
                onChange={(e) => patch({ requester: e.target.value })}
                className="inp"
              />
            </Field>
            <Field label={t('mat.fldSite')}>
              <input
                type="text"
                value={draft.site}
                onChange={(e) => patch({ site: e.target.value })}
                className="inp"
              />
            </Field>
            <Field label={t('mat.fldTask')}>
              <select
                value={draft.taskId ?? ''}
                onChange={(e) => patch({ taskId: e.target.value || undefined })}
                className="inp"
              >
                <option value="">{t('mat.fldTaskNone')}</option>
                {tasks.map((tk) => (
                  <option key={tk.id} value={tk.id}>
                    {tk.name || tk.id}
                  </option>
                ))}
              </select>
            </Field>
          </div>

          <Field label={t('mat.fldNote')}>
            <input
              type="text"
              value={draft.note}
              onChange={(e) => patch({ note: e.target.value })}
              className="inp w-full"
            />
          </Field>

          {/* Line items */}
          <div className="flex items-center justify-between mt-4 mb-2">
            <h4 className="text-sm font-bold text-dark">{t('mat.itemsTitle')}</h4>
            <button className="btn gray" onClick={addItem}>
              {t('mat.addItem')}
            </button>
          </div>

          <div className="overflow-x-auto">
            <table className="text-sm w-full">
              <thead>
                <tr>
                  <th className="text-left">{t('mat.itName')}</th>
                  <th className="text-left">{t('mat.itSpec')}</th>
                  <th className="text-center">{t('mat.itQty')}</th>
                  <th className="text-center">{t('mat.itUnit')}</th>
                  <th className="text-right">{t('mat.itPrice')}</th>
                  <th className="text-left">{t('mat.itSupplier')}</th>
                  <th className="text-right">{t('mat.itAmount')}</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {draft.items.length === 0 && (
                  <tr>
                    <td colSpan={8} className="text-center text-muted py-3">
                      {t('mat.noItems')}
                    </td>
                  </tr>
                )}
                {draft.items.map((it, idx) => (
                  <tr key={idx}>
                    <td>
                      <input
                        type="text"
                        value={it.name}
                        onChange={(e) => patchItem(idx, { name: e.target.value })}
                        className="inp w-36"
                      />
                    </td>
                    <td>
                      <input
                        type="text"
                        value={it.spec}
                        onChange={(e) => patchItem(idx, { spec: e.target.value })}
                        className="inp w-24"
                      />
                    </td>
                    <td className="text-center">
                      <input
                        type="number"
                        min={0}
                        step={1}
                        value={it.quantity}
                        onChange={(e) =>
                          patchItem(idx, { quantity: Number(e.target.value) })
                        }
                        className="inp w-16 text-center"
                      />
                    </td>
                    <td className="text-center">
                      <input
                        type="text"
                        value={it.unit}
                        onChange={(e) => patchItem(idx, { unit: e.target.value })}
                        className="inp w-14 text-center"
                      />
                    </td>
                    <td className="text-right">
                      <input
                        type="number"
                        min={0}
                        step={1}
                        value={it.unitPrice}
                        onChange={(e) =>
                          patchItem(idx, { unitPrice: Number(e.target.value) })
                        }
                        className="inp w-24 text-right"
                      />
                    </td>
                    <td>
                      <input
                        type="text"
                        value={it.supplier}
                        onChange={(e) => patchItem(idx, { supplier: e.target.value })}
                        className="inp w-28"
                      />
                    </td>
                    <td className="text-right font-medium">
                      {php((Number(it.quantity) || 0) * (Number(it.unitPrice) || 0))}
                    </td>
                    <td className="text-center">
                      <button
                        className="text-xs text-red-600 hover:underline"
                        onClick={() => removeItem(idx)}
                      >
                        ✕
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={6} className="text-right font-bold pt-2">
                    {t('mat.total')}
                  </td>
                  <td className="text-right font-bold pt-2">{php(draftTotal)}</td>
                  <td></td>
                </tr>
              </tfoot>
            </table>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-2 mt-4">
            <button className="btn" onClick={handleSave} disabled={saving}>
              {saving ? t('mat.saving') : t('mat.save')}
            </button>
            <button className="btn gray" onClick={() => setDraft(null)}>
              {t('mat.cancel')}
            </button>
            <div className="flex-1" />
            {draft.status !== 'approved' && (
              <button
                className="btn"
                style={{ background: '#16a34a' }}
                onClick={() => patch({ status: 'approved' })}
              >
                {t('mat.approve')}
              </button>
            )}
            {draft.status !== 'rejected' && (
              <button
                className="btn"
                style={{ background: '#dc2626' }}
                onClick={() => patch({ status: 'rejected' })}
              >
                {t('mat.reject')}
              </button>
            )}
            {draft.status !== 'requested' && (
              <button className="btn gray" onClick={() => patch({ status: 'requested' })}>
                {t('mat.reopen')}
              </button>
            )}
          </div>
        </div>
      )}

      <p className="text-xs text-muted mt-3">{t('mat.note')}</p>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs text-muted">{label}</span>
      {children}
    </label>
  );
}
