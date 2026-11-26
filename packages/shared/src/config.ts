import type { EmployeeFieldDef, PayrollConfig, SkillDef } from "./types.js";

// Default trade catalog in TEAMS.xlsx column order. Editable in Settings; the
// saved list lives in PayrollConfig.skills.
export const DEFAULT_SKILLS: SkillDef[] = [
  { key: "carpentry", header: "CARPENTER", en: "Carpenter", ko: "목수" },
  { key: "plastering", header: "MASON", en: "Mason", ko: "조적/미장" },
  { key: "tile", header: "TILE", en: "Tile", ko: "타일" },
  { key: "welding", header: "WELDER", en: "Welder", ko: "용접" },
  { key: "paint", header: "PAINTER", en: "Painter", ko: "페인트" },
  { key: "installer", header: "INSTALLER", en: "Installer", ko: "설치" },
  { key: "window_frame", header: "FRAME INSTALLER", en: "Frame installer", ko: "창호 프레임" },
  { key: "window_glass", header: "GLASS INSTALLER", en: "Glass installer", ko: "유리 시공" },
  { key: "water_pipe", header: "WATER LINE", en: "Water line", ko: "급수 배관" },
  { key: "sanitary_pipe", header: "SANITARY LINE", en: "Sanitary line", ko: "오·배수 배관" },
  { key: "fire_protection", header: "FIREPRO", en: "Firepro", ko: "소방" },
  { key: "ducting", header: "DUCTING", en: "Ducting", ko: "덕트" },
  { key: "roofing", header: "ROOFING", en: "Roofing", ko: "지붕/방수" },
  { key: "steelman", header: "STEELMAN", en: "Steelman", ko: "철근" },
  { key: "scaffolding", header: "SCAFFOLDING", en: "Scaffolding", ko: "스카폴딩" },
  { key: "electrician", header: "ELECTRICAL", en: "Electrical", ko: "전기" },
];

/** The skill catalog in effect for a config (saved list, else the defaults). */
export function skillsOf(config: Pick<PayrollConfig, "skills"> | null | undefined): SkillDef[] {
  return config?.skills?.length ? config.skills : DEFAULT_SKILLS;
}

// Built-in Employees info columns in their default order. Keys are fixed (they
// map to Employee properties); labels / visibility / order are editable.
const bf = (key: string, en: string, ko: string): EmployeeFieldDef => ({
  key,
  en,
  ko,
  visible: true,
  builtin: true,
});
export const DEFAULT_EMPLOYEE_FIELDS: EmployeeFieldDef[] = [
  bf("photo", "Photo", "사진"),
  bf("name", "Name", "성명"),
  bf("nickname", "Nickname", "닉네임"),
  bf("age", "Age", "나이"),
  bf("idNo", "ID", "아이디"),
  bf("position", "Position", "직급"),
  bf("crewId", "Crew", "소속 조"),
  bf("ratePerDay", "Daily Rate", "일당"),
  bf("incentiveDailyRate", "Incentive", "인센티브"),
  bf("canteenDebt", "Canteen debt", "식당 외상"),
  bf("adjustment", "Adjustment +", "조정 가산"),
  bf("adjustmentDeduction", "Adjustment −", "조정 공제"),
  bf("sssDeduction", "SSS", "SSS"),
  bf("pagibigDeduction", "Pag-IBIG", "Pag-IBIG"),
  bf("philhealthDeduction", "PhilHealth", "PhilHealth"),
  bf("joinDate", "Join Date", "입사일"),
  bf("sssNo", "SSS No.", "SSS 번호"),
];

/** Built-in fields that payroll needs, so they can't be hidden. */
export const REQUIRED_EMPLOYEE_FIELDS = ["name", "crewId", "position", "ratePerDay"];

/**
 * The Employees info columns in effect: the saved list (unknown built-ins
 * dropped), with any built-in missing from it appended so new built-ins show up.
 */
export function employeeFieldsOf(
  config: Pick<PayrollConfig, "employeeFields"> | null | undefined
): EmployeeFieldDef[] {
  const saved = config?.employeeFields;
  if (!saved?.length) return DEFAULT_EMPLOYEE_FIELDS;
  const builtinKeys = new Set(DEFAULT_EMPLOYEE_FIELDS.map((f) => f.key));
  const list = saved
    .filter((f) => !f.builtin || builtinKeys.has(f.key))
    .map((f) => (REQUIRED_EMPLOYEE_FIELDS.includes(f.key) ? { ...f, visible: true } : f));
  const have = new Set(list.map((f) => f.key));
  return [...list, ...DEFAULT_EMPLOYEE_FIELDS.filter((f) => !have.has(f.key))];
}

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
