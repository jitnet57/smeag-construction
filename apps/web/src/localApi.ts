// ============================================================================
// BROWSER DATA LAYER (static / serverless-free deployment)
// ----------------------------------------------------------------------------
// Mirrors apps/api/src/db.ts (seedIfEmpty + getters) entirely in memory and
// runs the SAME pure @brightem/engine calcPayslip in the browser, so the app
// can be deployed as a fully static site with no backend, no SQLite. Behavior
// is identical to the API: same seed, same period derivation, same engine.
// Attendance/config edits persist for the browser session (in memory).
// ============================================================================
import { DEFAULT_CONFIG } from '@brightem/shared';
import type {
  Employee,
  Crew,
  PayPeriod,
  AttendanceRecord,
  EmployeeDeductions,
  EmployeeSkill,
  Task,
  TaskAssignment,
  PayslipResult,
  PayrollConfig,
  PayrollCalcInput,
} from '@brightem/shared';
import { calcPayslip } from '@brightem/engine';
import seed from './seed.json';

// --- helpers (mirror db.ts) -------------------------------------------------
function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

const incentiveByPosition: Record<string, number> = {
  SKILLED: 82,
  ELECTRICIAN: 82,
  LABOR: 65,
  HOUSEKEEPING: 49,
  SECURITY: 49,
};

interface SeedEmployee {
  name: string;
  nickname?: string;
  crew: string;
  position: string;
  rate: number;
  incentiveDailyRate?: number;
  attendance?:
    | Record<string, string>
    | Array<{
        date: string;
        status: string;
        otHours?: number;
        nightHours?: number;
        lateMinutes?: number;
        holiday?: string;
        isRestDay?: boolean;
      }>;
}

interface SeedShape {
  period?: string;
  startDate?: string;
  endDate?: string;
  payDate?: string;
  crews: string[];
  employees: SeedEmployee[];
}

const S = seed as unknown as SeedShape;

// --- build in-memory state (mirror seedIfEmpty) -----------------------------
const crews: Crew[] = S.crews
  .map((name) => ({ id: name.toUpperCase(), name, foreman: undefined }))
  .sort((a, b) => a.id.localeCompare(b.id));

const employees: Employee[] = S.employees
  .map((emp) => {
    const incentive =
      emp.incentiveDailyRate ?? incentiveByPosition[emp.position] ?? undefined;
    return {
      id: slugify(emp.name),
      name: emp.name,
      nickname: emp.nickname || '',
      crewId: emp.crew.toUpperCase(),
      position: emp.position as Employee['position'],
      ratePerDay: emp.rate,
      incentiveDailyRate: incentive,
      active: true,
    } as Employee;
  })
  .sort((a, b) => a.name.localeCompare(b.name));

// attendance store (flat array), keyed logically by employeeId+date
let attendance: AttendanceRecord[] = [];
const allDates: string[] = [];
for (const emp of S.employees) {
  const empId = slugify(emp.name);
  const recs = Array.isArray(emp.attendance)
    ? emp.attendance
    : Object.entries(emp.attendance || {}).map(([date, status]) => ({
        date,
        status: status as string,
      }));
  for (const rec of recs) {
    if (rec?.date) allDates.push(rec.date);
    attendance.push({
      employeeId: empId,
      date: rec.date,
      status: rec.status as AttendanceRecord['status'],
      otHours: (rec as any).otHours ?? undefined,
      nightHours: (rec as any).nightHours ?? undefined,
      lateMinutes: (rec as any).lateMinutes ?? undefined,
      holiday: (rec as any).holiday ?? undefined,
      isRestDay: (rec as any).isRestDay ?? false,
    });
  }
}
allDates.sort();

const startDate = S.startDate || allDates[0] || '2026-06-19';
const endDate = S.endDate || allDates[allDates.length - 1] || '2026-06-25';
const payDate = S.payDate || startDate;
const label = S.period || `${startDate}..${endDate}`;
const periodId =
  label
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'PERIOD';

const periods: PayPeriod[] = [
  {
    id: periodId,
    label,
    startDate,
    endDate,
    payDate,
    status: 'open',
  },
];

const deductionsByKey = new Map<string, EmployeeDeductions>();
const skills = new Map<string, EmployeeSkill>(); // key: `${employeeId}::${skillKey}`
const tasks = new Map<string, Task>(); // key: task.id
let assignments: TaskAssignment[] = [];
let taskSeq = 1;
let config: PayrollConfig = JSON.parse(JSON.stringify(DEFAULT_CONFIG));

