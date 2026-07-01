import { useState, useEffect } from 'react';
import type { PayPeriod, PayslipResult, Employee } from '@brightem/shared';
import { api } from '../api';
import { useI18n } from '../i18n';

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

  useEffect(() => {
    api.getEmployees().then(setEmployees);
  }, []);

  useEffect(() => {
    if (!period) return;
    api
      .getPayroll(period.id)
      .then((data) => {
        setPayslips(data);
      });
  }, [period]);

  // Map employeeId -> employee for name/position/crew lookups
  const empMap = new Map(employees.map((e) => [e.id, e]));

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
      sss: acc.sss + (p.deductions.find((d) => d.key === 'sss')?.amount ?? 0),
      phil: acc.phil + (p.deductions.find((d) => d.key === 'philhealth')?.amount ?? 0),
      pagibig: acc.pagibig + (p.deductions.find((d) => d.key === 'pagibig')?.amount ?? 0),
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

        <button className="btn gray">{t('pay.excelExport')}</button>
        <button className="btn ghost">{t('pay.recalc')}</button>
        <button className="btn">{t('pay.requestApproval')}</button>
      </div>

      {/* Table */}
      <div className="panel">
        <h3 className="text-sm font-bold text-dark mb-3">
          {t('pay.title')}
        </h3>
        <div className="overflow-x-auto">
          <table>
            <thead>
              <tr>
                <th>{t('pay.thName')}</th>
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
                <th className="text-right">{t('pay.thOtherDeduct')}</th>
                <th className="text-right">{t('pay.thNet')}</th>
              </tr>
            </thead>
            <tbody>
              {displayData.map((slip) => (
                <tr key={slip.employeeId}>
                  <td>{empMap.get(slip.employeeId)?.name ?? slip.employeeId}</td>
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
                  <td className="text-right">
                    {(slip.deductions.find((d) => d.key === 'sss')?.amount ?? 0).toLocaleString()}
                  </td>
                  <td className="text-right">
                    {(slip.deductions.find((d) => d.key === 'philhealth')?.amount ?? 0).toLocaleString()}
                  </td>
                  <td className="text-right">
                    {(slip.deductions.find((d) => d.key === 'pagibig')?.amount ?? 0).toLocaleString()}
                  </td>
                  <td className="text-right">0</td>
                  <td className="text-right font-bold">
                    ₱ {slip.netPay.toLocaleString()}
                  </td>
                </tr>
              ))}
              <tr className="totrow">
                <td colSpan={7}>{t('pay.total')} ({totals.employees}{t('pay.totalUnit')})</td>
                <td className="text-right">₱ {totals.grossPay.toLocaleString()}</td>
                <td className="text-right">₱ {totals.sss.toLocaleString()}</td>
                <td className="text-right">₱ {totals.phil.toLocaleString()}</td>
                <td className="text-right">₱ {totals.pagibig.toLocaleString()}</td>
                <td className="text-right">0</td>
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
