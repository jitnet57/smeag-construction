// Applies the admin-entered payroll extras (OT hours, holiday calendar,
// canteen charges) to one employee's period attendance before the engine runs.
// Mirrors the BRIGHTEM workbook sheets OVERTIME, HOLIDAYS and CANTEEN:
//   * an OT entry for a day replaces the attendance OT hours of that day
//   * a worker present on a calendar holiday gets that holiday's premium
//   * canteen charges are deducted every `cycleWeeks` pay weeks (2), all at once
import { canteenWindowFor } from '@brightem/shared';
import type {
  AttendanceRecord,
  EmployeeDeductions,
  Holiday,
  PayDailyEntry,
  PayPeriod,
  PayrollConfig,
} from '@brightem/shared';

export interface PayExtras {
  holidays: Holiday[];
  /** Entries dated within the period (OT) and the canteen window. */
  entries: PayDailyEntry[];
}

/** Date range of daily entries needed to calculate `period`. */
export function extrasRange(period: PayPeriod, config: PayrollConfig) {
  const w = canteenWindowFor(period.startDate, config);
  return {
    from: w.deduct && w.from < period.startDate ? w.from : period.startDate,
    to: period.endDate,
  };
}

export function applyExtras(
  employeeId: string,
  period: PayPeriod,
  attendance: AttendanceRecord[],
  deductions: EmployeeDeductions,
  config: PayrollConfig,
  extras: PayExtras
): { attendance: AttendanceRecord[]; deductions: EmployeeDeductions; extraOtHours: number } {
  const holidayKind = new Map(extras.holidays.map((h) => [h.date, h.kind]));
  const otByDate = new Map<string, number>();
  let canteen = 0;
  const w = canteenWindowFor(period.startDate, config);
  for (const e of extras.entries) {
    if (e.employeeId !== employeeId) continue;
    if (e.otHours != null && e.date >= period.startDate && e.date <= period.endDate)
      otByDate.set(e.date, Number(e.otHours) || 0);
    if (w.deduct && e.canteen && e.date >= w.from && e.date <= w.to) canteen += Number(e.canteen) || 0;
  }

  const seen = new Set<string>();
  const out = attendance.map((r) => {
    seen.add(r.date);
    const next = { ...r };
    if (otByDate.has(r.date)) next.otHours = otByDate.get(r.date);
    const kind = holidayKind.get(r.date);
    if (kind && r.status !== 'absent') next.holiday = kind;
    return next;
  });
  let extraOtHours = 0;
  for (const [date, h] of otByDate) if (!seen.has(date)) extraOtHours += h;

  return {
    attendance: out,
    deductions:
      canteen > 0
        ? { ...deductions, canteen: (deductions.canteen ?? 0) + Math.round(canteen * 100) / 100 }
        : deductions,
    extraOtHours,
  };
}
