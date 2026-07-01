import { Router, Request, Response } from "express";
import {
  getCrews,
  getEmployees,
  getPayPeriods,
  getAttendanceForPeriod,
  upsertAttendance,
  getEmployeeAttendance,
  getEmployeeDeductions,
  upsertEmployeeDeductions,
  getConfig,
  setConfig,
} from "./db.js";
import { calcPayslip } from "@brightem/engine";
import type {
  AttendanceRecord,
  PayrollCalcInput,
  PayslipResult,
} from "@brightem/shared";

const router = Router();

// GET /api/employees
router.get("/employees", (req: Request, res: Response) => {
  try {
    const employees = getEmployees();
    res.json(employees);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch employees" });
  }
});

// GET /api/crews
router.get("/crews", (req: Request, res: Response) => {
  try {
    const crews = getCrews();
    res.json(crews);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch crews" });
  }
});

// GET /api/periods
router.get("/periods", (req: Request, res: Response) => {
  try {
    const periods = getPayPeriods();
    res.json(periods);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch pay periods" });
  }
});

// GET /api/attendance?period=
router.get("/attendance", (req: Request, res: Response) => {
  try {
    const periodId = req.query.period as string;
    if (!periodId) {
      return res.status(400).json({ error: "period query parameter required" });
    }

    const records = getAttendanceForPeriod(periodId);
    res.json(records);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch attendance" });
  }
});

// POST /api/attendance
router.post("/attendance", (req: Request, res: Response) => {
  try {
    const records = req.body as AttendanceRecord[];
    if (!Array.isArray(records)) {
      return res.status(400).json({ error: "Body must be an array" });
    }

    upsertAttendance(records);
    res.json({ success: true, count: records.length });
  } catch (error) {
    res.status(500).json({ error: "Failed to upsert attendance" });
  }
});

// GET /api/payroll?period=
router.get("/payroll", (req: Request, res: Response) => {
  try {
    const periodId = req.query.period as string;
    if (!periodId) {
      return res.status(400).json({ error: "period query parameter required" });
    }

    const employees = getEmployees().filter((e) => e.active);
    const periods = getPayPeriods();
    const period = periods.find((p) => p.id === periodId);

    if (!period) {
      return res.status(404).json({ error: "Period not found" });
    }

    const config = getConfig();
    const payslips: PayslipResult[] = [];

    for (const employee of employees) {
      const attendance = getEmployeeAttendance(employee.id, periodId);
      const deductions = getEmployeeDeductions(employee.id, periodId) || {};

      const input: PayrollCalcInput = {
        employee,
        period,
        attendance,
        deductions,
        config,
      };

      const payslip = calcPayslip(input);
      payslips.push(payslip);
    }

    res.json(payslips);
  } catch (error) {
    console.error("Payroll calculation error:", error);
    res.status(500).json({ error: "Failed to calculate payroll" });
  }
});

// GET /api/payslip/:employeeId?period=
router.get("/payslip/:employeeId", (req: Request, res: Response) => {
  try {
    const { employeeId } = req.params;
    const periodId = req.query.period as string;

    if (!periodId) {
      return res.status(400).json({ error: "period query parameter required" });
    }

    const employees = getEmployees();
    const employee = employees.find((e) => e.id === employeeId);

    if (!employee) {
      return res.status(404).json({ error: "Employee not found" });
    }

    const periods = getPayPeriods();
    const period = periods.find((p) => p.id === periodId);

    if (!period) {
      return res.status(404).json({ error: "Period not found" });
    }

    const attendance = getEmployeeAttendance(employeeId, periodId);
    const deductions = getEmployeeDeductions(employeeId, periodId) || {};
    const config = getConfig();

    const input: PayrollCalcInput = {
      employee,
      period,
      attendance,
      deductions,
      config,
    };

    const payslip = calcPayslip(input);
    res.json(payslip);
  } catch (error) {
    console.error("Payslip calculation error:", error);
    res.status(500).json({ error: "Failed to calculate payslip" });
  }
});

// GET /api/config
router.get("/config", (req: Request, res: Response) => {
  try {
    const config = getConfig();
    res.json(config);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch config" });
  }
});

// PUT /api/config
router.put("/config", (req: Request, res: Response) => {
  try {
    const config = req.body;
    setConfig(config);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: "Failed to update config" });
  }
});

export default router;
