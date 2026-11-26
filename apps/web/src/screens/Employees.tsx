import { useState, useEffect, useRef } from 'react';
import { REQUIRED_EMPLOYEE_FIELDS } from '@brightem/shared';
import type { Employee, Crew, EmployeeFieldDef } from '@brightem/shared';
import { api } from '../api';
import { useI18n } from '../i18n';
import { useEmployeeFields } from '../lib/employeeFields';

const POSITIONS = [
  'SKILLED',
  'LABOR',
  'ELECTRICIAN',
  'HOUSEKEEPING',
  'SECURITY',
];

type NewWorker = {
  name: string;
  nickname: string;
  crewId: string;
  position: Employee['position'];
  ratePerDay: string;
  incentive: string;
  age: string;
  idNo: string;
  joinDate: string;
  sssNo: string;
  canteenDebt: string;
  adjustment: string;
  adjustmentDeduction: string;
  sssDeduction: string;
  pagibigDeduction: string;
  philhealthDeduction: string;
  custom: Record<string, string>;
};

const EMPTY_WORKER: NewWorker = {
  name: '',
  nickname: '',
  crewId: '',
  position: 'SKILLED',
  ratePerDay: '540',
  incentive: '',
  age: '',
  idNo: '',
  joinDate: '',
  sssNo: '',
  canteenDebt: '',
  adjustment: '',
  adjustmentDeduction: '',
  sssDeduction: '',
  pagibigDeduction: '',
  philhealthDeduction: '',
  custom: {},
};

// Built-in field key -> NewWorker form property and input kind.
type FormKey = Exclude<keyof NewWorker, 'custom' | 'position' | 'crewId'>;
const BUILTIN_INPUTS: Record<string, { prop: FormKey; kind: 'text' | 'number' | 'date'; money?: boolean; optional?: boolean }> = {
  name: { prop: 'name', kind: 'text' },
  nickname: { prop: 'nickname', kind: 'text', optional: true },
  ratePerDay: { prop: 'ratePerDay', kind: 'number', money: true },
  incentiveDailyRate: { prop: 'incentive', kind: 'number', money: true, optional: true },
  age: { prop: 'age', kind: 'number' },
  idNo: { prop: 'idNo', kind: 'text', optional: true },
  joinDate: { prop: 'joinDate', kind: 'date', optional: true },
  sssNo: { prop: 'sssNo', kind: 'text', optional: true },
  canteenDebt: { prop: 'canteenDebt', kind: 'number', money: true },
  adjustment: { prop: 'adjustment', kind: 'number', money: true },
  adjustmentDeduction: { prop: 'adjustmentDeduction', kind: 'number', money: true },
  sssDeduction: { prop: 'sssDeduction', kind: 'number', money: true },
  pagibigDeduction: { prop: 'pagibigDeduction', kind: 'number', money: true },
  philhealthDeduction: { prop: 'philhealthDeduction', kind: 'number', money: true },
};

const MONEY_COLS = new Set([
  'ratePerDay',
  'incentiveDailyRate',
  'canteenDebt',
  'adjustment',
  'adjustmentDeduction',
  'sssDeduction',
  'pagibigDeduction',
  'philhealthDeduction',
]);

const peso = (v: number | null | undefined) => (v ? `₱${v}` : '—');

