// OT · Canteen · Holidays — admin entry screens mirroring the BRIGHTEM payroll
// workbook sheets OVERTIME, CANTEEN and HOLIDAYS. Values entered here flow
// into the payroll engine (see lib/payExtras.ts):
//   * OT hours per worker per day (replaces the attendance OT of that day)
//   * canteen charges per worker per day, deducted every 2nd pay week
//   * the holiday calendar (special +30% / legal +100% for workers present)
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  addDays,
  attendanceTimesOf,
  canteenCycleOf,
  canteenWindowFor,
  otFromCheckout,
  PH_HOLIDAYS,
} from '@brightem/shared';
import type {
  AttendanceRecord,
  Employee,
  Holiday,
  HolidayKind,
  PayDailyEntry,
  PayPeriod,
  PayrollConfig,
} from '@brightem/shared';
import { api } from '../api';
import { useI18n } from '../i18n';

type Tab = 'ot' | 'canteen' | 'holidays';
type Field = 'otHours' | 'canteen';
const ALL = '__ALL__';
const DOW = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
// holiday colours: special = yellow, legal / regular = red
const HOL_HEAD: Record<HolidayKind, string> = {
  special: 'bg-yellow-200 text-yellow-900',
  legal: 'bg-red-200 text-red-800',
};
const HOL_CELL: Record<HolidayKind, string> = {
  special: 'bg-yellow-50',
  legal: 'bg-red-50',
};

