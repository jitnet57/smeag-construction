import { useState, useEffect, useRef } from 'react';
import type { PayPeriod, AttendanceRecord, Employee } from '@brightem/shared';
import { api } from '../api';
import { useI18n } from '../i18n';
import { parseCsv } from '../lib/csv';

interface Props {
  period: PayPeriod | null;
}

const DOW_KEYS = ['dow.sun', 'dow.mon', 'dow.tue', 'dow.wed', 'dow.thu', 'dow.fri', 'dow.sat'];

// Build every calendar date from start..end (inclusive) as YYYY-MM-DD strings.
function buildDateList(start?: string, end?: string): string[] {
  if (!start || !end) return [];
  const out: string[] = [];
  const cur = new Date(start + 'T00:00:00');
  const last = new Date(end + 'T00:00:00');
  while (cur <= last) {
    out.push(cur.toISOString().slice(0, 10));
    cur.setDate(cur.getDate() + 1);
  }
  return out;
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
  const [allEmployees, setAllEmployees] = useState<Employee[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [crews, setCrews] = useState<{ id: string; count: number }[]>([]);

  useEffect(() => {
    // Load all employees once and derive crew list with head counts
    api.getEmployees().then((data) => {
      setAllEmployees(data);
      const counts = new Map<string, number>();
      data.forEach((e) => counts.set(e.crewId, (counts.get(e.crewId) ?? 0) + 1));
      const crewList = Array.from(counts.entries())
        .map(([id, count]) => ({ id, count }))
        .sort((a, b) => b.count - a.count);
      setCrews(crewList);
      // If the current selection isn't present, default to the largest crew
      if (crewList.length && !counts.has(selectedCrew)) {
        setSelectedCrew(crewList[0].id);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    // Show every employee in the selected crew (or all crews), sorted by name
    setEmployees(
      allEmployees
        .filter((e) => selectedCrew === 'ALL' || e.crewId === selectedCrew)
        .sort((a, b) => a.name.localeCompare(b.name))
    );
  }, [selectedCrew, allEmployees]);

  // All dates within the current pay period, defaulting selection to the last day.
  const periodDates = buildDateList(period?.startDate, period?.endDate);
  useEffect(() => {
    if (periodDates.length && !periodDates.includes(selectedDate)) {
      setSelectedDate(periodDates[periodDates.length - 1]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [period]);

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

  const fileRef = useRef<HTMLInputElement>(null);

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

  // ---- Excel / CSV import --------------------------------------------------
  // Expected columns (header row, case-insensitive): Name, AM IN, AM OUT,
  // PM IN, PM OUT, OT IN, OT OUT. Rows are matched to workers by name.
  const handleImportClick = () => fileRef.current?.click();

  const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow re-selecting the same file
    if (!file) return;
    try {
      const text = await file.text();
      const table = parseCsv(text).filter((r) => r.some((c) => c.trim() !== ''));
      if (table.length < 2) {
        alert(t('att.importEmpty'));
        return;
      }
      const header = table[0].map((h) => h.trim().toLowerCase());
      const col = (...names: string[]) =>
        header.findIndex((h) => names.includes(h));
      const iName = col('name', '성명', '이름');
      const iAmIn = col('am in', 'amin');
      const iAmOut = col('am out', 'amout');
      const iPmIn = col('pm in', 'pmin');
      const iPmOut = col('pm out', 'pmout');
      const iOtIn = col('ot in', 'otin');
      const iOtOut = col('ot out', 'otout');
      if (iName < 0) {
        alert(t('att.importNoName'));
        return;
      }
      const at = (r: string[], i: number) => (i >= 0 ? (r[i] ?? '').trim() : '');
      const byName = new Map(rows.map((row, idx) => [row.employee.name.trim().toLowerCase(), idx]));
      const next = [...rows];
      let matched = 0;
      for (const r of table.slice(1)) {
        const key = at(r, iName).toLowerCase();
        const idx = byName.get(key);
        if (idx === undefined) continue;
        matched++;
        const amIn = at(r, iAmIn) || next[idx].amIn;
        const amOut = at(r, iAmOut) || next[idx].amOut;
        const pmIn = at(r, iPmIn) || next[idx].pmIn;
        const pmOut = at(r, iPmOut) || next[idx].pmOut;
        const otIn = at(r, iOtIn);
        const otOut = at(r, iOtOut);
        next[idx] = {
          ...next[idx],
          amIn,
          amOut,
          pmIn,
          pmOut,
          otIn: otIn || next[idx].otIn,
          otOut: otOut || next[idx].otOut,
          workedHours: otIn ? 10.0 : 8.0,
        };
      }
      setRows(next);
      alert(`${t('att.imported')} ${matched} / ${table.length - 1}`);
    } catch {
      alert(t('att.importError'));
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
          <option value="ALL">
            {t('att.allCrews')} ({allEmployees.length}{t('att.people')})
          </option>
          {crews.map((c) => (
            <option key={c.id} value={c.id}>
              {c.id} ({c.count}{t('att.people')})
            </option>
          ))}
        </select>

        <select
          value={selectedDate}
          onChange={(e) => setSelectedDate(e.target.value)}
          className="border border-line rounded-lg px-3 py-2 text-sm bg-white"
        >
          {periodDates.map((d) => {
            const dow = t(DOW_KEYS[new Date(d + 'T00:00:00').getDay()] as Parameters<typeof t>[0]);
            return (
              <option key={d} value={d}>
                {t('att.date')} {d} ({dow})
              </option>
            );
          })}
        </select>

        <div className="flex-1" />

        <input
          ref={fileRef}
          type="file"
          accept=".csv,text/csv"
          className="hidden"
          onChange={handleImportFile}
        />
        <button className="btn gray" onClick={handleImportClick}>
          {t('att.excelImport')}
        </button>
        <button className="btn ghost" onClick={handleSave}>
          {t('att.saveDraft')}
        </button>
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
                <th className="freeze-col">{t('att.thName')}</th>
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
                  <td className="freeze-col">{row.employee.name}</td>
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
