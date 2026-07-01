/**
 * IMPORT A BRIGHTEM PAYROLL WORKBOOK -> seed.json
 * ---------------------------------------------------------------------------
 * Turns the company's own weekly Excel workbook (the format of
 * "BRIGHTEM CONSTRUCTION PAYROLL <period>.xlsx") into the app's seed file so
 * that real data can be applied immediately:
 *
 *     npm run import -- "/path/to/BRIGHTEM CONSTRUCTION PAYROLL ....xlsx"
 *     npm run seed          # loads the freshly generated seed.json into SQLite
 *
 * The PAYROLL SHEET is treated as the AUTHORITATIVE source (its own
 * ABSENCES / INCENTIVE / RATE columns are what produce the printed payslips),
 * matching how the company finalizes pay. A second argument overrides the
 * output path (default: src/seed.json next to this file).
 *
 * Reads (PAYROLL SHEET, data rows from row 7):
 *   H name · I nickname · L position · N rate/day · O working days ·
 *   Q DRD days · S special-holiday days · U legal-holiday days · W reg OT hrs ·
 *   AI night hrs · AR days present · AS incentive daily rate · AU absences ·
 *   AW late hours
 * A blank incentive cell is imported as 0 (no incentive), exactly as the sheet
 * treats it — NOT as a fallback rate.
 */
import XLSX from "xlsx";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// -- column letters -> 0-based index -----------------------------------------
function col(letter: string): number {
  let n = 0;
  for (const ch of letter) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}
const C = {
  no: col("G"),
  name: col("H"),
  nickname: col("I"),
  position: col("L"),
  rate: col("N"),
  workingDays: col("O"),
  drdDays: col("Q"),
  specialHol: col("S"),
  legalHol: col("U"),
  otHours: col("W"),
  nightHours: col("AI"),
  present: col("AR"),
  incentive: col("AS"),
  absences: col("AU"),
  lateHours: col("AW"),
};

