// ============================================================================
// SHARED DOMAIN CONTRACT  —  BRIGHTEM Attendance & Payroll System
// This file is the single source of truth for data shapes shared across the
// calculation engine, the API, and the web frontend. Do not fork these types.
// ============================================================================

// ---- Master data ----------------------------------------------------------

export type Position =
  | "SKILLED"
  | "LABOR"
  | "ELECTRICIAN"
  | "HOUSEKEEPING"
  | "SECURITY";

export interface Crew {
  id: string;          // e.g. "FOREMAN", "RICO"
  name: string;        // display name
  foreman?: string;    // optional foreman/lead name
}

export interface Employee {
  id: string;          // stable unique id (slug of name)
  name: string;        // "ABADILLA , COCOY"
  nickname: string;    // "COCOY"
  crewId: string;      // FK -> Crew.id
  position: Position;
  ratePerDay: number;  // ₱ per day (e.g. 540)
  incentiveDailyRate?: number; // ₱ per day PRESENT; per-employee (sheet col AS: 82/49/65...). Falls back to config.incentiveDailyRate when unset.
  active: boolean;
}

// ---- Attendance ------------------------------------------------------------

export type DayStatus = "full" | "half" | "absent";

/** A single employee's punch record for one calendar date. */
export interface AttendanceRecord {
  employeeId: string;
  date: string;          // ISO "YYYY-MM-DD"
  status: DayStatus;     // derived worked-day status
  amIn?: number | null;  // 24h decimal hour, e.g. 7 = 07:00, 13 = 13:00
  amOut?: number | null;
  pmIn?: number | null;
  pmOut?: number | null;
  otHours?: number;      // overtime hours worked that day
  nightHours?: number;   // hours falling in the night-differential window
  lateMinutes?: number;  // tardiness in minutes
  holiday?: HolidayKind | null; // if the date is a holiday
  isRestDay?: boolean;   // Duty Rest Day (DRD) worked
}

export type HolidayKind = "special" | "legal";

export interface Holiday {
  date: string;            // ISO date
  name: string;
  kind: HolidayKind;
}

// ---- Pay period ------------------------------------------------------------

export interface PayPeriod {
  id: string;
  label: string;       // "JUNE 19-25, 2026"
  startDate: string;   // ISO
  endDate: string;     // ISO
  payDate: string;     // ISO
  status: "open" | "calculated" | "approved" | "paid";
}

// ---- Payroll configuration (statutory tables & rules) ----------------------
// All rates/multipliers/tables live here so nothing is hardcoded in the engine.
// The CLIENT provides exact values; these are editable in the Settings screen.

export interface OvertimeMultipliers {
  // Mirrors the BRIGHTEM payroll sheet (cols R/T/V/X). regularDay is an HOURLY
  // OT multiplier; restDay/specialHoliday/legalHoliday are DAY-based premium
  // multipliers applied to the daily rate × number of such days.
  regularDay: number;      // OT hourly multiplier on ordinary day  (sheet X: 1.25)
  restDay: number;         // DRD day premium (rate × DRD days × x)  (sheet R: 0.30)
  specialHoliday: number;  // special holiday day premium            (sheet T: 0.30)
  legalHoliday: number;    // legal holiday day multiplier           (sheet V: 1.00)
}

export interface NightDifferential {
  windowStart: number;     // 22 (10pm)
  windowEnd: number;       // 6  (6am)
  ratePct: number;         // % of hourly rate added (e.g. 0.10)
}

/** A bracket-based statutory contribution table. */
export interface ContributionBracket {
  min: number;             // monthly salary credit floor (inclusive)
  max: number | null;      // ceiling (null = no upper bound)
  employeeShare: number;   // employee-paid amount OR rate (see mode)
}

export interface ContributionTable {
  name: "SSS" | "PHILHEALTH" | "PAG-IBIG";
  mode: "bracket" | "rate";   // bracket=amount per bracket; rate=percentage
  ratePct?: number;           // used when mode="rate"
  min?: number;               // floor for rate mode
  max?: number;               // ceiling for rate mode
  brackets?: ContributionBracket[];
  note?: string;
}

export interface PayrollConfig {
  currency: string;               // "PHP"
  standardHoursPerDay: number;    // 8
  incentiveDailyRate: number;     // e.g. 10 (per worked day)
  overtime: OvertimeMultipliers;
  nightDifferential: NightDifferential;
  contributions: ContributionTable[];
  // deductions the employer applies per-employee (loans, cash advance, canteen)
  // are supplied per payroll run, not in global config.
}

// ---- Calculation engine I/O ------------------------------------------------
// The engine is a PURE function: (input) => PayslipResult. No I/O, no dates
// beyond what is passed in. This is what api + web both call/display.

