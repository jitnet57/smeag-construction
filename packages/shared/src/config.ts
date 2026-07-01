import type { PayrollConfig } from "./types.js";

// ============================================================================
// DEFAULT PAYROLL CONFIG
// ----------------------------------------------------------------------------
// Calibrated to the real BRIGHTEM weekly payroll workbook
// ("BRIGHTEM CONSTRUCTION PAYROLL JUNE 19-25, 2026"). The values below mirror
// the sheet's own formulas so the app reproduces the company's payslips.
// Every value is CLIENT-EDITABLE from the Settings screen. Nothing in the
// engine is hardcoded — it all reads from this object.
// ============================================================================

export const DEFAULT_CONFIG: PayrollConfig = {
  currency: "PHP",
  // Global fallback incentive; the sheet uses a PER-EMPLOYEE rate (col AS:
  // 82/49/65...). Set each worker's rate on the Employee record; this value is
  // only used when an employee has no rate of their own.
  incentiveDailyRate: 10, // ₱ per day present
  standardHoursPerDay: 8,

  overtime: {
    // Sheet formulas: X = hrs × rate/8 × 1.25 ; R = rate × DRDdays × 0.30 ;
    // T = rate × specHolDays × 0.30 ; V = rate × legalHolDays × 1.00
    regularDay: 1.25,     // OT hourly multiplier on ordinary day (+25%)
    restDay: 0.30,        // DRD (rest day worked) day premium (+30% of daily rate)
    specialHoliday: 0.30, // special holiday day premium (+30% of daily rate)
    legalHoliday: 1.0,    // legal holiday day pay (100% of daily rate)
  },

  nightDifferential: {
    windowStart: 22, // 10:00 PM
    windowEnd: 6,    // 6:00 AM
    ratePct: 0.1,    // +10% of hourly rate (sheet AJ: 540/8 × hrs × 0.10)
  },

  // --- Statutory contributions (EMPLOYEE share) ------------------------------
  // The BRIGHTEM WEEKLY run deducts NO SSS/PhilHealth/Pag-IBIG — those columns
  // are blank on the weekly sheet; government contributions are collected on a
  // separate MONTHLY cycle. Left empty so weekly net matches the company sheet.
  // To enable monthly deductions, add rate- or bracket-mode tables here (the
  // engine already supports both) with the company's official figures.
  contributions: [],
};
