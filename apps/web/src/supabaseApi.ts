// ============================================================================
// SUPABASE DATA LAYER  (static frontend + Supabase Postgres backend)
// ----------------------------------------------------------------------------
// Reads master data (crews, employees, pay periods, attendance, deductions,
// config) from Supabase and runs the SAME pure @brightem/engine calcPayslip in
// the browser. No separate API server: the Vercel-hosted static site talks to
// Supabase directly with the anon key. Behavior is identical to the Express API
// and the in-memory localApi — same engine, same period logic.
//
// Enable with VITE_USE_SUPABASE=1 and provide:
//   VITE_SUPABASE_URL       = https://<project>.supabase.co
//   VITE_SUPABASE_ANON_KEY  = <anon public key>
// ============================================================================
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { DEFAULT_CONFIG } from '@brightem/shared';
import type {
  Employee,
  Position,
  Crew,
  PayPeriod,
  AttendanceRecord,
  EmployeeDeductions,
  EmployeeSkill,
  Task,
  TaskAssignment,
  MaterialRequest,
  MaterialItem,
  UnitProgress,
  MaterialReadiness,
  RoomPhoto,
  PayslipResult,
  PayrollConfig,
  PayrollCalcInput,
} from '@brightem/shared';
import { calcPayslip } from '@brightem/engine';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as
  | string
  | undefined;

let _client: SupabaseClient | null = null;
function sb(): SupabaseClient {
  if (_client) return _client;
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    throw new Error(
      'Supabase is not configured: set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY'
    );
  }
  _client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false },
  });
  return _client;
}

// --- row <-> domain mappers (snake_case DB <-> camelCase domain) ------------
function toCrew(r: any): Crew {
  return { id: r.id, name: r.name, foreman: r.foreman ?? undefined };
}

function toEmployee(r: any): Employee {
  return {
    id: r.id,
    name: r.name,
    nickname: r.nickname ?? '',
    crewId: r.crew_id,
    position: r.position,
    ratePerDay: Number(r.rate_per_day),
    incentiveDailyRate:
      r.incentive_daily_rate == null ? undefined : Number(r.incentive_daily_rate),
    active: !!r.active,
    age: r.age == null ? undefined : Number(r.age),
    idNo: r.id_no ?? undefined,
    photoUrl: r.photo_url ?? undefined,
    joinDate: r.join_date ?? undefined,
    sssNo: r.sss_no ?? undefined,
  };
}

function toPeriod(r: any): PayPeriod {
  return {
    id: r.id,
    label: r.label,
    startDate: r.start_date,
    endDate: r.end_date,
    payDate: r.pay_date,
    status: r.status,
  };
}

function toAttendance(r: any): AttendanceRecord {
  return {
    employeeId: r.employee_id,
    date: r.date,
    status: r.status,
    amIn: r.am_in ?? null,
    amOut: r.am_out ?? null,
    pmIn: r.pm_in ?? null,
    pmOut: r.pm_out ?? null,
    otHours: r.ot_hours == null ? undefined : Number(r.ot_hours),
    nightHours: r.night_hours == null ? undefined : Number(r.night_hours),
    lateMinutes: r.late_minutes == null ? undefined : Number(r.late_minutes),
    holiday: r.holiday ?? null,
    isRestDay: r.is_rest_day ?? false,
  };
}

function fromAttendance(rec: AttendanceRecord): Record<string, unknown> {
  return {
    employee_id: rec.employeeId,
    date: rec.date,
    status: rec.status,
    am_in: rec.amIn ?? null,
    am_out: rec.amOut ?? null,
    pm_in: rec.pmIn ?? null,
    pm_out: rec.pmOut ?? null,
    ot_hours: rec.otHours ?? null,
    night_hours: rec.nightHours ?? null,
    late_minutes: rec.lateMinutes ?? null,
    holiday: rec.holiday ?? null,
    is_rest_day: rec.isRestDay ?? false,
  };
}

function toDeductions(r: any): EmployeeDeductions {
  return {
    cashAdvance: num(r.cash_advance),
    employeeLoan: num(r.employee_loan),
    sssSalaryLoan: num(r.sss_salary_loan),
    sssCalamityLoan: num(r.sss_calamity_loan),
    pagibigSalaryLoan: num(r.pagibig_salary_loan),
    pagibigCalamityLoan: num(r.pagibig_calamity_loan),
    serviceIncentiveLeave: num(r.service_incentive_leave),
    canteen: num(r.canteen),
    overpaid: num(r.overpaid),
    adjustments: num(r.adjustments),
  };
}
function num(v: unknown): number | undefined {
  return v == null ? undefined : Number(v);
}

