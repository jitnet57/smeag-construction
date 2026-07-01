# Integration Contract — BRIGHTEM Payroll & Attendance

All three tracks build against `@brightem/shared` (`packages/shared/src`). Do not
redefine domain types; import them.

## Monorepo layout
```
payroll-app/
  packages/shared   @brightem/shared  — domain types + DEFAULT_CONFIG (DONE)
  packages/engine   @brightem/engine  — pure payroll calc engine (Track A)
  apps/api          @brightem/api     — Express + SQLite REST API (Track B)
  apps/web          @brightem/web     — React + Vite + Tailwind UI (Track C)
```

## Engine contract (Track A)
Export `calcPayslip(input: PayrollCalcInput): PayslipResult` — a PURE function.
Earnings must mirror the real BRIGHTEM payslip lines: Basic (rate×workedDays),
OT on Reg Day, Incentive (incentiveDailyRate × workedDays), DRD/holiday pay,
Night Differential, Special/Legal Holiday, Absent/LWOP (negative), Late/undertime.
Deductions: SSS, PhilHealth, Pag-IBIG (from config.contributions), plus per-run
manual deductions (cash advance, loans, canteen, overpaid, adjustments).
Ship Vitest unit tests including the known case: rate 540 × 6 days = 3240 basic.

## API contract (Track B)  — base URL `/api`
- `GET  /api/employees`            list employees (+crew, position, rate)
- `GET  /api/crews`               list crews
- `GET  /api/periods`             list pay periods
- `GET  /api/attendance?period=`  attendance grid for a period
- `POST /api/attendance`          upsert attendance records
- `GET  /api/payroll?period=`     calculated payslips for all employees (uses engine)
- `GET  /api/payslip/:employeeId?period=`  single payslip
- `GET  /api/config` / `PUT /api/config`   payroll config (statutory tables)
Seed the DB from `apps/api/src/seed.json` on first run (143 employees, 7 crews,
attendance for period JUNE 19-25 2026). Use better-sqlite3. Enable CORS.
Default port 4000.

## Web contract (Track C)
React + Vite + TypeScript + Tailwind. Six screens matching the approved mockup
(`../급여관리 시스템_화면목업.html`): Dashboard, Attendance Entry, Payroll Table,
Payslip, Employee Master, Settings. Colors: primary #2E75B6, dark #15304e.
Fetch from the API base URL (env `VITE_API_URL`, default `http://localhost:4000`).
Korean UI labels. Default dev port 5173.
