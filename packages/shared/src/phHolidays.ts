// Philippine national holidays, from the yearly Presidential proclamations:
//   2026 — Proclamation No. 1006 (Sept 3, 2025)
//   2027 — Proclamation No. 1427 (Sept 8, 2026)
// "legal" = regular holiday (+100%), "special" = special (non-working) day (+30%).
// Eid'l Fitr / Eid'l Adha are regular holidays declared by separate
// proclamations once their dates are fixed — add those by hand. Special
// WORKING days (e.g. EDSA anniversary) carry no premium and are left out.
import type { Holiday } from "./types.js";

export const PH_HOLIDAYS: Record<number, Holiday[]> = {
  2026: [
    { date: "2026-01-01", name: "New Year's Day", kind: "legal" },
    { date: "2026-02-17", name: "Chinese New Year", kind: "special" },
    { date: "2026-04-02", name: "Maundy Thursday", kind: "legal" },
    { date: "2026-04-03", name: "Good Friday", kind: "legal" },
    { date: "2026-04-04", name: "Black Saturday", kind: "special" },
    { date: "2026-04-09", name: "Araw ng Kagitingan", kind: "legal" },
    { date: "2026-05-01", name: "Labor Day", kind: "legal" },
    { date: "2026-06-12", name: "Independence Day", kind: "legal" },
    { date: "2026-08-21", name: "Ninoy Aquino Day", kind: "special" },
    { date: "2026-08-31", name: "National Heroes Day", kind: "legal" },
    { date: "2026-11-01", name: "All Saints' Day", kind: "special" },
    { date: "2026-11-02", name: "All Souls' Day", kind: "special" },
    { date: "2026-11-30", name: "Bonifacio Day", kind: "legal" },
    { date: "2026-12-08", name: "Feast of the Immaculate Conception", kind: "special" },
    { date: "2026-12-24", name: "Christmas Eve", kind: "special" },
    { date: "2026-12-25", name: "Christmas Day", kind: "legal" },
    { date: "2026-12-30", name: "Rizal Day", kind: "legal" },
    { date: "2026-12-31", name: "Last Day of the Year", kind: "special" },
  ],
  2027: [
    { date: "2027-01-01", name: "New Year's Day", kind: "legal" },
    { date: "2027-02-06", name: "Chinese New Year", kind: "special" },
    { date: "2027-03-25", name: "Maundy Thursday", kind: "legal" },
    { date: "2027-03-26", name: "Good Friday", kind: "legal" },
    { date: "2027-03-27", name: "Black Saturday", kind: "special" },
    { date: "2027-04-09", name: "Araw ng Kagitingan", kind: "legal" },
    { date: "2027-05-01", name: "Labor Day", kind: "legal" },
    { date: "2027-06-12", name: "Independence Day", kind: "legal" },
    { date: "2027-08-21", name: "Ninoy Aquino Day", kind: "special" },
    { date: "2027-08-30", name: "National Heroes Day", kind: "legal" },
    { date: "2027-11-01", name: "All Saints' Day", kind: "special" },
    { date: "2027-11-02", name: "All Souls' Day", kind: "special" },
    { date: "2027-11-30", name: "Bonifacio Day", kind: "legal" },
    { date: "2027-12-08", name: "Feast of the Immaculate Conception", kind: "special" },
    { date: "2027-12-24", name: "Christmas Eve", kind: "special" },
    { date: "2027-12-25", name: "Christmas Day", kind: "legal" },
    { date: "2027-12-30", name: "Rizal Day", kind: "legal" },
    { date: "2027-12-31", name: "Last Day of the Year", kind: "special" },
  ],
};
