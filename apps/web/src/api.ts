import type {
  Employee,
  Crew,
  PayPeriod,
  AttendanceRecord,
  EmployeeSkill,
  Task,
  TaskAssignment,
  MaterialRequest,
  UnitProgress,
  MaterialReadiness,
  RoomPhoto,
  PayslipResult,
  PayrollConfig,
} from '@brightem/shared';
import { localApi } from './localApi';
import { supabaseApi } from './supabaseApi';

const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:4000';

// When built for a static (backend-free) deployment, run everything in the
// browser via the shared payroll engine. Enabled with VITE_USE_LOCAL=1.
const USE_LOCAL = import.meta.env.VITE_USE_LOCAL === '1';

// When built for the Vercel + Supabase deployment, read data straight from
// Supabase and run the engine client-side. Enabled with VITE_USE_SUPABASE=1.
const USE_SUPABASE = import.meta.env.VITE_USE_SUPABASE === '1';

// Flag to enable mock fallback if API is unreachable
let USE_MOCK = false;

// Small mock data sample derived from types
const MOCK_DATA = {
  employees: [
    {
      id: 'abadilla-cocoy',
      name: 'ABADILLA , COCOY',
      nickname: 'COCOY',
      crewId: 'FOREMAN',
      position: 'SKILLED',
      ratePerDay: 540,
      active: true,
    } as Employee,
    {
      id: 'gomez-reneboy',
      name: 'GOMEZ, RENEBOY',
      nickname: 'RENEBOY',
      crewId: 'ANTHONY',
      position: 'LABOR',
      ratePerDay: 540,
      active: true,
    } as Employee,
  ],
  crews: [
    { id: 'FOREMAN', name: 'FOREMAN', foreman: 'FOREMAN' } as Crew,
    { id: 'ANTHONY', name: 'ANTHONY', foreman: 'ANTHONY' } as Crew,
  ] as Crew[],
  periods: [
    {
      id: 'period-jun-19-25',
      label: 'JUNE 19-25, 2026',
      startDate: '2026-06-19',
      endDate: '2026-06-25',
      payDate: '2026-06-27',
      status: 'open' as const,
    } as PayPeriod,
  ],
};

// Graceful fetch wrapper
async function fetchApi<T>(endpoint: string, options?: RequestInit): Promise<T> {
  try {
    const url = `${API_URL}${endpoint}`;
    const response = await fetch(url, {
      headers: {
        'Content-Type': 'application/json',
        ...options?.headers,
      },
      ...options,
    });

    if (!response.ok) {
      throw new Error(`API error: ${response.status}`);
    }

    return await response.json();
  } catch (error) {
    console.warn(`API call failed for ${endpoint}:`, error);
    USE_MOCK = true;
    throw error;
  }
}

