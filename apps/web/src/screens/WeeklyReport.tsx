import { useEffect, useMemo, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import type { Crew, Employee, PayPeriod, PayslipLine, PayslipResult } from '@brightem/shared';
import { api } from '../api';
import { onDataChanged } from '../offline';
import { useI18n } from '../i18n';
import { downloadCsv } from '../lib/csv';

// ============================================================================
// WEEKLY REPORT — the weekly payroll workbook (BRIGHTEM-CONSTRUCTION-PAYROLL
// xlsx) as one screen: the same sheet tabs, header colours and fonts, filled
// from the app's own payroll calculation. A view-options menu lets each person
// pick the colour set, font, text size, crew, which tabs show, and whether
// zero cells are blanked. The choices are kept on this device.
// ============================================================================

type TabKey =
  | 'summary'
  | 'sheet'
  | 'attendance'
  | 'absences'
  | 'lates'
  | 'overtime'
  | 'holidays'
  | 'drd'
  | 'night'
  | 'canteen';

// Sheet tab names exactly as in the workbook.
const TABS: { key: TabKey; label: string }[] = [
  { key: 'summary', label: 'PAYROLL SUMMARY' },
  { key: 'sheet', label: 'PAYROLL SHEET' },
  { key: 'attendance', label: 'ATTENDANCE' },
  { key: 'absences', label: 'ABSENCES' },
  { key: 'lates', label: 'LATES' },
  { key: 'overtime', label: 'OVERTIME' },
  { key: 'holidays', label: 'HOLIDAYS' },
  { key: 'drd', label: 'DRD' },
  { key: 'night', label: 'NIGHT DIFFERENTIAL' },
  { key: 'canteen', label: 'CANTEEN' },
];

// ---- Colour sets --------------------------------------------------------------
// 'excel' = the workbook's own fills (Office 2007 theme colours with the tints
// the sheets use); the others are alternatives to choose from.
type Role =
  | 'head'      // column headers (PAYROLL SHEET: Olive, lighter 40%)
  | 'title'     // "CONSTRUCTION WORKERS ASSIGNED" banner
  | 'name'      // crew / number / name / position cells
  | 'money'     // computed amount columns (Tan, darker 25%)
  | 'net'       // NET PAY
  | 'gross'     // GROSS SALARY
  | 'ded'       // TOTAL DEDUCTIONS
  | 'incent'    // incentive columns
  | 'present'   // days present
  | 'attHead'   // ATTENDANCE / ABSENCES header
  | 'attRow'
  | 'otHead'    // OVERTIME / DRD header
  | 'ndHead'    // NIGHT DIFFERENTIAL header
  | 'holSpecial'
  | 'holLegal'
  | 'canteenHead'
  | 'total';    // subtotal / total rows

type Palette = Record<Role, string> & { ink: string; grid: string; sheetBg: string };

const PALETTES: Record<string, { en: string; ko: string; p: Palette }> = {
  excel: {
    en: 'Excel (original)',
    ko: '엑셀 원본',
    p: {
      head: '#C3D69B', title: '#FFFF00', name: '#FDE9D9', money: '#C4BD97', net: '#FF9900',
      gross: '#FCD5B4', ded: '#B7DEE8', incent: '#95B3D7', present: '#E6B9B8',
      attHead: '#B8CCE4', attRow: '#FDE9D9', otHead: '#C6D9F1', ndHead: '#8DB4E2',
      holSpecial: '#FFFF00', holLegal: '#92D050', canteenHead: '#C3D69B', total: '#FFFF00',
      ink: '#000000', grid: '#9CA3AF', sheetBg: '#FFFFFF',
    },
  },
  app: {
    en: 'App blue',
    ko: '앱 기본(파랑)',
    p: {
      head: '#DBEAFE', title: '#1E3A8A', name: '#F8FAFC', money: '#EFF6FF', net: '#2563EB',
      gross: '#E0F2FE', ded: '#FEE2E2', incent: '#E0E7FF', present: '#F1F5F9',
      attHead: '#DBEAFE', attRow: '#F8FAFC', otHead: '#DBEAFE', ndHead: '#C7D2FE',
      holSpecial: '#FEF9C3', holLegal: '#FECACA', canteenHead: '#DCFCE7', total: '#E2E8F0',
      ink: '#15304E', grid: '#CBD5E1', sheetBg: '#FFFFFF',
    },
  },
  soft: {
    en: 'Soft pastel',
    ko: '부드러운 파스텔',
    p: {
      head: '#E7F0DC', title: '#FFF6C2', name: '#FFF7F2', money: '#F3F0E6', net: '#FFD9A8',
      gross: '#FFEBDD', ded: '#E3F4F7', incent: '#E5EDF7', present: '#F7E9E9',
      attHead: '#E5EDF7', attRow: '#FFF7F2', otHead: '#E9F0FA', ndHead: '#DCE7F5',
      holSpecial: '#FFF6C2', holLegal: '#E3F2D4', canteenHead: '#E7F0DC', total: '#FFF6C2',
      ink: '#1F2937', grid: '#D1D5DB', sheetBg: '#FFFFFF',
    },
  },
  mono: {
    en: 'Black & white (print)',
    ko: '흑백(인쇄용)',
    p: {
      head: '#E5E5E5', title: '#FFFFFF', name: '#FFFFFF', money: '#FFFFFF', net: '#D4D4D4',
      gross: '#F0F0F0', ded: '#F0F0F0', incent: '#FFFFFF', present: '#FFFFFF',
      attHead: '#E5E5E5', attRow: '#FFFFFF', otHead: '#E5E5E5', ndHead: '#E5E5E5',
      holSpecial: '#F0F0F0', holLegal: '#D4D4D4', canteenHead: '#E5E5E5', total: '#E5E5E5',
      ink: '#000000', grid: '#000000', sheetBg: '#FFFFFF',
    },
  },
  dark: {
    en: 'Dark',
    ko: '다크',
    p: {
      head: '#334155', title: '#854D0E', name: '#1E293B', money: '#1E293B', net: '#C2410C',
      gross: '#7C2D12', ded: '#164E63', incent: '#1E3A8A', present: '#4C1D25',
      attHead: '#1E3A8A', attRow: '#1E293B', otHead: '#1E3A8A', ndHead: '#312E81',
      holSpecial: '#854D0E', holLegal: '#14532D', canteenHead: '#14532D', total: '#854D0E',
      ink: '#F1F5F9', grid: '#475569', sheetBg: '#0F172A',
    },
  },
};

// ---- Font sets ----------------------------------------------------------------
// 'excel' = the workbook's fonts: Berlin Sans FB headers, Calibri cells,
// Arial Narrow on the attendance-type sheets, Arial on the summary.
type FontSet = { head: string; cell: string; narrow: string; summary: string };
const FONTS: Record<string, { en: string; ko: string; f: FontSet }> = {
  excel: {
    en: 'Excel (original)',
    ko: '엑셀 원본',
    f: {
      head: '"Berlin Sans FB Demi", "Berlin Sans FB", "Trebuchet MS", sans-serif',
      cell: 'Calibri, Carlito, "Segoe UI", sans-serif',
      narrow: '"Arial Narrow", "Roboto Condensed", "Liberation Sans Narrow", Arial, sans-serif',
      summary: 'Arial, Helvetica, sans-serif',
    },
  },
  system: {
    en: 'System',
    ko: '시스템 기본',
    f: (() => {
      const s = '-apple-system, "Segoe UI", Roboto, "Noto Sans KR", sans-serif';
      return { head: s, cell: s, narrow: s, summary: s };
    })(),
  },
  arial: {
    en: 'Arial',
    ko: 'Arial',
    f: { head: 'Arial, sans-serif', cell: 'Arial, sans-serif', narrow: '"Arial Narrow", Arial, sans-serif', summary: 'Arial, sans-serif' },
  },
  dotum: {
    en: 'Dotum (돋움)',
    ko: '돋움',
    f: (() => {
      const s = 'Dotum, 돋움, "Apple SD Gothic Neo", "Noto Sans KR", sans-serif';
      return { head: s, cell: s, narrow: s, summary: s };
    })(),
  },
  mono: {
    en: 'Monospace',
    ko: '고정폭',
    f: (() => {
      const s = '"JetBrains Mono", Menlo, Consolas, monospace';
      return { head: s, cell: s, narrow: s, summary: s };
    })(),
  },
};

const SIZES = [
  { v: 0.85, en: 'Small', ko: '작게' },
  { v: 1, en: 'Normal', ko: '보통' },
  { v: 1.2, en: 'Large', ko: '크게' },
  { v: 1.45, en: 'Extra large', ko: '아주 크게' },
];

interface Prefs {
  palette: string;
  font: string;
  size: number;
  crew: string; // '' = all crews
  tabs: TabKey[];
  hideZero: boolean;
  cash: number; // PAYROLL SUMMARY "CASH" on hand
}

const PREFS_KEY = 'brightem.weeklyReport';
const DEFAULT_PREFS: Prefs = {
  palette: 'excel',
  font: 'excel',
  size: 1,
  crew: '',
  tabs: TABS.map((t) => t.key),
  hideZero: true,
  cash: 0,
};

function loadPrefs(): Prefs {
  try {
    const p = JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}') as Partial<Prefs>;
    const merged = { ...DEFAULT_PREFS, ...p };
    if (!PALETTES[merged.palette]) merged.palette = 'excel';
    if (!FONTS[merged.font]) merged.font = 'excel';
    merged.tabs = (merged.tabs ?? []).filter((k) => TABS.some((t) => t.key === k));
    if (!merged.tabs.length) merged.tabs = DEFAULT_PREFS.tabs;
    return merged;
  } catch {
    return DEFAULT_PREFS;
  }
}

