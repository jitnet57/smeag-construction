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

type Bi = { en: string; ko: string };

// General industry-tendency comparison (Philippines / Korea / Overseas) used in
// the "Construction Assessment" panel. Broad tendencies, not absolute claims.
const COMPARE_ROWS: { dim: Bi; ph: Bi; kr: Bi; other: Bi }[] = [
  {
    dim: { en: 'Schedule & productivity', ko: '공기 · 생산성' },
    ph: {
      en: 'Labor-intensive pace; large crews absorb volume; rainy season & typhoons (Jun–Nov) add variability; low labor cost favors manual methods.',
      ko: '노동집약적 진행, 다인력 투입으로 물량 소화. 우기·태풍(6~11월)으로 공정 변동성이 크고, 낮은 인건비로 수작업 비중이 높음.',
    },
    kr: {
      en: 'Tight CPM scheduling, high mechanization/prefab, night & crash work to shorten duration; high wages push productivity metrics.',
      ko: '촘촘한 공정관리(CPM), 기계화·프리팹 비중 높음, 야간·돌관작업으로 공기 단축. 높은 인건비로 생산성 지표를 중시.',
    },
    other: {
      en: 'Strict contractual milestones/liquidated damages, BIM & scheduling software; safety/environmental rules moderate speed.',
      ko: '계약상 공기·지체상금(LD) 엄격, BIM·공정 소프트웨어 활용. 안전·환경 규제로 속도가 제약됨.',
    },
  },
  {
    dim: { en: 'Workforce & labor', ko: '인력 · 노무' },
    ph: {
      en: 'Abundant labor, foreman/crew-based teams, daily-wage common, wide skill variance — multiskilling & crew balancing matter.',
      ko: '풍부한 노동력, 포먼·조(crew) 중심 편성, 일당제 비중 큼, 숙련도 편차가 커 멀티스킬·조 편성 관리가 관건.',
    },
    kr: {
      en: 'Aging/short skilled trades, rising migrant labor, mix of direct & subcontract; strong statutory rules (insurance, 52-hr week).',
      ko: '숙련공 고령화·부족, 외국인력 의존 증가, 직영·전문 하도급 혼재. 4대보험·주 52시간 등 제도 관리가 강함.',
    },
    other: {
      en: 'Union/trade influence, license-based assignment, strong wage & benefit regulation.',
      ko: '노조·직능단체 영향, 자격·면허 기반 배치, 임금·복지 규제가 강함.',
    },
  },
  {
    dim: { en: 'Quality & methods', ko: '품질 · 시공' },
    ph: {
      en: 'Manual inspection & field discretion; finishing consistency is the key challenge; material lead-times vary.',
      ko: '수기 검측·현장 재량 비중이 큼. 마감 편차 관리가 핵심 과제이며, 자재 수급 리드타임 변동이 있음.',
    },
    kr: {
      en: 'Standardized specs & inspection, model units + QC gates, strict material grading/certification.',
      ko: '표준시방·검측 체계화, 견본세대·품질검사 단계 강화, 자재 규격·인증이 엄격.',
    },
    other: {
      en: 'Third-party supervision/certification (ISO), performance-based specs, heavy documentation.',
      ko: '제3자 감리·인증(ISO 등), 성능기반 시방, 문서화가 강함.',
    },
  },
  {
    dim: { en: 'Safety & compliance', ko: '안전 · 법규' },
    ph: {
      en: 'DOLE safety rules & building-permit regime; site safety/PPE adoption varies; enforcement is tightening.',
      ko: 'DOLE(노동고용부) 안전규정·건축 인허가 체계. 현장 안전문화·PPE 정착도 편차가 있으나 감독이 강화되는 추세.',
    },
    kr: {
      en: 'OSH Act & Serious Accidents Punishment Act raise accountability; mandatory risk assessment & paperwork.',
      ko: '산업안전보건법·중대재해처벌법으로 안전 책임 강화. 사전 위험성평가·서류 의무가 큼.',
    },
    other: {
      en: 'Strong regimes (US OSHA, UK CDM); safety is a core cost & schedule driver.',
      ko: '강력한 규제(미국 OSHA, 영국 CDM 등). 안전이 공기·비용의 핵심 변수.',
    },
  },
];