function num(v: unknown): number {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? ""));
  return Number.isFinite(n) ? n : 0;
}
function str(v: unknown): string {
  return String(v ?? "").trim();
}
// SheetJS (cellDates:true) returns each date as LOCAL midnight. Formatting via
// toISOString()/getUTC* reads it in UTC and rolls back a day in +offset zones
// (e.g. Asia/Manila GMT+8). Use LOCAL components so the date is correct in any TZ.
function iso(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

type SeedAttendance = {
  date: string;
  status: "full" | "half" | "absent";
  otHours?: number;
  nightHours?: number;
  lateMinutes?: number;
  isRestDay?: boolean;
  holiday?: "special" | "legal";
};

function main() {
  const inputPath = process.argv[2];
  if (!inputPath) {
    console.error(
      'Usage: npm run import -- "/path/to/BRIGHTEM CONSTRUCTION PAYROLL <period>.xlsx" [outSeed.json]'
    );
    process.exit(1);
  }
  const outPath = process.argv[3] || path.join(__dirname, "seed.json");

  const wb = XLSX.readFile(inputPath, { cellDates: true });

  // ---- period dates (from ATTENDANCE header row: the 7 dated columns) ------
  const attSheet = wb.Sheets["ATTENDANCE"];
  const periodDates: Date[] = [];
  if (attSheet) {
    // readFile above uses cellDates:true, so date cells are JS Date objects.
    // raw:true passes them through unchanged (raw:false would stringify them).
    const rows = XLSX.utils.sheet_to_json<any[]>(attSheet, {
      header: 1,
      raw: true,
    });
    // The date header row holds the day columns; find the first row with >=3 Date cells.
    for (const r of rows) {
      const dates = (r || []).filter((c: unknown) => c instanceof Date) as Date[];
      if (dates.length >= 3) {
        // keep the first contiguous run of 7 (the current pay week)
        for (const d of dates.slice(0, 7)) periodDates.push(d);
        break;
      }
    }
  }
  periodDates.sort((a, b) => a.getTime() - b.getTime());
  const startDate = periodDates[0];
  const endDate = periodDates[periodDates.length - 1];

  const label =
    str(wb.Sheets["PAYROLL SHEET"]?.["K1"]?.v) ||
    (startDate && endDate ? `${iso(startDate)}..${iso(endDate)}` : "IMPORTED");

  // Working dates = period dates that are not Sunday (the weekly rest day).
  const workingDates = periodDates.filter((d) => d.getDay() !== 0);
  const restDate = periodDates.find((d) => d.getDay() === 0);

  // ---- parse PAYROLL SHEET worker rows -------------------------------------
  const ps = wb.Sheets["PAYROLL SHEET"];
  if (!ps) throw new Error('Workbook has no "PAYROLL SHEET" tab');
  const grid = XLSX.utils.sheet_to_json<any[]>(ps, {
    header: 1,
    raw: true,
    defval: null,
  });

  const employees: any[] = [];
  const crews = new Set<string>();
  for (let i = 6; i < grid.length; i++) {
    const row = grid[i] || [];
    const name = str(row[C.name]);
    const no = row[C.no];
    if (!name || typeof no !== "number") continue; // skip separators/blank rows

    const position = str(row[C.position]).toUpperCase() || "LABOR";
    const rate = num(row[C.rate]);
    if (rate <= 0) continue;

    const workingDays = num(row[C.workingDays]);
    const present = num(row[C.present]) || Math.max(workingDays - num(row[C.absences]), 0);
    const absent = num(row[C.absences]);
    const incentive = num(row[C.incentive]); // blank -> 0 (matches the sheet)
    const lateMinutes = num(row[C.lateHours]) * 60;
    const otHours = num(row[C.otHours]);
    const nightHours = num(row[C.nightHours]);
    const drdDays = num(row[C.drdDays]);
    const specialHol = num(row[C.specialHol]);
    const legalHol = num(row[C.legalHol]);

    // Build attendance across the working dates. `present`/`absent` may be
    // fractional (the sheet records half-day attendance, e.g. present 4.5):
    // emit floor(present) full days, then one "half" day for a .5 remainder,
    // then the remaining full "absent" days. A half day contributes 0.5 worked
    // (matching the sheet's basic = rate x present exactly).
    const attendance: SeedAttendance[] = [];
    let di = 0;
    // Mutable holiday counters (specialHol/legalHol above are read-only inputs):
    // tag the first `specialHol` worked days as special, the next `legalHol` as legal.
    let shLeft = specialHol;
    let lhLeft = legalHol;
    const fullPresent = Math.floor(present + 1e-9);
    const hasHalf = present - fullPresent > 1e-9;
    const fullAbsent = Math.floor(absent + 1e-9);
    for (let p = 0; p < fullPresent && di < workingDates.length; p++, di++) {
      const rec: SeedAttendance = { date: iso(workingDates[di]), status: "full" };
      if (shLeft > 0) {
        rec.holiday = "special";
        shLeft--;
      } else if (lhLeft > 0) {
        rec.holiday = "legal";
        lhLeft--;
      }
      attendance.push(rec);
    }
    if (hasHalf && di < workingDates.length) {
      attendance.push({ date: iso(workingDates[di]), status: "half" });
      di++;
    }
    for (let a = 0; a < fullAbsent && di < workingDates.length; a++, di++) {
      attendance.push({ date: iso(workingDates[di]), status: "absent" });
    }
    // DRD worked -> add the rest day as a worked rest day
    if (drdDays > 0 && restDate) {
      attendance.push({ date: iso(restDate), status: "full", isRestDay: true });
    }
    // Weekly OT / night / late totals: attach to the first worked day (engine
    // only needs the period sum; per-date detail isn't in the workbook).
    const firstWorked = attendance.find(
      (r) => r.status === "full" || r.status === "half"
    );
    if (firstWorked) {
      if (otHours) firstWorked.otHours = otHours;
      if (nightHours) firstWorked.nightHours = nightHours;
      if (lateMinutes) firstWorked.lateMinutes = lateMinutes;
    }

    const crew = position; // no crew column on the payroll sheet; group by position
    crews.add(crew);
    employees.push({
      name,
      nickname: str(row[C.nickname]) || name.split(",")[0],
      crew,
      position,
      rate,
      incentiveDailyRate: incentive,
      attendance,
    });
  }

  const seed = {
    company: "BRIGHTEM REALTY CORP.",
    address: "Datag, Maribago, Lapu-Lapu City, Cebu",
    period: label,
    startDate: startDate ? iso(startDate) : null,
    endDate: endDate ? iso(endDate) : null,
    payDate: startDate ? iso(startDate) : null,
    crews: Array.from(crews).sort(),
    employees,
  };

  fs.writeFileSync(outPath, JSON.stringify(seed, null, 1), "utf-8");
  console.log(
    `Imported ${employees.length} employees / ${crews.size} groups ` +
      `for period "${label}" -> ${outPath}`
  );
}

main();
