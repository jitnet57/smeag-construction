import { useState, useEffect } from 'react';
import type { PayPeriod, Employee, AttendanceRecord, PayslipResult } from '@brightem/shared';
import { api } from '../api';
import { useI18n } from '../i18n';

interface Props {
  period: PayPeriod | null;
}

interface CrewStat {
  crewId: string;
  count: number;
  avgAttendance: number;
  attendanceRate: number;
  weeklyGross: number;
  status: 'ok' | 'half' | 'abs';
}

interface DayBar {
  md: string;
  dowKey: string;
  date: string;
  count: number;
  pct: number;
}

const DOW_KEYS = ['dow.sun', 'dow.mon', 'dow.tue', 'dow.wed', 'dow.thu', 'dow.fri', 'dow.sat'];

export default function Dashboard({ period }: Props): JSX.Element {
  const { t } = useI18n();
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [attendance, setAttendance] = useState<AttendanceRecord[]>([]);
  const [payslips, setPayslips] = useState<PayslipResult[]>([]);

  useEffect(() => {
    api.getEmployees().then(setEmployees);
  }, []);

  useEffect(() => {
    if (!period) return;
    api.getAttendance(period.id).then(setAttendance);
    api.getPayroll(period.id).then(setPayslips);
  }, [period]);

  // ---- Derive KPIs and charts from real data ----
  const totalEmployees = employees.length;

  // Present = any status other than "absent" (full or half day counts as present).
  const dates = Array.from(new Set(attendance.map((a) => a.date))).sort();
  const numDays = dates.length || 1;

  const presentByDate = new Map<string, number>();
  const presentByEmp = new Map<string, number>();
  attendance.forEach((a) => {
    if (a.status !== 'absent') {
      presentByDate.set(a.date, (presentByDate.get(a.date) ?? 0) + 1);
      presentByEmp.set(a.employeeId, (presentByEmp.get(a.employeeId) ?? 0) + 1);
    }
  });

  const maxCount = Math.max(1, ...dates.map((d) => presentByDate.get(d) ?? 0));
  const dayBars: DayBar[] = dates.map((d) => {
    const dt = new Date(d + 'T00:00:00');
    const count = presentByDate.get(d) ?? 0;
    return {
      date: d,
      dowKey: DOW_KEYS[dt.getDay()],
      md: `${dt.getMonth() + 1}/${dt.getDate()}`,
      count,
      pct: count / maxCount,
    };
  });

  const totalPresent = dates.reduce((s, d) => s + (presentByDate.get(d) ?? 0), 0);
  const avgAttendance = totalPresent / numDays;
  const attRate = totalEmployees ? (totalPresent / (totalEmployees * numDays)) * 100 : 0;

  const weeklyGross = payslips.reduce((s, p) => s + p.grossPay, 0);
  const totalDeductions = payslips.reduce((s, p) => s + p.totalDeductions, 0);
  const totalManHours = payslips.reduce((s, p) => s + p.workedDays, 0) * 8;

  // ---- Crew summary from real data ----
  const grossByEmp = new Map(payslips.map((p) => [p.employeeId, p.grossPay]));
  const crewAgg = new Map<string, { count: number; present: number; gross: number }>();
  employees.forEach((e) => {
    const c = crewAgg.get(e.crewId) ?? { count: 0, present: 0, gross: 0 };
    c.count += 1;
    c.present += presentByEmp.get(e.id) ?? 0;
    c.gross += grossByEmp.get(e.id) ?? 0;
    crewAgg.set(e.crewId, c);
  });
  const crewStats: CrewStat[] = Array.from(crewAgg.entries())
    .map(([crewId, c]) => {
      const rate = c.count ? (c.present / (c.count * numDays)) * 100 : 0;
      return {
        crewId,
        count: c.count,
        avgAttendance: Math.round((c.present / numDays) * 10) / 10,
        attendanceRate: Math.round(rate * 10) / 10,
        weeklyGross: Math.round(c.gross),
        status: (rate >= 80 ? 'ok' : rate >= 70 ? 'half' : 'abs') as 'ok' | 'half' | 'abs',
      };
    })
    .sort((a, b) => b.count - a.count);

  const getPillClass = (status: string) => {
    switch (status) {
      case 'ok':
        return 'pill ok';
      case 'half':
        return 'pill half';
      case 'abs':
        return 'pill abs';
      default:
        return 'pill';
    }
  };

  const getStatusLabel = (status: string) => {
    switch (status) {
      case 'ok':
        return t('dash.stOk');
      case 'half':
        return t('dash.stHalf');
      case 'abs':
        return t('dash.stAbs');
      default:
        return status;
    }
  };

  return (
    <div className="w-full">
      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3.5 mb-5">
        <div className="card">
          <div className="text-xs text-muted">{t('dash.registeredWorkers')}</div>
          <div className="text-2xl font-bold text-dark mt-1">
            {totalEmployees}
            <small className="text-base text-primary">{t('dash.unitPeople')}</small>
          </div>
          <div className="text-xs mt-1">
            {crewStats.length} {t('dash.crewsRunning')}
          </div>
        </div>

        <div className="card">
          <div className="text-xs text-muted">{t('dash.avgDaily')}</div>
          <div className="text-2xl font-bold text-dark mt-1">
            {avgAttendance.toFixed(1)}
            <small className="text-base text-primary">{t('dash.unitPeople')}</small>
          </div>
          <div className="text-xs mt-1 up">
            {t('dash.attRate')} {attRate.toFixed(1)}%
          </div>
        </div>

        <div className="card">
          <div className="text-xs text-muted">{t('dash.weeklyGross')}</div>
          <div className="text-2xl font-bold text-dark mt-1">
            ₱ {Math.round(weeklyGross).toLocaleString()}
          </div>
          <div className="text-xs mt-1">
            {t('dash.workedManHr')} {totalManHours.toLocaleString()} man-hr
          </div>
        </div>

        <div className="card">
          <div className="text-xs text-muted">{t('dash.totalDeductions')}</div>
          <div className="text-2xl font-bold text-dark mt-1">
            ₱ {Math.round(totalDeductions).toLocaleString()}
          </div>
          <div className="text-xs mt-1 down">{t('dash.deductNote')}</div>
        </div>
      </div>

      {/* Manpower Chart */}
      <div className="panel">
        <h3 className="text-sm font-bold text-dark mb-3.5">
          <span className="inline-block w-1 h-4 bg-primary rounded mr-2" />
          {t('dash.manpowerTitle')}
        </h3>
        <div className="flex items-end gap-3.5 h-40 py-2.5">
          {dayBars.map((bar) => (
            <div key={bar.date} className="flex-1 flex flex-col items-center gap-1.5">
              <div className="text-xs font-bold text-dark">{bar.count}</div>
              <div
                className="w-full bg-gradient-to-t from-primary to-blue-400 rounded-t"
                style={{ height: `${bar.pct * 140}px` }}
              />
              <div className="text-xs text-muted">
                {bar.md} {t(bar.dowKey as Parameters<typeof t>[0])}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Crew Summary Table */}
      <div className="panel">
        <h3 className="text-sm font-bold text-dark mb-3">
          <span className="inline-block w-1 h-4 bg-primary rounded mr-2" />
          {t('dash.crewStatus')}
        </h3>
        <div className="overflow-x-auto">
          <table>
            <thead>
              <tr>
                <th>{t('dash.thCrew')}</th>
                <th className="text-center">{t('dash.thHeadcount')}</th>
                <th className="text-center">{t('dash.thAvgAtt')}</th>
                <th className="text-center">{t('dash.thAttRate')}</th>
                <th className="text-right">{t('dash.thWeeklySub')}</th>
                <th className="text-center">{t('dash.thStatus')}</th>
              </tr>
            </thead>
            <tbody>
              {crewStats.map((crew) => (
                <tr key={crew.crewId}>
                  <td>{crew.crewId}</td>
                  <td className="text-center">{crew.count}</td>
                  <td className="text-center">{crew.avgAttendance}</td>
                  <td className="text-center">{crew.attendanceRate}%</td>
                  <td className="text-right">₱ {crew.weeklyGross.toLocaleString()}</td>
                  <td className="text-center">
                    <span className={getPillClass(crew.status)}>
                      {getStatusLabel(crew.status)}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