// --- query helpers ----------------------------------------------------------
function periodById(id: string): PayPeriod | undefined {
  return periods.find((p) => p.id === id);
}

function attendanceForPeriod(periodIdArg: string): AttendanceRecord[] {
  const p = periodById(periodIdArg);
  if (!p) return [];
  return attendance
    .filter((r) => r.date >= p.startDate && r.date <= p.endDate)
    .sort((a, b) =>
      a.date === b.date
        ? a.employeeId.localeCompare(b.employeeId)
        : a.date.localeCompare(b.date)
    );
}

function employeeAttendance(
  employeeId: string,
  periodIdArg: string
): AttendanceRecord[] {
  const p = periodById(periodIdArg);
  if (!p) return [];
  return attendance
    .filter(
      (r) =>
        r.employeeId === employeeId &&
        r.date >= p.startDate &&
        r.date <= p.endDate
    )
    .sort((a, b) => a.date.localeCompare(b.date));
}

// --- exported API (drop-in shape identical to network api) ------------------
export const localApi = {
  async getEmployees(): Promise<Employee[]> {
    return employees;
  },
  async getCrews(): Promise<Crew[]> {
    return crews;
  },
  async getPeriods(): Promise<PayPeriod[]> {
    return periods;
  },
  async getAttendance(period: string): Promise<AttendanceRecord[]> {
    return attendanceForPeriod(period);
  },
  async updateAttendance(records: AttendanceRecord[]): Promise<void> {
    for (const rec of records) {
      const idx = attendance.findIndex(
        (r) => r.employeeId === rec.employeeId && r.date === rec.date
      );
      if (idx >= 0) attendance[idx] = { ...attendance[idx], ...rec };
      else attendance.push({ ...rec });
    }
  },
  async getPayroll(period: string): Promise<PayslipResult[]> {
    const p = periodById(period);
    if (!p) return [];
    const out: PayslipResult[] = [];
    for (const employee of employees.filter((e) => e.active)) {
      const input: PayrollCalcInput = {
        employee,
        period: p,
        attendance: employeeAttendance(employee.id, period),
        deductions: deductionsByKey.get(`${employee.id}|${period}`) || {},
        config,
      };
      out.push(calcPayslip(input));
    }
    return out;
  },
  async getPayslip(
    employeeId: string,
    period: string
  ): Promise<PayslipResult> {
    const employee = employees.find((e) => e.id === employeeId);
    const p = periodById(period);
    if (!employee || !p) {
      return {
        employeeId,
        periodId: period,
        earnings: [],
        grossPay: 0,
        deductions: [],
        totalDeductions: 0,
        netPay: 0,
        workedDays: 0,
        absentDays: 0,
      };
    }
    const input: PayrollCalcInput = {
      employee,
      period: p,
      attendance: employeeAttendance(employeeId, period),
      deductions: deductionsByKey.get(`${employeeId}|${period}`) || {},
      config,
    };
    return calcPayslip(input);
  },
  async getConfig(): Promise<PayrollConfig> {
    return config;
  },
  async updateConfig(next: PayrollConfig): Promise<void> {
    config = next;
  },
  async getEmployeeSkills(): Promise<EmployeeSkill[]> {
    return Array.from(skills.values());
  },
  async saveEmployeeSkills(next: EmployeeSkill[]): Promise<void> {
    for (const s of next) {
      skills.set(`${s.employeeId}::${s.skillKey}`, { ...s });
    }
  },
  async getTasks(date: string): Promise<Task[]> {
    return Array.from(tasks.values()).filter((tk) => tk.workDate === date);
  },
  async saveTask(task: Task): Promise<Task> {
    const id = task.id || `task-${taskSeq++}`;
    const saved: Task = { ...task, id };
    tasks.set(id, saved);
    return saved;
  },
  async deleteTask(id: string): Promise<void> {
    tasks.delete(id);
    assignments = assignments.filter((a) => a.taskId !== id);
  },
  async getAssignments(date: string): Promise<TaskAssignment[]> {
    return assignments.filter((a) => a.workDate === date);
  },
  async saveAssignments(date: string, rows: TaskAssignment[]): Promise<void> {
    assignments = assignments.filter((a) => a.workDate !== date);
    assignments.push(...rows.map((r) => ({ ...r })));
  },
};

export type LocalApi = typeof localApi;
