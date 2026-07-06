import { useState, useEffect, useCallback } from 'react';
import type { PayPeriod, PayslipResult, Employee } from '@brightem/shared';
import { api } from '../api';
import { useI18n } from '../i18n';
import { downloadCsv } from '../lib/csv';

interface Props {
  period: PayPeriod | null;
  periods: PayPeriod[];
}

const ALL_CREWS = '__ALL__';

export default function Payroll({ period }: Props) {
  const { t } = useI18n();
  const [payslips, setPayslips] = useState<PayslipResult[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [selectedCrew, setSelectedCrew] = useState(ALL_CREWS);
  const [busy, setBusy] = useState(false);
  // In-progress text for the inline-editable standing fields (canteen debt /
  // adjustment / adjustment deduction), keyed by `${employeeId}:${field}`.
  const [draft, setDraft] = useState<Record<string, string>>({});

  useEffect(() => {
    api.getEmployees().then(setEmployees);
  }, []);

  const loadPayroll = useCallback(async () => {
    if (!period) return;
    setBusy(true);
    try {
      const data = await api.getPayroll(period.id);
      setPayslips(data);
    } finally {
      setBusy(false);
    }
  }, [period]);

  useEffect(() => {
    loadPayroll();
  }, [loadPayroll]);

  // Map employeeId -> employee for name/position/crew lookups
  const empMap = new Map(employees.map((e) => [e.id, e]));

  // --- Inline editing of per-employee standing balances ---------------------
  type StandingField =
    | 'canteenDebt'
    | 'adjustment'
    | 'adjustmentDeduction'
    | 'sssDeduction'
    | 'pagibigDeduction'
    | 'philhealthDeduction';
  const dkey = (id: string, f: StandingField) => `${id}:${f}`;
  const draftVal = (emp: Employee | undefined, f: StandingField): string => {
    if (!emp) return '';
    const k = dkey(emp.id, f);
    if (k in draft) return draft[k];
    const v = emp[f];
    return v ? String(v) : '';
  };
  const onDraft = (id: string, f: StandingField, val: string) =>
    setDraft((p) => ({ ...p, [dkey(id, f)]: val }));
  const commitField = async (id: string, f: StandingField) => {
    const k = dkey(id, f);
    if (!(k in draft)) return;
    const value = draft[k] === '' ? 0 : Math.max(0, Number(draft[k]) || 0);
    try {
      await api.updateEmployee(id, { [f]: value });
      setEmployees((prev) =>
        prev.map((e) => (e.id === id ? ({ ...e, [f]: value } as Employee) : e))
      );
      setDraft((p) => {
        const n = { ...p };
        delete n[k];
        return n;
      });
      await loadPayroll();
    } catch {
      alert(t('pay.saveError'));
    }
  };

  // Crew list with head counts, derived from real employee data
  const crewCounts = new Map<string, number>();
  employees.forEach((e) => crewCounts.set(e.crewId, (crewCounts.get(e.crewId) ?? 0) + 1));
  const crewList = Array.from(crewCounts.entries())
    .map(([id, count]) => ({ id, count }))
    .sort((a, b) => b.count - a.count);

  // Apply the crew filter to the payslips actually shown
  const filteredSlips =
    selectedCrew === ALL_CREWS
      ? payslips
      : payslips.filter((p) => empMap.get(p.employeeId)?.crewId === selectedCrew);

  // Calculate totals (over the filtered set so they match the visible rows)
  const totals = filteredSlips.reduce(
    (acc, p) => ({
      employees: acc.employees + 1,
      workedDays: acc.workedDays + p.workedDays,
      grossPay: acc.grossPay + p.grossPay,
      deductions: acc.deductions + p.totalDeductions,
      netPay: acc.netPay + p.netPay,
      sss: acc.sss + (empMap.get(p.employeeId)?.sssDeduction ?? 0),
      phil: acc.phil + (empMap.get(p.employeeId)?.philhealthDeduction ?? 0),
      pagibig: acc.pagibig + (empMap.get(p.employeeId)?.pagibigDeduction ?? 0),
      canteen: acc.canteen + (empMap.get(p.employeeId)?.canteenDebt ?? 0),
      adjPlus: acc.adjPlus + (empMap.get(p.employeeId)?.adjustment ?? 0),
      adjMinus: acc.adjMinus + (empMap.get(p.employeeId)?.adjustmentDeduction ?? 0),
    }),
    {
      employees: 0,
      workedDays: 0,
      grossPay: 0,
      deductions: 0,
      netPay: 0,
      sss: 0,
      phil: 0,
      pagibig: 0,
      canteen: 0,
      adjPlus: 0,
      adjMinus: 0,
    }
  );

  // Mock data if empty
  const displayData =
    payslips.length > 0
      ? filteredSlips
      : [
          {
            employeeId: 'emp-001',
            periodId: period?.id ?? '',
            earnings: [{ key: 'basic', label: 'Basic (6 days)', qty: 6, rate: 540, amount: 3240 }],
            grossPay: 3240,
            deductions: [
              { key: 'sss', label: 'SSS', amount: 67 },
              { key: 'philhealth', label: 'PhilHealth', amount: 45 },
              { key: 'pagibig', label: 'Pag-IBIG', amount: 18 },
            ],
            totalDeductions: 130,
            netPay: 3110,
            workedDays: 6,
            absentDays: 0,
          } as PayslipResult,
        ];

  // --- Actions --------------------------------------------------------------
  const amt = (slip: PayslipResult, kind: 'e' | 'd', key: string) =>
    (kind === 'e'
      ? slip.earnings.find((x) => x.key === key)?.amount
      : slip.deductions.find((x) => x.key === key)?.amount) ?? 0;

  const handleExport = () => {
    const header = [
      t('pay.thName'),
      t('pay.thPosition'),
      'Crew',
      t('pay.thWorkDays'),
      t('pay.thBasic'),
      'OT',
      'Night',
      'Holiday',
      'Incentive',
      'Gross',
      'SSS',
      'PhilHealth',
      'Pag-IBIG',
      'Canteen',
      'Adjustment',
      'Adjustment Deduction',
      'Net',
    ];
    const body = displayData.map((slip) => {
      const e = empMap.get(slip.employeeId);
      return [
        e?.name ?? slip.employeeId,
        e?.position ?? 'SKILLED',
        e?.crewId ?? '',
        slip.workedDays,
        amt(slip, 'e', 'basic'),
        amt(slip, 'e', 'ot'),
        amt(slip, 'e', 'night'),
        amt(slip, 'e', 'holiday'),
        amt(slip, 'e', 'incentive'),
        slip.grossPay,
        e?.sssDeduction ?? 0,
        e?.philhealthDeduction ?? 0,
        e?.pagibigDeduction ?? 0,
        e?.canteenDebt ?? 0,
        e?.adjustment ?? 0,
        e?.adjustmentDeduction ?? 0,
        slip.netPay,
      ];
    });
    const totalRow = [
      `${t('pay.total')} (${totals.employees}${t('pay.totalUnit')})`,
      '',
      '',
      totals.workedDays,
      '',
      '',
      '',
      '',
      '',
      totals.grossPay,
      totals.sss,
      totals.phil,
      totals.pagibig,
      totals.canteen,
      totals.adjPlus,
      totals.adjMinus,
      totals.netPay,
    ];
    const crewTag = selectedCrew === ALL_CREWS ? 'all' : selectedCrew;
    const fname = `payroll_${period?.startDate ?? ''}_${crewTag}.csv`;
    downloadCsv(fname, [header, ...body, totalRow]);
  };

  const handleRecalc = () => {
    loadPayroll();
  };

  const handleApproval = () => {
    if (!period) return;
    const ok = window.confirm(
      `${t('pay.approvalConfirm')}\n\n${t('pay.periodLabel')} ${period.startDate} ~ ${period.endDate}\n${totals.employees}${t('pay.totalUnit')} · ₱ ${Math.round(totals.netPay).toLocaleString()}`
    );
    if (ok) alert(t('pay.approvalRequested'));
  };

  return (
    <div className="w-full">
      {/* Steps */}
      <div className="steps">
        <span className="st done">{t('pay.step1')}</span>
        <span className="st done">{t('pay.step2')}</span>
        <span className="st now">{t('pay.step3')}</span>
        <span className="st">{t('pay.step4')}</span>
        <span className="st">{t('pay.step5')}</span>
      </div>

      {/* Toolbar */}
      <div className="flex gap-2 items-center flex-wrap mb-3.5">
        <div className="border border-line rounded-lg px-3 py-2 text-sm bg-white">
          {t('pay.periodLabel')} {period?.startDate} ~ {period?.endDate}
        </div>

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

        <div className="flex-1" />

        <button className="btn gray" onClick={handleExport}>
          {t('pay.excelExport')}
        </button>
        <button className="btn ghost" onClick={handleRecalc} disabled={busy}>
          {busy ? t('pay.recalcBusy') : t('pay.recalc')}
        </button>
        <button className="btn" onClick={handleApproval}>
          {t('pay.requestApproval')}
        </button>
      </div>

      {/* Table */}
      <div className="panel">
        <h3 className="text-sm font-bold text-dark mb-3">
          {t('pay.title')}
        </h3>
        {/* Mobile card view */}
        <div className="md:hidden space-y-3">
          <div className="rounded-xl p-3 text-white bg-gradient-to-br from-primary to-[#255e97]">
            <div className="text-[11px] opacity-80">{t('pay.total')} ({totals.employees}{t('pay.totalUnit')})</div>
            <div className="text-2xl font-extrabold mt-0.5">₱ {totals.netPay.toLocaleString()}</div>
          </div>
          {displayData.map((slip, idx) => {
            const emp = empMap.get(slip.employeeId);
            const deductions = Math.max(0, slip.grossPay - slip.netPay);
            return (
              <div key={slip.employeeId} className="bg-white border border-line rounded-xl p-3 shadow-sm">
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="font-bold text-sm text-dark truncate">
                      {idx + 1}. {emp?.name ?? slip.employeeId}
                    </div>
                    <div className="text-xs text-muted truncate">{emp?.position ?? 'SKILLED'}</div>
                  </div>
                  <div className="text-lg font-extrabold text-dark flex-shrink-0">
                    ₱ {slip.netPay.toLocaleString()}
                  </div>
                </div>
                <div className="flex items-center justify-between mt-2 text-[11px]">
                  <span className="pill">{slip.workedDays}{t('pay.totalUnit')}</span>
                  <span className="text-muted">
                    {t('pay.thGross')} ₱{slip.grossPay.toLocaleString()} · {t('pay.thNet')} 공제 ₱{deductions.toLocaleString()}
                  </span>
                </div>
              </div>
            );
          })}
        </div>

        {/* Desktop table view */}
        <div className="overflow-x-auto hidden md:block">
          <table>
            <thead>
              <tr>
                <th>#</th>
                <th className="freeze-col">{t('pay.thName')}</th>
                <th>{t('pay.thPosition')}</th>
                <th className="text-center">{t('pay.thWorkDays')}</th>
                <th className="text-right">{t('pay.thBasic')}</th>
                <th className="text-right">{t('pay.thOt')}</th>
                <th className="text-right">{t('pay.thNight')}</th>
                <th className="text-right">{t('pay.thHoliday')}</th>
                <th className="text-right">{t('pay.thIncentive')}</th>
                <th className="text-right">{t('pay.thGross')}</th>
                <th className="text-right">SSS</th>
                <th className="text-right">Phil</th>
                <th className="text-right">Pag-IBIG</th>
                <th className="text-right">{t('pay.thCanteen')}</th>
                <th className="text-right">{t('pay.thAdjustment')}</th>
                <th className="text-right">{t('pay.thAdjustmentDeduct')}</th>
                <th className="text-right">{t('pay.thNet')}</th>
              </tr>
            </thead>
            <tbody>
              {displayData.map((slip, idx) => (
                <tr key={slip.employeeId}>
                  <td>{idx + 1}</td>
                  <td className="freeze-col">{empMap.get(slip.employeeId)?.name ?? slip.employeeId}</td>
                  <td>{empMap.get(slip.employeeId)?.position ?? 'SKILLED'}</td>
                  <td className="text-center">{slip.workedDays}</td>
                  <td className="text-right">
                    {(slip.earnings.find((e) => e.key === 'basic')?.amount ?? 0).toLocaleString()}
                  </td>
                  <td className="text-right">
                    {(slip.earnings.find((e) => e.key === 'ot')?.amount ?? 0).toLocaleString()}
                  </td>
                  <td className="text-right">
                    {(slip.earnings.find((e) => e.key === 'night')?.amount ?? 0).toLocaleString()}
                  </td>
                  <td className="text-right">
                    {(slip.earnings.find((e) => e.key === 'holiday')?.amount ?? 0).toLocaleString()}
                  </td>
                  <td className="text-right">
                    {(slip.earnings.find((e) => e.key === 'incentive')?.amount ?? 0).toLocaleString()}
                  </td>
                  <td className="text-right font-bold">₱ {slip.grossPay.toLocaleString()}</td>
                  <td className="text-right p-0.5">
                    <input
                      type="number"
                      min={0}
                      inputMode="numeric"
                      value={draftVal(empMap.get(slip.employeeId), 'sssDeduction')}
                      onChange={(e) => onDraft(slip.employeeId, 'sssDeduction', e.target.value)}
                      onBlur={() => commitField(slip.employeeId, 'sssDeduction')}
                      className="w-16 rounded border border-line bg-white px-1 py-1 text-right text-sm"
                      placeholder="0"
                    />
                  </td>
                  <td className="text-right p-0.5">
                    <input
                      type="number"
                      min={0}
                      inputMode="numeric"
                      value={draftVal(empMap.get(slip.employeeId), 'philhealthDeduction')}
                      onChange={(e) =>
                        onDraft(slip.employeeId, 'philhealthDeduction', e.target.value)
                      }
                      onBlur={() => commitField(slip.employeeId, 'philhealthDeduction')}
                      className="w-16 rounded border border-line bg-white px-1 py-1 text-right text-sm"
                      placeholder="0"
                    />
                  </td>
                  <td className="text-right p-0.5">
                    <input
                      type="number"
                      min={0}
                      inputMode="numeric"
                      value={draftVal(empMap.get(slip.employeeId), 'pagibigDeduction')}
                      onChange={(e) =>
                        onDraft(slip.employeeId, 'pagibigDeduction', e.target.value)
                      }
                      onBlur={() => commitField(slip.employeeId, 'pagibigDeduction')}
                      className="w-16 rounded border border-line bg-white px-1 py-1 text-right text-sm"
                      placeholder="0"
                    />
                  </td>
                  <td className="text-right p-0.5">
                    <input
                      type="number"
                      min={0}
                      inputMode="numeric"
                      value={draftVal(empMap.get(slip.employeeId), 'canteenDebt')}
                      onChange={(e) => onDraft(slip.employeeId, 'canteenDebt', e.target.value)}
                      onBlur={() => commitField(slip.employeeId, 'canteenDebt')}
                      className="w-16 rounded border border-line bg-white px-1 py-1 text-right text-sm"
                      placeholder="0"
                    />
                  </td>
                  <td className="text-right p-0.5">
                    <input
                      type="number"
                      min={0}
                      inputMode="numeric"
                      value={draftVal(empMap.get(slip.employeeId), 'adjustment')}
                      onChange={(e) => onDraft(slip.employeeId, 'adjustment', e.target.value)}
                      onBlur={() => commitField(slip.employeeId, 'adjustment')}
                      className="w-16 rounded border border-line bg-white px-1 py-1 text-right text-sm"
                      placeholder="0"
                    />
                  </td>
                  <td className="text-right p-0.5">
                    <input
                      type="number"
                      min={0}
                      inputMode="numeric"
                      value={draftVal(empMap.get(slip.employeeId), 'adjustmentDeduction')}
                      onChange={(e) =>
                        onDraft(slip.employeeId, 'adjustmentDeduction', e.target.value)
                      }
                      onBlur={() => commitField(slip.employeeId, 'adjustmentDeduction')}
                      className="w-16 rounded border border-line bg-white px-1 py-1 text-right text-sm"
                      placeholder="0"
                    />
                  </td>
                  <td className="text-right font-bold">
                    ₱ {slip.netPay.toLocaleString()}
                  </td>
                </tr>
              ))}
              <tr className="totrow">
                <td colSpan={9}>{t('pay.total')} ({totals.employees}{t('pay.totalUnit')})</td>
                <td className="text-right">₱ {totals.grossPay.toLocaleString()}</td>
                <td className="text-right">₱ {totals.sss.toLocaleString()}</td>
                <td className="text-right">₱ {totals.phil.toLocaleString()}</td>
                <td className="text-right">₱ {totals.pagibig.toLocaleString()}</td>
                <td className="text-right">₱ {totals.canteen.toLocaleString()}</td>
                <td className="text-right">₱ {totals.adjPlus.toLocaleString()}</td>
                <td className="text-right">₱ {totals.adjMinus.toLocaleString()}</td>
                <td className="text-right">₱ {totals.netPay.toLocaleString()}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <div className="note">
          {t('pay.note')}
        </div>
      </div>
    </div>
  );
}