// API endpoints
const networkApi = {
  // Master data
  async getEmployees(): Promise<Employee[]> {
    try {
      return await fetchApi<Employee[]>('/api/employees');
    } catch {
      return MOCK_DATA.employees;
    }
  },

  async getCrews(): Promise<Crew[]> {
    try {
      return await fetchApi<Crew[]>('/api/crews');
    } catch {
      return MOCK_DATA.crews;
    }
  },

  async getPeriods(): Promise<PayPeriod[]> {
    try {
      return await fetchApi<PayPeriod[]>('/api/periods');
    } catch {
      return MOCK_DATA.periods;
    }
  },

  // Attendance
  async getAttendance(period: string): Promise<AttendanceRecord[]> {
    try {
      return await fetchApi<AttendanceRecord[]>(`/api/attendance?period=${period}`);
    } catch {
      return [];
    }
  },

  async updateAttendance(records: AttendanceRecord[]): Promise<void> {
    await fetchApi('/api/attendance', {
      method: 'POST',
      body: JSON.stringify(records),
    });
  },

  // Payroll
  async getPayroll(period: string): Promise<PayslipResult[]> {
    try {
      return await fetchApi<PayslipResult[]>(`/api/payroll?period=${period}`);
    } catch {
      return [];
    }
  },

  async getPayslip(employeeId: string, period: string): Promise<PayslipResult> {
    try {
      return await fetchApi<PayslipResult>(
        `/api/payslip/${employeeId}?period=${period}`
      );
    } catch {
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
  },

  // Configuration
  async getConfig(): Promise<PayrollConfig> {
    try {
      return await fetchApi<PayrollConfig>('/api/config');
    } catch {
      return {
        currency: 'PHP',
        standardHoursPerDay: 8,
        incentiveDailyRate: 10,
        overtime: {
          regularDay: 1.25,
          restDay: 0.3,
          specialHoliday: 0.3,
          legalHoliday: 1.0,
        },
        nightDifferential: {
          windowStart: 22,
          windowEnd: 6,
          ratePct: 0.1,
        },
        contributions: [],
      };
    }
  },

  async updateConfig(config: PayrollConfig): Promise<void> {
    await fetchApi('/api/config', {
      method: 'PUT',
      body: JSON.stringify(config),
    });
  },

  async getEmployeeSkills(): Promise<EmployeeSkill[]> {
    try {
      return await fetchApi<EmployeeSkill[]>('/api/employee-skills');
    } catch {
      return [];
    }
  },

  async saveEmployeeSkills(skills: EmployeeSkill[]): Promise<void> {
    await fetchApi('/api/employee-skills', {
      method: 'POST',
      body: JSON.stringify(skills),
    });
  },

  async getTasks(date: string): Promise<Task[]> {
    try {
      return await fetchApi<Task[]>(`/api/tasks?date=${date}`);
    } catch {
      return [];
    }
  },

  async saveTask(task: Task): Promise<Task> {
    return await fetchApi<Task>('/api/tasks', {
      method: 'POST',
      body: JSON.stringify(task),
    });
  },

  async deleteTask(id: string): Promise<void> {
    await fetchApi(`/api/tasks/${id}`, { method: 'DELETE' });
  },

  async getAssignments(date: string): Promise<TaskAssignment[]> {
    try {
      return await fetchApi<TaskAssignment[]>(`/api/assignments?date=${date}`);
    } catch {
      return [];
    }
  },

  async saveAssignments(date: string, rows: TaskAssignment[]): Promise<void> {
    await fetchApi('/api/assignments', {
      method: 'POST',
      body: JSON.stringify({ date, rows }),
    });
  },

  async getMaterialRequests(): Promise<MaterialRequest[]> {
    try {
      return await fetchApi<MaterialRequest[]>('/api/material-requests');
    } catch {
      return [];
    }
  },

  async saveMaterialRequest(req: MaterialRequest): Promise<MaterialRequest> {
    return await fetchApi<MaterialRequest>('/api/material-requests', {
      method: 'POST',
      body: JSON.stringify(req),
    });
  },

  async deleteMaterialRequest(id: string): Promise<void> {
    await fetchApi(`/api/material-requests/${id}`, { method: 'DELETE' });
  },

  async getUnitProgress(floor: number): Promise<UnitProgress[]> {
    try {
      return await fetchApi<UnitProgress[]>(`/api/unit-progress?floor=${floor}`);
    } catch {
      return [];
    }
  },

  async saveUnitProgress(entry: UnitProgress): Promise<void> {
    await fetchApi('/api/unit-progress', {
      method: 'POST',
      body: JSON.stringify(entry),
    });
  },

  async getMaterialReadiness(floor: number): Promise<MaterialReadiness[]> {
    try {
      return await fetchApi<MaterialReadiness[]>(`/api/material-readiness?floor=${floor}`);
    } catch {
      return [];
    }
  },

  async saveMaterialReadiness(entry: MaterialReadiness): Promise<void> {
    await fetchApi('/api/material-readiness', {
      method: 'POST',
      body: JSON.stringify(entry),
    });
  },

  // Room photos — held in memory (this network layer is a mock fallback; the
  // production Supabase layer persists them to storage).
  async getRoomPhotos(floor: number, room: number): Promise<RoomPhoto[]> {
    return _photos
      .filter((p) => p.floor === floor && p.room === room)
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  },
  async addRoomPhoto(floor: number, room: number, file: File): Promise<RoomPhoto> {
    const url: string = await new Promise((resolve) => {
      const fr = new FileReader();
      fr.onload = () => resolve(String(fr.result));
      fr.readAsDataURL(file);
    });
    const photo: RoomPhoto = {
      id: `photo-${_photoSeq++}`,
      floor,
      room,
      url,
      createdAt: new Date().toISOString(),
    };
    _photos.push(photo);
    return photo;
  },
  async deleteRoomPhoto(id: string): Promise<void> {
    const i = _photos.findIndex((p) => p.id === id);
    if (i >= 0) _photos.splice(i, 1);
  },
  async createEmployee(input: {
    name: string;
    nickname?: string;
    crewId: string;
    position: Employee['position'];
    ratePerDay: number;
    age?: number | null;
    idNo?: string | null;
    joinDate?: string | null;
    sssNo?: string | null;
  }): Promise<Employee> {
    const created = await fetchApi<Employee>('/api/employees', {
      method: 'POST',
      body: JSON.stringify(input),
    });
    return created;
  },
  async updateEmployee(
    employeeId: string,
    patch: {
      name?: string;
      nickname?: string | null;
      crewId?: string;
      position?: Employee['position'];
      ratePerDay?: number;
      age?: number | null;
      idNo?: string | null;
      joinDate?: string | null;
      sssNo?: string | null;
    }
  ): Promise<Employee> {
    const updated = await fetchApi<Employee>(
      `/api/employees/${encodeURIComponent(employeeId)}`,
      { method: 'PUT', body: JSON.stringify(patch) }
    );
    return updated;
  },
  async updateEmployeeInfo(
    employeeId: string,
    patch: { age?: number | null; idNo?: string | null }
  ): Promise<void> {
    await fetchApi(`/api/employees/${encodeURIComponent(employeeId)}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    });
  },
  async uploadEmployeePhoto(employeeId: string, file: File): Promise<string> {
    const url: string = await new Promise((resolve) => {
      const fr = new FileReader();
      fr.onload = () => resolve(String(fr.result));
      fr.readAsDataURL(file);
    });
    _employeePhotos[employeeId] = url;
    return url;
  },
};

const _photos: RoomPhoto[] = [];
let _photoSeq = 1;
const _employeePhotos: Record<string, string> = {};

// Pick the data source at build time. Supabase (Vercel deploy) and local
// (fully static/offline) both run the pure engine in the browser; otherwise
// fall back to the network-backed Express API. Same shape either way.
export const api = USE_SUPABASE ? supabaseApi : USE_LOCAL ? localApi : networkApi;

export { USE_MOCK };
