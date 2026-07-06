import type {
  AttendanceRecord,
  PayrollCalcInput,
  PayslipLine,
  PayslipResult,
  EmployeeDeductions,
} from "@brightem/shared";
import { computeContribution } from "./contributions.js";

/**
 * PURE PAYROLL CALCULATION ENGINE
 * Mirrors the real BRIGHTEM payslip exactly. No I/O, no side effects.
 * All rounding to 2 decimals using round2().
 */

/**
 * Round a number to 2 decimal places.
 */
function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Number of pay periods per month.
 * Used to scale monthly contributions/deductions to weekly pay.
 * Document: 52 weeks / 12 months ≈ 4.33 periods per month.
 */
const PAY_PERIODS_PER_MONTH = 4.33;

/**
 * Days per month for "monthlyizing" a daily rate to compute statutory contributions.
 * Standard is 26 working days per month (some systems use 30).
 */
const MONTHLYIZE_DAYS = 26;

/**
 * Main payroll calculation function.
 * Input: employee data, period, attendance, deductions, config.
 * Output: complete payslip with earnings, deductions, gross, net.
 *
 * EARNINGS ORDER (mirroring real BRIGHTEM payslip):
 * 1. Basic (rate × workedDays)
 * 2. OT on Regular Day
 * 3. Incentive (incentiveDailyRate × workedDays)
 * 4. DRD Pay (rest day worked)
 * 5. Special Holiday Pay
 * 6. Legal Holiday Pay
 * 7. Night Differential
 * 8. Absent/LWOP (always shown for reporting, but amount = 0 since basic already reflects worked days)
 * 9. Late/Undertime (negative)
 *
 * DEDUCTIONS:
 * - SSS, PhilHealth, Pag-IBIG (statutory, scaled weekly)
 * - Manual: cashAdvance, employeeLoan, sssSalaryLoan, sssCalamityLoan,
 *   pagibigSalaryLoan, pagibigCalamityLoan, serviceIncentiveLeave, canteen, overpaid, adjustments
 */
