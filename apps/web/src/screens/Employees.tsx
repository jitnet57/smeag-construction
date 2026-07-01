import { useState, useEffect } from 'react';
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

  useEffect(() => {
    setLoading(true);
    api
      .getEmployees()
      .then((data) => {
        setEmployees(data);
      })
      .finally(() => setLoading(false));
  }, []);

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
                <th>{t('emp.thName')}</th>
                <th>{t('emp.thNickname')}</th>
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
                  <td colSpan={8} className="text-center text-muted py-8">
                    {t('emp.noData')}
                  </td>
                </tr>
              )}
              {filtered.map((emp, idx) => (
                <tr key={emp.id}>
                  <td>{String(idx + 1).padStart(3, '0')}</td>
                  <td>{emp.name}</td>
                  <td>{emp.nickname || '—'}</td>
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