// Month calendar for the Holidays tab: each holiday's date number gets the
// kind colour (special = yellow, legal = red). Clicking a day picks it for
// the "add holiday" form.
const HOL_DAY: Record<HolidayKind, string> = {
  special: 'bg-yellow-300 text-yellow-950 font-bold',
  legal: 'bg-red-500 text-white font-bold',
};
function HolidayMonth({
  holidays,
  selected,
  onPick,
  L,
}: {
  holidays: Holiday[];
  selected: string;
  onPick: (d: string) => void;
  L: (en: string, ko: string) => string;
}) {
  const today = new Date().toISOString().slice(0, 10);
  const [ym, setYm] = useState(() => (selected || today).slice(0, 7)); // YYYY-MM
  const [y, m] = ym.split('-').map(Number);
  const first = new Date(Date.UTC(y, m - 1, 1));
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const lead = first.getUTCDay();
  const byDate = new Map(holidays.map((h) => [h.date, h]));
  const shift = (n: number) => {
    const d = new Date(Date.UTC(y, m - 1 + n, 1));
    setYm(d.toISOString().slice(0, 7));
  };
  const cells: (string | null)[] = [
    ...Array<null>(lead).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => `${ym}-${String(i + 1).padStart(2, '0')}`),
  ];
  return (
    <div className="border border-line rounded-lg p-3 mb-3 max-w-sm bg-white">
      <div className="flex items-center justify-between mb-2">
        <button type="button" className="btn ghost px-2 py-1" onClick={() => shift(-1)}>‹</button>
        <b className="text-dark text-sm">{ym}</b>
        <button type="button" className="btn ghost px-2 py-1" onClick={() => shift(1)}>›</button>
      </div>
      <div className="grid grid-cols-7 gap-1 text-center text-[11px] text-muted mb-1">
        {DOW.map((d, i) => (
          <span key={d} className={i === 0 ? 'text-red-600' : i === 6 ? 'text-blue-600' : ''}>{d}</span>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1 text-center text-sm">
        {cells.map((d, i) => {
          if (!d) return <span key={`e${i}`} />;
          const h = byDate.get(d);
          return (
            <button
              key={d}
              type="button"
              title={h ? `${h.name} (${h.kind === 'legal' ? L('Legal', '법정') : L('Special', '특별')})` : undefined}
              onClick={() => onPick(d)}
              className={`h-8 rounded-md ${h ? HOL_DAY[h.kind] : 'hover:bg-bg text-dark'} ${
                d === selected ? 'ring-2 ring-primary' : ''
              } ${d === today ? 'underline' : ''}`}
            >
              {Number(d.slice(8))}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function daysFrom(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}
const dow = (iso: string) => DOW[new Date(iso + 'T00:00:00Z').getUTCDay()];
const md = (iso: string) => `${Number(iso.slice(5, 7))}/${Number(iso.slice(8, 10))}`;
const money = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 2 });
const ekey = (empId: string, date: string) => `${empId}|${date}`;

export default function PayExtras({ period }: { period: PayPeriod | null }) {
  const { lang } = useI18n();
  const L = (en: string, ko: string) => (lang === 'ko' ? ko : en);

  const [tab, setTab] = useState<Tab>('ot');
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [config, setConfig] = useState<PayrollConfig | null>(null);
  const [attendance, setAttendance] = useState<AttendanceRecord[]>([]);
  const [entries, setEntries] = useState<Map<string, PayDailyEntry>>(new Map());
  const [holidays, setHolidays] = useState<Holiday[]>([]);
  const [draft, setDraft] = useState<Record<string, string>>({}); // `${field}:${emp}|${date}`
  // canteen purchases being edited, per `${emp}|${date}` (the cell shows their sum)
  const [cDraft, setCDraft] = useState<Record<string, number[]>>({});
  const [openCell, setOpenCell] = useState<{ emp: Employee; date: string } | null>(null);
  const [addAmt, setAddAmt] = useState('');
  const [crew, setCrew] = useState(ALL);
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState(false);

  const win = useMemo(
    () => (period && config ? canteenWindowFor(period.startDate, config) : null),
    [period, config]
  );
  const otDays = useMemo(
    () => (period ? daysFrom(period.startDate, period.endDate) : []),
    [period]
  );
  const canteenDays = useMemo(() => (win ? daysFrom(win.from, win.to) : []), [win]);

  const load = useCallback(async () => {
    if (!period) return;
    const cfg = await api.getConfig();
    const w = canteenWindowFor(period.startDate, cfg);
    const from = w.from < period.startDate ? w.from : period.startDate;
    const to = w.to > period.endDate ? w.to : period.endDate;
    const [emps, att, ents, hols] = await Promise.all([
      api.getEmployees(),
      api.getAttendance(period.id),
      api.getDailyEntries(from, to),
      api.getHolidays(),
    ]);
    setConfig(cfg);
    setEmployees(emps.filter((e) => e.active));
    setAttendance(att);
    setEntries(new Map(ents.map((e) => [ekey(e.employeeId, e.date), e])));
    setHolidays(hols);
    setDraft({});
    setCDraft({});
  }, [period]);

  useEffect(() => {
    load().catch((e) => alert(String(e?.message ?? e)));
  }, [load]);

  // OT from each worker's own check-out (PM OUT) time; days without a
  // check-out fall back to the OT stored on the attendance record.
  const attOt = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of attendance) {
      const ot = otFromCheckout(r.pmOut, config) ?? r.otHours ?? 0;
      if (ot) m.set(ekey(r.employeeId, r.date), ot);
    }
    return m;
  }, [attendance, config]);
  const pmOutOf = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of attendance) if (r.pmOut != null) m.set(ekey(r.employeeId, r.date), r.pmOut);
    return m;
  }, [attendance]);
  const hhmm = (h: number) => {
    const t = Math.round(h * 60);
    return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
  };
  const checkOutAt = attendanceTimesOf(config).checkOut;

  const crews = useMemo(
    () => Array.from(new Set(employees.map((e) => e.crewId))).sort(),
    [employees]
  );
  const shown = employees.filter(
    (e) =>
      (crew === ALL || e.crewId === crew) &&
      (!search ||
        e.name.toLowerCase().includes(search.toLowerCase()) ||
        (e.nickname ?? '').toLowerCase().includes(search.toLowerCase()))
  );

  // --- cell values ---------------------------------------------------------
  const dk = (f: Field, empId: string, date: string) => `${f}:${ekey(empId, date)}`;
  const saved = (f: Field, empId: string, date: string) => entries.get(ekey(empId, date))?.[f] ?? null;
  const cellText = (f: Field, empId: string, date: string) => {
    const k = dk(f, empId, date);
    if (k in draft) return draft[k];
    const v = saved(f, empId, date);
    return v == null ? '' : String(v);
  };
  /** Canteen purchases of a worker's day (draft included). */
  const itemsOf = (empId: string, date: string): number[] => {
    const k = ekey(empId, date);
    if (k in cDraft) return cDraft[k];
    const e = entries.get(k);
    if (e?.canteenItems?.length) return e.canteenItems;
    return e?.canteen != null ? [e.canteen] : [];
  };
  const sum = (xs: number[]) => Math.round(xs.reduce((a, b) => a + b, 0) * 100) / 100;
  /** Effective number used by payroll for this cell (draft included). */
  const cellNum = (f: Field, empId: string, date: string) => {
    if (f === 'canteen') return sum(itemsOf(empId, date));
    const txt = cellText(f, empId, date);
    if (txt !== '') return Number(txt) || 0;
    if (f === 'otHours') return attOt.get(ekey(empId, date)) ?? 0;
    return 0;
  };
  const rowTotal = (f: Field, empId: string, days: string[]) =>
    days.reduce((s, d) => s + cellNum(f, empId, d), 0);

  const dirty = Object.keys(draft).length + Object.keys(cDraft).length;
  const resetDrafts = () => {
    setDraft({});
    setCDraft({});
  };

  const save = async () => {
    if (!dirty) return;
    const changed = new Map<string, PayDailyEntry>();
    for (const [k, txt] of Object.entries(draft)) {
      const [f, rest] = k.split(':') as [Field, string];
      const [employeeId, date] = rest.split('|');
      const cur = changed.get(rest) ??
        entries.get(rest) ?? { employeeId, date, otHours: null, canteen: null };
      const val = txt.trim() === '' ? null : Math.max(0, Number(txt));
      if (val != null && !Number.isFinite(val)) continue;
      if (f === 'otHours' && val != null && val > 24) {
        alert(L('OT hours must be 0–24.', 'OT 시간은 0~24 사이여야 합니다.'));
        return;
      }
      changed.set(rest, { ...cur, [f]: val });
    }
    for (const [k, items] of Object.entries(cDraft)) {
      const [employeeId, date] = k.split('|');
      const cur = changed.get(k) ??
        entries.get(k) ?? { employeeId, date, otHours: null, canteen: null };
      changed.set(k, {
        ...cur,
        canteen: items.length ? sum(items) : null,
        canteenItems: items.length ? items : null,
      });
    }
    setBusy(true);
    try {
      await api.saveDailyEntries([...changed.values()]);
      await load();
    } catch (e) {
      alert(`${L('Save failed', '저장 실패')}: ${String((e as Error)?.message ?? e)}`);
    } finally {
      setBusy(false);
    }
  };

  // --- grid ----------------------------------------------------------------
  const grid = (f: Field, days: string[]) => {
    const holidayKind = new Map(holidays.map((h) => [h.date, h.kind]));
    const colTotal = (d: string) => shown.reduce((s, e) => s + cellNum(f, e.id, d), 0);
    const grand = shown.reduce((s, e) => s + rowTotal(f, e.id, days), 0);
    return (
      <div className="overflow-x-auto">
        <table>
          <thead>
            <tr>
              <th>#</th>
              <th className="freeze-col">{L('Name', '이름')}</th>
              <th>{L('Crew', '팀')}</th>
              {days.map((d) => (
                <th
                  key={d}
                  className={`text-center ${holidayKind.has(d) ? HOL_HEAD[holidayKind.get(d)!] : ''}`}
                  title={holidays.find((h) => h.date === d)?.name}
                >
                  <div className="text-[10px]">{dow(d)}</div>
                  <div>{md(d)}</div>
                </th>
              ))}
              <th className="text-right">
                {f === 'otHours' ? L('Total hrs', '합계(시간)') : L('Total ₱', '합계(₱)')}
              </th>
              {f === 'otHours' && <th className="text-right">{L('OT pay ₱', 'OT 수당 ₱')}</th>}
            </tr>
          </thead>
          <tbody>
            {shown.map((e, i) => {
              const total = rowTotal(f, e.id, days);
              const otMul = config?.overtime.regularDay ?? 1.25;
              const hrsPerDay = config?.standardHoursPerDay ?? 8;
              return (
                <tr key={e.id}>
                  <td>{i + 1}</td>
                  <td className="freeze-col whitespace-nowrap">{e.name}</td>
                  <td>{e.crewId}</td>
                  {days.map((d) => {
                    const k = dk(f, e.id, d);
                    const fromAtt = f === 'otHours' ? attOt.get(ekey(e.id, d)) : undefined;
                    const out = f === 'otHours' ? pmOutOf.get(ekey(e.id, d)) : undefined;
                    if (f === 'canteen') {
                      const items = itemsOf(e.id, d);
                      const changed = ekey(e.id, d) in cDraft;
                      return (
                        <td
                          key={d}
                          className={`p-0.5 text-center ${holidayKind.has(d) ? HOL_CELL[holidayKind.get(d)!] : ''}`}
                        >
                          <button
                            type="button"
                            onClick={() => {
                              setAddAmt('');
                              setOpenCell({ emp: e, date: d });
                            }}
                            title={
                              items.length
                                ? items.map((x) => `₱${money(x)}`).join(' + ')
                                : L('Add purchase', '구매 추가')
                            }
                            className={`w-16 h-8 rounded border px-1 text-right text-sm relative ${
                              changed ? 'border-primary bg-yellow-50' : 'border-line bg-white hover:bg-blue-50'
                            }`}
                          >
                            {items.length ? money(sum(items)) : ''}
                            {items.length > 1 && (
                              <span className="absolute -top-1.5 -right-1.5 rounded-full bg-primary text-white text-[9px] leading-none px-1 py-0.5">
                                {items.length}
                              </span>
                            )}
                          </button>
                        </td>
                      );
                    }
                    return (
                      <td
                        key={d}
                        className={`p-0.5 text-center ${holidayKind.has(d) ? HOL_CELL[holidayKind.get(d)!] : ''}`}
                      >
                        <input
                          type="number"
                          min={0}
                          max={f === 'otHours' ? 24 : undefined}
                          step={f === 'otHours' ? 0.5 : 1}
                          inputMode="decimal"
                          value={cellText(f, e.id, d)}
                          placeholder={fromAtt ? String(fromAtt) : ''}
                          title={
                            out != null
                              ? L(
                                  `Check-out ${hhmm(out)} → OT ${fromAtt ?? 0} h`,
                                  `퇴근 ${hhmm(out)} → OT ${fromAtt ?? 0}시간`
                                )
                              : fromAtt
                                ? L(`Attendance OT: ${fromAtt} h`, `출퇴근 기록 OT: ${fromAtt}시간`)
                                : undefined
                          }
                          onChange={(ev) => setDraft((p) => ({ ...p, [k]: ev.target.value }))}
                          className={`w-12 rounded border px-1 py-1 text-right text-sm ${
                            k in draft ? 'border-primary bg-yellow-50' : 'border-line bg-white'
                          }`}
                        />
                      </td>
                    );
                  })}
                  <td className="text-right font-bold">{total ? money(total) : ''}</td>
                  {f === 'otHours' && (
                    <td className="text-right">
                      {total ? money((e.ratePerDay / hrsPerDay) * total * otMul) : ''}
                    </td>
                  )}
                </tr>
              );
            })}
            <tr className="totrow">
              <td colSpan={3}>
                {L('Total', '합계')} ({shown.length})
              </td>
              {days.map((d) => (
                <td key={d} className="text-center">
                  {colTotal(d) ? money(colTotal(d)) : ''}
                </td>
              ))}
              <td className="text-right">{money(grand)}</td>
              {f === 'otHours' && <td />}
            </tr>
          </tbody>
        </table>
      </div>
    );
  };

  // --- canteen cycle settings ---------------------------------------------
  const cycle = canteenCycleOf(config);
  const saveCycle = async (next: { cycleWeeks?: number; anchorStart?: string }) => {
    if (!config) return;
    const cfg = { ...config, canteenCycle: { ...cycle, ...next } };
    try {
      await api.updateConfig(cfg);
      await load();
    } catch (e) {
      alert(`${L('Save failed', '저장 실패')}: ${String((e as Error)?.message ?? e)}`);
    }
  };

  // --- holidays --------------------------------------------------------------
  const [hDate, setHDate] = useState('');
  const [hName, setHName] = useState('');
  const [hKind, setHKind] = useState<HolidayKind>('special');
  const addHoliday = async () => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(hDate)) return alert(L('Pick a date.', '날짜를 선택하세요.'));
    try {
      await api.saveHoliday({ date: hDate, name: hName.trim(), kind: hKind });
      setHDate('');
      setHName('');
      await load();
    } catch (e) {
      alert(`${L('Save failed', '저장 실패')}: ${String((e as Error)?.message ?? e)}`);
    }
  };
  // Philippine national holidays (Presidential proclamation) for a year;
  // dates already in the calendar are kept as entered.
  const phYears = Object.keys(PH_HOLIDAYS).map(Number).sort();
  const [phYear, setPhYear] = useState(() => {
    const y = Number((period?.startDate ?? new Date().toISOString()).slice(0, 4));
    return phYears.includes(y) ? y : phYears[phYears.length - 1];
  });
  const importPh = async () => {
    const have = new Set(holidays.map((h) => h.date));
    const missing = (PH_HOLIDAYS[phYear] ?? []).filter((h) => !have.has(h.date));
    if (missing.length === 0)
      return alert(L(`All ${phYear} Philippine holidays are already in.`, `${phYear}년 필리핀 공휴일이 이미 모두 등록되어 있습니다.`));
    if (
      !window.confirm(
        L(
          `Add ${missing.length} Philippine holidays for ${phYear}?`,
          `${phYear}년 필리핀 공휴일 ${missing.length}개를 추가할까요?`
        )
      )
    )
      return;
    try {
      for (const h of missing) await api.saveHoliday(h);
      await load();
    } catch (e) {
      alert(`${L('Save failed', '저장 실패')}: ${String((e as Error)?.message ?? e)}`);
      await load();
    }
  };
  // inline edit of one calendar row; date is the key, so a moved date is
  // saved as the new row first and the old one removed after
  const [hEdit, setHEdit] = useState<{ orig: string; h: Holiday } | null>(null);
  const saveEdit = async () => {
    if (!hEdit) return;
    const { orig, h } = hEdit;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(h.date)) return alert(L('Pick a date.', '날짜를 선택하세요.'));
    if (
      h.date !== orig &&
      holidays.some((x) => x.date === h.date) &&
      !window.confirm(
        L(`${h.date} is already a holiday. Replace it?`, `${h.date}에 이미 휴일이 있습니다. 덮어쓸까요?`)
      )
    )
      return;
    try {
      await api.saveHoliday({ ...h, name: h.name.trim() });
      if (h.date !== orig) await api.deleteHoliday(orig);
      setHEdit(null);
      await load();
    } catch (e) {
      alert(`${L('Save failed', '저장 실패')}: ${String((e as Error)?.message ?? e)}`);
      await load();
    }
  };
  const removeHoliday = async (h: Holiday) => {
    if (!window.confirm(L(`Delete holiday ${h.date}?`, `${h.date} 휴일을 삭제할까요?`))) return;
    try {
      await api.deleteHoliday(h.date);
      await load();
    } catch (e) {
      alert(`${L('Delete failed', '삭제 실패')}: ${String((e as Error)?.message ?? e)}`);
    }
  };
  const periodHolidays = holidays.filter(
    (h) => period && h.date >= period.startDate && h.date <= period.endDate
  );
  const holidaySummary = shown
    .map((e) => {
      let special = 0;
      let legal = 0;
      for (const h of periodHolidays) {
        const r = attendance.find((a) => a.employeeId === e.id && a.date === h.date);
        if (!r || r.status === 'absent') continue;
        if (h.kind === 'special') special += 1;
        else legal += 1;
      }
      const rate = e.ratePerDay;
      const pay =
        special * rate * (config?.overtime.specialHoliday ?? 0.3) +
        legal * rate * (config?.overtime.legalHoliday ?? 1);
      return { e, special, legal, pay };
    })
    .filter((x) => x.special || x.legal);

  if (!period) return null;

  const tabBtn = (k: Tab, label: string) => (
    <button
      key={k}
      type="button"
      onClick={() => {
        if (dirty && !window.confirm(L('Discard unsaved changes?', '저장하지 않은 변경을 버릴까요?'))) return;
        resetDrafts();
        setTab(k);
      }}
      className={`px-4 py-2 text-sm font-bold rounded-lg border ${
        tab === k ? 'bg-primary text-white border-primary' : 'bg-white text-dark border-line'
      }`}
    >
      {label}
    </button>
  );

  return (
    <div className="w-full">
      <div className="flex gap-2 flex-wrap mb-3.5">
        {tabBtn('ot', L('Overtime', '초과근무 (OT)'))}
        {tabBtn('canteen', L('Canteen', '식당 (Canteen)'))}
        {tabBtn('holidays', L('Holidays', '휴일 (Holidays)'))}
      </div>

      {tab !== 'holidays' && (
        <div className="flex gap-2 items-center flex-wrap mb-3.5">
          <select
            value={crew}
            onChange={(e) => setCrew(e.target.value)}
            className="border border-line rounded-lg px-3 py-2 text-sm bg-white"
          >
            <option value={ALL}>{L('All crews', '전체 팀')}</option>
            {crews.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={L('Search name', '이름 검색')}
            className="border border-line rounded-lg px-3 py-2 text-sm bg-white"
          />
          <div className="flex-1" />
          {dirty > 0 && (
            <span className="text-xs text-muted">
              {L(`${dirty} unsaved`, `저장 안 됨 ${dirty}칸`)}
            </span>
          )}
          <button className="btn ghost" disabled={!dirty || busy} onClick={resetDrafts}>
            {L('Undo', '되돌리기')}
          </button>
          <button className="btn" disabled={!dirty || busy} onClick={save}>
            {busy ? L('Saving…', '저장 중…') : L('Save', '저장')}
          </button>
        </div>
      )}

      {tab === 'ot' && (
        <div className="panel">
          <h3 className="text-sm font-bold text-dark mb-1">
            {L("Worker's overtime", '인부 초과근무')} — {period.label}
          </h3>
          <p className="text-xs text-muted mb-3">
            {L(
              `OT is set from each worker's own check-out time: hours past ${checkOutAt}, in half-hour steps (grey = from check-out; hover a cell to see the time). A value typed here replaces it for that day. OT pay = daily rate ÷ ${config?.standardHoursPerDay ?? 8} × hours × ${config?.overtime.regularDay ?? 1.25}.`,
              `OT는 인부별 퇴근(PM OUT) 시각으로 자동 책정됩니다: ${checkOutAt} 이후 근무시간, 30분 단위 내림(회색 = 퇴근시각 기준값, 칸에 마우스를 올리면 퇴근시각 표시). 직접 입력하면 그날 값을 대체합니다. OT 수당 = 일당 ÷ ${config?.standardHoursPerDay ?? 8} × 시간 × ${config?.overtime.regularDay ?? 1.25}.`
            )}
          </p>
          {grid('otHours', otDays)}
        </div>
      )}

      {tab === 'canteen' && win && (
        <div className="panel">
          <h3 className="text-sm font-bold text-dark mb-1">
            {L('Canteen debt', '식당 외상')} — {win.from} ~ {win.to}
          </h3>
          <div
            className={`text-sm rounded-lg px-3 py-2 mb-3 ${
              win.deduct ? 'bg-red-50 text-red-700' : 'bg-blue-50 text-blue-800'
            }`}
          >
            {win.deduct
              ? L(
                  `This pay week (${period.label}) deducts these ${cycle.cycleWeeks} weeks of canteen charges from pay.`,
                  `이번 급여주(${period.label})에 위 ${cycle.cycleWeeks}주치 식당비가 급여에서 공제됩니다.`
                )
              : L(
                  `No canteen deduction this week. Charges are deducted together in the pay week starting ${win.deductWeekStart}.`,
                  `이번 주는 식당비 공제가 없습니다. ${win.deductWeekStart} 시작 급여주에 합산 공제됩니다.`
                )}
          </div>
          <div className="flex gap-3 items-center flex-wrap text-sm mb-3">
            <label className="flex items-center gap-1">
              {L('Deduct every', '공제 주기')}
              <select
                value={cycle.cycleWeeks}
                onChange={(e) => saveCycle({ cycleWeeks: Number(e.target.value) })}
                className="border border-line rounded px-2 py-1 bg-white"
              >
                {[1, 2, 3, 4].map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
              {L('week(s)', '주마다')}
            </label>
            <label className="flex items-center gap-1">
              {L('A deduction week starts', '공제 기준 주 시작일')}
              <input
                type="date"
                value={cycle.anchorStart}
                onChange={(e) => e.target.value && saveCycle({ anchorStart: e.target.value })}
                className="border border-line rounded px-2 py-1 bg-white"
              />
            </label>
          </div>
          <p className="text-xs text-muted mb-2">
            {L(
              'Click a cell to see or add individual purchases; the cell shows their total.',
              '칸을 클릭하면 개별 구매 금액을 보고 추가할 수 있습니다. 칸에는 합계가 표시됩니다.'
            )}
          </p>
          {grid('canteen', canteenDays)}
        </div>
      )}

      {openCell && (() => {
        const { emp, date } = openCell;
        const k = ekey(emp.id, date);
        const items = itemsOf(emp.id, date);
        const setItems = (next: number[]) => setCDraft((p) => ({ ...p, [k]: next }));
        const add = () => {
          const v = Number(addAmt.replace(/,/g, ''));
          if (!addAmt.trim() || !Number.isFinite(v) || v <= 0) return;
          setItems([...items, Math.round(v * 100) / 100]);
          setAddAmt('');
        };
        return (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/30"
            onClick={() => setOpenCell(null)}
          >
            <div
              className="bg-white rounded-xl shadow-xl w-[320px] max-w-[92vw] p-4"
              onClick={(ev) => ev.stopPropagation()}
            >
              <div className="flex items-start justify-between mb-3">
                <div>
                  <div className="font-bold text-dark">{emp.name}</div>
                  <div className="text-xs text-muted">
                    {date} ({dow(date)}) · {L('Canteen purchases', '식당 구매 내역')}
                  </div>
                </div>
                <button className="btn ghost" onClick={() => setOpenCell(null)}>
                  ✕
                </button>
              </div>
              {items.length === 0 ? (
                <p className="text-sm text-muted mb-3">{L('No purchases.', '구매 내역이 없습니다.')}</p>
              ) : (
                <ul className="mb-3 divide-y divide-line border border-line rounded-lg">
                  {items.map((x, i) => (
                    <li key={i} className="flex items-center justify-between px-3 py-1.5 text-sm">
                      <span className="text-muted">#{i + 1}</span>
                      <span className="flex-1 text-right mr-3">₱{money(x)}</span>
                      <button
                        type="button"
                        className="text-red-600 text-xs"
                        onClick={() => setItems(items.filter((_, j) => j !== i))}
                      >
                        {L('Delete', '삭제')}
                      </button>
                    </li>
                  ))}
                  <li className="flex justify-between px-3 py-1.5 text-sm font-bold bg-blue-50">
                    <span>{L('Total', '합계')}</span>
                    <span>₱{money(sum(items))}</span>
                  </li>
                </ul>
              )}
              <div className="flex gap-2">
                <input
                  autoFocus
                  type="number"
                  min={0}
                  step="any"
                  inputMode="decimal"
                  value={addAmt}
                  onChange={(ev) => setAddAmt(ev.target.value)}
                  onKeyDown={(ev) => {
                    if (ev.key === 'Enter') add();
                    if (ev.key === 'Escape') setOpenCell(null);
                  }}
                  placeholder={L('Amount ₱', '금액 ₱')}
                  className="flex-1 border border-line rounded-lg px-3 py-2 text-sm"
                />
                <button className="btn" onClick={add}>
                  {L('Add', '추가')}
                </button>
              </div>
              <p className="text-[11px] text-muted mt-2">
                {L(
                  'Enter adds the amount. Press Save on the screen to keep changes.',
                  'Enter로 금액 추가. 화면의 저장 버튼을 눌러야 반영됩니다.'
                )}
              </p>
            </div>
          </div>
        );
      })()}

      {tab === 'holidays' && (
        <div className="space-y-3.5">
          <div className="panel">
            <h3 className="text-sm font-bold text-dark mb-1">{L('Holiday calendar', '휴일 달력')}</h3>
            <p className="text-xs text-muted mb-3">
              {L(
                `Workers present on a holiday get: special = daily rate × ${config?.overtime.specialHoliday ?? 0.3}, legal = daily rate × ${config?.overtime.legalHoliday ?? 1}, on top of the basic day.`,
                `휴일에 출근한 인부에게 기본 일당 외에 추가 지급: 특별공휴일 = 일당 × ${config?.overtime.specialHoliday ?? 0.3}, 법정공휴일 = 일당 × ${config?.overtime.legalHoliday ?? 1}.`
              )}
            </p>
            <div className="flex gap-3 items-center text-xs mb-3">
              <span className="pill bg-yellow-200 text-yellow-900">{L('Special +30%', '특별공휴일 +30%')}</span>
              <span className="pill bg-red-200 text-red-800">{L('Legal / regular +100%', '법정(정규)공휴일 +100%')}</span>
              <span className="text-muted">
                {L('Bold, blue edge = this pay week', '굵은 글씨·파란 줄 = 이번 급여주')}
              </span>
            </div>
            <div className="flex gap-2 flex-wrap items-center mb-3">
              <input
                type="date"
                value={hDate}
                onChange={(e) => setHDate(e.target.value)}
                className="border border-line rounded-lg px-3 py-2 text-sm bg-white"
              />
              <input
                value={hName}
                onChange={(e) => setHName(e.target.value)}
                placeholder={L('Name (e.g. Bonifacio Day)', '이름 (예: Bonifacio Day)')}
                className="border border-line rounded-lg px-3 py-2 text-sm bg-white min-w-[220px]"
              />
              <select
                value={hKind}
                onChange={(e) => setHKind(e.target.value as HolidayKind)}
                className="border border-line rounded-lg px-3 py-2 text-sm bg-white"
              >
                <option value="special">{L('Special (+30%)', '특별공휴일 (+30%)')}</option>
                <option value="legal">{L('Legal / regular (+100%)', '법정공휴일 (+100%)')}</option>
              </select>
              <button className="btn" onClick={addHoliday}>
                {L('Add', '추가')}
              </button>
              <span className="flex-1" />
              <select
                value={phYear}
                onChange={(e) => setPhYear(Number(e.target.value))}
                className="border border-line rounded-lg px-3 py-2 text-sm bg-white"
              >
                {phYears.map((y) => (
                  <option key={y} value={y}>
                    {y}
                  </option>
                ))}
              </select>
              <button className="btn ghost" onClick={importPh}>
                🇵🇭 {L('Load Philippine holidays', '필리핀 공휴일 불러오기')}
              </button>
            </div>
            <HolidayMonth holidays={holidays} selected={hDate} onPick={setHDate} L={L} />
            <div className="overflow-x-auto">
              <table>
                <thead>
                  <tr>
                    <th>{L('Date', '날짜')}</th>
                    <th>{L('Day', '요일')}</th>
                    <th>{L('Name', '이름')}</th>
                    <th>{L('Kind', '구분')}</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {holidays.length === 0 && (
                    <tr>
                      <td colSpan={5} className="text-center text-muted">
                        {L('No holidays yet.', '등록된 휴일이 없습니다.')}
                      </td>
                    </tr>
                  )}
                  {holidays.map((h) => {
                    const inWeek = h.date >= period.startDate && h.date <= period.endDate;
                    const rowCls = `${h.kind === 'legal' ? 'bg-red-50' : 'bg-yellow-50'} ${
                      inWeek ? 'font-bold shadow-[inset_4px_0_0_#2563eb]' : ''
                    }`;
                    if (hEdit?.orig === h.date) {
                      const e = hEdit.h;
                      const set = (p: Partial<Holiday>) => setHEdit({ orig: hEdit.orig, h: { ...e, ...p } });
                      return (
                        <tr key={h.date} className="bg-blue-50">
                          <td>
                            <input
                              type="date"
                              value={e.date}
                              onChange={(ev) => set({ date: ev.target.value })}
                              className="border border-line rounded px-2 py-1 text-sm bg-white"
                            />
                          </td>
                          <td>{/^\d{4}-\d{2}-\d{2}$/.test(e.date) ? dow(e.date) : ''}</td>
                          <td>
                            <input
                              value={e.name}
                              onChange={(ev) => set({ name: ev.target.value })}
                              onKeyDown={(ev) => {
                                if (ev.key === 'Enter') saveEdit();
                                if (ev.key === 'Escape') setHEdit(null);
                              }}
                              className="border border-line rounded px-2 py-1 text-sm bg-white w-full min-w-[180px]"
                            />
                          </td>
                          <td>
                            <select
                              value={e.kind}
                              onChange={(ev) => set({ kind: ev.target.value as HolidayKind })}
                              className="border border-line rounded px-2 py-1 text-sm bg-white"
                            >
                              <option value="special">{L('Special (+30%)', '특별 (+30%)')}</option>
                              <option value="legal">{L('Legal (+100%)', '법정 (+100%)')}</option>
                            </select>
                          </td>
                          <td className="text-right whitespace-nowrap">
                            <button className="btn" onClick={saveEdit}>
                              {L('Save', '저장')}
                            </button>{' '}
                            <button className="btn ghost" onClick={() => setHEdit(null)}>
                              {L('Cancel', '취소')}
                            </button>
                          </td>
                        </tr>
                      );
                    }
                    return (
                      <tr key={h.date} className={rowCls}>
                        <td>{h.date}</td>
                        <td>{dow(h.date)}</td>
                        <td>{h.name}</td>
                        <td>
                          <span
                            className={`pill ${
                              h.kind === 'legal' ? 'bg-red-200 text-red-800' : 'bg-yellow-200 text-yellow-900'
                            }`}
                          >
                            {h.kind === 'legal' ? L('Legal', '법정') : L('Special', '특별')}
                          </span>
                        </td>
                        <td className="text-right whitespace-nowrap">
                          <button className="btn ghost" onClick={() => setHEdit({ orig: h.date, h: { ...h } })}>
                            {L('Edit', '편집')}
                          </button>{' '}
                          <button className="btn ghost" onClick={() => removeHoliday(h)}>
                            {L('Delete', '삭제')}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          <div className="panel">
            <h3 className="text-sm font-bold text-dark mb-3">
              {L('Summary of holidays', '휴일 수당 요약')} — {period.label}
            </h3>
            {periodHolidays.length === 0 ? (
              <p className="text-sm text-muted">
                {L('No holiday in this pay week.', '이번 급여주에는 휴일이 없습니다.')}
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table>
                  <thead>
                    <tr>
                      <th>#</th>
                      <th className="freeze-col">{L('Name', '이름')}</th>
                      <th>{L('Crew', '팀')}</th>
                      <th className="text-center">{L('Special days', '특별 일수')}</th>
                      <th className="text-center">{L('Legal days', '법정 일수')}</th>
                      <th className="text-right">{L('Holiday pay ₱', '휴일 수당 ₱')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {holidaySummary.map((x, i) => (
                      <tr key={x.e.id}>
                        <td>{i + 1}</td>
                        <td className="freeze-col">{x.e.name}</td>
                        <td>{x.e.crewId}</td>
                        <td className="text-center">{x.special || ''}</td>
                        <td className="text-center">{x.legal || ''}</td>
                        <td className="text-right">{money(x.pay)}</td>
                      </tr>
                    ))}
                    <tr className="totrow">
                      <td colSpan={5}>
                        {L('Total', '합계')} ({holidaySummary.length})
                      </td>
                      <td className="text-right">
                        {money(holidaySummary.reduce((s, x) => s + x.pay, 0))}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