export default function Employees(): JSX.Element {
  const { t } = useI18n();
  const { fields, label } = useEmployeeFields();
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedPosition, setSelectedPosition] = useState('ALL');
  const [loading, setLoading] = useState(false);

  // Editable ID info (age / id number) and photo URLs, keyed by employee id.
  const [ages, setAges] = useState<Record<string, string>>({});
  const [idNos, setIdNos] = useState<Record<string, string>>({});
  const [photos, setPhotos] = useState<Record<string, string>>({});
  const [uploadFor, setUploadFor] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // Add/Edit-worker modal state. editingId === null => add mode.
  const [crews, setCrews] = useState<Crew[]>([]);
  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<NewWorker>(EMPTY_WORKER);

  const visibleFields = fields.filter((f) => f.visible);
  // Fields shown in the add/edit form: visible ones plus the payroll-required ones.
  const formFields = fields.filter(
    (f) => f.key !== 'photo' && (f.visible || REQUIRED_EMPLOYEE_FIELDS.includes(f.key))
  );

  const loadEmployees = () => {
    setLoading(true);
    api
      .getEmployees()
      .then((data) => {
        setEmployees(data);
        const a: Record<string, string> = {};
        const n: Record<string, string> = {};
        const p: Record<string, string> = {};
        data.forEach((e) => {
          if (e.age != null) a[e.id] = String(e.age);
          if (e.idNo) n[e.id] = e.idNo;
          if (e.photoUrl) p[e.id] = e.photoUrl;
        });
        setAges(a);
        setIdNos(n);
        setPhotos(p);
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    loadEmployees();
    api.getCrews().then(setCrews).catch(() => undefined);
  }, []);

  const openAdd = () => {
    setEditingId(null);
    setForm({ ...EMPTY_WORKER, custom: {}, crewId: crews[0]?.id ?? '' });
    setShowModal(true);
  };

  const openEdit = (emp: Employee) => {
    setEditingId(emp.id);
    setForm({
      name: emp.name,
      nickname: emp.nickname || '',
      crewId: emp.crewId,
      position: emp.position,
      ratePerDay: String(emp.ratePerDay ?? ''),
      incentive: emp.incentiveDailyRate != null ? String(emp.incentiveDailyRate) : '',
      age: emp.age != null ? String(emp.age) : '',
      idNo: emp.idNo || '',
      joinDate: emp.joinDate || '',
      sssNo: emp.sssNo || '',
      canteenDebt: emp.canteenDebt ? String(emp.canteenDebt) : '',
      adjustment: emp.adjustment ? String(emp.adjustment) : '',
      adjustmentDeduction: emp.adjustmentDeduction ? String(emp.adjustmentDeduction) : '',
      sssDeduction: emp.sssDeduction ? String(emp.sssDeduction) : '',
      pagibigDeduction: emp.pagibigDeduction ? String(emp.pagibigDeduction) : '',
      philhealthDeduction: emp.philhealthDeduction ? String(emp.philhealthDeduction) : '',
      custom: { ...(emp.custom ?? {}) },
    });
    setShowModal(true);
  };

  // Custom values to save: the edited ones for current custom fields, plus any
  // values of deleted fields kept as-is (re-adding the key restores them).
  const buildCustom = (): Record<string, string> => {
    const out: Record<string, string> = {};
    Object.entries(form.custom).forEach(([k, v]) => {
      const val = String(v ?? '').trim();
      if (val) out[k] = val;
    });
    return out;
  };

  const submitWorker = async () => {
    const name = form.name.trim();
    if (!name) {
      alert(t('emp.nameRequired'));
      return;
    }
    if (!form.crewId) {
      alert(t('emp.crewRequired'));
      return;
    }
    const prevCustom = editingId
      ? employees.find((e) => e.id === editingId)?.custom ?? {}
      : {};
    const custom = buildCustom();
    const customChanged = JSON.stringify(custom) !== JSON.stringify(prevCustom);
    const payload = {
      name,
      nickname: form.nickname.trim() || null,
      crewId: form.crewId,
      position: form.position,
      ratePerDay: Math.max(0, Math.floor(Number(form.ratePerDay) || 0)),
      incentiveDailyRate: form.incentive
        ? Math.max(0, Math.floor(Number(form.incentive)))
        : null,
      age: form.age ? Math.max(0, Math.floor(Number(form.age))) : null,
      idNo: form.idNo.trim() || null,
      joinDate: form.joinDate || null,
      sssNo: form.sssNo.trim() || null,
      canteenDebt: form.canteenDebt ? Math.max(0, Number(form.canteenDebt)) : 0,
      adjustment: form.adjustment ? Math.max(0, Number(form.adjustment)) : 0,
      adjustmentDeduction: form.adjustmentDeduction
        ? Math.max(0, Number(form.adjustmentDeduction))
        : 0,
      sssDeduction: form.sssDeduction ? Math.max(0, Number(form.sssDeduction)) : 0,
      pagibigDeduction: form.pagibigDeduction
        ? Math.max(0, Number(form.pagibigDeduction))
        : 0,
      philhealthDeduction: form.philhealthDeduction
        ? Math.max(0, Number(form.philhealthDeduction))
        : 0,
      // Only sent when custom values changed, so workers without custom
      // fields never touch the custom_fields column.
      ...(customChanged ? { custom } : {}),
    };
    setSaving(true);
    try {
      if (editingId) {
        await api.updateEmployee(editingId, payload);
      } else {
        await api.createEmployee({
          ...payload,
          nickname: payload.nickname ?? undefined,
        });
      }
      setShowModal(false);
      loadEmployees();
    } catch {
      alert(
        customChanged
          ? `${editingId ? t('emp.updateError') : t('emp.addError')}\n${t('emp.customSaveError')}`
          : editingId
            ? t('emp.updateError')
            : t('emp.addError')
      );
    } finally {
      setSaving(false);
    }
  };

  // Persist age/id changes for one employee (called on blur).
  const saveInfo = (empId: string, patch: { age?: number | null; idNo?: string | null }) => {
    api.updateEmployeeInfo(empId, patch).catch(() => alert(t('skill.saveError')));
  };

  const handleDelete = async (emp: Employee) => {
    if (!window.confirm(t('emp.deleteConfirm').replace('{name}', emp.name))) return;
    try {
      await api.deleteEmployee(emp.id);
      loadEmployees();
    } catch {
      alert(t('emp.deleteError'));
    }
  };

  // Trigger the hidden file picker for a given worker's photo.
  const pickPhoto = (empId: string) => {
    setUploadFor(empId);
    fileRef.current?.click();
  };

  const onPhotoFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !uploadFor) return;
    const empId = uploadFor;
    try {
      const url = await api.uploadEmployeePhoto(empId, file);
      setPhotos((prev) => ({ ...prev, [empId]: url }));
    } catch {
      alert(t('skill.photoError'));
    } finally {
      setUploadFor(null);
    }
  };

  // Filter employees
  const filtered = employees.filter((emp) => {
    const q = searchTerm.toLowerCase();
    const matchesSearch =
      emp.name.toLowerCase().includes(q) ||
      emp.nickname.toLowerCase().includes(q) ||
      Object.values(emp.custom ?? {}).some((v) => String(v).toLowerCase().includes(q));
    const matchesPosition =
      selectedPosition === 'ALL' || emp.position === selectedPosition;
    return matchesSearch && matchesPosition;
  });

  // Count by position
  const positionCounts = POSITIONS.reduce(
    (acc, pos) => {
      acc[pos] = employees.filter((e) => e.position === pos).length;
      return acc;
    },
    {} as Record<string, number>
  );

  const inputCls = 'w-full rounded-lg border border-line px-3 py-2 text-sm';

  // One input in the add/edit form, rendered from its field definition.
  const renderFormField = (f: EmployeeFieldDef, first: boolean) => {
    const caption = (optional?: boolean, money?: boolean) => (
      <span className="mb-1 block text-xs font-semibold text-muted">
        {label(f)}
        {money ? ' (₱)' : ''}
        {optional ? <span className="font-normal"> ({t('emp.fOptional')})</span> : null}
      </span>
    );

    if (!f.builtin) {
      const kind = f.type ?? 'text';
      return (
        <label key={f.key} className="block">
          {caption(true)}
          <input
            type={kind}
            inputMode={kind === 'number' ? 'decimal' : undefined}
            value={form.custom[f.key] ?? ''}
            onChange={(e) =>
              setForm((prev) => ({ ...prev, custom: { ...prev.custom, [f.key]: e.target.value } }))
            }
            className={inputCls}
          />
        </label>
      );
    }

    if (f.key === 'crewId') {
      return (
        <label key={f.key} className="block">
          {caption()}
          <select
            value={form.crewId}
            onChange={(e) => setForm((prev) => ({ ...prev, crewId: e.target.value }))}
            className={`${inputCls} bg-white`}
          >
            <option value="">{t('emp.selectCrew')}</option>
            {crews.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
      );
    }

    if (f.key === 'position') {
      return (
        <label key={f.key} className="block">
          {caption()}
          <select
            value={form.position}
            onChange={(e) =>
              setForm((prev) => ({ ...prev, position: e.target.value as Employee['position'] }))
            }
            className={`${inputCls} bg-white`}
          >
            {POSITIONS.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </label>
      );
    }

    const spec = BUILTIN_INPUTS[f.key];
    if (!spec) return null;
    return (
      <label key={f.key} className={`block ${f.key === 'name' ? 'col-span-2' : ''}`}>
        {caption(spec.optional, spec.money)}
        <input
          type={spec.kind}
          autoFocus={first}
          min={spec.kind === 'number' ? 0 : undefined}
          inputMode={spec.kind === 'number' ? 'numeric' : undefined}
          placeholder={f.key === 'name' ? t('emp.fNamePh') : undefined}
          value={form[spec.prop]}
          onChange={(e) => setForm((prev) => ({ ...prev, [spec.prop]: e.target.value }))}
          className={inputCls}
        />
      </label>
    );
  };

  // Table cell for one employee × one visible field.
  const renderCell = (emp: Employee, f: EmployeeFieldDef) => {
    if (!f.builtin) {
      return <td key={f.key}>{emp.custom?.[f.key] || '—'}</td>;
    }
    switch (f.key) {
      case 'photo':
        return (
          <td key={f.key} className="text-center p-1">
            <button
              onClick={() => pickPhoto(emp.id)}
              title={t('skill.photoTitle')}
              className="mx-auto block h-11 w-9 overflow-hidden rounded border border-line bg-gray-50 hover:ring-2 hover:ring-primary"
            >
              {photos[emp.id] ? (
                <img src={photos[emp.id]} alt="" className="h-full w-full object-cover" />
              ) : (
                <span className="text-base leading-none text-muted">＋</span>
              )}
            </button>
          </td>
        );
      case 'name':
        return (
          <td key={f.key} className="freeze-col">
            {emp.name}
          </td>
        );
      case 'nickname':
        return <td key={f.key}>{emp.nickname || '—'}</td>;
      case 'age':
        return (
          <td key={f.key} className="text-center p-0.5">
            <input
              type="number"
              min={0}
              inputMode="numeric"
              value={ages[emp.id] ?? ''}
              onChange={(ev) => setAges((prev) => ({ ...prev, [emp.id]: ev.target.value }))}
              onBlur={() =>
                saveInfo(emp.id, {
                  age: ages[emp.id] ? Math.max(0, Math.floor(Number(ages[emp.id]))) : null,
                })
              }
              className="w-12 rounded border border-line bg-white px-1 py-1 text-center text-sm"
              placeholder="—"
            />
          </td>
        );
      case 'idNo':
        return (
          <td key={f.key} className="text-center p-0.5">
            <input
              type="text"
              value={idNos[emp.id] ?? ''}
              onChange={(ev) => setIdNos((prev) => ({ ...prev, [emp.id]: ev.target.value }))}
              onBlur={() => saveInfo(emp.id, { idNo: idNos[emp.id]?.trim() || null })}
              className="w-24 rounded border border-line bg-white px-1 py-1 text-center text-sm"
              placeholder="—"
            />
          </td>
        );
      case 'position':
        return <td key={f.key}>{emp.position}</td>;
      case 'crewId':
        return (
          <td key={f.key}>
            <span className="crewtag">{emp.crewId}</span>
          </td>
        );
      case 'ratePerDay':
        return (
          <td key={f.key} className="text-right">
            ₱{emp.ratePerDay}
          </td>
        );
      case 'incentiveDailyRate':
        return (
          <td key={f.key} className="text-right">
            {emp.incentiveDailyRate != null ? `₱${emp.incentiveDailyRate}` : '—'}
          </td>
        );
      case 'joinDate':
        return <td key={f.key}>{emp.joinDate || '—'}</td>;
      case 'sssNo':
        return <td key={f.key}>{emp.sssNo || '—'}</td>;
      default:
        if (MONEY_COLS.has(f.key)) {
          return (
            <td key={f.key} className="text-right">
              {peso((emp as unknown as Record<string, number | undefined>)[f.key])}
            </td>
          );
        }
        return <td key={f.key}>—</td>;
    }
  };

  const headerAlign = (f: EmployeeFieldDef) =>
    f.builtin && MONEY_COLS.has(f.key)
      ? 'text-right'
      : f.key === 'photo' || f.key === 'age' || f.key === 'idNo'
        ? 'text-center'
        : '';

  const mobileCustom = visibleFields.filter((f) => !f.builtin);

  return (
    <div className="w-full">
      {/* Toolbar */}
      <div className="flex gap-2 items-center flex-wrap mb-3.5">
        <input
          type="text"
          placeholder={t('emp.searchPlaceholder')}
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="border border-line rounded-lg px-3 py-2 text-sm bg-white w-56"
        />

        <select
          value={selectedPosition}
          onChange={(e) => setSelectedPosition(e.target.value)}
          className="border border-line rounded-lg px-3 py-2 text-sm bg-white"
        >
          <option value="ALL">{t('emp.allPositions')}</option>
          {POSITIONS.map((pos) => (
            <option key={pos} value={pos}>
              {pos} ({positionCounts[pos]})
            </option>
          ))}
        </select>

        <div className="flex-1" />

        <button className="btn" onClick={openAdd}>
          {t('emp.addWorker')}
        </button>
      </div>

      {/* Add / Edit-worker modal */}
      {showModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={() => !saving && setShowModal(false)}
        >
          <div
            className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-xl bg-white p-5 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="mb-4 text-base font-bold text-dark">
              {editingId ? t('emp.editTitle') : t('emp.addTitle')}
            </h3>

            <div className="grid grid-cols-2 gap-3">
              {formFields.map((f, i) => renderFormField(f, i === 0))}
            </div>

            <div className="mt-5 flex justify-end gap-2">
              <button
                className="rounded-lg border border-line px-4 py-2 text-sm"
                disabled={saving}
                onClick={() => setShowModal(false)}
              >
                {t('emp.cancel')}
              </button>
              <button className="btn" disabled={saving} onClick={submitWorker}>
                {saving ? t('emp.saving') : t('emp.save')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Hidden picker used for uploading a worker's ID photo. */}
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={onPhotoFile}
      />

      {/* Table */}
      <div className="panel">
        <h3 className="text-sm font-bold text-dark mb-3">
          {t('emp.masterTitle')} ({employees.length}{t('emp.masterUnit')})
        </h3>
        {/* Mobile card view */}
        <div className="md:hidden space-y-3">
          {filtered.length === 0 && !loading && (
            <div className="text-center text-muted py-8">{t('emp.noData')}</div>
          )}
          {filtered.map((emp) => (
            <div key={emp.id} className="bg-white border border-line rounded-xl p-3 shadow-sm">
              <div className="flex items-center gap-3">
                <button
                  onClick={() => pickPhoto(emp.id)}
                  title={t('skill.photoTitle')}
                  className="h-12 w-10 flex-shrink-0 overflow-hidden rounded border border-line bg-gray-50 flex items-center justify-center"
                >
                  {photos[emp.id] ? (
                    <img src={photos[emp.id]} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <span className="text-lg leading-none text-muted">＋</span>
                  )}
                </button>
                <div className="min-w-0 flex-1">
                  <div className="font-bold text-sm text-dark truncate">
                    {emp.name}
                    {emp.nickname ? <span className="text-muted font-normal"> ({emp.nickname})</span> : null}
                  </div>
                  <div className="text-xs text-muted truncate">
                    {emp.position} · <span className="crewtag">{emp.crewId}</span> · ₱{emp.ratePerDay}/일
                  </div>
                  {mobileCustom.some((f) => emp.custom?.[f.key]) && (
                    <div className="text-xs text-muted truncate">
                      {mobileCustom
                        .filter((f) => emp.custom?.[f.key])
                        .map((f) => `${label(f)}: ${emp.custom?.[f.key]}`)
                        .join(' · ')}
                    </div>
                  )}
                </div>
                <div className="flex flex-col gap-1 flex-shrink-0">
                  <button
                    onClick={() => openEdit(emp)}
                    className="rounded-lg border border-line px-2.5 py-1 text-xs font-semibold text-primary hover:bg-gray-50"
                  >
                    {t('emp.edit')}
                  </button>
                  <button
                    onClick={() => handleDelete(emp)}
                    className="rounded-lg border border-red-300 px-2.5 py-1 text-xs font-semibold text-red-600 hover:bg-red-50"
                  >
                    {t('emp.delete')}
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Desktop table view */}
        <div className="overflow-x-auto hidden md:block">
          <table>
            <thead>
              <tr>
                <th>{t('emp.thEmpNo')}</th>
                {visibleFields.map((f) => (
                  <th
                    key={f.key}
                    className={`${headerAlign(f)} ${f.key === 'name' ? 'freeze-col' : ''}`}
                  >
                    {label(f)}
                  </th>
                ))}
                <th className="text-center">{t('emp.thActions')}</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && !loading && (
                <tr>
                  <td colSpan={visibleFields.length + 2} className="text-center text-muted py-8">
                    {t('emp.noData')}
                  </td>
                </tr>
              )}
              {filtered.map((emp, idx) => (
                <tr key={emp.id}>
                  <td>{String(idx + 1).padStart(3, '0')}</td>
                  {visibleFields.map((f) => renderCell(emp, f))}
                  <td className="text-center">
                    <div className="flex items-center justify-center gap-1.5">
                      <button
                        onClick={() => openEdit(emp)}
                        className="rounded-lg border border-line px-2.5 py-1 text-xs font-semibold text-primary hover:bg-gray-50"
                      >
                        {t('emp.edit')}
                      </button>
                      <button
                        onClick={() => handleDelete(emp)}
                        className="rounded-lg border border-red-300 px-2.5 py-1 text-xs font-semibold text-red-600 hover:bg-red-50"
                      >
                        {t('emp.delete')}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="note">
          {filtered.length} {t('emp.showingCount')}
        </div>
      </div>
    </div>
  );
}
