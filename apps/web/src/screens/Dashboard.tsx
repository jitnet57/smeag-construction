import { useState, useEffect, Fragment } from 'react';
import type {
  PayPeriod,
  Employee,
  AttendanceRecord,
  PayslipResult,
  MaterialReadiness,
  UnitProgress,
  UnitWorkItem,
} from '@brightem/shared';
import { UNIT_WORK_ITEMS } from '@brightem/shared';
import { api } from '../api';
import { useI18n } from '../i18n';
import type { TKey } from '../i18n';

const FLOORS = [4, 5, 6, 7, 8, 9, 10, 11];
const ROOMS_PER_FLOOR = 26;

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
const ALL_CREWS = '__ALL__';

export default function Dashboard({ period }: Props): JSX.Element {
  const { t } = useI18n();
  const [allEmployees, setAllEmployees] = useState<Employee[]>([]);
  const [attendance, setAttendance] = useState<AttendanceRecord[]>([]);
  const [payslips, setPayslips] = useState<PayslipResult[]>([]);
  const [selectedCrew, setSelectedCrew] = useState(ALL_CREWS);
  const [expandedCrew, setExpandedCrew] = useState<string | null>(null);

  // Building-wide material readiness + unit progress (all floors), for the
  // material-delivery and work-progress summaries. These are floor-based, not
  // worker-based, so the crew filter does not apply to them.
  const [materialData, setMaterialData] = useState<MaterialReadiness[]>([]);
  const [unitData, setUnitData] = useState<UnitProgress[]>([]);
  const [openMat, setOpenMat] = useState<UnitWorkItem | null>(null);
  const [openWork, setOpenWork] = useState<UnitWorkItem | null>(null);

  useEffect(() => {
    api.getEmployees().then(setAllEmployees);
    Promise.all(FLOORS.map((f) => api.getMaterialReadiness(f))).then((lists) =>
      setMaterialData(lists.flat())
    );
    Promise.all(FLOORS.map((f) => api.getUnitProgress(f))).then((lists) =>
      setUnitData(lists.flat())
    );
  }, []);

  useEffect(() => {
    if (!period) return;
    api.getAttendance(period.id).then(setAttendance);
    api.getPayroll(period.id).then(setPayslips);
  }, [period]);

  // ---- Crew list (from all employees) for the filter dropdown ----
  const crewCounts = new Map<string, number>();
  allEmployees.forEach((e) => crewCounts.set(e.crewId, (crewCounts.get(e.crewId) ?? 0) + 1));
  const crewList = Array.from(crewCounts.entries())
    .map(([id, count]) => ({ id, count }))
    .sort((a, b) => b.count - a.count);

  // ---- Apply the crew filter to every downstream dataset ----
  const empIdSet = new Set(
    allEmployees.filter((e) => selectedCrew === ALL_CREWS || e.crewId === selectedCrew).map((e) => e.id)
  );
  const employees = allEmployees.filter((e) => empIdSet.has(e.id));
  const fAttendance = attendance.filter((a) => empIdSet.has(a.employeeId));
  const fPayslips = payslips.filter((p) => empIdSet.has(p.employeeId));

  // ---- Derive KPIs and charts from real data ----
  const totalEmployees = employees.length;

  // Present = any status other than "absent" (full or half day counts as present).
  const dates = Array.from(new Set(fAttendance.map((a) => a.date))).sort();
  const numDays = dates.length || 1;

  const presentByDate = new Map<string, number>();
  const presentByEmp = new Map<string, number>();
  fAttendance.forEach((a) => {
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

  const weeklyGross = fPayslips.reduce((s, p) => s + p.grossPay, 0);
  const totalDeductions = fPayslips.reduce((s, p) => s + p.totalDeductions, 0);
  const totalManHours = fPayslips.reduce((s, p) => s + p.workedDays, 0) * 8;

  // ---- Crew summary from real data ----
  const grossByEmp = new Map(fPayslips.map((p) => [p.employeeId, p.grossPay]));
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

  // Per-worker detail for a crew (shown when a crew row is expanded).
  const crewMembers = (crewId: string) =>
    employees
      .filter((e) => e.crewId === crewId)
      .map((e) => ({
        id: e.id,
        name: e.name,
        position: e.position,
        present: presentByEmp.get(e.id) ?? 0,
        gross: Math.round(grossByEmp.get(e.id) ?? 0),
      }))
      .sort((a, b) => b.present - a.present || b.gross - a.gross);

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

  // ---- Material delivery summary (per material, aggregated over floors) ----
  const roomsPerMaterial = FLOORS.length * ROOMS_PER_FLOOR; // 208
  const matSummary = UNIT_WORK_ITEMS.map((mat) => {
    const perFloor = FLOORS.map((f) => {
      const row = materialData.find((m) => m.material === mat && m.floor === f);
      return {
        floor: f,
        stage: row?.stage ?? 'pending',
        delivered: row?.deliveredRooms?.length ?? 0,
        ongoing: row?.ongoingRooms?.length ?? 0,
      };
    });
    const delivered = perFloor.reduce((s, p) => s + p.delivered, 0);
    const ongoing = perFloor.reduce((s, p) => s + p.ongoing, 0);
    return { mat, perFloor, delivered, ongoing, total: roomsPerMaterial };
  });
  const matDeliveredRooms = matSummary.reduce((s, m) => s + m.delivered, 0);
  const matTotalRooms = UNIT_WORK_ITEMS.length * roomsPerMaterial; // 1872
  const matPct = matTotalRooms ? (matDeliveredRooms / matTotalRooms) * 100 : 0;

  // ---- Work progress summary (per work item, aggregated over floors) ----
  const workSummary = UNIT_WORK_ITEMS.map((item) => {
    const rows = unitData.filter((u) => u.workItem === item);
    const perFloor = FLOORS.map((f) => {
      const fr = rows.filter((r) => r.floor === f);
      return {
        floor: f,
        done: fr.filter((r) => r.status === 'done').length,
        inProgress: fr.filter((r) => r.status === 'in_progress').length,
      };
    });
    const done = rows.filter((r) => r.status === 'done').length;
    const inProgress = rows.filter((r) => r.status === 'in_progress').length;
    return { item, perFloor, done, inProgress, total: roomsPerMaterial };
  });
  const workDoneRooms = workSummary.reduce((s, w) => s + w.done, 0);
  const workTotalRooms = UNIT_WORK_ITEMS.length * roomsPerMaterial; // 1872
  const workPct = workTotalRooms ? (workDoneRooms / workTotalRooms) * 100 : 0;

  const matLabel = (m: UnitWorkItem) => t(`unit.wi.${m}` as TKey);
  const stageLabel = (s: string) => t(`matr.stage.${s}` as TKey);
  const pct = (n: number, d: number) => (d ? Math.round((n / d) * 100) : 0);

  return (
    <div className="w-full">
      {/* Crew filter */}
      <div className="flex gap-2 items-center flex-wrap mb-3.5">
        <span className="text-sm text-muted">{t('att.crewSelect')}</span>
        <select
          value={selectedCrew}
          onChange={(e) => setSelectedCrew(e.target.value)}
          className="border border-line rounded-lg px-3 py-2 text-sm bg-white"
        >
          <option value={ALL_CREWS}>{t('pay.allCrews')}</option>
          {crewList.map((c) => (
            <option key={c.id} value={c.id}>
              {c.id} ({c.count})
            </option>
          ))}
        </select>
      </div>

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

      {/* Overall Summary: material delivery + work progress */}
      <div className="panel">
        <h3 className="text-sm font-bold text-dark mb-3.5">
          <span className="inline-block w-1 h-4 bg-primary rounded mr-2" />
          {t('dash.overviewTitle')}
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
          <div className="rounded-lg border border-line p-4">
            <div className="flex items-baseline justify-between">
              <span className="text-xs text-muted">📦 {t('dash.matDeliveryKpi')}</span>
              <span className="text-2xl font-bold text-dark">{matPct.toFixed(1)}%</span>
            </div>
            <div className="mt-2 h-2.5 w-full overflow-hidden rounded-full bg-gray-100">
              <div
                className="h-full rounded-full bg-gradient-to-r from-green-400 to-green-600"
                style={{ width: `${matPct}%` }}
              />
            </div>
            <div className="mt-1.5 text-xs text-muted">
              {matDeliveredRooms.toLocaleString()} / {matTotalRooms.toLocaleString()}{' '}
              {t('dash.roomsDeliveredShort')}
            </div>
          </div>
          <div className="rounded-lg border border-line p-4">
            <div className="flex items-baseline justify-between">
              <span className="text-xs text-muted">🏗️ {t('dash.workProgressKpi')}</span>
              <span className="text-2xl font-bold text-dark">{workPct.toFixed(1)}%</span>
            </div>
            <div className="mt-2 h-2.5 w-full overflow-hidden rounded-full bg-gray-100">
              <div
                className="h-full rounded-full bg-gradient-to-r from-blue-400 to-primary"
                style={{ width: `${workPct}%` }}
              />
            </div>
            <div className="mt-1.5 text-xs text-muted">
              {workDoneRooms.toLocaleString()} / {workTotalRooms.toLocaleString()}{' '}
              {t('dash.itemsDoneShort')}
            </div>
          </div>
        </div>
      </div>

      {/* Material Delivery Status (per material, expandable) */}
      <div className="panel">
        <h3 className="text-sm font-bold text-dark mb-1">
          <span className="inline-block w-1 h-4 bg-primary rounded mr-2" />
          {t('dash.matDeliveryTitle')}
        </h3>
        <p className="text-xs text-muted mb-3">{t('dash.clickDetailHint')}</p>
        <div className="overflow-x-auto">
          <table>
            <thead>
              <tr>
                <th>{t('dash.thItem')}</th>
                <th className="text-center">{t('dash.thDelivered')}</th>
                <th className="text-center">{t('dash.thOngoing')}</th>
                <th className="text-center">{t('dash.thProgress')}</th>
              </tr>
            </thead>
            <tbody>
              {matSummary.map((m) => {
                const open = openMat === m.mat;
                const p = pct(m.delivered, m.total);
                return (
                  <Fragment key={m.mat}>
                    <tr
                      className="cursor-pointer"
                      onClick={() => setOpenMat(open ? null : m.mat)}
                    >
                      <td className="font-medium">
                        <span className="inline-block w-4 text-primary">
                          {open ? '▾' : '▸'}
                        </span>
                        {matLabel(m.mat)}
                      </td>
                      <td className="text-center">
                        {m.delivered} / {m.total}
                      </td>
                      <td className="text-center text-amber-700">{m.ongoing || '—'}</td>
                      <td className="text-center">
                        <div className="flex items-center gap-2">
                          <div className="h-2 flex-1 overflow-hidden rounded-full bg-gray-100">
                            <div
                              className="h-full rounded-full bg-green-500"
                              style={{ width: `${p}%` }}
                            />
                          </div>
                          <span className="w-10 text-right text-xs font-semibold">{p}%</span>
                        </div>
                      </td>
                    </tr>
                    {open && (
                      <tr>
                        <td colSpan={4} className="bg-blue-50/50 p-0">
                          <div className="p-3">
                            <table className="text-sm">
                              <thead>
                                <tr>
                                  <th>{t('dash.thFloor')}</th>
                                  <th className="text-center">{t('dash.thStage')}</th>
                                  <th className="text-center">{t('dash.thDelivered')}</th>
                                  <th className="text-center">{t('dash.thOngoing')}</th>
                                </tr>
                              </thead>
                              <tbody>
                                {m.perFloor.map((pf) => (
                                  <tr key={pf.floor}>
                                    <td>
                                      {pf.floor}
                                      {t('unit.floorSuffix')}
                                    </td>
                                    <td className="text-center">{stageLabel(pf.stage)}</td>
                                    <td className="text-center">
                                      {pf.delivered} / {ROOMS_PER_FLOOR}
                                    </td>
                                    <td className="text-center text-amber-700">
                                      {pf.ongoing || '—'}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Work Progress Status (per work item, expandable) */}
      <div className="panel">
        <h3 className="text-sm font-bold text-dark mb-1">
          <span className="inline-block w-1 h-4 bg-primary rounded mr-2" />
          {t('dash.workProgressTitle')}
        </h3>
        <p className="text-xs text-muted mb-3">{t('dash.clickDetailHint')}</p>
        <div className="overflow-x-auto">
          <table>
            <thead>
              <tr>
                <th>{t('dash.thItem')}</th>
                <th className="text-center">{t('dash.thDone')}</th>
                <th className="text-center">{t('dash.thInProgress')}</th>
                <th className="text-center">{t('dash.thProgress')}</th>
              </tr>
            </thead>
            <tbody>
              {workSummary.map((w) => {
                const open = openWork === w.item;
                const p = pct(w.done, w.total);
                return (
                  <Fragment key={w.item}>
                    <tr
                      className="cursor-pointer"
                      onClick={() => setOpenWork(open ? null : w.item)}
                    >
                      <td className="font-medium">
                        <span className="inline-block w-4 text-primary">
                          {open ? '▾' : '▸'}
                        </span>
                        {matLabel(w.item)}
                      </td>
                      <td className="text-center">
                        {w.done} / {w.total}
                      </td>
                      <td className="text-center text-amber-700">{w.inProgress || '—'}</td>
                      <td className="text-center">
                        <div className="flex items-center gap-2">
                          <div className="h-2 flex-1 overflow-hidden rounded-full bg-gray-100">
                            <div
                              className="h-full rounded-full bg-primary"
                              style={{ width: `${p}%` }}
                            />
                          </div>
                          <span className="w-10 text-right text-xs font-semibold">{p}%</span>
                        </div>
                      </td>
                    </tr>
                    {open && (
                      <tr>
                        <td colSpan={4} className="bg-blue-50/50 p-0">
                          <div className="p-3">
                            <table className="text-sm">
                              <thead>
                                <tr>
                                  <th>{t('dash.thFloor')}</th>
                                  <th className="text-center">{t('dash.thDone')}</th>
                                  <th className="text-center">{t('dash.thInProgress')}</th>
                                  <th className="text-center">{t('dash.thProgress')}</th>
                                </tr>
                              </thead>
                              <tbody>
                                {w.perFloor.map((pf) => (
                                  <tr key={pf.floor}>
                                    <td>
                                      {pf.floor}
                                      {t('unit.floorSuffix')}
                                    </td>
                                    <td className="text-center">
                                      {pf.done} / {ROOMS_PER_FLOOR}
                                    </td>
                                    <td className="text-center text-amber-700">
                                      {pf.inProgress || '—'}
                                    </td>
                                    <td className="text-center">
                                      {pct(pf.done, ROOMS_PER_FLOOR)}%
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
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
        <h3 className="text-sm font-bold text-dark mb-1">
          <span className="inline-block w-1 h-4 bg-primary rounded mr-2" />
          {t('dash.crewStatus')}
        </h3>
        <p className="text-xs text-muted mb-3">{t('dash.crewClickHint')}</p>
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
              {crewStats.map((crew) => {
                const open = expandedCrew === crew.crewId;
                return (
                  <Fragment key={crew.crewId}>
                    <tr
                      className="cursor-pointer"
                      onClick={() =>
                        setExpandedCrew(open ? null : crew.crewId)
                      }
                    >
                      <td className="font-medium">
                        <span className="inline-block w-4 text-primary">
                          {open ? '▾' : '▸'}
                        </span>
                        {crew.crewId}
                      </td>
                      <td className="text-center">{crew.count}</td>
                      <td className="text-center">{crew.avgAttendance}</td>
                      <td className="text-center">{crew.attendanceRate}%</td>
                      <td className="text-right">
                        ₱ {crew.weeklyGross.toLocaleString()}
                      </td>
                      <td className="text-center">
                        <span className={getPillClass(crew.status)}>
                          {getStatusLabel(crew.status)}
                        </span>
                      </td>
                    </tr>
                    {open && (
                      <tr>
                        <td colSpan={6} className="bg-blue-50/50 p-0">
                          <div className="p-3">
                            <table className="text-sm">
                              <thead>
                                <tr>
                                  <th>{t('dash.detName')}</th>
                                  <th>{t('dash.detPosition')}</th>
                                  <th className="text-center">
                                    {t('dash.detPresent')}
                                  </th>
                                  <th className="text-right">
                                    {t('dash.detGross')}
                                  </th>
                                </tr>
                              </thead>
                              <tbody>
                                {crewMembers(crew.crewId).map((m) => (
                                  <tr key={m.id}>
                                    <td>{m.name}</td>
                                    <td>{m.position}</td>
                                    <td className="text-center">
                                      {m.present} / {numDays}
                                    </td>
                                    <td className="text-right">
                                      ₱ {m.gross.toLocaleString()}
                                    </td>
                                  </tr>
                                ))}
                                {crewMembers(crew.crewId).length === 0 && (
                                  <tr>
                                    <td
                                      colSpan={4}
                                      className="text-center text-muted py-2"
                                    >
                                      —
                                    </td>
                                  </tr>
                                )}
                              </tbody>
                            </table>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