function toTask(r: any): Task {
  return {
    id: r.id,
    workDate: r.work_date,
    name: r.name,
    skillKey: r.skill_key,
    requiredManday: Number(r.required_manday) || 0,
    requiredHeadcount: Number(r.required_headcount) || 0,
    status: r.status,
    progress: r.progress ?? 'pending',
  };
}

function toMaterialItem(r: any): MaterialItem {
  return {
    name: r?.name ?? '',
    spec: r?.spec ?? '',
    quantity: Number(r?.quantity) || 0,
    unit: r?.unit ?? '',
    unitPrice: Number(r?.unitPrice) || 0,
    supplier: r?.supplier ?? '',
  };
}

function toMaterialRequest(r: any): MaterialRequest {
  return {
    id: r.id,
    requestNo: r.request_no ?? '',
    requestDate: r.request_date ?? '',
    requester: r.requester ?? '',
    site: r.site ?? '',
    neededBy: r.needed_by ?? '',
    taskId: r.task_id ?? undefined,
    status: r.status ?? 'requested',
    note: r.note ?? '',
    items: Array.isArray(r.items) ? r.items.map(toMaterialItem) : [],
  };
}

// --- query helpers ----------------------------------------------------------
async function fetchPeriods(): Promise<PayPeriod[]> {
  const { data, error } = await sb()
    .from('pay_periods')
    .select('*')
    .order('start_date', { ascending: false });
  if (error) throw error;
  return (data ?? []).map(toPeriod);
}

async function periodById(id: string): Promise<PayPeriod | undefined> {
  const { data, error } = await sb()
    .from('pay_periods')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  return data ? toPeriod(data) : undefined;
}

async function fetchConfig(): Promise<PayrollConfig> {
  const { data, error } = await sb()
    .from('config')
    .select('data')
    .eq('id', 1)
    .maybeSingle();
  if (error) throw error;
  return (data?.data as PayrollConfig) ?? JSON.parse(JSON.stringify(DEFAULT_CONFIG));
}

async function fetchDeductions(
  periodId: string
): Promise<Map<string, EmployeeDeductions>> {
  const { data, error } = await sb()
    .from('employee_deductions')
    .select('*')
    .eq('period_id', periodId);
  if (error) throw error;
  const map = new Map<string, EmployeeDeductions>();
  for (const r of data ?? []) map.set(r.employee_id, toDeductions(r));
  return map;
}

