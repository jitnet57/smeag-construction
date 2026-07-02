import { useState, useEffect, useRef } from 'react';
import type { Employee } from '@brightem/shared';
import { api } from '../api';
import { useI18n } from '../i18n';

const POSITIONS = [
  'SKILLED',
  'LABOR',
  'ELECTRICIAN',
  'HOUSEKEEPING',
  'SECURITY',
];

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

  useEffect(() => {
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
  }, []);

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

        <button className="btn">{t('emp.addWorker')}</button>
      </div>

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
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && !loading && (
                <tr>
                  <td colSpan={11} className="text-center text-muted py-8">
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
                  <td>2022-08-28</td>
                  <td>34-xxxxxxx-x</td>
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
