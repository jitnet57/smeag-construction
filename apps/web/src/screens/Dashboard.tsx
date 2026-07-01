import { useState } from 'react';
import { useI18n } from '../i18n';

interface CrewStat {
  crewId: string;
  crewName: string;
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

export default function Dashboard(): JSX.Element {
  const { t } = useI18n();
  const [totalEmployees] = useState(143);
  const [avgAttendance] = useState(110.5);
  const [totalManHours] = useState(5246);
  const [weeklyGross] = useState(486720);
  const [totalDeductions] = useState(62410);

  const [dayBars] = useState<DayBar[]>([
    { md: '6/19', dowKey: 'dow.fri', date: '2026-06-19', count: 116, pct: 1.0 },
    { md: '6/20', dowKey: 'dow.sat', date: '2026-06-20', count: 109, pct: 0.86 },
    { md: '6/22', dowKey: 'dow.mon', date: '2026-06-22', count: 102, pct: 0.72 },
    { md: '6/23', dowKey: 'dow.tue', date: '2026-06-23', count: 111, pct: 0.9 },
    { md: '6/24', dowKey: 'dow.wed', date: '2026-06-24', count: 114, pct: 0.96 },
    { md: '6/25', dowKey: 'dow.thu', date: '2026-06-25', count: 111, pct: 0.9 },
  ]);

  const [crewStats] = useState<CrewStat[]>([
    {
      crewId: 'ANTHONY',
      crewName: 'ANTHONY',
      count: 44,
      avgAttendance: 36.8,
      attendanceRate: 83.7,
      weeklyGross: 162900,
      status: 'ok',
    },
    {
      crewId: 'FOREMAN',
      crewName: 'FOREMAN',
      count: 25,
      avgAttendance: 19.5,
      attendanceRate: 78.0,
      weeklyGross: 85900,
      status: 'ok',
    },
    {
      crewId: 'HANZ',
      crewName: 'HANZ',
      count: 24,
      avgAttendance: 17.7,
      attendanceRate: 73.6,
      weeklyGross: 78100,
      status: 'half',
    },
    {
      crewId: 'JERRY',
      crewName: 'JERRY',
      count: 14,
      avgAttendance: 11.8,
      attendanceRate: 84.5,
      weeklyGross: 51000,
      status: 'ok',
    },
    {
      crewId: 'NANTE',
      crewName: 'NANTE',
      count: 14,
      avgAttendance: 10.8,
      attendanceRate: 77.4,
      weeklyGross: 47400,
      status: 'ok',
    },
    {
      crewId: 'RICO',
      crewName: 'RICO',
      count: 13,
      avgAttendance: 10.7,
      attendanceRate: 82.1,
      weeklyGross: 47500,
      status: 'ok',
    },
    {
      crewId: 'JASON',
      crewName: 'JASON',
      count: 6,
      avgAttendance: 3.2,
      attendanceRate: 52.8,
      weeklyGross: 13920,
      status: 'abs',
    },
  ]);

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
      <div className="banner">
        📢 {t('dash.mockBanner')}
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3.5 mb-5">
        <div className="card">
          <div className="text-xs text-muted">{t('dash.registeredWorkers')}</div>
          <div className="text-2xl font-bold text-dark mt-1">
            {totalEmployees}
            <small className="text-base text-primary">{t('dash.unitPeople')}</small>
          </div>
          <div className="text-xs mt-1">{t('dash.crewsRunning')}</div>
        </div>

        <div className="card">
          <div className="text-xs text-muted">{t('dash.avgDaily')}</div>
          <div className="text-2xl font-bold text-dark mt-1">
            {avgAttendance}
            <small className="text-base text-primary">{t('dash.unitPeople')}</small>
          </div>
          <div className="text-xs mt-1 up">{t('dash.attRate')} 78.9%</div>
        </div>

        <div className="card">
          <div className="text-xs text-muted">{t('dash.weeklyGross')}</div>
          <div className="text-2xl font-bold text-dark mt-1">
            ₱ {weeklyGross.toLocaleString()}
          </div>
          <div className="text-xs mt-1">{t('dash.workedManHr')} {totalManHours.toLocaleString()} man-hr</div>
        </div>

        <div className="card">
          <div className="text-xs text-muted">{t('dash.totalDeductions')}</div>
          <div className="text-2xl font-bold text-dark mt-1">
            ₱ {totalDeductions.toLocaleString()}
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
              <div className="text-xs text-muted">{bar.md} {t(bar.dowKey as any)}</div>
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
                  <td>{crew.crewName}</td>
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
