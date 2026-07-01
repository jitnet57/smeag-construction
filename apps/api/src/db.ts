import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";
import { openDatabase, type Db } from "./sqlite.js";
import { DEFAULT_CONFIG } from "@brightem/shared";
import type {
  Crew,
  Employee,
  PayPeriod,
  AttendanceRecord,
  EmployeeDeductions,
  PayrollConfig,
} from "@brightem/shared";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const dataDir = path.join(__dirname, "../data");
const dbPath = path.join(dataDir, "brightem.db");

// Ensure data directory exists
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const db: Db = openDatabase(dbPath);

// Helper to slugify employee names (lowercase, alphanumeric + dash)
function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function initSchema() {
  // Create crews table
  db.exec(`
    CREATE TABLE IF NOT EXISTS crews (
      id TEXT PRIMARY KEY,
      name TEXT UNIQUE NOT NULL,
      foreman TEXT
    )
  `);

  // Create employees table
  db.exec(`
    CREATE TABLE IF NOT EXISTS employees (
      id TEXT PRIMARY KEY,
      name TEXT UNIQUE NOT NULL,
      nickname TEXT,
      crewId TEXT NOT NULL,
      position TEXT NOT NULL,
      ratePerDay REAL NOT NULL,
      incentiveDailyRate REAL,
      active INTEGER NOT NULL DEFAULT 1,
      FOREIGN KEY (crewId) REFERENCES crews(id)
    )
  `);

  // Additive migration for pre-existing databases (no-op if column exists)
  const empCols = db
    .prepare("PRAGMA table_info(employees)")
    .all() as Array<{ name: string }>;
  if (!empCols.some((c) => c.name === "incentiveDailyRate")) {
    db.exec("ALTER TABLE employees ADD COLUMN incentiveDailyRate REAL");
  }

  // Create pay_periods table
  db.exec(`
    CREATE TABLE IF NOT EXISTS pay_periods (
      id TEXT PRIMARY KEY,
      label TEXT UNIQUE NOT NULL,
      startDate TEXT NOT NULL,
      endDate TEXT NOT NULL,
      payDate TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'open'
    )
  `);

  // Create attendance table
  db.exec(`
    CREATE TABLE IF NOT EXISTS attendance (
      employeeId TEXT NOT NULL,
      date TEXT NOT NULL,
      status TEXT NOT NULL,
      amIn REAL,
      amOut REAL,
      pmIn REAL,
      pmOut REAL,
      otHours REAL,
      nightHours REAL,
      lateMinutes REAL,
      holiday TEXT,
      isRestDay INTEGER,
      PRIMARY KEY (employeeId, date),
      FOREIGN KEY (employeeId) REFERENCES employees(id)
    )
  `);

  // Create employee_deductions table
  db.exec(`
    CREATE TABLE IF NOT EXISTS employee_deductions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      employeeId TEXT NOT NULL,
      periodId TEXT NOT NULL,
      cashAdvance REAL,
      employeeLoan REAL,
      sssSalaryLoan REAL,
      sssCalamityLoan REAL,
      pagibigSalaryLoan REAL,
      pagibigCalamityLoan REAL,
      serviceIncentiveLeave REAL,
      canteen REAL,
      overpaid REAL,
      adjustments REAL,
      FOREIGN KEY (employeeId) REFERENCES employees(id),
      FOREIGN KEY (periodId) REFERENCES pay_periods(id),
      UNIQUE (employeeId, periodId)
    )
  `);

  // Create config table (single row)
  db.exec(`
    CREATE TABLE IF NOT EXISTS config (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      data TEXT NOT NULL
    )
  `);
}

