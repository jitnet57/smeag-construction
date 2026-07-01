import { describe, it, expect } from "vitest";
import { calcPayslip } from "./engine.js";
import type {
  Employee,
  PayPeriod,
  AttendanceRecord,
  PayrollConfig,
  EmployeeDeductions,
} from "@brightem/shared";

/**
 * Helper to create test fixtures
 */
function createTestEmployee(): Employee {
  return {
    id: "emp-001",
    name: "TEST, EMPLOYEE",
    nickname: "TEST",
    crewId: "crew-001",
    position: "LABOR",
    ratePerDay: 540,
    active: true,
  };
}

function createTestPeriod(): PayPeriod {
  return {
    id: "period-001",
    label: "JUNE 19-25, 2026",
    startDate: "2026-06-19",
    endDate: "2026-06-25",
    payDate: "2026-06-26",
    status: "calculated",
  };
}

function createTestConfig(): PayrollConfig {
  return {
    currency: "PHP",
    standardHoursPerDay: 8,
    incentiveDailyRate: 10,
    overtime: {
      regularDay: 1.25, // OT hourly multiplier
      restDay: 0.3, // DRD day premium
      specialHoliday: 0.3, // special holiday day premium
      legalHoliday: 1.0, // legal holiday day pay
    },
    nightDifferential: {
      windowStart: 22,
      windowEnd: 6,
      ratePct: 0.1,
    },
    contributions: [
      {
        name: "SSS",
        mode: "rate",
        ratePct: 0.045,
        min: 0,
        max: 30000,
      },
      {
        name: "PHILHEALTH",
        mode: "rate",
        ratePct: 0.025,
        min: 0,
        max: 100000,
      },
      {
        name: "PAG-IBIG",
        mode: "rate",
        ratePct: 0.02,
        min: 0,
        max: 10000,
      },
    ],
  };
}

function createEmptyDeductions(): EmployeeDeductions {
  return {};
}