// ---- Payslip helpers ------------------------------------------------------------
const line = (lines: PayslipLine[], key: string) => lines.find((l) => l.key === key);
const amt = (lines: PayslipLine[], key: string) => line(lines, key)?.amount ?? 0;
const qty = (lines: PayslipLine[], key: string) => line(lines, key)?.qty ?? 0;
const amtStarts = (lines: PayslipLine[], prefix: string) =>
  lines.filter((l) => l.key.startsWith(prefix)).reduce((s, l) => s + l.amount, 0);

interface Row {
  emp: Employee;
  slip: PayslipResult;
}

// One report column: header text, value getter, colour role, money or count.
interface Col {
  h: string;
  get: (r: Row) => number | string;
  role?: Role;
  money?: boolean;
  bold?: boolean;
  sum?: boolean;
}

function fmt(v: number | string, money: boolean | undefined, hideZero: boolean): string {
  if (typeof v === 'string') return v;
  if (hideZero && Math.abs(v) < 0.005) return money ? '-' : '';
  return money
    ? v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : v.toLocaleString('en-US', { maximumFractionDigits: 2 });
}

// Text colour that stays readable on a given fill.
function inkOn(bg: string, fallback: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(bg);
  if (!m) return fallback;
  const n = parseInt(m[1], 16);
  const lum = (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
  return lum < 0.5 ? '#FFFFFF' : '#000000';
}

export default function WeeklyReport({ period }: { period: PayPeriod | null }) {
  const { lang } = useI18n();
  const L = (en: string, ko: string) => (lang === 'ko' ? ko : en);

  const [prefs, setPrefs] = useState<Prefs>(loadPrefs);
  const [optsOpen, setOptsOpen] = useState(false);
  const [tab, setTab] = useState<TabKey>(() => loadPrefs().tabs[0]);
  const [slips, setSlips] = useState<PayslipResult[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [crews, setCrews] = useState<Crew[]>([]);
  const [busy, setBusy] = useState(false);

  const update = (patch: Partial<Prefs>) =>
    setPrefs((p) => {
      const next = { ...p, ...patch };
      try {
        localStorage.setItem(PREFS_KEY, JSON.stringify(next));
      } catch {
        /* not remembered */
      }
      return next;
    });

  useEffect(() => {
    api.getEmployees().then(setEmployees).catch(() => undefined);
    api.getCrews().then(setCrews).catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!period) return;
    let alive = true;
    setBusy(true);
    api
      .getPayroll(period.id)
      .then((d) => alive && setSlips(d))
      .catch(() => alive && setSlips([]))
      .finally(() => alive && setBusy(false));
    const off = onDataChanged(() => {
      api.getPayroll(period.id).then((d) => alive && setSlips(d)).catch(() => undefined);
    });
    return () => {
      alive = false;
      off();
    };
  }, [period]);

  // Keep the open tab one of the tabs chosen in the options.
  useEffect(() => {
    if (!prefs.tabs.includes(tab)) setTab(prefs.tabs[0]);
  }, [prefs.tabs, tab]);

  const pal = PALETTES[prefs.palette].p;
  const font = FONTS[prefs.font].f;
  const px = (n: number) => `${Math.round(n * prefs.size * 10) / 10}px`;

  // Rows grouped by crew in roster order, like the workbook.
  const groups = useMemo(() => {
    const empMap = new Map(employees.map((e) => [e.id, e]));
    const order = new Map(crews.map((c, i) => [c.id, i]));
    const byCrew = new Map<string, Row[]>();
    for (const slip of slips) {
      const emp = empMap.get(slip.employeeId);
      if (!emp) continue;
      if (prefs.crew && emp.crewId !== prefs.crew) continue;
      const list = byCrew.get(emp.crewId) ?? [];
      list.push({ emp, slip });
      byCrew.set(emp.crewId, list);
    }
    return Array.from(byCrew.entries())
      .sort((a, b) => (order.get(a[0]) ?? 999) - (order.get(b[0]) ?? 999) || a[0].localeCompare(b[0]))
      .map(([crewId, rows]) => ({
        crewId,
        crewName: crews.find((c) => c.id === crewId)?.name ?? crewId,
        rows: rows.sort((a, b) => a.emp.name.localeCompare(b.emp.name)),
      }));
  }, [slips, employees, crews, prefs.crew]);

  const allRows = groups.flatMap((g) => g.rows);

  // ---- Columns per sheet -------------------------------------------------------
  const e = (r: Row) => r.slip.earnings;
  const d = (r: Row) => r.slip.deductions;
  const contrib = (r: Row) =>
    amtStarts(d(r), 'contribution_') + amt(d(r), 'sssDeduction') + amt(d(r), 'pagibigDeduction') + amt(d(r), 'philhealthDeduction');
  const loans = (r: Row) =>
    amt(d(r), 'sssSalaryLoan') + amt(d(r), 'sssCalamityLoan') + amt(d(r), 'pagibigSalaryLoan') + amt(d(r), 'pagibigCalamityLoan') +
    amt(d(r), 'cashAdvance') + amt(d(r), 'employeeLoan');

  const COLS: Record<Exclude<TabKey, 'summary'>, { head: Role; narrow: boolean; cols: Col[] }> = {
    sheet: {
      head: 'head',
      narrow: false,
      cols: [
        { h: 'NET PAY', get: (r) => r.slip.netPay, role: 'net', money: true, bold: true, sum: true },
        { h: 'POSITION', get: (r) => r.emp.position, role: 'name' },
        { h: 'RATE/DAY', get: (r) => r.emp.ratePerDay, money: true, bold: true },
        { h: 'NO.OF WORKING DAYS', get: (r) => r.slip.workedDays, bold: true, sum: true },
        { h: 'BASIC PAY', get: (r) => amt(e(r), 'basic'), role: 'money', money: true, bold: true, sum: true },
        { h: 'DRD #', get: (r) => qty(e(r), 'drdPay'), sum: true },
        { h: 'DRD PAY', get: (r) => amt(e(r), 'drdPay'), role: 'money', money: true, sum: true },
        { h: 'SPECIAL #', get: (r) => qty(e(r), 'specialHolidayPay'), sum: true },
        { h: 'SPECIAL', get: (r) => amt(e(r), 'specialHolidayPay'), role: 'money', money: true, sum: true },
        { h: 'LEGAL #', get: (r) => qty(e(r), 'legalHolidayPay'), sum: true },
        { h: 'LEGAL', get: (r) => amt(e(r), 'legalHolidayPay'), role: 'money', money: true, sum: true },
        { h: 'OT HRS', get: (r) => qty(e(r), 'otRegular'), sum: true },
        { h: 'TOTAL AMOUNT(OT)', get: (r) => amt(e(r), 'otRegular'), role: 'money', money: true, sum: true },
        { h: 'NIGHT DIFF HRS', get: (r) => qty(e(r), 'nightDifferential'), sum: true },
        { h: 'NIGHT DIFF AMOUNT', get: (r) => amt(e(r), 'nightDifferential'), role: 'money', money: true, sum: true },
        { h: 'ADJUSTMENT', get: (r) => amt(e(r), 'adjustment'), money: true, sum: true },
        { h: 'NO. OF DAYS PRESENT', get: (r) => qty(e(r), 'incentive') || r.slip.workedDays, role: 'present', sum: true },
        { h: 'INCENTIVE DAILY RATE', get: (r) => line(e(r), 'incentive')?.rate ?? r.emp.incentiveDailyRate ?? 0, role: 'incent', money: true },
        { h: 'TOTAL INCENTIVE', get: (r) => amt(e(r), 'incentive'), role: 'ded', money: true, sum: true },
        { h: 'ABSENCES #', get: (r) => r.slip.absentDays, sum: true },
        { h: 'LATE/TARDY HRS', get: (r) => qty(e(r), 'lateUndertime'), sum: true },
        { h: 'LATE/TARDY AMOUNT', get: (r) => amt(e(r), 'lateUndertime'), role: 'money', money: true, sum: true },
        { h: 'GROSS SALARY', get: (r) => r.slip.grossPay, role: 'gross', money: true, bold: true, sum: true },
        { h: 'CONTRIBUTIONS', get: contrib, money: true, sum: true },
        { h: 'LOANS', get: loans, money: true, sum: true },
        { h: 'CANTEEN', get: (r) => amt(d(r), 'canteen'), money: true, sum: true },
        { h: 'ADJUSTMENT OVERPAID', get: (r) => amt(d(r), 'overpaid') + amt(d(r), 'adjustmentDeduction'), money: true, sum: true },
        { h: 'TOTAL DEDUCTIONS', get: (r) => r.slip.totalDeductions, role: 'ded', money: true, bold: true, sum: true },
      ],
    },
    attendance: {
      head: 'attHead',
      narrow: true,
      cols: [
        { h: 'NO. OF WORKING DAYS', get: (r) => r.slip.workedDays, role: 'attRow', bold: true, sum: true },
        { h: 'NO. OF DAYS PRESENT', get: (r) => qty(e(r), 'incentive') || r.slip.workedDays, role: 'attRow', sum: true },
        { h: 'ABSENT', get: (r) => r.slip.absentDays, role: 'attRow', sum: true },
        { h: 'LATE (HRS)', get: (r) => qty(e(r), 'lateUndertime'), role: 'attRow', sum: true },
        { h: 'OT (HRS)', get: (r) => qty(e(r), 'otRegular'), role: 'attRow', sum: true },
      ],
    },
    absences: {
      head: 'attHead',
      narrow: true,
      cols: [
        { h: 'RATE/DAY', get: (r) => r.emp.ratePerDay, money: true },
        { h: 'NO. OF ABSENCES', get: (r) => r.slip.absentDays, role: 'attRow', bold: true, sum: true },
        { h: 'AMOUNT', get: (r) => -r.emp.ratePerDay * r.slip.absentDays, role: 'money', money: true, sum: true },
      ],
    },
    lates: {
      head: 'otHead',
      narrow: false,
      cols: [
        { h: 'RATE/HR', get: (r) => r.emp.ratePerDay / 8, money: true },
        { h: 'LATE/UNDERTIME (HRS)', get: (r) => qty(e(r), 'lateUndertime'), bold: true, sum: true },
        { h: 'AMOUNT', get: (r) => amt(e(r), 'lateUndertime'), role: 'money', money: true, sum: true },
      ],
    },
    overtime: {
      head: 'otHead',
      narrow: true,
      cols: [
        { h: 'RATE/DAY', get: (r) => r.emp.ratePerDay, money: true },
        { h: 'REGULAR DAY OT (HRS)', get: (r) => qty(e(r), 'otRegular'), bold: true, sum: true },
        { h: 'TOTAL AMOUNT(OT)', get: (r) => amt(e(r), 'otRegular'), role: 'money', money: true, sum: true },
      ],
    },
    holidays: {
      head: 'holLegal',
      narrow: false,
      cols: [
        { h: 'SPECIAL #', get: (r) => qty(e(r), 'specialHolidayPay'), role: 'holSpecial', sum: true },
        { h: 'SPECIAL (+30%)', get: (r) => amt(e(r), 'specialHolidayPay'), role: 'money', money: true, sum: true },
        { h: 'LEGAL #', get: (r) => qty(e(r), 'legalHolidayPay'), role: 'holLegal', sum: true },
        { h: 'LEGAL (+100%)', get: (r) => amt(e(r), 'legalHolidayPay'), role: 'money', money: true, sum: true },
      ],
    },
    drd: {
      head: 'otHead',
      narrow: true,
      cols: [
        { h: 'DUTY REST DAYS #', get: (r) => qty(e(r), 'drdPay'), bold: true, sum: true },
        { h: 'DRD PAY (+30%)', get: (r) => amt(e(r), 'drdPay'), role: 'money', money: true, sum: true },
      ],
    },
    night: {
      head: 'ndHead',
      narrow: true,
      cols: [
        { h: '# OF HRS', get: (r) => qty(e(r), 'nightDifferential'), bold: true, sum: true },
        { h: 'AMOUNT', get: (r) => amt(e(r), 'nightDifferential'), role: 'money', money: true, sum: true },
      ],
    },
    canteen: {
      head: 'canteenHead',
      narrow: false,
      cols: [
        { h: 'CANTEEN', get: (r) => amt(d(r), 'canteen'), role: 'money', money: true, bold: true, sum: true },
        { h: 'CANTEEN DEBT (BALANCE)', get: (r) => r.emp.canteenDebt ?? 0, money: true, sum: true },
      ],
    },
  };

  // ---- Cell styles -------------------------------------------------------------
  const cell = (bg: string | undefined, opts: { bold?: boolean; family?: string; size?: number; align?: 'left' | 'right' | 'center' } = {}): CSSProperties => {
    const fill = bg ?? pal.sheetBg;
    return {
      background: fill,
      color: bg ? inkOn(fill, pal.ink) : pal.ink,
      border: `1px solid ${pal.grid}`,
      padding: `${px(3)} ${px(6)}`,
      fontWeight: opts.bold ? 700 : 400,
      fontFamily: opts.family ?? font.cell,
      fontSize: px(opts.size ?? 13),
      textAlign: opts.align ?? 'left',
      whiteSpace: 'nowrap',
    };
  };

  const title = (
    <div style={{ fontFamily: font.summary, color: pal.ink, textAlign: 'center', fontWeight: 700, fontSize: px(15), lineHeight: 1.5 }}>
      <div>BRIGHTEM REALTY CORP.</div>
      <div>DATAG MARIBAGO, LAPU LAPU CITY</div>
      <div>PAYROLL PERIOD : {period?.label ?? ''}</div>
      <div>PAYROLL DATE: {period?.payDate ?? ''}</div>
    </div>
  );

  const renderSheet = (key: Exclude<TabKey, 'summary'>) => {
    const def = COLS[key];
    const headFamily = key === 'sheet' ? font.head : def.narrow ? font.narrow : font.cell;
    const bodyFamily = def.narrow ? font.narrow : font.cell;
    const hs = () => cell(pal[def.head], { bold: true, family: headFamily, size: 12, align: 'center' });
    const total = (rows: Row[], c: Col) =>
      c.sum ? rows.reduce((s, r) => s + (Number(c.get(r)) || 0), 0) : '';
    let n = 0;
    return (
      <table style={{ borderCollapse: 'collapse', background: pal.sheetBg }}>
        <thead>
          {key === 'sheet' && (
            <tr>
              <th colSpan={def.cols.length + 4} style={cell(pal.title, { bold: true, family: font.head, size: 18, align: 'center' })}>
                CONSTRUCTION WORKERS ASSIGNED
              </th>
            </tr>
          )}
          <tr>
            <th style={hs()}>TEAM</th>
            <th style={hs()}>NO</th>
            <th style={hs()}>NAME</th>
            <th style={hs()}>NICKNAME</th>
            {def.cols.map((c) => (
              <th key={c.h} style={{ ...hs(), whiteSpace: 'normal', minWidth: px(70) }}>
                {c.h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {groups.map((g) => (
            <GroupRows key={g.crewId}>
              {g.rows.map((r, i) => {
                n += 1;
                return (
                  <tr key={r.emp.id}>
                    {i === 0 && (
                      <td rowSpan={g.rows.length} style={{ ...cell(pal.name, { bold: true, family: font.summary, size: 14, align: 'center' }), verticalAlign: 'middle' }}>
                        {g.crewName}
                      </td>
                    )}
                    <td style={cell(pal.name, { family: font.summary, align: 'center' })}>{n}</td>
                    <td style={cell(pal.name, { family: bodyFamily })}>{r.emp.name}</td>
                    <td style={cell(pal.name, { family: bodyFamily })}>{r.emp.nickname}</td>
                    {def.cols.map((c) => (
                      <td
                        key={c.h}
                        style={cell(c.role ? pal[c.role] : undefined, {
                          bold: c.bold,
                          family: bodyFamily,
                          align: typeof c.get(r) === 'string' ? 'left' : 'right',
                        })}
                      >
                        {fmt(c.get(r), c.money, prefs.hideZero)}
                      </td>
                    ))}
                  </tr>
                );
              })}
              <tr>
                <td colSpan={4} style={cell(pal.total, { bold: true, family: bodyFamily, align: 'right' })}>
                  {g.crewName} {L('SUBTOTAL', '소계')} ({g.rows.length})
                </td>
                {def.cols.map((c) => (
                  <td key={c.h} style={cell(pal.total, { bold: true, family: bodyFamily, align: 'right' })}>
                    {c.sum ? fmt(total(g.rows, c), c.money, prefs.hideZero) : ''}
                  </td>
                ))}
              </tr>
            </GroupRows>
          ))}
          <tr>
            <td colSpan={4} style={cell(pal.net, { bold: true, family: bodyFamily, size: 14, align: 'right' })}>
              {L('GRAND TOTAL', '총합계')} ({allRows.length})
            </td>
            {def.cols.map((c) => (
              <td key={c.h} style={cell(pal.net, { bold: true, family: bodyFamily, size: 14, align: 'right' })}>
                {c.sum ? fmt(total(allRows, c), c.money, prefs.hideZero) : ''}
              </td>
            ))}
          </tr>
        </tbody>
      </table>
    );
  };

  const renderSummary = () => {
    const totalCash = allRows.reduce((s, r) => s + r.slip.netPay, 0);
    const change = prefs.cash - totalCash;
    const money = (v: number) => v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const rowStyle: CSSProperties = { fontFamily: font.summary, fontWeight: 700, fontSize: px(15), color: pal.ink };
    return (
      <div style={{ maxWidth: 640, margin: '0 auto', padding: px(16), background: pal.sheetBg }}>
        {title}
        <table style={{ width: '100%', marginTop: px(20), borderCollapse: 'collapse' }}>
          <tbody>
            <tr>
              <td style={rowStyle}>TOTAL CASH</td>
              <td style={{ ...rowStyle, textAlign: 'right' }}>{money(totalCash)}</td>
            </tr>
            <tr>
              <td style={{ ...rowStyle, paddingTop: px(14) }}>CASH</td>
              <td style={{ ...rowStyle, textAlign: 'right', paddingTop: px(14) }}>
                <input
                  type="number"
                  inputMode="decimal"
                  value={prefs.cash || ''}
                  placeholder="0.00"
                  onChange={(ev) => update({ cash: Math.max(0, Number(ev.target.value) || 0) })}
                  className="no-print-border"
                  style={{ ...rowStyle, width: '11em', textAlign: 'right', border: `1px solid ${pal.grid}`, background: pal.sheetBg, padding: '2px 6px' }}
                />
              </td>
            </tr>
            <tr>
              <td style={{ ...rowStyle, paddingTop: px(14) }}>CHANGE</td>
              <td style={{ ...rowStyle, textAlign: 'right', paddingTop: px(14), color: change < 0 ? '#DC2626' : pal.ink }}>
                {money(change)}
              </td>
            </tr>
          </tbody>
        </table>

        <table style={{ width: '100%', marginTop: px(22), borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              {['TEAM', L('WORKERS', '인원'), 'GROSS', 'DEDUCTIONS', 'NET PAY'].map((h) => (
                <th key={h} style={cell(pal.head, { bold: true, family: font.head, size: 12, align: 'center' })}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {groups.map((g) => (
              <tr key={g.crewId}>
                <td style={cell(pal.name, { bold: true, family: font.summary })}>{g.crewName}</td>
                <td style={cell(undefined, { family: font.summary, align: 'right' })}>{g.rows.length}</td>
                <td style={cell(pal.gross, { family: font.summary, align: 'right' })}>{money(g.rows.reduce((s, r) => s + r.slip.grossPay, 0))}</td>
                <td style={cell(pal.ded, { family: font.summary, align: 'right' })}>{money(g.rows.reduce((s, r) => s + r.slip.totalDeductions, 0))}</td>
                <td style={cell(pal.net, { bold: true, family: font.summary, align: 'right' })}>{money(g.rows.reduce((s, r) => s + r.slip.netPay, 0))}</td>
              </tr>
            ))}
            <tr>
              <td style={cell(pal.total, { bold: true, family: font.summary })}>{L('TOTAL', '합계')}</td>
              <td style={cell(pal.total, { bold: true, family: font.summary, align: 'right' })}>{allRows.length}</td>
              <td style={cell(pal.total, { bold: true, family: font.summary, align: 'right' })}>{money(allRows.reduce((s, r) => s + r.slip.grossPay, 0))}</td>
              <td style={cell(pal.total, { bold: true, family: font.summary, align: 'right' })}>{money(allRows.reduce((s, r) => s + r.slip.totalDeductions, 0))}</td>
              <td style={cell(pal.total, { bold: true, family: font.summary, align: 'right' })}>{money(totalCash)}</td>
            </tr>
          </tbody>
        </table>

        <div style={{ ...rowStyle, marginTop: px(30), display: 'grid', gridTemplateColumns: '1fr 1fr', gap: px(16) }}>
          <div>
            <div>Prepared by:</div>
            <div style={{ marginTop: px(22), paddingLeft: px(24) }}>John Carlo P. Ongos</div>
            <div style={{ paddingLeft: px(24), fontWeight: 400 }}>Accounting Officer</div>
          </div>
          <div>
            <div>Approved by:</div>
            <div style={{ marginTop: px(22), paddingLeft: px(24) }}>Atty. Emmeline Sacay-Hwang</div>
          </div>
        </div>
      </div>
    );
  };

  const exportCsv = () => {
    if (tab === 'summary') {
      downloadCsv(`weekly-report-summary-${period?.id ?? ''}.csv`, [
        ['TEAM', 'WORKERS', 'GROSS', 'DEDUCTIONS', 'NET PAY'],
        ...groups.map((g) => [
          g.crewName,
          g.rows.length,
          g.rows.reduce((s, r) => s + r.slip.grossPay, 0),
          g.rows.reduce((s, r) => s + r.slip.totalDeductions, 0),
          g.rows.reduce((s, r) => s + r.slip.netPay, 0),
        ]),
      ]);
      return;
    }
    const def = COLS[tab];
    downloadCsv(`weekly-report-${tab}-${period?.id ?? ''}.csv`, [
      ['TEAM', 'NAME', 'NICKNAME', ...def.cols.map((c) => c.h)],
      ...groups.flatMap((g) => g.rows.map((r) => [g.crewName, r.emp.name, r.emp.nickname, ...def.cols.map((c) => c.get(r))])),
    ]);
  };

  const visibleTabs = TABS.filter((t) => prefs.tabs.includes(t.key));

  if (!period) return null;

  return (
    <div className="space-y-3">
      {/* Top bar: title + actions */}
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-lg font-bold text-dark mr-auto">
          📊 Weekly Report <span className="text-sm font-normal text-muted">· {period.label}</span>
        </h2>
        <button className="btn ghost" onClick={() => setOptsOpen((o) => !o)} aria-expanded={optsOpen}>
          🎨 {L('View options', '보기 옵션')}
        </button>
        <button className="btn ghost" onClick={exportCsv}>
          ⬇ CSV
        </button>
        <button className="btn" onClick={() => window.print()}>
          🖨 {L('Print', '인쇄')}
        </button>
      </div>

      {/* View options: colour, font, size, crew, tabs, zeros */}
      {optsOpen && (
        <div className="card p-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 text-sm">
          <Opt label={L('Colours', '색상')}>
            <div className="flex flex-wrap gap-1.5">
              {Object.entries(PALETTES).map(([k, v]) => (
                <button
                  key={k}
                  onClick={() => update({ palette: k })}
                  className={`flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 ${prefs.palette === k ? 'border-primary ring-2 ring-primary/30 font-semibold' : 'border-line'}`}
                >
                  <span className="flex">
                    {(['head', 'net', 'gross', 'ded'] as Role[]).map((r) => (
                      <i key={r} className="block h-3.5 w-3.5 border border-black/10" style={{ background: v.p[r] }} />
                    ))}
                  </span>
                  {L(v.en, v.ko)}
                </button>
              ))}
            </div>
          </Opt>
          <Opt label={L('Font', '폰트')}>
            <div className="flex flex-wrap gap-1.5">
              {Object.entries(FONTS).map(([k, v]) => (
                <button
                  key={k}
                  onClick={() => update({ font: k })}
                  style={{ fontFamily: v.f.head }}
                  className={`rounded-md border px-2.5 py-1.5 ${prefs.font === k ? 'border-primary ring-2 ring-primary/30 font-semibold' : 'border-line'}`}
                >
                  {L(v.en, v.ko)}
                </button>
              ))}
            </div>
          </Opt>
          <Opt label={L('Text size', '글자 크기')}>
            <div className="flex flex-wrap gap-1.5">
              {SIZES.map((s) => (
                <button
                  key={s.v}
                  onClick={() => update({ size: s.v })}
                  className={`rounded-md border px-2.5 py-1.5 ${prefs.size === s.v ? 'border-primary ring-2 ring-primary/30 font-semibold' : 'border-line'}`}
                >
                  {L(s.en, s.ko)}
                </button>
              ))}
            </div>
          </Opt>
          <Opt label={L('Team', '팀')}>
            <select value={prefs.crew} onChange={(ev) => update({ crew: ev.target.value })} className="w-full">
              <option value="">{L('All teams', '전체 팀')}</option>
              {crews.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </Opt>
          <Opt label={L('Sheets to show', '표시할 시트')}>
            <div className="flex flex-wrap gap-x-3 gap-y-1">
              {TABS.map((t) => (
                <label key={t.key} className="flex items-center gap-1.5">
                  <input
                    type="checkbox"
                    checked={prefs.tabs.includes(t.key)}
                    onChange={(ev) => {
                      const next = ev.target.checked
                        ? TABS.map((x) => x.key).filter((k) => k === t.key || prefs.tabs.includes(k))
                        : prefs.tabs.filter((k) => k !== t.key);
                      if (next.length) update({ tabs: next });
                    }}
                  />
                  {t.label}
                </label>
              ))}
            </div>
          </Opt>
          <Opt label={L('Other', '기타')}>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={prefs.hideZero} onChange={(ev) => update({ hideZero: ev.target.checked })} />
              {L('Show zero as blank / "-"', '0은 빈칸·"-"로 표시')}
            </label>
            <button className="btn ghost mt-2" onClick={() => update({ ...DEFAULT_PREFS, cash: prefs.cash })}>
              ↺ {L('Reset to Excel style', '엑셀 원본으로 되돌리기')}
            </button>
          </Opt>
        </div>
      )}

      {/* The report itself (this is what prints) */}
      <div className="wr-print rounded-lg border border-line overflow-hidden" style={{ background: pal.sheetBg }}>
        <div className="overflow-auto" style={{ maxHeight: 'calc(100vh - 230px)' }}>
          {busy && !slips.length ? (
            <p className="p-8 text-center text-muted">{L('Loading…', '불러오는 중…')}</p>
          ) : !allRows.length ? (
            <p className="p-8 text-center text-muted">{L('No payroll for this period yet.', '이 기간의 급여 데이터가 없습니다.')}</p>
          ) : tab === 'summary' ? (
            renderSummary()
          ) : (
            <div style={{ padding: px(8) }}>
              {tab === 'sheet' && <div style={{ marginBottom: px(10) }}>{title}</div>}
              {renderSheet(tab)}
            </div>
          )}
        </div>

        {/* Workbook-style sheet tabs along the bottom */}
        <div className="no-print flex gap-0.5 overflow-x-auto border-t border-line bg-[#F1F3F4] px-1">
          {visibleTabs.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`whitespace-nowrap px-3.5 py-2 text-xs ${
                tab === t.key ? 'bg-white font-bold text-[#188038] shadow-[inset_0_-3px_0_#188038]' : 'text-[#3C4043] hover:bg-white/60'
              }`}
              style={t.key === 'canteen' && prefs.palette === 'excel' ? { borderTop: '3px solid #00B050' } : undefined}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function GroupRows({ children }: { children: ReactNode }) {
  return <>{children}</>;
}

function Opt({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <div className="mb-1.5 text-xs font-bold uppercase tracking-wide text-muted">{label}</div>
      {children}
    </div>
  );
}