export interface EmployeeDeductions {
  cashAdvance?: number;
  employeeLoan?: number;
  sssSalaryLoan?: number;
  sssCalamityLoan?: number;
  pagibigSalaryLoan?: number;
  pagibigCalamityLoan?: number;
  serviceIncentiveLeave?: number;   // negative earning / adjustment
  canteen?: number;
  overpaid?: number;
  adjustments?: number;             // PFF / misc adjustments (signed)
}

export interface PayrollCalcInput {
  employee: Employee;
  period: PayPeriod;
  attendance: AttendanceRecord[];   // this employee's records within the period
  deductions: EmployeeDeductions;   // per-run manual deductions
  config: PayrollConfig;
}

/** One line item on the payslip (label + hours/qty + amount). */
export interface PayslipLine {
  key: string;
  label: string;
  qty?: number;      // days or hours
  rate?: number;
  amount: number;    // signed; negatives reduce pay
}

export interface PayslipResult {
  employeeId: string;
  periodId: string;
  earnings: PayslipLine[];      // basic, OT, DRD, holiday, night diff, incentive, etc.
  grossPay: number;
  deductions: PayslipLine[];    // SSS, PhilHealth, Pag-IBIG, loans, canteen...
  totalDeductions: number;
  netPay: number;
  workedDays: number;
  absentDays: number;
  meta?: Record<string, number>;
}

// ---- Multi-skill matrix ----------------------------------------------------

/** Trade/skill categories tracked per worker. Extendable — add keys here. */
export const SKILL_KEYS = [
  "tile",
  "carpentry",
  "plastering",
  "paint",
  "scaffolding",
  "pipe",
] as const;

export type SkillKey = (typeof SKILL_KEYS)[number];

/** A single worker's proficiency (0–10) in one trade. */
export interface EmployeeSkill {
  employeeId: string;
  skillKey: string;
  level: number; // 0 = not rated, 1–10 = proficiency
}

// ---- Task-based manpower assignment ---------------------------------------

export type TaskStatus = "draft" | "closed";

/** Work-progress state of a task (distinct from the planning status). */
export type TaskProgress = "pending" | "in_progress" | "done";

/**
 * A unit of work planned for a given work day (registered/closed the day
 * before). requiredManday is total person-days (공수); requiredHeadcount is
 * how many workers to place on it that day.
 */
export interface Task {
  id: string;
  workDate: string; // YYYY-MM-DD
  name: string;
  skillKey: string; // which trade this task needs
  requiredManday: number;
  requiredHeadcount: number;
  status: TaskStatus;
  /** How far along the actual work is: pending → in_progress → done. */
  progress?: TaskProgress;
}

/** A worker placed on a task for a work day (auto-matched from attendance). */
export interface TaskAssignment {
  taskId: string;
  employeeId: string;
  workDate: string;
}

// ---- Material purchase request --------------------------------------------

export type MaterialReqStatus = "requested" | "approved" | "rejected";

/** A single material line inside a purchase request. */
export interface MaterialItem {
  name: string;      // material name, e.g. "Portland cement"
  spec: string;      // spec/grade, e.g. "40kg"
  quantity: number;
  unit: string;      // ea, bag, m, kg, ...
  unitPrice: number; // ₱ estimate per unit (0 if unknown)
  supplier: string;  // preferred supplier / vendor
}

/**
 * A material purchase request document: a header plus one or more material
 * line items. Optionally linked to a planned Task. Approval is a 3-state
 * flow: requested → approved / rejected.
 */
export interface MaterialRequest {
  id: string;
  requestNo: string;    // human reference no. (optional)
  requestDate: string;  // YYYY-MM-DD
  requester: string;
  site: string;         // site / area
  neededBy: string;     // YYYY-MM-DD needed-by date
  taskId?: string;      // optional FK -> Task.id
  status: MaterialReqStatus;
  note: string;
  items: MaterialItem[];
}

// ---- Unit (room) finishing-work progress ----------------------------------

/** The finishing-work items tracked per room, in display order. */
export const UNIT_WORK_ITEMS = [
  "xps",
  "ceiling",
  "pipe",
  "electrical",
  "tile",
  "waterproof",
  "window",
  "wallpaper",
  "door",
] as const;

export type UnitWorkItem = (typeof UNIT_WORK_ITEMS)[number];

/**
 * Progress of a single finishing-work item for a single room on a floor.
 * Rooms run floor*100+1 .. floor*100+26 (e.g. 401..426). Status reuses the
 * task progress vocabulary: pending → in_progress → done. Only touched
 * (non-pending) rows need to be stored; anything absent defaults to pending.
 */
export interface UnitProgress {
  floor: number;        // 4..11
  room: number;         // e.g. 401
  workItem: UnitWorkItem;
  status: TaskProgress; // pending | in_progress | done
}

// ---- API contract ----------------------------------------------------------

export interface ApiError {
  error: string;
  detail?: string;
}