describe("calcPayslip", () => {
  // ========================================================================
  // TEST 1: BASIC KNOWN CASE (540 × 6 = 3240 basic)
  // ========================================================================
  it("should calculate basic pay correctly for 6 worked days (540 × 6 = 3240)", () => {
    const employee = createTestEmployee();
    const period = createTestPeriod();
    const config = createTestConfig();

    // 6 full days of work
    const attendance: AttendanceRecord[] = [
      {
        employeeId: "emp-001",
        date: "2026-06-19",
        status: "full",
      },
      {
        employeeId: "emp-001",
        date: "2026-06-20",
        status: "full",
      },
      {
        employeeId: "emp-001",
        date: "2026-06-21",
        status: "full",
      },
      {
        employeeId: "emp-001",
        date: "2026-06-22",
        status: "full",
      },
      {
        employeeId: "emp-001",
        date: "2026-06-23",
        status: "full",
      },
      {
        employeeId: "emp-001",
        date: "2026-06-24",
        status: "full",
      },
    ];

    const result = calcPayslip({
      employee,
      period,
      attendance,
      deductions: createEmptyDeductions(),
      config,
    });

    // Check worked days
    expect(result.workedDays).toBe(6);

    // Find basic pay line
    const basicLine = result.earnings.find((e) => e.key === "basic");
    expect(basicLine).toBeDefined();
    expect(basicLine!.amount).toBe(3240);

    // Find incentive line (10 × 6 = 60)
    const incentiveLine = result.earnings.find((e) => e.key === "incentive");
    expect(incentiveLine).toBeDefined();
    expect(incentiveLine!.amount).toBe(60);

    // Gross = 3240 + 60 + no OT + no night diff + no holidays
    expect(result.grossPay).toBe(3300);

    // Check that deductions are applied (SSS, PhilHealth, Pag-IBIG)
    const sssLine = result.deductions.find(
      (d) => d.key === "contribution_sss"
    );
    expect(sssLine).toBeDefined();
    expect(sssLine!.amount).toBeGreaterThan(0);

    // Net should be gross - deductions
    expect(result.netPay).toBeLessThan(result.grossPay);
  });

  // ========================================================================
  // TEST 2: HALF-DAY HANDLING (5 full + 1 half = 5.5 days)
  // ========================================================================
  it("should handle half-day correctly (5 full + 1 half = 5.5 days)", () => {
    const employee = createTestEmployee();
    const period = createTestPeriod();
    const config = createTestConfig();

    const attendance: AttendanceRecord[] = [
      { employeeId: "emp-001", date: "2026-06-19", status: "full" },
      { employeeId: "emp-001", date: "2026-06-20", status: "full" },
      { employeeId: "emp-001", date: "2026-06-21", status: "full" },
      { employeeId: "emp-001", date: "2026-06-22", status: "full" },
      { employeeId: "emp-001", date: "2026-06-23", status: "full" },
      { employeeId: "emp-001", date: "2026-06-24", status: "half" },
    ];

    const result = calcPayslip({
      employee,
      period,
      attendance,
      deductions: createEmptyDeductions(),
      config,
    });

    expect(result.workedDays).toBe(5.5);

    const basicLine = result.earnings.find((e) => e.key === "basic");
    // 540 × 5.5 = 2970
    expect(basicLine!.amount).toBe(2970);

    const incentiveLine = result.earnings.find((e) => e.key === "incentive");
    // 10 × 5.5 = 55
    expect(incentiveLine!.amount).toBe(55);
  });

  // ========================================================================
  // TEST 3: OT HOURS AND NIGHT HOURS
  // ========================================================================
  it("should calculate OT on regular day and night differential", () => {
    const employee = createTestEmployee();
    const period = createTestPeriod();
    const config = createTestConfig();

    // 3 days with OT and night hours
    const attendance: AttendanceRecord[] = [
      {
        employeeId: "emp-001",
        date: "2026-06-19",
        status: "full",
        otHours: 2, // 2 hours OT
        nightHours: 1, // 1 hour night
      },
      {
        employeeId: "emp-001",
        date: "2026-06-20",
        status: "full",
        otHours: 3, // 3 hours OT
        nightHours: 2, // 2 hours night
      },
      {
        employeeId: "emp-001",
        date: "2026-06-21",
        status: "full",
      },
    ];

    const result = calcPayslip({
      employee,
      period,
      attendance,
      deductions: createEmptyDeductions(),
      config,
    });

    expect(result.workedDays).toBe(3);

    // OT on regular day: (2+3) × (540/8) × 1.25 = 5 × 67.5 × 1.25 = 421.875 ≈ 421.88
    const otLine = result.earnings.find((e) => e.key === "otRegular");
    expect(otLine).toBeDefined();
    expect(otLine!.qty).toBe(5);
    expect(otLine!.amount).toBe(421.88);

    // Night differential: (1+2) × (540/8) × 0.1 = 3 × 67.5 × 0.1 = 20.25
    const nightLine = result.earnings.find((e) => e.key === "nightDifferential");
    expect(nightLine).toBeDefined();
    expect(nightLine!.qty).toBe(3);
    expect(nightLine!.amount).toBe(20.25);

    // Basic: 540 × 3 = 1620
    const basicLine = result.earnings.find((e) => e.key === "basic");
    expect(basicLine!.amount).toBe(1620);

    // Gross should include basic, OT, night diff, and incentive
    expect(result.grossPay).toBeGreaterThan(1620 + 421.88);
  });

  // ========================================================================
  // TEST 4: STATUTORY DEDUCTIONS REDUCE NET
  // ========================================================================
  it("should apply statutory deductions (SSS, PhilHealth, Pag-IBIG)", () => {
    const employee = createTestEmployee();
    const period = createTestPeriod();
    const config = createTestConfig();

    const attendance: AttendanceRecord[] = [
      { employeeId: "emp-001", date: "2026-06-19", status: "full" },
      { employeeId: "emp-001", date: "2026-06-20", status: "full" },
      { employeeId: "emp-001", date: "2026-06-21", status: "full" },
      { employeeId: "emp-001", date: "2026-06-22", status: "full" },
      { employeeId: "emp-001", date: "2026-06-23", status: "full" },
      { employeeId: "emp-001", date: "2026-06-24", status: "full" },
    ];

    const result = calcPayslip({
      employee,
      period,
      attendance,
      deductions: createEmptyDeductions(),
      config,
    });

    // Expected gross: 3240 (basic) + 60 (incentive) = 3300
    expect(result.grossPay).toBe(3300);

    // Check each deduction exists and is positive
    const sssLine = result.deductions.find((d) => d.key === "contribution_sss");
    expect(sssLine).toBeDefined();
    expect(sssLine!.amount).toBeGreaterThan(0);

    const philHealthLine = result.deductions.find(
      (d) => d.key === "contribution_philhealth"
    );
    expect(philHealthLine).toBeDefined();
    expect(philHealthLine!.amount).toBeGreaterThan(0);

    const pagibigLine = result.deductions.find(
      (d) => d.key === "contribution_pag-ibig"
    );
    expect(pagibigLine).toBeDefined();
    expect(pagibigLine!.amount).toBeGreaterThan(0);

    // Total deductions
    expect(result.totalDeductions).toBeGreaterThan(0);

    // Net should be less than gross
    expect(result.netPay).toBeLessThan(result.grossPay);
    expect(result.netPay).toBe(result.grossPay - result.totalDeductions);
  });

  // ========================================================================
  // TEST 5: MANUAL DEDUCTIONS
  // ========================================================================
  it("should apply manual deductions (cash advance, loans, etc.)", () => {
    const employee = createTestEmployee();
    const period = createTestPeriod();
    const config = createTestConfig();

    const attendance: AttendanceRecord[] = [
      { employeeId: "emp-001", date: "2026-06-19", status: "full" },
      { employeeId: "emp-001", date: "2026-06-20", status: "full" },
      { employeeId: "emp-001", date: "2026-06-21", status: "full" },
    ];

    const deductions: EmployeeDeductions = {
      cashAdvance: 500,
      employeeLoan: 200,
      canteen: 100,
    };

    const result = calcPayslip({
      employee,
      period,
      attendance,
      deductions,
      config,
    });

    // Manual deductions should appear in deductions list
    const cashAdvanceLine = result.deductions.find(
      (d) => d.key === "cashAdvance"
    );
    expect(cashAdvanceLine).toBeDefined();
    expect(cashAdvanceLine!.amount).toBe(500);

    const employeeLoanLine = result.deductions.find(
      (d) => d.key === "employeeLoan"
    );
    expect(employeeLoanLine).toBeDefined();
    expect(employeeLoanLine!.amount).toBe(200);

    const canteenLine = result.deductions.find((d) => d.key === "canteen");
    expect(canteenLine).toBeDefined();
    expect(canteenLine!.amount).toBe(100);

    // Verify net calculation
    const totalManualDeductions = 500 + 200 + 100;
    expect(result.totalDeductions).toBeGreaterThanOrEqual(totalManualDeductions);
  });

  // ========================================================================
  // TEST 6: ABSENT DAYS ARE TRACKED
  // ========================================================================
  it("should track absent days and emit Absent/LWOP line", () => {
    const employee = createTestEmployee();
    const period = createTestPeriod();
    const config = createTestConfig();

    const attendance: AttendanceRecord[] = [
      { employeeId: "emp-001", date: "2026-06-19", status: "full" },
      { employeeId: "emp-001", date: "2026-06-20", status: "full" },
      { employeeId: "emp-001", date: "2026-06-21", status: "absent" },
      { employeeId: "emp-001", date: "2026-06-22", status: "absent" },
      { employeeId: "emp-001", date: "2026-06-23", status: "full" },
    ];

    const result = calcPayslip({
      employee,
      period,
      attendance,
      deductions: createEmptyDeductions(),
      config,
    });

    expect(result.workedDays).toBe(3);
    expect(result.absentDays).toBe(2);

    // Absent/LWOP line should be present with qty=2 and amount=0
    const absentLine = result.earnings.find((e) => e.key === "absentLwop");
    expect(absentLine).toBeDefined();
    expect(absentLine!.qty).toBe(2);
    expect(absentLine!.amount).toBe(0);
  });

  // ========================================================================
  // TEST 7: LATE/UNDERTIME REDUCES PAY
  // ========================================================================
  it("should calculate late/undertime deduction", () => {
    const employee = createTestEmployee();
    const period = createTestPeriod();
    const config = createTestConfig();

    // 3 days: 1 with 30 minutes late, 1 with 60 minutes late, 1 normal
    const attendance: AttendanceRecord[] = [
      {
        employeeId: "emp-001",
        date: "2026-06-19",
        status: "full",
        lateMinutes: 30,
      },
      {
        employeeId: "emp-001",
        date: "2026-06-20",
        status: "full",
        lateMinutes: 60,
      },
      { employeeId: "emp-001", date: "2026-06-21", status: "full" },
    ];

    const result = calcPayslip({
      employee,
      period,
      attendance,
      deductions: createEmptyDeductions(),
      config,
    });

    // Late: -(90 min / 60) × hourlyRate = -1.5 × 67.5 = -101.25
    const lateLine = result.earnings.find((e) => e.key === "lateUndertime");
    expect(lateLine).toBeDefined();
    expect(lateLine!.amount).toBe(-101.25);

    // Gross should be reduced by the late amount
    const expectedBasic = 540 * 3;
    expect(result.grossPay).toBeLessThan(expectedBasic);
  });

  // ========================================================================
  // TEST 8: SPECIAL AND LEGAL HOLIDAYS
  // ========================================================================
  it("should calculate special and legal holiday pay", () => {
    const employee = createTestEmployee();
    const period = createTestPeriod();
    const config = createTestConfig();

    const attendance: AttendanceRecord[] = [
      {
        employeeId: "emp-001",
        date: "2026-06-19",
        status: "full",
        holiday: "special",
      },
      {
        employeeId: "emp-001",
        date: "2026-06-20",
        status: "full",
        holiday: "legal",
      },
      { employeeId: "emp-001", date: "2026-06-21", status: "full" },
    ];

    const result = calcPayslip({
      employee,
      period,
      attendance,
      deductions: createEmptyDeductions(),
      config,
    });

    // Special holiday day premium: 1 × 540 × 0.30 = 162
    const specialHolidayLine = result.earnings.find(
      (e) => e.key === "specialHolidayPay"
    );
    expect(specialHolidayLine).toBeDefined();
    expect(specialHolidayLine!.amount).toBe(162);

    // Legal holiday day pay: 1 × 540 × 1.00 = 540
    const legalHolidayLine = result.earnings.find(
      (e) => e.key === "legalHolidayPay"
    );
    expect(legalHolidayLine).toBeDefined();
    expect(legalHolidayLine!.amount).toBe(540);
  });

  // ========================================================================
  // TEST 9: REST DAY (DRD) WORKED
  // ========================================================================
  it("should calculate DRD (rest day) pay when worked", () => {
    const employee = createTestEmployee();
    const period = createTestPeriod();
    const config = createTestConfig();

    const attendance: AttendanceRecord[] = [
      { employeeId: "emp-001", date: "2026-06-19", status: "full" },
      {
        employeeId: "emp-001",
        date: "2026-06-20",
        status: "full",
        isRestDay: true, // one rest day worked
      },
      { employeeId: "emp-001", date: "2026-06-21", status: "full" },
    ];

    const result = calcPayslip({
      employee,
      period,
      attendance,
      deductions: createEmptyDeductions(),
      config,
    });

    // DRD day premium: 1 rest day × 540 × 0.30 = 162
    const drdLine = result.earnings.find((e) => e.key === "drdPay");
    expect(drdLine).toBeDefined();
    expect(drdLine!.qty).toBe(1);
    expect(drdLine!.amount).toBe(162);
  });

  // ========================================================================
  // TEST 10: ZERO DEDUCTIONS CASE
  // ========================================================================
  it("should omit zero-amount deduction lines", () => {
    const employee = createTestEmployee();
    const period = createTestPeriod();
    const config = createTestConfig();

    // Remove contributions to test zero-deduction scenario
    const configNoContrib: PayrollConfig = {
      ...config,
      contributions: [],
    };

    const attendance: AttendanceRecord[] = [
      { employeeId: "emp-001", date: "2026-06-19", status: "full" },
    ];

    const deductions: EmployeeDeductions = {
      // All undefined = no manual deductions
    };

    const result = calcPayslip({
      employee,
      period,
      attendance,
      deductions,
      config: configNoContrib,
    });

    // Should have no deduction lines or only zero-value ones
    const nonZeroDeductions = result.deductions.filter((d) => d.amount !== 0);
    expect(nonZeroDeductions.length).toBe(0);

    expect(result.totalDeductions).toBe(0);
    expect(result.netPay).toBe(result.grossPay);
  });

  // ========================================================================
  // TEST 11: ROUNDING CONSISTENCY
  // ========================================================================
  it("should round all amounts to 2 decimal places", () => {
    const employee = createTestEmployee();
    const period = createTestPeriod();
    const config = createTestConfig();

    const attendance: AttendanceRecord[] = [
      { employeeId: "emp-001", date: "2026-06-19", status: "full", otHours: 1 },
      { employeeId: "emp-001", date: "2026-06-20", status: "half" },
      { employeeId: "emp-001", date: "2026-06-21", status: "full", nightHours: 1 },
    ];

    const result = calcPayslip({
      employee,
      period,
      attendance,
      deductions: createEmptyDeductions(),
      config,
    });

    // All earnings should have 2 decimal places
    for (const line of result.earnings) {
      const rounded = Math.round(line.amount * 100) / 100;
      expect(line.amount).toBe(rounded);
    }

    // All deductions should have 2 decimal places
    for (const line of result.deductions) {
      const rounded = Math.round(line.amount * 100) / 100;
      expect(line.amount).toBe(rounded);
    }

    // Totals should have 2 decimal places
    expect(result.grossPay).toBe(Math.round(result.grossPay * 100) / 100);
    expect(result.totalDeductions).toBe(
      Math.round(result.totalDeductions * 100) / 100
    );
    expect(result.netPay).toBe(Math.round(result.netPay * 100) / 100);
  });

  // ========================================================================
  // TEST 12: NEGATIVE ADJUSTMENTS (EARNING CREDITS)
  // ========================================================================
  it("should handle negative adjustments as earning credits", () => {
    const employee = createTestEmployee();
    const period = createTestPeriod();
    const config = createTestConfig();

    const attendance: AttendanceRecord[] = [
      { employeeId: "emp-001", date: "2026-06-19", status: "full" },
      { employeeId: "emp-001", date: "2026-06-20", status: "full" },
    ];

    const deductions: EmployeeDeductions = {
      adjustments: -100, // negative = credit to net pay
    };

    const resultWithAdjustment = calcPayslip({
      employee,
      period,
      attendance,
      deductions,
      config,
    });

    const resultNoAdjustment = calcPayslip({
      employee,
      period,
      attendance,
      deductions: {},
      config,
    });

    // With negative adjustment, net should be higher
    expect(resultWithAdjustment.netPay).toBeGreaterThan(
      resultNoAdjustment.netPay
    );
  });

  // ========================================================================
  // TEST 13: META DATA
  // ========================================================================
  it("should include computed meta values", () => {
    const employee = createTestEmployee();
    const period = createTestPeriod();
    const config = createTestConfig();

    const attendance: AttendanceRecord[] = [
      {
        employeeId: "emp-001",
        date: "2026-06-19",
        status: "full",
        otHours: 2,
        nightHours: 1,
        lateMinutes: 30,
      },
    ];

    const result = calcPayslip({
      employee,
      period,
      attendance,
      deductions: createEmptyDeductions(),
      config,
    });

    expect(result.meta).toBeDefined();
    expect(result.meta!.hourlyRate).toBe(67.5); // 540 / 8
    expect(result.meta!.monthlyBasis).toBeGreaterThan(0);
    expect(result.meta!.periodBasis).toBeGreaterThan(0);
    expect(result.meta!.totalOtHours).toBe(2);
    expect(result.meta!.totalNightHours).toBe(1);
    expect(result.meta!.totalLateMinutes).toBe(30);
  });

  // ========================================================================
  // TEST 14: BRACKET-MODE CONTRIBUTIONS
  // ========================================================================
  it("should handle bracket-mode contributions", () => {
    const employee = createTestEmployee();
    const period = createTestPeriod();

    const configWithBrackets: PayrollConfig = {
      currency: "PHP",
      standardHoursPerDay: 8,
      incentiveDailyRate: 10,
      overtime: {
        regularDay: 1.25,
        restDay: 1.3,
        specialHoliday: 1.3,
        legalHoliday: 2.0,
      },
      nightDifferential: {
        windowStart: 22,
        windowEnd: 6,
        ratePct: 0.1,
      },
      contributions: [
        {
          name: "SSS",
          mode: "bracket",
          brackets: [
            { min: 0, max: 1250, employeeShare: 75 },
            { min: 1250.01, max: 2500, employeeShare: 150 },
            { min: 2500.01, max: null, employeeShare: 300 },
          ],
        },
      ],
    };

    const attendance: AttendanceRecord[] = [
      { employeeId: "emp-001", date: "2026-06-19", status: "full" },
      { employeeId: "emp-001", date: "2026-06-20", status: "full" },
      { employeeId: "emp-001", date: "2026-06-21", status: "full" },
      { employeeId: "emp-001", date: "2026-06-22", status: "full" },
      { employeeId: "emp-001", date: "2026-06-23", status: "full" },
      { employeeId: "emp-001", date: "2026-06-24", status: "full" },
    ];

    const result = calcPayslip({
      employee,
      period,
      attendance,
      deductions: createEmptyDeductions(),
      config: configWithBrackets,
    });

    // Monthly basis ≈ 540 × 26 = 14040 (falls in highest bracket)
    // Bracket contribution = 300
    const sssLine = result.deductions.find((d) => d.key === "contribution_sss");
    expect(sssLine).toBeDefined();
    // Scaled weekly: 300 / 4.33 ≈ 69.28
    expect(sssLine!.amount).toBeGreaterThan(0);
  });

  // ========================================================================
  // TEST 15: EDGE CASE - ZERO WORKED DAYS
  // ========================================================================
  it("should handle zero worked days gracefully", () => {
    const employee = createTestEmployee();
    const period = createTestPeriod();
    const config = createTestConfig();

    const attendance: AttendanceRecord[] = [
      { employeeId: "emp-001", date: "2026-06-19", status: "absent" },
      { employeeId: "emp-001", date: "2026-06-20", status: "absent" },
    ];

    const result = calcPayslip({
      employee,
      period,
      attendance,
      deductions: createEmptyDeductions(),
      config,
    });

    expect(result.workedDays).toBe(0);
    expect(result.absentDays).toBe(2);

    const basicLine = result.earnings.find((e) => e.key === "basic");
    expect(basicLine!.amount).toBe(0);

    const incentiveLine = result.earnings.find((e) => e.key === "incentive");
    expect(incentiveLine!.amount).toBe(0);

    // Gross should be at least 0 (but may have deductions if configured)
    expect(result.grossPay).toBeLessThanOrEqual(0);
  });
});