export function seedIfEmpty() {
  // Check if already seeded
  const crewCount = db.prepare("SELECT COUNT(*) as count FROM crews").get() as {
    count: number;
  };
  if (crewCount.count > 0) {
    console.log("Database already seeded, skipping...");
    return;
  }

  const seedPath = path.join(__dirname, "seed.json");
  const seedRaw = fs.readFileSync(seedPath, "utf-8");
  const seed = JSON.parse(seedRaw);

  // Insert crews
  const insertCrew = db.prepare(
    "INSERT INTO crews (id, name, foreman) VALUES (?, ?, ?)"
  );
  for (const crewName of seed.crews) {
    insertCrew.run(crewName.toUpperCase(), crewName, null);
  }

  // Insert employees
  // Per-employee incentive daily rate (sheet col AS). Use the value from the
  // seed if provided, else a reasonable position-based default (editable later).
  const incentiveByPosition: Record<string, number> = {
    SKILLED: 82,
    ELECTRICIAN: 82,
    LABOR: 65,
    HOUSEKEEPING: 49,
    SECURITY: 49,
  };
  const insertEmployee = db.prepare(
    "INSERT INTO employees (id, name, nickname, crewId, position, ratePerDay, incentiveDailyRate, active) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
  );
  for (const emp of seed.employees) {
    const empId = slugify(emp.name);
    const incentive =
      emp.incentiveDailyRate ?? incentiveByPosition[emp.position] ?? null;
    insertEmployee.run(
      empId,
      emp.name,
      emp.nickname || null,
      emp.crew.toUpperCase(),
      emp.position,
      emp.rate,
      incentive,
      1
    );
  }

  // Insert pay period.
  // Prefer explicit dates from the seed (produced by the workbook importer);
  // fall back to deriving them from the attendance dates, then to a default.
  const allDates: string[] = [];
  for (const emp of seed.employees) {
    if (Array.isArray(emp.attendance)) {
      for (const rec of emp.attendance) if (rec?.date) allDates.push(rec.date);
    } else if (emp.attendance && typeof emp.attendance === "object") {
      for (const date of Object.keys(emp.attendance)) allDates.push(date);
    }
  }
  allDates.sort();
  const startDate = seed.startDate || allDates[0] || "2026-06-19";
  const endDate = seed.endDate || allDates[allDates.length - 1] || "2026-06-25";
  const payDate = seed.payDate || startDate;
  const label = seed.period || `${startDate}..${endDate}`;
  const periodId =
    label
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "PERIOD";

  const insertPeriod = db.prepare(
    "INSERT INTO pay_periods (id, label, startDate, endDate, payDate, status) VALUES (?, ?, ?, ?, ?, ?)"
  );
  insertPeriod.run(periodId, label, startDate, endDate, payDate, "open");

  // Insert attendance records. The importer emits an ARRAY of full records
  // ({date,status,otHours?,nightHours?,lateMinutes?,holiday?,isRestDay?}); the
  // legacy demo seed uses a { date: status } map. Support both.
  const insertAttendance = db.prepare(
    "INSERT INTO attendance (employeeId, date, status, amIn, amOut, pmIn, pmOut, otHours, nightHours, lateMinutes, holiday, isRestDay) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
  );
  for (const emp of seed.employees) {
    const empId = slugify(emp.name);
    const records: Array<{
      date: string;
      status: string;
      otHours?: number;
      nightHours?: number;
      lateMinutes?: number;
      holiday?: string;
      isRestDay?: boolean;
    }> = Array.isArray(emp.attendance)
      ? emp.attendance
      : Object.entries(emp.attendance || {}).map(([date, status]) => ({
          date,
          status: status as string,
        }));
    for (const rec of records) {
      insertAttendance.run(
        empId,
        rec.date,
        rec.status,
        null,
        null,
        null,
        null,
        rec.otHours ?? null,
        rec.nightHours ?? null,
        rec.lateMinutes ?? null,
        rec.holiday ?? null,
        rec.isRestDay ? 1 : null
      );
    }
  }

  // Insert default config
  const insertConfig = db.prepare(
    "INSERT OR REPLACE INTO config (id, data) VALUES (1, ?)"
  );
  insertConfig.run(JSON.stringify(DEFAULT_CONFIG));

  console.log("Database seeded successfully");
}

// Getter functions
export function getCrews(): Crew[] {
  const rows = db
    .prepare("SELECT id, name, foreman FROM crews ORDER BY id")
    .all() as Array<{
    id: string;
    name: string;
    foreman: string | null;
  }>;
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    foreman: row.foreman || undefined,
  }));
}

