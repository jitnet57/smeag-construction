import { useState, useEffect } from 'react';
import type { PayPeriod, Employee, PayslipResult } from '@brightem/shared';
import { api } from '../api';
import { useI18n } from '../i18n';

interface Props {
  period: PayPeriod | null;
  periods: PayPeriod[];
}

export default function Payslip({ period }: Props) {
  const { t } = useI18n();
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [selectedEmployee, setSelectedEmployee] = useState<Employee | null>(null);
  const [payslip, setPayslip] = useState<PayslipResult | null>(null);

  useEffect(() => {
    api.getEmployees().then((data) => {
      setEmployees(data);
      if (data.length > 0) {
        setSelectedEmployee(data[1]); // Default to second employee
      }
    });
  }, []);

  useEffect(() => {
    if (selectedEmployee && period) {
      api.getPayslip(selectedEmployee.id, period.id).then((data) => {
        setPayslip(data);
      });
    }
  }, [selectedEmployee, period]);

  const emp = selectedEmployee || {
    id: 'abadilla-jeffrey',
    name: 'ABADILLA, JEFFREY',
    nickname: 'JEFFREY',
    crewId: 'FOREMAN',
    position: 'SKILLED',
    ratePerDay: 540,
    active: true,
  } as Employee;

  const slip = payslip || {
    employeeId: emp.id,
    periodId: period?.id ?? '',
    earnings: [
      { key: 'basic', label: 'Basic (6 days)', qty: 6, rate: 540, amount: 3240 },
      { key: 'ot', label: 'OT (2h)', qty: 2, rate: 67.5, amount: 135 },
      { key: 'night', label: 'Night Differential', amount: 27 },
      { key: 'incentive', label: 'Incentive', amount: 0 },
    ],
    grossPay: 3402,
    deductions: [
      { key: 'sss', label: 'SSS', amount: 67 },
      { key: 'philhealth', label: 'PhilHealth', amount: 45 },
      { key: 'pagibig', label: 'Pag-IBIG', amount: 18 },
      { key: 'canteen', label: 'Canteen', amount: 0 },
    ],
    totalDeductions: 130,
    netPay: 3272,
    workedDays: 6,
    absentDays: 0,
  } as PayslipResult;

  return (
    <div className="w-full">
      {/* Toolbar */}
      <div className="flex gap-2 items-center flex-wrap mb-3.5">
        <select
          value={selectedEmployee?.id ?? ''}
          onChange={(e) => {
            const emp = employees.find((x) => x.id === e.target.value);
            if (emp) setSelectedEmployee(emp);
          }}
          className="border border-line rounded-lg px-3 py-2 text-sm bg-white"
        >
          {employees.map((e) => (
            <option key={e.id} value={e.id}>
              {t('slip.worker')} {e.name}
            </option>
          ))}
        </select>

        <div className="flex-1" />

        <button className="btn gray" onClick={() => window.print()}>{t('slip.batchPdf')}</button>
        <button className="btn" onClick={() => window.print()}>{t('slip.printPdf')}</button>
      </div>

      {/* Payslip Card */}
      <div className="slip">
        <div className="slip-header">
          <b>BRIGHTEM REALTY CORP.</b>
          <div>Datag, Maribago, Lapu-Lapu City, Cebu · PAYSLIP</div>
        </div>
        <div className="slip-body">
          <div className="grid2">
            <div>
              <span>{t('slip.name')}</span>
              <b>{emp.name}</b>
            </div>
            <div>
              <span>{t('slip.position')}</span>
              <b>{emp.position}</b>
            </div>
            <div>
              <span>{t('slip.crew')}</span>
              <b>{emp.crewId}</b>
            </div>
            <div>
              <span>{t('slip.dailyRate')}</span>
              <b>₱ {emp.ratePerDay}</b>
            </div>
            <div>
              <span>{t('slip.payPeriod')}</span>
              <b>
                {period?.startDate.slice(5)} ~ {period?.endDate.slice(5)}
              </b>
            </div>
            <div>
              <span>{t('slip.payDate')}</span>
              <b>{period?.payDate}</b>
            </div>
          </div>

          <table className="text-sm">
            <thead>
              <tr>
                <th>{t('slip.earnings')}</th>
                <th className="text-right">{t('slip.amount')}</th>
                <th>{t('slip.deductions')}</th>
                <th className="text-right">{t('slip.amount')}</th>
              </tr>
            </thead>
            <tbody>
              {slip.earnings.map((e, idx) => (
                <tr key={e.key}>
                  <td>{e.label}</td>
                  <td className="text-right">₱ {e.amount.toLocaleString()}</td>
                  {idx < slip.deductions.length ? (
                    <>
                      <td>{slip.deductions[idx].label}</td>
                      <td className="text-right">₱ {slip.deductions[idx].amount.toLocaleString()}</td>
                    </>
                  ) : (
                    <>
                      <td></td>
                      <td></td>
                    </>
                  )}
                </tr>
              ))}
              {slip.deductions.length > slip.earnings.length &&
                slip.deductions.slice(slip.earnings.length).map((d) => (
                  <tr key={d.key}>
                    <td colSpan={2}></td>
                    <td>{d.label}</td>
                    <td className="text-right">₱ {d.amount.toLocaleString()}</td>
                  </tr>
                ))}
              <tr>
                <td style={{ color: 'var(--muted)' }}>{t('slip.gross')}</td>
                <td className="text-right">
                  <b>₱ {slip.grossPay.toLocaleString()}</b>
                </td>
                <td style={{ color: 'var(--muted)' }}>{t('slip.totalDeduct')}</td>
                <td className="text-right">
                  <b>₱ {slip.totalDeductions.toLocaleString()}</b>
                </td>
              </tr>
            </tbody>
          </table>

          <div className="slip .net">
            <span>{t('slip.netPay')}</span>
            <b>₱ {slip.netPay.toLocaleString()}</b>
          </div>
        </div>
      </div>
    </div>
  );
}