export function calcPayslip(input: PayrollCalcInput): PayslipResult {
  const { employee, period, attendance, deductions, config } = input;

  // ========================================================================
  // STEP 1: PARSE ATTENDANCE & COMPUTE WORK METRICS
  // ========================================================================

  let workedDays = 0;
  let absentDays = 0;
  let totalOtHours = 0;
  let totalNightHours = 0;
  let totalLateMinutes = 0;
  let restDayCount = 0;
  let specialHolidayDays = 0;
  let legalHolidayDays = 0;

  for (const record of attendance) {
    if (record.status === "full") {
      workedDays += 1;
    } else if (record.status === "half") {
      workedDays += 0.5;
    } else if (record.status === "absent") {
      absentDays += 1;
    }

    // OT hours (worked regardless of day type)
    if (record.otHours) {
      totalOtHours += record.otHours;
    }

    // Night hours
    if (record.nightHours) {
      totalNightHours += record.nightHours;
    }

    // Late minutes
    if (record.lateMinutes) {
      totalLateMinutes += record.lateMinutes;
    }

    // Rest day (DRD) worked — day-based premium (sheet col Q/R), one per DRD worked
    if (record.isRestDay && record.status !== "absent") {
      restDayCount += 1;
    }

    // Holiday tracking (for special/legal holiday pay)
    if (record.holiday) {
      if (record.holiday === "special") {
        specialHolidayDays += 1;
      } else if (record.holiday === "legal") {
        legalHolidayDays += 1;
      }
    }
  }

  // ========================================================================
  // STEP 2: COMPUTE HOURLY RATE & SALARY BASES
  // ========================================================================

  const ratePerDay = employee.ratePerDay;
  const hourlyRate =
    ratePerDay / config.standardHoursPerDay;

  // Monthly basis for statutory contribution lookups
  // Using standard 26 working days per month
  const monthlyBasis = ratePerDay * MONTHLYIZE_DAYS;

  // Period basis for weekly contribution (monthlyBasis / pay periods per month)
  const periodBasis = monthlyBasis / PAY_PERIODS_PER_MONTH;

  // ========================================================================
  // STEP 3: BUILD EARNINGS LINES
  // ========================================================================

  const earnings: PayslipLine[] = [];

  // 1. BASIC PAY (ratePerDay × workedDays)
  // Convention: basic already reflects only worked days, no separate absent line amount.
  const basicAmount = round2(ratePerDay * workedDays);
  earnings.push({
    key: "basic",
    label: "Basic",
    qty: workedDays,
    rate: ratePerDay,
    amount: basicAmount,
  });

  // 2. OT ON REGULAR DAY
  const otRegularAmount = round2(
    totalOtHours * hourlyRate * config.overtime.regularDay
  );
  if (otRegularAmount !== 0) {
    earnings.push({
      key: "otRegular",
      label: "OT on Reg Day",
      qty: totalOtHours,
      rate: hourlyRate * config.overtime.regularDay,
      amount: otRegularAmount,
    });
  }

  // 3. INCENTIVE (per-employee rate × days present; falls back to config)
  // Mirrors sheet AT = AR × AS, where AR = days present and AS is per-worker.
  const incentiveRate =
    employee.incentiveDailyRate ?? config.incentiveDailyRate;
  const incentiveAmount = round2(incentiveRate * workedDays);
  earnings.push({
    key: "incentive",
    label: "Incentive",
    qty: workedDays,
    rate: incentiveRate,
    amount: incentiveAmount,
  });

  // 4. DRD PAY (rest day worked) — day-based premium (sheet R = rate × DRDdays × 0.30)
  const drdAmount = round2(
    restDayCount * ratePerDay * config.overtime.restDay
  );
  if (drdAmount !== 0) {
    earnings.push({
      key: "drdPay",
      label: "DRD Pay",
      qty: restDayCount,
      rate: ratePerDay * config.overtime.restDay,
      amount: drdAmount,
    });
  }

  // 5. SPECIAL HOLIDAY PAY — day-based premium (sheet T = rate × specHolDays × 0.30)
  const specialHolidayAmount = round2(
    specialHolidayDays * ratePerDay * config.overtime.specialHoliday
  );
  if (specialHolidayAmount !== 0) {
    earnings.push({
      key: "specialHolidayPay",
      label: "Special Holiday Pay",
      qty: specialHolidayDays,
      rate: ratePerDay * config.overtime.specialHoliday,
      amount: specialHolidayAmount,
    });
  }

  // 6. LEGAL HOLIDAY PAY
  const legalHolidayAmount = round2(
    legalHolidayDays * ratePerDay * config.overtime.legalHoliday
  );
  if (legalHolidayAmount !== 0) {
    earnings.push({
      key: "legalHolidayPay",
      label: "Legal Holiday Pay",
      qty: legalHolidayDays,
      rate: ratePerDay * config.overtime.legalHoliday,
      amount: legalHolidayAmount,
    });
  }

  // 7. NIGHT DIFFERENTIAL
  const nightDiffAmount = round2(
    totalNightHours * hourlyRate * config.nightDifferential.ratePct
  );
  if (nightDiffAmount !== 0) {
    earnings.push({
      key: "nightDifferential",
      label: "Night Differential",
      qty: totalNightHours,
      rate: hourlyRate * config.nightDifferential.ratePct,
      amount: nightDiffAmount,
    });
  }

  // 8. ABSENT/LWOP (for reporting; amount = 0 since basic already reflects worked days)
  // Emit the line only if there are absent days, for transparency.
  earnings.push({
    key: "absentLwop",
    label: "Absent/LWOP",
    qty: absentDays,
    rate: 0,
    amount: 0,
  });

  // 9. LATE/UNDERTIME (negative)
  const lateAmount = round2(-1 * (totalLateMinutes / 60) * hourlyRate);
  if (lateAmount !== 0) {
    earnings.push({
      key: "lateUndertime",
      label: "Late/Undertime",
      qty: totalLateMinutes / 60, // in hours
      rate: -1 * hourlyRate,
      amount: lateAmount,
    });
  }

  // ========================================================================
  // STEP 4: COMPUTE GROSS PAY
  // ========================================================================

  const grossPay = round2(
    earnings.reduce((sum, line) => sum + line.amount, 0)
  );

  // ========================================================================
  // STEP 5: BUILD DEDUCTIONS LINES
  // ========================================================================

  const deductionLines: PayslipLine[] = [];

  // Statutory contributions (scaled weekly)
  for (const table of config.contributions) {
    const amount = computeContribution(table, monthlyBasis, periodBasis);
    const roundedAmount = round2(amount);
    if (roundedAmount !== 0) {
      deductionLines.push({
        key: `contribution_${table.name.toLowerCase()}`,
        label: table.name,
        amount: roundedAmount,
      });
    }
  }

  // Manual deductions (per-run)
  const manualDeductionFields: Array<{
    key: string;
    label: string;
    value?: number;
  }> = [
    {
      key: "cashAdvance",
      label: "Cash Advance",
      value: deductions.cashAdvance,
    },
    {
      key: "employeeLoan",
      label: "Employee Loan",
      value: deductions.employeeLoan,
    },
    {
      key: "sssSalaryLoan",
      label: "SSS Salary Loan",
      value: deductions.sssSalaryLoan,
    },
    {
      key: "sssCalamityLoan",
      label: "SSS Calamity Loan",
      value: deductions.sssCalamityLoan,
    },
    {
      key: "pagibigSalaryLoan",
      label: "Pag-IBIG Salary Loan",
      value: deductions.pagibigSalaryLoan,
    },
    {
      key: "pagibigCalamityLoan",
      label: "Pag-IBIG Calamity Loan",
      value: deductions.pagibigCalamityLoan,
    },
    {
      key: "serviceIncentiveLeave",
      label: "Service Incentive Leave",
      value: deductions.serviceIncentiveLeave,
    },
    { key: "canteen", label: "Canteen", value: deductions.canteen },
    { key: "overpaid", label: "Overpaid", value: deductions.overpaid },
    {
      key: "adjustments",
      label: "Adjustments",
      value: deductions.adjustments,
    },
    // Standing adjustment ADDED to pay: stored as a positive amount but applied
    // as a negative deduction line (a credit that increases net pay).
    {
      key: "adjustment",
      label: "Adjustment",
      value:
        deductions.adjustment != null ? -Math.abs(deductions.adjustment) : undefined,
    },
    // Standing adjustment SUBTRACTED from pay: positive deduction, reduces net.
    {
      key: "adjustmentDeduction",
      label: "Adjustment Deduction",
      value:
        deductions.adjustmentDeduction != null
          ? Math.abs(deductions.adjustmentDeduction)
          : undefined,
    },
    // Standing statutory contributions entered manually per employee.
    {
      key: "sssDeduction",
      label: "SSS",
      value:
        deductions.sssDeduction != null
          ? Math.abs(deductions.sssDeduction)
          : undefined,
    },
    {
      key: "pagibigDeduction",
      label: "Pag-IBIG",
      value:
        deductions.pagibigDeduction != null
          ? Math.abs(deductions.pagibigDeduction)
          : undefined,
    },
    {
      key: "philhealthDeduction",
      label: "PhilHealth",
      value:
        deductions.philhealthDeduction != null
          ? Math.abs(deductions.philhealthDeduction)
          : undefined,
    },
  ];

  for (const field of manualDeductionFields) {
    if (field.value !== undefined && field.value !== 0) {
      // Adjustments is signed; positive is a deduction, negative is an earning credit
      // Emit as-is (positive deduction reduces net, negative increases net)
      const roundedValue = round2(Math.abs(field.value));
      deductionLines.push({
        key: field.key,
        label: field.label,
        amount: field.value < 0 ? -roundedValue : roundedValue,
      });
    }
  }

  // ========================================================================
  // STEP 6: COMPUTE TOTALS
  // ========================================================================

  const totalDeductions = round2(
    deductionLines.reduce((sum, line) => sum + line.amount, 0)
  );

  const netPay = round2(grossPay - totalDeductions);

  // ========================================================================
  // RETURN PAYSLIP RESULT
  // ========================================================================

  return {
    employeeId: employee.id,
    periodId: period.id,
    earnings,
    grossPay,
    deductions: deductionLines,
    totalDeductions,
    netPay,
    workedDays,
    absentDays,
    meta: {
      hourlyRate: round2(hourlyRate),
      monthlyBasis: round2(monthlyBasis),
      periodBasis: round2(periodBasis),
      totalOtHours,
      totalNightHours,
      totalLateMinutes,
    },
  };
}