// --- exported API (drop-in shape identical to network/local api) ------------
export const supabaseApi = {
  async getEmployees(): Promise<Employee[]> {
    const { data, error } = await sb()
      .from('employees')
      .select('*')
      .order('name', { ascending: true });
    if (error) throw error;
    return (data ?? []).map(toEmployee);
  },

  async getCrews(): Promise<Crew[]> {
    const { data, error } = await sb()
      .from('crews')
      .select('*')
      .order('id', { ascending: true });
    if (error) throw error;
    return (data ?? []).map(toCrew);
  },

  async getPeriods(): Promise<PayPeriod[]> {
    return fetchPeriods();
  },

  async getAttendance(period: string): Promise<AttendanceRecord[]> {
    const p = await periodById(period);
    if (!p) return [];
    const { data, error } = await sb()
      .from('attendance')
      .select('*')
      .gte('date', p.startDate)
      .lte('date', p.endDate)
      .order('date', { ascending: true });
    if (error) throw error;
    return (data ?? []).map(toAttendance);
  },

  async updateAttendance(records: AttendanceRecord[]): Promise<void> {
    if (!records.length) return;
    const rows = records.map(fromAttendance);
    const { error } = await sb()
      .from('attendance')
      .upsert(rows, { onConflict: 'employee_id,date' });
    if (error) throw error;
  },

  async getPayroll(period: string): Promise<PayslipResult[]> {
    const p = await periodById(period);
    if (!p) return [];
    const [employees, config, deductions] = await Promise.all([
      this.getEmployees(),
      fetchConfig(),
      fetchDeductions(period),
    ]);
    const active = employees.filter((e) => e.active);
    // all attendance for the period, grouped by employee
    const { data, error } = await sb()
      .from('attendance')
      .select('*')
      .gte('date', p.startDate)
      .lte('date', p.endDate);
    if (error) throw error;
    const byEmp = new Map<string, AttendanceRecord[]>();
    for (const r of data ?? []) {
      const rec = toAttendance(r);
      const arr = byEmp.get(rec.employeeId) ?? [];
      arr.push(rec);
      byEmp.set(rec.employeeId, arr);
    }
    return active.map((employee) => {
      const input: PayrollCalcInput = {
        employee,
        period: p,
        attendance: (byEmp.get(employee.id) ?? []).sort((a, b) =>
          a.date.localeCompare(b.date)
        ),
        deductions: deductions.get(employee.id) ?? {},
        config,
      };
      return calcPayslip(input);
    });
  },

  async getPayslip(employeeId: string, period: string): Promise<PayslipResult> {
    const p = await periodById(period);
    const empty: PayslipResult = {
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
    if (!p) return empty;
    const [{ data: empRow, error: empErr }, config, deductions] =
      await Promise.all([
        sb().from('employees').select('*').eq('id', employeeId).maybeSingle(),
        fetchConfig(),
        fetchDeductions(period),
      ]);
    if (empErr) throw empErr;
    if (!empRow) return empty;
    const { data: att, error: attErr } = await sb()
      .from('attendance')
      .select('*')
      .eq('employee_id', employeeId)
      .gte('date', p.startDate)
      .lte('date', p.endDate)
      .order('date', { ascending: true });
    if (attErr) throw attErr;
    const input: PayrollCalcInput = {
      employee: toEmployee(empRow),
      period: p,
      attendance: (att ?? []).map(toAttendance),
      deductions: deductions.get(employeeId) ?? {},
      config,
    };
    return calcPayslip(input);
  },

  async getConfig(): Promise<PayrollConfig> {
    return fetchConfig();
  },

  async updateConfig(next: PayrollConfig): Promise<void> {
    const { error } = await sb()
      .from('config')
      .upsert({ id: 1, data: next }, { onConflict: 'id' });
    if (error) throw error;
  },

  async getEmployeeSkills(): Promise<EmployeeSkill[]> {
    const { data, error } = await sb()
      .from('employee_skills')
      .select('employee_id, skill_key, level');
    if (error) throw error;
    return (data ?? []).map((r: any) => ({
      employeeId: r.employee_id,
      skillKey: r.skill_key,
      level: Number(r.level) || 0,
    }));
  },

  async saveEmployeeSkills(skills: EmployeeSkill[]): Promise<void> {
    if (!skills.length) return;
    const rows = skills.map((s) => ({
      employee_id: s.employeeId,
      skill_key: s.skillKey,
      level: s.level,
      updated_at: new Date().toISOString(),
    }));
    const { error } = await sb()
      .from('employee_skills')
      .upsert(rows, { onConflict: 'employee_id,skill_key' });
    if (error) throw error;
  },

  async getTasks(date: string): Promise<Task[]> {
    const { data, error } = await sb()
      .from('tasks')
      .select('*')
      .eq('work_date', date)
      .order('created_at', { ascending: true });
    if (error) throw error;
    return (data ?? []).map(toTask);
  },

  async saveTask(task: Task): Promise<Task> {
    const row: any = {
      work_date: task.workDate,
      name: task.name,
      skill_key: task.skillKey,
      required_manday: task.requiredManday,
      required_headcount: task.requiredHeadcount,
      status: task.status,
      progress: task.progress ?? 'pending',
    };
    if (task.id) row.id = task.id;
    const { data, error } = await sb()
      .from('tasks')
      .upsert(row)
      .select('*')
      .single();
    if (error) throw error;
    return toTask(data);
  },

  async deleteTask(id: string): Promise<void> {
    const { error } = await sb().from('tasks').delete().eq('id', id);
    if (error) throw error;
  },

  async getAssignments(date: string): Promise<TaskAssignment[]> {
    const { data, error } = await sb()
      .from('task_assignments')
      .select('task_id, employee_id, work_date')
      .eq('work_date', date);
    if (error) throw error;
    return (data ?? []).map((r: any) => ({
      taskId: r.task_id,
      employeeId: r.employee_id,
      workDate: r.work_date,
    }));
  },

  async saveAssignments(date: string, rows: TaskAssignment[]): Promise<void> {
    // Replace all assignments for the given work day.
    const del = await sb().from('task_assignments').delete().eq('work_date', date);
    if (del.error) throw del.error;
    if (!rows.length) return;
    const insert = rows.map((r) => ({
      task_id: r.taskId,
      employee_id: r.employeeId,
      work_date: r.workDate,
    }));
    const { error } = await sb().from('task_assignments').insert(insert);
    if (error) throw error;
  },

  async getMaterialRequests(): Promise<MaterialRequest[]> {
    const { data, error } = await sb()
      .from('material_requests')
      .select('*')
      .order('request_date', { ascending: false })
      .order('created_at', { ascending: false });
    if (error) throw error;
    return (data ?? []).map(toMaterialRequest);
  },

  async saveMaterialRequest(req: MaterialRequest): Promise<MaterialRequest> {
    const row: any = {
      request_no: req.requestNo || null,
      request_date: req.requestDate || null,
      requester: req.requester || null,
      site: req.site || null,
      needed_by: req.neededBy || null,
      task_id: req.taskId || null,
      status: req.status,
      note: req.note || null,
      items: req.items ?? [],
    };
    if (req.id) row.id = req.id;
    const { data, error } = await sb()
      .from('material_requests')
      .upsert(row)
      .select('*')
      .single();
    if (error) throw error;
    return toMaterialRequest(data);
  },

  async deleteMaterialRequest(id: string): Promise<void> {
    const { error } = await sb().from('material_requests').delete().eq('id', id);
    if (error) throw error;
  },

  async getUnitProgress(floor: number): Promise<UnitProgress[]> {
    const { data, error } = await sb()
      .from('unit_progress')
      .select('floor, room, work_item, status')
      .eq('floor', floor);
    if (error) throw error;
    return (data ?? []).map((r: any) => ({
      floor: Number(r.floor),
      room: Number(r.room),
      workItem: r.work_item,
      status: r.status,
    }));
  },

  async saveUnitProgress(entry: UnitProgress): Promise<void> {
    const { error } = await sb()
      .from('unit_progress')
      .upsert(
        {
          floor: entry.floor,
          room: entry.room,
          work_item: entry.workItem,
          status: entry.status,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'floor,room,work_item' }
      );
    if (error) throw error;
  },

  async getMaterialReadiness(floor: number): Promise<MaterialReadiness[]> {
    const { data, error } = await sb()
      .from('material_readiness')
      .select('floor, material, stage, note, delivered_rooms, ongoing_rooms, room_details')
      .eq('floor', floor);
    if (error) throw error;
    return (data ?? []).map((r: any) => ({
      floor: Number(r.floor),
      material: r.material,
      stage: r.stage,
      note: r.note ?? '',
      deliveredRooms: (r.delivered_rooms ?? []).map((n: any) => Number(n)),
      ongoingRooms: (r.ongoing_rooms ?? []).map((n: any) => Number(n)),
      roomDetails: (r.room_details ?? []).map((d: any) => ({
        room: Number(d.room),
        pieces: Number(d.pieces) || 0,
        memo: d.memo ?? undefined,
      })),
    }));
  },

  async saveMaterialReadiness(entry: MaterialReadiness): Promise<void> {
    const { error } = await sb()
      .from('material_readiness')
      .upsert(
        {
          floor: entry.floor,
          material: entry.material,
          stage: entry.stage,
          note: entry.note ?? null,
          delivered_rooms: entry.deliveredRooms ?? [],
          ongoing_rooms: entry.ongoingRooms ?? [],
          room_details: entry.roomDetails ?? [],
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'floor,material' }
      );
    if (error) throw error;
  },

  // --- Room photos (stored in the 'room-photos' storage bucket) -------------
  async getRoomPhotos(floor: number, room: number): Promise<RoomPhoto[]> {
    const { data, error } = await sb()
      .from('room_photos')
      .select('id, floor, room, path, caption, created_at')
      .eq('floor', floor)
      .eq('room', room)
      .order('created_at', { ascending: false });
    if (error) throw error;
    const bucket = sb().storage.from('room-photos');
    return (data ?? []).map((r: any) => ({
      id: r.id,
      floor: Number(r.floor),
      room: Number(r.room),
      url: bucket.getPublicUrl(r.path).data.publicUrl,
      caption: r.caption ?? undefined,
      createdAt: r.created_at,
    }));
  },

  async addRoomPhoto(floor: number, room: number, file: File): Promise<RoomPhoto> {
    const ext = (file.name.split('.').pop() || 'jpg').toLowerCase();
    const path = `${floor}/${room}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
    const bucket = sb().storage.from('room-photos');
    const up = await bucket.upload(path, file, {
      contentType: file.type || 'image/jpeg',
      upsert: false,
    });
    if (up.error) throw up.error;
    const { data, error } = await sb()
      .from('room_photos')
      .insert({ floor, room, path })
      .select('id, floor, room, path, caption, created_at')
      .single();
    if (error) throw error;
    return {
      id: data.id,
      floor: Number(data.floor),
      room: Number(data.room),
      url: bucket.getPublicUrl(data.path).data.publicUrl,
      caption: data.caption ?? undefined,
      createdAt: data.created_at,
    };
  },

  async deleteRoomPhoto(id: string): Promise<void> {
    const client = sb();
    const { data, error } = await client
      .from('room_photos')
      .select('path')
      .eq('id', id)
      .single();
    if (error) throw error;
    if (data?.path) {
      await client.storage.from('room-photos').remove([data.path]);
    }
    const del = await client.from('room_photos').delete().eq('id', id);
    if (del.error) throw del.error;
  },

  // --- Create a new worker --------------------------------------------------
  async createEmployee(input: {
    name: string;
    nickname?: string;
    crewId: string;
    position: Position;
    ratePerDay: number;
    age?: number | null;
    idNo?: string | null;
    joinDate?: string | null;
    sssNo?: string | null;
  }): Promise<Employee> {
    const base =
      input.name
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '') || 'worker';
    const id = `${base}-${Date.now().toString(36).slice(-4)}`;
    const row = {
      id,
      name: input.name.trim(),
      nickname: input.nickname?.trim() || null,
      crew_id: input.crewId,
      position: input.position,
      rate_per_day: input.ratePerDay,
      active: true,
      age: input.age ?? null,
      id_no: input.idNo?.trim() || null,
      join_date: input.joinDate || null,
      sss_no: input.sssNo?.trim() || null,
    };
    const { data, error } = await sb()
      .from('employees')
      .insert(row)
      .select()
      .single();
    if (error) throw error;
    return toEmployee(data);
  },

  // --- Update an existing worker (all editable fields) ----------------------
  async updateEmployee(
    employeeId: string,
    patch: {
      name?: string;
      nickname?: string | null;
      crewId?: string;
      position?: Position;
      ratePerDay?: number;
      age?: number | null;
      idNo?: string | null;
      joinDate?: string | null;
      sssNo?: string | null;
    }
  ): Promise<Employee> {
    const row: any = {};
    if (patch.name !== undefined) row.name = patch.name.trim();
    if (patch.nickname !== undefined) row.nickname = patch.nickname?.trim() || null;
    if (patch.crewId !== undefined) row.crew_id = patch.crewId;
    if (patch.position !== undefined) row.position = patch.position;
    if (patch.ratePerDay !== undefined) row.rate_per_day = patch.ratePerDay;
    if (patch.age !== undefined) row.age = patch.age ?? null;
    if (patch.idNo !== undefined) row.id_no = patch.idNo?.trim() || null;
    if (patch.joinDate !== undefined) row.join_date = patch.joinDate || null;
    if (patch.sssNo !== undefined) row.sss_no = patch.sssNo?.trim() || null;
    const { data, error } = await sb()
      .from('employees')
      .update(row)
      .eq('id', employeeId)
      .select()
      .single();
    if (error) throw error;
    return toEmployee(data);
  },

  // --- Employee ID info (age / id number / photo) ---------------------------
  async updateEmployeeInfo(
    employeeId: string,
    patch: { age?: number | null; idNo?: string | null }
  ): Promise<void> {
    const row: any = {};
    if ('age' in patch) row.age = patch.age ?? null;
    if ('idNo' in patch) row.id_no = patch.idNo ?? null;
    if (!Object.keys(row).length) return;
    const { error } = await sb().from('employees').update(row).eq('id', employeeId);
    if (error) throw error;
  },

  async uploadEmployeePhoto(employeeId: string, file: File): Promise<string> {
    const ext = (file.name.split('.').pop() || 'jpg').toLowerCase();
    const path = `employees/${employeeId}/${Date.now()}-${Math.random()
      .toString(36)
      .slice(2, 8)}.${ext}`;
    const bucket = sb().storage.from('room-photos');
    const up = await bucket.upload(path, file, {
      contentType: file.type || 'image/jpeg',
      upsert: false,
    });
    if (up.error) throw up.error;
    const url = bucket.getPublicUrl(path).data.publicUrl;
    const { error } = await sb()
      .from('employees')
      .update({ photo_url: url })
      .eq('id', employeeId);
    if (error) throw error;
    return url;
  },
};

export type SupabaseApi = typeof supabaseApi;