export function getEmployees(): Employee[] {
  const rows = db
    .prepare(
      "SELECT id, name, nickname, crewId, position, ratePerDay, incentiveDailyRate, active FROM employees ORDER BY name"
    )
    .all() as Array<{
    id: string;
    name: string;
    nickname: string | null;
    crewId: string;
    position: string;
    ratePerDay: number;
    incentiveDailyRate: number | null;
    active: number;
  }>;
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    nickname: row.nickname || "",
    crewId: row.crewId,
    position: row.position as any,
    ratePerDay: row.ratePerDay,
    incentiveDailyRate: row.incentiveDailyRate ?? undefined,
    active: row.active === 1,
  }));
}

export function getPayPeriods(): PayPeriod[] {
  const rows = db
    .prepare(
      "SELECT id, label, startDate, endDate, payDate, status FROM pay_periods ORDER BY startDate DESC"
    )
    .all() as Array<{
    id: string;
    label: string;
    startDate: string;
    endDate: string;
    payDate: string;
    status: string;
  }>;
  return rows.map((row) => ({
    id: row.id,
    label: row.label,
    startDate: row.startDate,
    endDate: row.endDate,
    payDate: row.payDate,
    status: row.status as any,
  }));
}

export function getAttendanceForPeriod(
  periodId: string
): Array<AttendanceRecord> {
  const period = db
    .prepare("SELECT startDate, endDate FROM pay_periods WHERE id = ?")
    .get(periodId) as {
    startDate: string;
    endDate: string;
  } | null;

  if (!period) {
    return [];
  }

  const rows = db
    .prepare(
      `SELECT employeeId, date, status, amIn, amOut, pmIn, pmOut, otHours, nightHours, lateMinutes, holiday, isRestDay
       FROM attendance
       WHERE date >= ? AND date <= ?
       ORDER BY date, employeeId`
    )
    .all(period.startDate, period.endDate) as Array<{
    employeeId: string;
    date: string;
    status: string;
    amIn: number | null;
    amOut: number | null;
    pmIn: number | null;
    pmOut: number | null;
    otHours: number | null;
    nightHours: number | null;
    lateMinutes: number | null;
    holiday: string | null;
    isRestDay: number | null;
  }>;

  return rows.map((row) => ({
    employeeId: row.employeeId,
    date: row.date,
    status: row.status as any,
    amIn: row.amIn,
    amOut: row.amOut,
    pmIn: row.pmIn,
    pmOut: row.pmOut,
    otHours: row.otHours ?? undefined,
    nightHours: row.nightHours ?? undefined,
    lateMinutes: row.lateMinutes ?? undefined,
    holiday: row.holiday as any,
    isRestDay: row.isRestDay === 1,
  }));
}

export function upsertAttendance(records: AttendanceRecord[]) {
  const stmt = db.prepare(
    `INSERT INTO attendance (employeeId, date, status, amIn, amOut, pmIn, pmOut, otHours, nightHours, lateMinutes, holiday, isRestDay)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(employeeId, date) DO UPDATE SET
       status=excluded.status,
       amIn=excluded.amIn,
       amOut=excluded.amOut,
       pmIn=excluded.pmIn,
       pmOut=excluded.pmOut,
       otHours=excluded.otHours,
       nightHours=excluded.nightHours,
       lateMinutes=excluded.lateMinutes,
       holiday=excluded.holiday,
       isRestDay=excluded.isRestDay`
  );

  const transaction = db.transaction(() => {
    for (const rec of records) {
      stmt.run(
        rec.employeeId,
        rec.date,
        rec.status,
        rec.amIn ?? null,
        rec.amOut ?? null,
        rec.pmIn ?? null,
        rec.pmOut ?? null,
        rec.otHours ?? null,
        rec.nightHours ?? null,
        rec.lateMinutes ?? null,
        rec.holiday ?? null,
        rec.isRestDay ? 1 : 0
      );
    }
  });

  transaction();
}