// Practical takeaways for this Philippine finishing-works site.
const ASSESS_NOTES: Bi[] = [
  {
    en: 'Keep a schedule buffer for the rainy season & typhoons (a Philippine-specific risk).',
    ko: '우기·태풍에 대비한 공정 버퍼를 확보하세요 (필리핀 특유의 리스크).',
  },
  {
    en: 'Crew/foreman productivity varies widely — use the Multi-Skill matrix to optimize assignments.',
    ko: '조·포먼 단위 생산성 편차가 큽니다 — 멀티스킬 매트릭스로 배치를 최적화하세요.',
  },
  {
    en: 'Material lead-times fluctuate — manage ordering & delivery in real time (see the Material Delivery panel).',
    ko: '자재 리드타임 변동이 큽니다 — 발주·배달 현황을 실시간 관리하세요(위 자재 배달 현황 활용).',
  },
  {
    en: 'Control floor-by-floor finishing variance with per-room inspection and photo records.',
    ko: '층별 마감 편차는 방별 검측·사진 기록으로 관리하세요.',
  },
  {
    en: 'Align Korean HQ standards with local practice up front — agree on inspection criteria & documentation early.',
    ko: '한국 본사 기준과 현지 관행 차이는 검측 기준·서류를 사전에 합의해 두세요.',
  },
];

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
  const { t, lang } = useI18n();
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
  const [showCompare, setShowCompare] = useState(false);

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
  const L = (b: Bi) => b[lang];

  // ---- Auto diagnosis from this site's live metrics ----
  type Tone = 'ok' | 'warn' | 'bad';
  const band = (p: number): Tone => (p >= 80 ? 'ok' : p >= 50 ? 'warn' : 'bad');
  const diagnosis: { tone: Tone; text: Bi }[] = [];

  const mp = matPct.toFixed(0);
  diagnosis.push(
    band(matPct) === 'ok'
      ? { tone: 'ok', text: { en: `Material delivery is on track at ${mp}%.`, ko: `자재 배달이 ${mp}%로 순조롭게 진행되고 있습니다.` } }
      : band(matPct) === 'warn'
        ? { tone: 'warn', text: { en: `Material delivery is mid-way at ${mp}% — keep watching order & delivery lead times.`, ko: `자재 배달이 ${mp}%로 진행 중입니다. 발주·배달 리드타임을 계속 점검하세요.` } }
        : { tone: 'bad', text: { en: `Material delivery is still early at ${mp}% — accelerate ordering to avoid delays.`, ko: `자재 배달이 ${mp}%로 초기 단계입니다. 공정 지연을 막으려면 발주를 서두르세요.` } }
  );

  const wp = workPct.toFixed(0);
  diagnosis.push(
    band(workPct) === 'ok'
      ? { tone: 'ok', text: { en: `Finishing work is well advanced at ${wp}%.`, ko: `마감 작업이 ${wp}%로 상당히 진척됐습니다.` } }
      : band(workPct) === 'warn'
        ? { tone: 'warn', text: { en: `Finishing work is in progress at ${wp}%.`, ko: `마감 작업이 ${wp}%로 진행 중입니다.` } }
        : { tone: 'bad', text: { en: `Finishing work is at an early stage (${wp}%).`, ko: `마감 작업이 초기 단계입니다(${wp}%).` } }
  );

  const ar = attRate.toFixed(0);
  diagnosis.push(
    attRate >= 90
      ? { tone: 'ok', text: { en: `Attendance is strong at ${ar}%.`, ko: `출근율이 ${ar}%로 양호합니다.` } }
      : attRate >= 80
        ? { tone: 'warn', text: { en: `Attendance is ${ar}% — watch crews trending low.`, ko: `출근율이 ${ar}%입니다. 출근이 낮은 조를 주시하세요.` } }
        : { tone: 'bad', text: { en: `Attendance is low at ${ar}% — this may bottleneck progress.`, ko: `출근율이 ${ar}%로 낮습니다. 공정 병목이 될 수 있습니다.` } }
  );

  const gap = matPct - workPct;
  diagnosis.push(
    gap >= 20
      ? { tone: 'warn', text: { en: 'Materials are ahead of installation — add crews so work catches up to delivered materials.', ko: '자재는 준비됐으나 작업이 뒤따르지 못하고 있습니다. 인력을 보강해 작업을 자재에 맞추세요.' } }
      : gap <= -20
        ? { tone: 'warn', text: { en: 'Work is outpacing material supply — prioritize ordering to avoid a material bottleneck.', ko: '작업이 자재 공급을 앞서고 있어 자재 병목이 우려됩니다. 발주를 우선하세요.' } }
        : { tone: 'ok', text: { en: 'Material supply and installation are well balanced.', ko: '자재 공급과 작업 진행이 균형을 이루고 있습니다.' } }
  );

  const toneDot = (tone: Tone) =>
    tone === 'ok' ? 'bg-green-500' : tone === 'warn' ? 'bg-amber-500' : 'bg-red-500';

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

      {/* Construction Assessment · Cross-country comparison */}
      <div className="panel">
        <h3 className="text-sm font-bold text-dark mb-3">
          <span className="inline-block w-1 h-4 bg-primary rounded mr-2" />
          {t('dash.assessTitle')}
        </h3>

        {/* Auto diagnosis from live metrics */}
        <div className="rounded-lg border border-line bg-gray-50 p-4">
          <div className="text-xs font-bold text-dark mb-2">🩺 {t('dash.assessDiagnosis')}</div>
          <ul className="space-y-1.5">
            {diagnosis.map((d, i) => (
              <li key={i} className="flex items-start gap-2 text-sm text-dark">
                <span
                  className={`mt-1.5 h-2 w-2 flex-shrink-0 rounded-full ${toneDot(d.tone)}`}
                />
                <span>{L(d.text)}</span>
              </li>
            ))}
          </ul>
        </div>

        <button
          onClick={() => setShowCompare((v) => !v)}
          className="mt-3 rounded-md border border-line bg-white px-3 py-1.5 text-xs font-semibold text-primary hover:bg-gray-50"
        >
          {showCompare ? `▾ ${t('dash.assessLess')}` : `▸ ${t('dash.assessMore')}`}
        </button>

        {showCompare && (
          <div className="mt-3">
            <div className="text-xs font-bold text-dark mb-1">🌏 {t('dash.assessCompare')}</div>
            <p className="text-[11px] text-muted mb-2">{t('dash.assessDisclaimer')}</p>
            <div className="overflow-x-auto">
              <table className="text-sm">
                <thead>
                  <tr>
                    <th className="whitespace-nowrap">{t('dash.colDim')}</th>
                    <th>🇵🇭 {t('dash.colPh')}</th>
                    <th>🇰🇷 {t('dash.colKr')}</th>
                    <th>🌐 {t('dash.colOther')}</th>
                  </tr>
                </thead>
                <tbody>
                  {COMPARE_ROWS.map((row, i) => (
                    <tr key={i} className="align-top">
                      <td className="whitespace-nowrap font-semibold text-dark">
                        {L(row.dim)}
                      </td>
                      <td className="min-w-[180px] text-xs leading-relaxed">{L(row.ph)}</td>
                      <td className="min-w-[180px] text-xs leading-relaxed">{L(row.kr)}</td>
                      <td className="min-w-[180px] text-xs leading-relaxed">{L(row.other)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-4">
              <div className="text-xs font-bold text-amber-900 mb-2">
                📌 {t('dash.assessNotes')}
              </div>
              <ul className="space-y-1.5">
                {ASSESS_NOTES.map((n, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm text-dark">
                    <span className="mt-1.5 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-amber-500" />
                    <span>{L(n)}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}
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
                          <div className="p-3 overflow-x-auto">
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
                          <div className="p-3 overflow-x-auto">
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
                          <div className="p-3 overflow-x-auto">
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
