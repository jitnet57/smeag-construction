import { useState, useEffect } from 'react';
import type { PayPeriod, AttendanceRecord, Employee } from '@brightem/shared';
import { api } from '../api';
import { useI18n } from '../i18n';

interface Props {
  period: PayPeriod | null;
}

interface AttendanceRow {
  employee: Employee;
  record: AttendanceRecord | null;
  amIn: string;
  amOut: string;
  pmIn: string;
  pmOut: string;
  otIn: string;
  otOut: string;
  workedHours: number;
  status: string;
  statusType: 'ok' | 'half' | 'abs';
}

export default function Attendance({ period }: Props) {
  const { t } = useI18n();
  const [selectedCrew, setSelectedCrew] = useState('ANTHONY');
  const [selectedDate, setSelectedDate] = useState('2026-06-25');
  const [rows, setRows] = useState<AttendanceRow[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);

  useEffect(() => {
    // Load employees filtered by crew
    api.getEmployees().then((data) => {
      const filtered = data.filter((e) => e.crewId === selectedCrew);
      setEmployees(filtered.slice(0, 5)); // Show first 5 as mock
    });
  }, [selectedCrew]);

  useEffect(() => {
    // Load attendance records
    if (period) {
      api.getAttendance(period.id).then((records) => {
        const newRows = employees.map((emp) => {
          const rec = records.find(
            (r) => r.employeeId === emp.id && r.date === selectedDate
          );
          const status = rec?.status === 'full' ? t('att.stNormal') : rec?.status === 'half' ? t('att.stHalf') : t('att.stAbsent');
          const statusType: 'ok' | 'half' | 'abs' = rec?.status === 'full' ? 'ok' : rec?.status === 'half' ? 'half' : 'abs';
          return {
            employee: emp,
            record: rec || null,
            amIn: rec?.amIn?.toString() ?? '',
            amOut: rec?.amOut?.toString() ?? '',
            pmIn: rec?.pmIn?.toString() ?? '',
            pmOut: rec?.pmOut?.toString() ?? '',
            otIn: rec?.otHours ? '17' : '',
            otOut: rec?.otHours ? '19' : '',
            workedHours: rec?.otHours ? 10.0 : 8.0,
            status,
            statusType,
          };
        });
        setRows(newRows);
      });
    }
  }, [employees, period, selectedDate, t]);

  const handleInputChange = (index: number, field: string, value: string) => {
    const newRows = [...rows];
    newRows[index] = { ...newRows[index], [field]: value };
    setRows(newRows);
  };

  const handleSave = async () => {
    if (!period) return;
    const records = rows.map((row) => ({
      employeeId: row.employee.id,
      date: selectedDate,
      status: row.workedHours >= 8 ? ('full' as const) : 'half' as const,
      amIn: row.amIn ? parseFloat(row.amIn) : null,
      amOut: row.amOut ? parseFloat(row.amOut) : null,
      pmIn: row.pmIn ? parseFloat(row.pmIn) : null,
      pmOut: row.pmOut ? parseFloat(row.pmOut) : null,
      otHours: row.otIn ? 2 : undefined,
    } as AttendanceRecord));

    try {
      await api.updateAttendance(records);
      alert(t('att.saved'));
    } catch {
      alert(t('att.saveError'));
    }
  };

  return (
    <div className="w-full">
      {/* Toolbar */}
      <div className="flex gap-2 items-center flex-wrap mb-3.5">
        <select
          value={selectedCrew}
          onChange={(e) => setSelectedCrew(e.target.value)}
          className="border border-line rounded-lg px-3 py-2 text-sm bg-white"
        >
          <option value="ANTHONY">{t('att.crewSelect')} ANTHONY (44{t('att.people')})</option>
          <option value="FOREMAN">FOREMAN (25{t('att.people')})</option>
          <option value="HANZ">HANZ (24{t('att.people')})</option>
        </select>

        <select
          value={selectedDate}
          onChange={(e) => setSelectedDate(e.target.value)}
          className="border border-line rounded-lg px-3 py-2 text-sm bg-white"
        >
          <option value="2026-06-25">{t('att.date')} 2026-06-25 ({t('dow.thu')})</option>
          <option value="2026-06-24">2026-06-24 ({t('dow.wed')})</option>
        </select>

        <div className="flex-1" />

        <button className="btn gray">{t('att.excelImport')}</button>
        <button className="btn ghost">{t('att.saveDraft')}</button>
        <button onClick={handleSave} className="btn">
          {t('att.confirm')}
        </button>
      </div>

      {/* Table */}
      <div className="panel">
        <h3 className="text-sm font-bold text-dark mb-3">
          {t('att.timeEntryTitle')}
        </h3>
        <div className="overflow-x-auto">
          <table>
            <thead>
              <tr>
                <th>#</th>
                <th>{t('att.thName')}</th>
                <th>{t('att.thPosition')}</th>
                <th className="text-center">AM IN</th>
                <th className="text-center">AM OUT</th>
                <th className="text-center">PM IN</th>
                <th className="text-center">PM OUT</th>
                <th className="text-center">OT IN</th>
                <th className="text-center">OT OUT</th>
                <th className="text-center">{t('att.thWorkedH')}</th>
                <th className="text-center">{t('att.thStatus')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, idx) => (
                <tr key={row.employee.id}>
                  <td>{idx + 1}</td>
                  <td>{row.employee.name}</td>
                  <td>{row.employee.position}</td>
                  <td className="text-center">
                    <input
                      className="in"
                      value={row.amIn}
                      onChange={(e) => handleInputChange(idx, 'amIn', e.target.value)}
                    />
                  </td>
                  <td className="text-center">
                    <input
                      className="in"
                      value={row.amOut}
                      onChange={(e) => handleInputChange(idx, 'amOut', e.target.value)}
                    />
                  </td>
                  <td className="text-center">
                    <input
                      className="in"
                      value={row.pmIn}
                      onChange={(e) => handleInputChange(idx, 'pmIn', e.target.value)}
                    />
                  </td>
                  <td className="text-center">
                    <input
                      className="in"
                      value={row.pmOut}
                      onChange={(e) => handleInputChange(idx, 'pmOut', e.target.value)}
                    />
                  </td>
                  <td className="text-center">
                    <input
                      className="in"
                      value={row.otIn}
                      onChange={(e) => handleInputChange(idx, 'otIn', e.target.value)}
                    />
                  </td>
                  <td className="text-center">
                    <input
                      className="in"
                      value={row.otOut}
                      onChange={(e) => handleInputChange(idx, 'otOut', e.target.value)}
                    />
                  </td>
                  <td className="text-center">{row.workedHours.toFixed(1)}</td>
                  <td className="text-center">
                    <span className={`pill ${row.statusType}`}>{row.status}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="note">
          {t('att.note')}
        </div>
      </div>
    </div>
  );
}