export function getEmployeeAttendance(
  employeeId: string,
  periodId: string
): AttendanceRecord[] {
  const period = db
    .prepare("SELECT startDate, endDate FROM pay_periods WHERE id = ?")
    .get(periodId) as {
    startDate: string;
    endDate: string;
  } | null;

  if (!period) {
    return [];
  }

  const rows = db
    .prepare(
      `SELECT employeeId, date, status, amIn, amOut, pmIn, pmOut, otHours, nightHours, lateMinutes, holiday, isRestDay
       FROM attendance
       WHERE employeeId = ? AND date >= ? AND date <= ?
       ORDER BY date`
    )
    .all(employeeId, period.startDate, period.endDate) as Array<{
    employeeId: string;
    date: string;
    status: string;
    amIn: number | null;
    amOut: number | null;
    pmIn: number | null;
    pmOut: number | null;
    otHours: number | null;
    nightHours: number | null;
    lateMinutes: number | null;
    holiday: string | null;
    isRestDay: number | null;
  }>;

  return rows.map((row) => ({
    employeeId: row.employeeId,
    date: row.date,
    status: row.status as any,
    amIn: row.amIn,
    amOut: row.amOut,
    pmIn: row.pmIn,
    pmOut: row.pmOut,
    otHours: row.otHours ?? undefined,
    nightHours: row.nightHours ?? undefined,
    lateMinutes: row.lateMinutes ?? undefined,
    holiday: row.holiday as any,
    isRestDay: row.isRestDay === 1,
  }));
}

export function getEmployeeDeductions(
  employeeId: string,
  periodId: string
): EmployeeDeductions | null {
  const row = db
    .prepare(
      `SELECT cashAdvance, employeeLoan, sssSalaryLoan, sssCalamityLoan, pagibigSalaryLoan, pagibigCalamityLoan,
              serviceIncentiveLeave, canteen, overpaid, adjustments
       FROM employee_deductions
       WHERE employeeId = ? AND periodId = ?`
    )
    .get(employeeId, periodId) as any;

  if (!row) {
    return {};
  }

  return {
    cashAdvance: row.cashAdvance,
    employeeLoan: row.employeeLoan,
    sssSalaryLoan: row.sssSalaryLoan,
    sssCalamityLoan: row.sssCalamityLoan,
    pagibigSalaryLoan: row.pagibigSalaryLoan,
    pagibigCalamityLoan: row.pagibigCalamityLoan,
    serviceIncentiveLeave: row.serviceIncentiveLeave,
    canteen: row.canteen,
    overpaid: row.overpaid,
    adjustments: row.adjustments,
  };
}

export function upsertEmployeeDeductions(
  employeeId: string,
  periodId: string,
  deductions: EmployeeDeductions
) {
  const stmt = db.prepare(
    `INSERT INTO employee_deductions (employeeId, periodId, cashAdvance, employeeLoan, sssSalaryLoan, sssCalamityLoan, pagibigSalaryLoan, pagibigCalamityLoan, serviceIncentiveLeave, canteen, overpaid, adjustments)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(employeeId, periodId) DO UPDATE SET
       cashAdvance=excluded.cashAdvance,
       employeeLoan=excluded.employeeLoan,
       sssSalaryLoan=excluded.sssSalaryLoan,
       sssCalamityLoan=excluded.sssCalamityLoan,
       pagibigSalaryLoan=excluded.pagibigSalaryLoan,
       pagibigCalamityLoan=excluded.pagibigCalamityLoan,
       serviceIncentiveLeave=excluded.serviceIncentiveLeave,
       canteen=excluded.canteen,
       overpaid=excluded.overpaid,
       adjustments=excluded.adjustments`
  );

  stmt.run(
    employeeId,
    periodId,
    deductions.cashAdvance ?? null,
    deductions.employeeLoan ?? null,
    deductions.sssSalaryLoan ?? null,
    deductions.sssCalamityLoan ?? null,
    deductions.pagibigSalaryLoan ?? null,
    deductions.pagibigCalamityLoan ?? null,
    deductions.serviceIncentiveLeave ?? null,
    deductions.canteen ?? null,
    deductions.overpaid ?? null,
    deductions.adjustments ?? null
  );
}

export function getConfig(): PayrollConfig {
  const row = db.prepare("SELECT data FROM config WHERE id = 1").get() as {
    data: string;
  } | null;

  if (!row) {
    return DEFAULT_CONFIG;
  }

  return JSON.parse(row.data) as PayrollConfig;
}

export function setConfig(config: PayrollConfig) {
  const stmt = db.prepare(
    "INSERT OR REPLACE INTO config (id, data) VALUES (1, ?)"
  );
  stmt.run(JSON.stringify(config));
}

export { db };
