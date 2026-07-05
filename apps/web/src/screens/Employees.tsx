import { useState, useEffect, useRef } from 'react';
import type { Employee, Crew } from '@brightem/shared';
import { api } from '../api';
import { useI18n } from '../i18n';

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
  age: string;
  idNo: string;
  joinDate: string;
  sssNo: string;
};

const EMPTY_WORKER: NewWorker = {
  name: '',
  nickname: '',
  crewId: '',
  position: 'SKILLED',
  ratePerDay: '540',
  age: '',
  idNo: '',
  joinDate: '',
  sssNo: '',
};

export default function Employees(): JSX.Element {
  const { t } = useI18n();
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
    setForm({ ...EMPTY_WORKER, crewId: crews[0]?.id ?? '' });
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
      age: emp.age != null ? String(emp.age) : '',
      idNo: emp.idNo || '',
      joinDate: emp.joinDate || '',
      sssNo: emp.sssNo || '',
    });
    setShowModal(true);
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
    const payload = {
      name,
      nickname: form.nickname.trim() || null,
      crewId: form.crewId,
      position: form.position,
      ratePerDay: Math.max(0, Math.floor(Number(form.ratePerDay) || 0)),
      age: form.age ? Math.max(0, Math.floor(Number(form.age))) : null,
      idNo: form.idNo.trim() || null,
      joinDate: form.joinDate || null,
      sssNo: form.sssNo.trim() || null,
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
      alert(editingId ? t('emp.updateError') : t('emp.addError'));
    } finally {
      setSaving(false);
    }
  };

  // Persist age/id changes for one employee (called on blur).
  const saveInfo = (empId: string, patch: { age?: number | null; idNo?: string | null }) => {
    api.updateEmployeeInfo(empId, patch).catch(() => alert(t('skill.saveError')));
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
    const matchesSearch =
      emp.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      emp.nickname.toLowerCase().includes(searchTerm.toLowerCase());
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

            <div className="space-y-3">
              <label className="block">
                <span className="mb-1 block text-xs font-semibold text-muted">
                  {t('emp.fName')}
                </span>
                <input
                  type="text"
                  autoFocus
                  value={form.name}
                  placeholder={t('emp.fNamePh')}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  className="w-full rounded-lg border border-line px-3 py-2 text-sm"
                />
              </label>

              <label className="block">
                <span className="mb-1 block text-xs font-semibold text-muted">
                  {t('emp.fNickname')}{' '}
                  <span className="font-normal">({t('emp.fOptional')})</span>
                </span>
                <input
                  type="text"
                  value={form.nickname}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, nickname: e.target.value }))
                  }
                  className="w-full rounded-lg border border-line px-3 py-2 text-sm"
                />
              </label>

              <div className="flex gap-3">
                <label className="block flex-1">
                  <span className="mb-1 block text-xs font-semibold text-muted">
                    {t('emp.fCrew')}
                  </span>
                  <select
                    value={form.crewId}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, crewId: e.target.value }))
                    }
                    className="w-full rounded-lg border border-line bg-white px-3 py-2 text-sm"
                  >
                    <option value="">{t('emp.selectCrew')}</option>
                    {crews.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="block flex-1">
                  <span className="mb-1 block text-xs font-semibold text-muted">
                    {t('emp.fPosition')}
                  </span>
                  <select
                    value={form.position}
                    onChange={(e) =>
                      setForm((f) => ({
                        ...f,
                        position: e.target.value as Employee['position'],
                      }))
                    }
                    className="w-full rounded-lg border border-line bg-white px-3 py-2 text-sm"
                  >
                    {POSITIONS.map((p) => (
                      <option key={p} value={p}>
                        {p}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <div className="flex gap-3">
                <label className="block flex-1">
                  <span className="mb-1 block text-xs font-semibold text-muted">
                    {t('emp.fRate')}
                  </span>
                  <input
                    type="number"
                    min={0}
                    inputMode="numeric"
                    value={form.ratePerDay}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, ratePerDay: e.target.value }))
                    }
                    className="w-full rounded-lg border border-line px-3 py-2 text-sm"
                  />
                </label>

                <label className="block w-20">
                  <span className="mb-1 block text-xs font-semibold text-muted">
                    {t('emp.fAge')}
                  </span>
                  <input
                    type="number"
                    min={0}
                    inputMode="numeric"
                    value={form.age}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, age: e.target.value }))
                    }
                    className="w-full rounded-lg border border-line px-3 py-2 text-sm"
                  />
                </label>

                <label className="block flex-1">
                  <span className="mb-1 block text-xs font-semibold text-muted">
                    {t('emp.fId')}{' '}
                    <span className="font-normal">({t('emp.fOptional')})</span>
                  </span>
                  <input
                    type="text"
                    value={form.idNo}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, idNo: e.target.value }))
                    }
                    className="w-full rounded-lg border border-line px-3 py-2 text-sm"
                  />
                </label>
              </div>

              <div className="flex gap-3">
                <label className="block flex-1">
                  <span className="mb-1 block text-xs font-semibold text-muted">
                    {t('emp.fJoinDate')}{' '}
                    <span className="font-normal">({t('emp.fOptional')})</span>
                  </span>
                  <input
                    type="date"
                    value={form.joinDate}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, joinDate: e.target.value }))
                    }
                    className="w-full rounded-lg border border-line px-3 py-2 text-sm"
                  />
                </label>

                <label className="block flex-1">
                  <span className="mb-1 block text-xs font-semibold text-muted">
                    {t('emp.fSssNo')}{' '}
                    <span className="font-normal">({t('emp.fOptional')})</span>
                  </span>
                  <input
                    type="text"
                    value={form.sssNo}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, sssNo: e.target.value }))
                    }
                    className="w-full rounded-lg border border-line px-3 py-2 text-sm"
                  />
                </label>
              </div>
            </div>

            <div className="mt-5 flex justify-end gap-2">
              <button
                className="rounded-lg border border-line px-4 py-2 text-sm"
                disabled={saving}
                onClick={() => setShowModal(false)}
              >
                {t('emp.cancel')}
              </button>
              <button
                className="btn"
                disabled={saving}
                onClick={submitWorker}
              >
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
        <div className="overflow-x-auto">
          <table>
            <thead>
              <tr>
                <th>{t('emp.thEmpNo')}</th>
                <th className="text-center">{t('emp.thPhoto')}</th>
                <th>{t('emp.thName')}</th>
                <th>{t('emp.thNickname')}</th>
                <th className="text-center">{t('emp.thAge')}</th>
                <th className="text-center">{t('emp.thId')}</th>
                <th>{t('emp.thPosition')}</th>
                <th>{t('emp.thCrew')}</th>
                <th className="text-right">{t('emp.thDailyRate')}</th>
                <th>{t('emp.thJoinDate')}</th>
                <th>{t('emp.thSssNo')}</th>
                <th className="text-center">{t('emp.thActions')}</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && !loading && (
                <tr>
                  <td colSpan={12} className="text-center text-muted py-8">
                    {t('emp.noData')}
                  </td>
                </tr>
              )}
              {filtered.map((emp, idx) => (
                <tr key={emp.id}>
                  <td>{String(idx + 1).padStart(3, '0')}</td>
                  <td className="text-center p-1">
                    <button
                      onClick={() => pickPhoto(emp.id)}
                      title={t('skill.photoTitle')}
                      className="mx-auto block h-11 w-9 overflow-hidden rounded border border-line bg-gray-50 hover:ring-2 hover:ring-primary"
                    >
                      {photos[emp.id] ? (
                        <img
                          src={photos[emp.id]}
                          alt=""
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        <span className="text-base leading-none text-muted">＋</span>
                      )}
                    </button>
                  </td>
                  <td>{emp.name}</td>
                  <td>{emp.nickname || '—'}</td>
                  <td className="text-center p-0.5">
                    <input
                      type="number"
                      min={0}
                      inputMode="numeric"
                      value={ages[emp.id] ?? ''}
                      onChange={(ev) =>
                        setAges((prev) => ({ ...prev, [emp.id]: ev.target.value }))
                      }
                      onBlur={() =>
                        saveInfo(emp.id, {
                          age: ages[emp.id]
                            ? Math.max(0, Math.floor(Number(ages[emp.id])))
                            : null,
                        })
                      }
                      className="w-12 rounded border border-line bg-white px-1 py-1 text-center text-sm"
                      placeholder="—"
                    />
                  </td>
                  <td className="text-center p-0.5">
                    <input
                      type="text"
                      value={idNos[emp.id] ?? ''}
                      onChange={(ev) =>
                        setIdNos((prev) => ({ ...prev, [emp.id]: ev.target.value }))
                      }
                      onBlur={() => saveInfo(emp.id, { idNo: idNos[emp.id]?.trim() || null })}
                      className="w-24 rounded border border-line bg-white px-1 py-1 text-center text-sm"
                      placeholder="—"
                    />
                  </td>
                  <td>{emp.position}</td>
                  <td>
                    <span className="crewtag">{emp.crewId}</span>
                  </td>
                  <td className="text-right">₱{emp.ratePerDay}</td>
                  <td>{emp.joinDate || '—'}</td>
                  <td>{emp.sssNo || '—'}</td>
                  <td className="text-center">
                    <button
                      onClick={() => openEdit(emp)}
                      className="rounded-lg border border-line px-2.5 py-1 text-xs font-semibold text-primary hover:bg-gray-50"
                    >
                      {t('emp.edit')}
                    </button>
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
