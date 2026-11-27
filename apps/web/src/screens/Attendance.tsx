import { useState, useEffect, useRef } from 'react';
import type { PayPeriod, AttendanceRecord, Employee, AttendancePhoto, AttendancePhotoKind } from '@brightem/shared';
import { api } from '../api';
import { onDataChanged } from '../offline';
import { useI18n } from '../i18n';
import { parseCsv } from '../lib/csv';
import { readXlsx } from '../lib/xlsx';
import { attendanceTimesOf } from '@brightem/shared';
import {
  useAuth, canEditCheckin, canEditCheckout, canOverrideTimes, isTeamLeader, isAdmin, syncServerClock, manilaNow,
  setAttendanceTimes, getAttendanceTimes, checkoutCloseHour, phoneLast4,
} from '../auth';
import CheckCameraModal, { KIND_SPEECH, speak, playKindSound, unlockSound } from '../components/CheckCameraModal';
import { getDevicePhotos, addDevicePhoto } from '../lib/devicePhotos';

// 10:00–10:15 (Manila) is break time: the camera buttons record the break.
const BREAK_START = 10;
const BREAK_END = 10.25;

const KIND_LABEL: Record<AttendancePhotoKind, string> = {
  check_in: 'att.checkIn',
  check_out: 'att.checkOut',
  break_in: 'att.breakIn',
  break_out: 'att.breakOut',
};

// Decimal hour (10.05) → "10:03".
function hourClock(h: number): string {
  const m = Math.round(h * 60);
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

// "07:05" in Manila time for a photo's ISO timestamp.
function manilaClock(iso: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Manila', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).format(new Date(iso));
}

interface Props {
  period: PayPeriod | null;
}

const DOW_KEYS = ['dow.sun', 'dow.mon', 'dow.tue', 'dow.wed', 'dow.thu', 'dow.fri', 'dow.sat'];

// Build every calendar date from start..end (inclusive) as YYYY-MM-DD strings.
function buildDateList(start?: string, end?: string): string[] {
  if (!start || !end) return [];
  const out: string[] = [];
  // UTC on both sides, so the device's time zone can't shift the dates.
  const cur = new Date(start + 'T00:00:00Z');
  const last = new Date(end + 'T00:00:00Z');
  while (cur <= last) {
    out.push(cur.toISOString().slice(0, 10));
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return out;
}

// Normalise an imported time cell to the app's decimal-hour text.
// Excel stores a time-formatted cell (07:00) as a day fraction (0.2916…);
// text like "7:30" or "07:30" becomes 7.5; plain hours (7, 13.5) pass through.
function toHourText(v: string): string {
  const s = v.trim();
  if (!s) return '';
  const hm = s.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
  if (hm) return String(Math.round((Number(hm[1]) + Number(hm[2]) / 60) * 100) / 100);
  const n = Number(s);
  if (Number.isFinite(n) && n > 0 && n < 1) return String(Math.round(n * 24 * 100) / 100);
  return s;
}

interface AttendanceRow {
  employee: Employee;
  record: AttendanceRecord | null;
  amIn: string;
  amOut: string;
  pmIn: string;
  pmOut: string;
  breakIn: number | null;
  breakOut: number | null;
  otIn: string;
  otOut: string;
  workedHours: number;
  status: string;
  statusType: 'ok' | 'half' | 'abs';
}

export default function Attendance({ period }: Props) {
  const { t } = useI18n();
  const { session } = useAuth();
  // Team leaders only see and edit their own crew.
  const lockedCrew = isTeamLeader(session) ? session!.crewId : null;
  const [selectedCrew, setSelectedCrew] = useState(lockedCrew ?? 'ANTHONY');
  const [selectedDate, setSelectedDate] = useState('2026-06-25');
  const [rows, setRows] = useState<AttendanceRow[]>([]);
  const [reloadKey, setReloadKey] = useState(0); // bump to refetch after save
  // True while the table holds edits that are not saved yet: auto-refresh
  // (sync / other devices) must not overwrite them.
  const dirtyRef = useRef(false);
  const [allEmployees, setAllEmployees] = useState<Employee[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [crews, setCrews] = useState<{ id: string; count: number }[]>([]);

  useEffect(() => {
    // Load all employees once and derive crew list with head counts
    api.getEmployees().then((data) => {
      setAllEmployees(data);
      const counts = new Map<string, number>();
      data.forEach((e) => counts.set(e.crewId, (counts.get(e.crewId) ?? 0) + 1));
      const crewList = Array.from(counts.entries())
        .map(([id, count]) => ({ id, count }))
        .sort((a, b) => b.count - a.count);
      setCrews(lockedCrew ? crewList.filter((c) => c.id === lockedCrew) : crewList);
      // If the current selection isn't present, default to the largest crew
      if (!lockedCrew && crewList.length && !counts.has(selectedCrew)) {
        setSelectedCrew(crewList[0].id);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    // Show every employee in the selected crew (or all crews), sorted by name
    setEmployees(
      allEmployees
        .filter((e) => selectedCrew === 'ALL' || e.crewId === selectedCrew)
        .sort((a, b) => a.name.localeCompare(b.name))
    );
  }, [selectedCrew, allEmployees]);

  // All dates within the current pay period; select today when it is in the
  // period, else the last day.
  const periodDates = buildDateList(period?.startDate, period?.endDate);
  useEffect(() => {
    if (!periodDates.length) return;
    const today = manilaNow().date;
    if (periodDates.includes(today)) setSelectedDate(today);
    else if (!periodDates.includes(selectedDate)) {
      setSelectedDate(periodDates[periodDates.length - 1]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [period]);

  useEffect(() => {
    // Load attendance records
    if (period) {
      api.getAttendance(period.id).then((records) => {
        const newRows = employees.map((emp) => {
          const rec = records.find(
            (r) => r.employeeId === emp.id && r.date === selectedDate
          );
          const status = rec?.status === 'full' ? t('att.stNormal') : rec?.status === 'half' ? t('att.stHalf') : t('att.stAbsent');
          const statusType: 'ok' | 'half' | 'abs' = rec?.status === 'full' ? 'ok' : rec?.status === 'half' ? 'half' : 'abs';
          return {
            employee: emp,
            record: rec || null,
            amIn: rec?.amIn?.toString() ?? '',
            amOut: rec?.amOut?.toString() ?? '',
            pmIn: rec?.pmIn?.toString() ?? '',
            pmOut: rec?.pmOut?.toString() ?? '',
            breakIn: rec?.breakIn ?? null,
            breakOut: rec?.breakOut ?? null,
            otIn: rec?.otHours ? '17' : '',
            otOut: rec?.otHours ? '19' : '',
            workedHours: rec?.otHours ? 10.0 : 8.0,
            status,
            statusType,
          };
        });
        dirtyRef.current = false;
        setRows(newRows);
      });
    }
  }, [employees, period, selectedDate, t, reloadKey]);

  // Pick up attendance uploaded by other devices (or this one coming back
  // online) without a manual reload — unless there are unsaved edits.
  useEffect(
    () =>
      onDataChanged(() => {
        if (!dirtyRef.current) setReloadKey((n) => n + 1);
      }),
    []
  );

  const fileRef = useRef<HTMLInputElement>(null);

  // On a computer, show the phone-style cards (with the camera check buttons)
  // instead of the table when chosen. Remembered on this device.
  const [cardView, setCardView] = useState(() => localStorage.getItem('brightem.att.cardView') === '1');
  const toggleCardView = () =>
    setCardView((v) => {
      localStorage.setItem('brightem.att.cardView', v ? '0' : '1');
      return !v;
    });

  // Camera check-in / check-out (and break) photos for the selected date.
  const [photos, setPhotos] = useState<AttendancePhoto[]>([]);
  const [camera, setCamera] = useState<{ employeeId: string; kind: AttendancePhotoKind } | null>(null);
  const [viewer, setViewer] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    getDevicePhotos(selectedDate)
      .then((list) => alive && setPhotos(list))
      .catch(() => alive && setPhotos([]));
    return () => {
      alive = false;
    };
  }, [selectedDate, reloadKey]);

  // Morning check-in (AM IN) closes at 07:00 Manila time on the work date;
  // after that only Emmeline Hwang / Carlo may change it. Re-check every 30s so an
  // open page locks itself when the cutoff passes.
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), 30_000);
    return () => clearInterval(id);
  }, []);
  // Check-in cutoff / check-out time + grace come from Settings.
  useEffect(() => {
    api
      .getConfig()
      .then((cfg) => {
        setAttendanceTimes(attendanceTimesOf(cfg));
        setTick((n) => n + 1);
      })
      .catch(() => {});
  }, []);
  const attTimes = getAttendanceTimes();
  const checkinMsg = (key: 'att.checkinLocked' | 'att.checkinOpen') => t(key).replace('{time}', attTimes.checkIn);
  const checkoutMsg = (key: 'att.checkoutLocked' | 'att.checkoutOpen') =>
    t(key).replace('{time}', hourClock(checkoutCloseHour(attTimes)));
  const amInLocked = !canEditCheckin(session, selectedDate);
  const pmOutLocked = !canEditCheckout(session, selectedDate);
  // One check-in and one check-out per worker per day: once saved, the camera
  // button stays off for that day. Only Emmeline / Carlo can still correct the
  // time by hand.
  const override = canOverrideTimes(session);
  const checkedIn = (row: AttendanceRow) => row.record?.amIn != null;
  const checkedOut = (row: AttendanceRow) => row.record?.pmOut != null;
  // Time inputs: staff never type times (camera buttons only). Emmeline,
  // Jaesun and Carlo click an input and enter their own 4-digit login PIN to
  // unlock editing on this page.
  const [timeEditUnlocked, setTimeEditUnlocked] = useState(false);
  const [pinOpen, setPinOpen] = useState(false);
  const [pin, setPin] = useState('');
  const [pinError, setPinError] = useState('');
  const myPin = phoneLast4(session?.phone);
  const openPin = () => {
    setPin('');
    setPinError(myPin ? '' : t('att.pinNoPhone'));
    setPinOpen(true);
  };
  const enterPin = (v: string) => {
    const d = v.replace(/\D/g, '').slice(0, 4);
    setPin(d);
    if (d.length < 4) return setPinError('');
    if (myPin && d === myPin) {
      setTimeEditUnlocked(true);
      setPinOpen(false);
    } else {
      setPin('');
      setPinError(t(myPin ? 'att.pinWrong' : 'att.pinNoPhone'));
    }
  };
  type TimeField = 'amIn' | 'pmOut' | 'otIn' | 'otOut';
  const timeInput = (row: AttendanceRow, idx: number, field: TimeField, cls: string) => {
    const locked = isLocked(row);
    const canEdit = override && timeEditUnlocked && !locked;
    const needsPin = override && !timeEditUnlocked && !locked;
    return (
      <input
        className={`${cls} disabled:bg-gray-100 disabled:text-muted ${needsPin ? 'bg-gray-100 text-muted cursor-pointer' : ''}`}
        value={row[field]}
        disabled={!canEdit && !needsPin}
        readOnly={needsPin}
        title={needsPin ? t('att.pinClickToEdit') : !canEdit && !locked ? t('att.timeInputsLocked') : undefined}
        onClick={needsPin ? openPin : undefined}
        onChange={(e) => canEdit && handleInputChange(idx, field, e.target.value)}
      />
    );
  };
  const isLocked = (row: AttendanceRow) => !!row.record?.confirmed;
  const now = manilaNow();
  const isToday = selectedDate === now.date;
  const breakTime = isToday && now.hour >= BREAK_START && now.hour < BREAK_END;
  // Break times are saved on the server row, so every phone agrees. A worker
  // with Break in but no Break out is still on break: only "Break time out"
  // is enabled for them until they come back.
  const onBreak = (row: AttendanceRow) => row.breakIn != null && row.breakOut == null;
  const ROW_KINDS: AttendancePhotoKind[] = ['check_in', 'break_in', 'break_out', 'check_out'];
  const camDisabled = (row: AttendanceRow, kind: AttendancePhotoKind) =>
    !isToday || isLocked(row) || (kind === 'check_in' && (amInLocked || checkedIn(row)))
      || (kind === 'check_out' && (pmOutLocked || checkedOut(row)))
      || (kind === 'break_in' && onBreak(row))
      || (kind === 'break_out' && !onBreak(row));
  const camTitle = (row: AttendanceRow, kind: AttendancePhotoKind) =>
    !isToday ? t('att.camOnlyToday')
      : isLocked(row) ? undefined
      : kind === 'check_in' && amInLocked ? checkinMsg('att.checkinLocked')
      : kind === 'check_in' && checkedIn(row) ? t('att.alreadyCheckedIn')
      : kind === 'check_out' && pmOutLocked ? checkoutMsg('att.checkoutLocked')
      : kind === 'check_out' && checkedOut(row) ? t('att.alreadyCheckedOut') : undefined;
  const lockedCount = rows.filter(isLocked).length;
  const allLocked = rows.length > 0 && lockedCount === rows.length;

  const handleInputChange = (index: number, field: string, value: string) => {
    const newRows = [...rows];
    newRows[index] = { ...newRows[index], [field]: value };
    dirtyRef.current = true;
    setRows(newRows);
  };

  const toRecord = (row: AttendanceRow, confirm: boolean): AttendanceRecord => ({
    employeeId: row.employee.id,
    date: selectedDate,
    status: row.workedHours >= 8 ? ('full' as const) : 'half' as const,
    amIn: !canEditCheckin(session, selectedDate) || (!canOverrideTimes(session) && row.record?.amIn != null)
      ? row.record?.amIn ?? null
      : row.amIn ? parseFloat(row.amIn) : null,
    amOut: row.record?.amOut ?? null,
    pmIn: row.record?.pmIn ?? null,
    pmOut: !canEditCheckout(session, selectedDate) || (!canOverrideTimes(session) && row.record?.pmOut != null)
      ? row.record?.pmOut ?? null
      : row.pmOut ? parseFloat(row.pmOut) : null,
    breakIn: row.breakIn,
    breakOut: row.breakOut,
    otHours: row.otIn ? 2 : undefined,
    confirmed: confirm,
  } as AttendanceRecord);

  // A photo was taken: announce it out loud, save the time on the server row
  // (check-in → AM IN, check-out → PM OUT, break → break in / out; the row is
  // saved as a draft) and keep the photo on this phone.
  const handleCapture = async (blob: Blob) => {
    if (!camera) return;
    const { employeeId, kind } = camera;
    setCamera(null);
    playKindSound(kind);
    speak(KIND_SPEECH[kind]);
    const idx = rows.findIndex((r) => r.employee.id === employeeId);
    if (idx < 0) return;
    const h = Math.round(manilaNow().hour * 100) / 100;
    const hour = String(h);
    let row = rows[idx];
    try {
      row =
        kind === 'check_in' ? { ...row, amIn: hour }
          : kind === 'check_out' ? { ...row, pmOut: hour }
          : kind === 'break_in' ? { ...row, breakIn: h, breakOut: null }
          : { ...row, breakOut: h };
      const rec = toRecord(row, false);
      await api.updateAttendance([rec]);
      row = { ...row, record: { ...(row.record ?? {}), ...rec } as AttendanceRecord };
      setRows((cur) => cur.map((r) => (r.employee.id === employeeId ? row : r)));
      const photo = await addDevicePhoto(
        employeeId, row.employee.name, selectedDate, kind, blob,
        manilaClock(new Date().toISOString())
      );
      setPhotos((cur) => [...cur.filter((p) => p.id !== photo.id), photo]);
    } catch (err) {
      const msg = String((err as { message?: string })?.message ?? '');
      if (msg.includes('CHECKIN_DONE') || msg.includes('CHECKOUT_DONE')) {
        // Another phone already recorded it: show the saved time.
        setReloadKey((n) => n + 1);
        alert(t(msg.includes('CHECKOUT_DONE') ? 'att.alreadyCheckedOut' : 'att.alreadyCheckedIn'));
      } else if (msg.includes('CHECKIN_CLOSED') || msg.includes('CHECKOUT_CLOSED')) {
        await syncServerClock();
        setTick((n) => n + 1);
        alert(msg.includes('CHECKOUT_CLOSED') ? checkoutMsg('att.checkoutLocked') : checkinMsg('att.checkinLocked'));
      } else {
        alert(t('att.photoError'));
      }
    }
  };

  const camButtons = (row: AttendanceRow) => (
    <div className="flex flex-wrap gap-1.5">
      {ROW_KINDS.map((kind) => (
        <button
          key={kind}
          className={`btn ${kind === 'check_out' ? 'ghost' : ''} ${kind.startsWith('break_') ? '!bg-amber-500 !border-amber-500' : ''} !px-2.5 !py-1.5 text-xs whitespace-nowrap disabled:opacity-40`}
          disabled={camDisabled(row, kind)}
          title={camTitle(row, kind)}
          onClick={() => {
            unlockSound(); // phones only allow sound that starts from a tap
            setCamera({ employeeId: row.employee.id, kind });
          }}
        >
          📷 {t(KIND_LABEL[kind] as Parameters<typeof t>[0])}
        </button>
      ))}
    </div>
  );

  const photoStrip = (row: AttendanceRow) => {
    const mine = photos.filter((p) => p.employeeId === row.employee.id);
    const brk = row.breakIn != null && (
      <span className="rounded bg-amber-50 px-1.5 py-0.5 text-[10px] text-amber-800">
        ☕ {hourClock(row.breakIn)} – {row.breakOut != null ? hourClock(row.breakOut) : t('att.onBreak')}
      </span>
    );
    if (!mine.length && !brk) return null;
    return (
      <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
        {brk}
        {mine.map((p) => (
          <button key={p.id} onClick={() => setViewer(p.url)} className="flex items-center gap-1 rounded border border-line bg-bg px-1 py-0.5 text-[10px] text-muted">
            <img src={p.url} alt="" className="h-6 w-6 rounded object-cover" />
            {t(KIND_LABEL[p.kind] as Parameters<typeof t>[0])} {manilaClock(p.takenAt)}
          </button>
        ))}
      </div>
    );
  };

  // Save the editable (not yet confirmed) rows: as a draft, or confirmed
  // (locked). Confirmed rows are never rewritten here.
  const handleSave = async (confirm: boolean) => {
    if (!period) return;
    const editable = rows.filter((row) => !isLocked(row));
    if (!editable.length) {
      alert(t('att.nothingToSave'));
      return;
    }
    if (confirm && !window.confirm(t('att.confirmAsk'))) return;
    const records = editable.map((row) => toRecord(row, confirm));

    try {
      await api.updateAttendance(records);
      alert(t(confirm ? 'att.confirmed' : 'att.draftSaved'));
      setReloadKey((n) => n + 1);
    } catch (err) {
      // The database rejects AM IN changes after 07:00 (server clock).
      const msg = String((err as { message?: string })?.message ?? '');
      if (msg.includes('CHECKIN_DONE') || msg.includes('CHECKOUT_DONE')) {
        // Another phone already recorded it: show the saved time.
        setReloadKey((n) => n + 1);
        alert(t(msg.includes('CHECKOUT_DONE') ? 'att.alreadyCheckedOut' : 'att.alreadyCheckedIn'));
      } else if (msg.includes('CHECKIN_CLOSED') || msg.includes('CHECKOUT_CLOSED')) {
        await syncServerClock();
        setTick((n) => n + 1);
        alert(msg.includes('CHECKOUT_CLOSED') ? checkoutMsg('att.checkoutLocked') : checkinMsg('att.checkinLocked'));
      } else {
        alert(t('att.saveError'));
      }
    }
  };

  // Admin only: unlock the confirmed rows shown, keeping their data.
  const handleUnlock = async () => {
    const locked = rows.filter(isLocked);
    if (!locked.length || !window.confirm(t('att.unlockAsk'))) return;
    try {
      await api.updateAttendance(
        locked.map((row) => ({ ...row.record!, confirmed: false })),
        { unlock: true }
      );
      alert(t('att.unlocked'));
      setReloadKey((n) => n + 1);
    } catch {
      alert(t('att.saveError'));
    }
  };

  // ---- Excel (.xlsx) / CSV import -------------------------------------------
  // Expected columns (header row, case-insensitive): Name, CHECK IN,
  // CHECK OUT, OT IN, OT OUT (AM IN / PM OUT are read as check in / out). Rows are matched to workers by name.
  // For .xlsx the first sheet is read. Confirmed (locked) rows are skipped.
  const handleImportClick = () => fileRef.current?.click();

  const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow re-selecting the same file
    if (!file) return;
    try {
      const isXlsx = /\.xlsx$/i.test(file.name);
      const raw = isXlsx
        ? (await readXlsx(await file.arrayBuffer()))[0]?.rows ?? []
        : parseCsv(await file.text());
      const table = raw.filter((r) => r.some((c) => (c ?? '').trim() !== ''));
      if (table.length < 2) {
        alert(t('att.importEmpty'));
        return;
      }
      const header = table[0].map((h) => h.trim().toLowerCase());
      const col = (...names: string[]) =>
        header.findIndex((h) => names.includes(h));
      const iName = col('name', '성명', '이름');
      const iAmIn = col('check in', 'checkin', 'time in', 'in', '체크인', 'am in', 'amin');
      const iPmOut = col('check out', 'checkout', 'time out', 'out', '체크아웃', 'pm out', 'pmout');
      const iOtIn = col('ot in', 'otin');
      const iOtOut = col('ot out', 'otout');
      if (iName < 0) {
        alert(t('att.importNoName'));
        return;
      }
      const at = (r: string[], i: number) => (i >= 0 ? toHourText(r[i] ?? '') : '');
      const nameAt = (r: string[]) => (r[iName] ?? '').trim();
      const byName = new Map(rows.map((row, idx) => [row.employee.name.trim().toLowerCase(), idx]));
      const next = [...rows];
      let matched = 0;
      let skipped = 0;
      for (const r of table.slice(1)) {
        const key = nameAt(r).toLowerCase();
        const idx = byName.get(key);
        if (idx === undefined) continue;
        if (isLocked(next[idx])) {
          skipped++;
          continue;
        }
        matched++;
        const amIn = at(r, iAmIn) || next[idx].amIn;
        const pmOut = at(r, iPmOut) || next[idx].pmOut;
        const otIn = at(r, iOtIn);
        const otOut = at(r, iOtOut);
        next[idx] = {
          ...next[idx],
          amIn,
          pmOut,
          otIn: otIn || next[idx].otIn,
          otOut: otOut || next[idx].otOut,
          workedHours: otIn ? 10.0 : 8.0,
        };
      }
      dirtyRef.current = true;
      setRows(next);
      alert(
        `${t('att.imported')} ${matched} / ${table.length - 1}` +
          (skipped ? `\n${t('att.importSkipped')} ${skipped}` : '')
      );
    } catch {
      alert(t('att.importError'));
    }
  };

  return (
    <div className="w-full">
      {/* Toolbar */}
      <div className="flex gap-2 items-center flex-wrap mb-3.5">
        <select
          value={selectedCrew}
          onChange={(e) => setSelectedCrew(e.target.value)}
          className="border border-line rounded-lg px-3 py-2 text-sm bg-white"
        >
          {!lockedCrew && (
            <option value="ALL">
              {t('att.allCrews')} ({allEmployees.length}{t('att.people')})
            </option>
          )}
          {crews.map((c) => (
            <option key={c.id} value={c.id}>
              {c.id} ({c.count}{t('att.people')})
            </option>
          ))}
        </select>

        <select
          value={selectedDate}
          onChange={(e) => setSelectedDate(e.target.value)}
          className="border border-line rounded-lg px-3 py-2 text-sm bg-white"
        >
          {periodDates.map((d) => {
            const dow = t(DOW_KEYS[new Date(d + 'T00:00:00').getDay()] as Parameters<typeof t>[0]);
            return (
              <option key={d} value={d}>
                {t('att.date')} {d} ({dow})
              </option>
            );
          })}
        </select>

        <div className="flex-1" />

        <button className="btn ghost hidden md:inline-flex" onClick={toggleCardView}>
          {cardView ? `🖥 ${t('att.tableView')}` : `📱 ${t('att.mobileView')}`}
        </button>

        <input
          ref={fileRef}
          type="file"
          accept=".xlsx,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          className="hidden"
          onChange={handleImportFile}
        />
        {isAdmin(session) && lockedCount > 0 && (
          <button className="btn ghost" onClick={handleUnlock}>
            🔓 {t('att.unlock')}
          </button>
        )}
        <button className="btn gray disabled:opacity-50" onClick={handleImportClick} disabled={allLocked || !override}
          title={!override ? t('att.timeInputsLocked') : undefined}>
          {t('att.excelImport')}
        </button>
        <button className="btn ghost disabled:opacity-50" onClick={() => handleSave(false)} disabled={allLocked}>
          {t('att.saveDraft')}
        </button>
        <button onClick={() => handleSave(true)} className="btn disabled:opacity-50" disabled={allLocked}>
          {t('att.confirm')}
        </button>
      </div>

      {/* Table */}
      <div className="panel">
        <h3 className="text-sm font-bold text-dark mb-3">
          {t('att.timeEntryTitle')}
        </h3>
        <div
          className={`text-xs rounded-lg px-3 py-2 mb-3 ${
            amInLocked ? 'bg-red-50 text-red-700' : canOverrideTimes(session) ? 'bg-blue-50 text-dark' : 'bg-bg text-muted'
          }`}
        >
          🕖 {amInLocked ? checkinMsg('att.checkinLocked') : canOverrideTimes(session) ? t('att.checkinTl') : checkinMsg('att.checkinOpen')}
        </div>
        {!canOverrideTimes(session) && (
          <div
            className={`text-xs rounded-lg px-3 py-2 mb-3 ${pmOutLocked ? 'bg-red-50 text-red-700' : 'bg-bg text-muted'}`}
          >
            🕔 {pmOutLocked ? checkoutMsg('att.checkoutLocked') : checkoutMsg('att.checkoutOpen')}
          </div>
        )}
        {breakTime && (
          <div className="text-xs rounded-lg px-3 py-2 mb-3 bg-amber-50 text-amber-800">
            ☕ {t('att.breakBanner')}
          </div>
        )}
        {lockedCount > 0 && (
          <div className="text-xs rounded-lg px-3 py-2 mb-3 bg-green-50 text-green-800">
            🔒{' '}
            {allLocked
              ? t(isAdmin(session) ? 'att.lockedBannerAdmin' : 'att.lockedBanner')
              : `${lockedCount}/${rows.length} ${t('att.someLocked')}`}
          </div>
        )}
        {/* Mobile card view */}
        <div className={cardView ? 'grid gap-3 sm:grid-cols-2 xl:grid-cols-3' : 'md:hidden space-y-3'}>
          {rows.map((row, idx) => (
            <div key={row.employee.id} className="bg-white border border-line rounded-xl p-3 shadow-sm">
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="font-bold text-sm text-dark truncate">
                    {idx + 1}. {row.employee.name}
                  </div>
                  <div className="text-xs text-muted truncate">{row.employee.position}</div>
                </div>
                <span className={`pill ${row.statusType} flex-shrink-0`}>
                  {isLocked(row) && '🔒 '}{row.status} · {row.workedHours.toFixed(1)}h
                </span>
              </div>
              <div className="grid grid-cols-2 gap-2 mt-3">
                <label className="block">
                  <span className="block text-[9px] text-muted mb-0.5">CHECK IN</span>
                  {timeInput(row, idx, 'amIn', 'in w-full')}
                </label>
                <label className="block">
                  <span className="block text-[9px] text-muted mb-0.5">CHECK OUT</span>
                  {timeInput(row, idx, 'pmOut', 'in w-full')}
                </label>
                <label className="block">
                  <span className="block text-[9px] text-muted mb-0.5">OT IN</span>
                  {timeInput(row, idx, 'otIn', 'in w-full')}
                </label>
                <label className="block">
                  <span className="block text-[9px] text-muted mb-0.5">OT OUT</span>
                  {timeInput(row, idx, 'otOut', 'in w-full')}
                </label>
              </div>
              <div className="mt-3">{camButtons(row)}</div>
              {photoStrip(row)}
            </div>
          ))}
        </div>

        {/* Desktop table view */}
        <div className={cardView ? 'hidden' : 'overflow-x-auto hidden md:block'}>
          <table>
            <thead>
              <tr>
                <th>#</th>
                <th className="freeze-col">{t('att.thName')}</th>
                <th>{t('att.thPosition')}</th>
                <th className="text-center">CHECK IN</th>
                <th className="text-center">CHECK OUT</th>
                <th className="text-center">OT IN</th>
                <th className="text-center">OT OUT</th>
                <th className="text-center">{t('att.thWorkedH')}</th>
                <th className="text-center">{t('att.thStatus')}</th>
                <th>{t('att.thCamera')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, idx) => (
                <tr key={row.employee.id}>
                  <td>{idx + 1}</td>
                  <td className="freeze-col">{row.employee.name}</td>
                  <td>{row.employee.position}</td>
                  <td className="text-center">
                    {timeInput(row, idx, 'amIn', 'in')}
                  </td>
                  <td className="text-center">
                    {timeInput(row, idx, 'pmOut', 'in')}
                  </td>
                  <td className="text-center">
                    {timeInput(row, idx, 'otIn', 'in')}
                  </td>
                  <td className="text-center">
                    {timeInput(row, idx, 'otOut', 'in')}
                  </td>
                  <td className="text-center">{row.workedHours.toFixed(1)}</td>
                  <td className="text-center">
                    <span className={`pill ${row.statusType}`}>{isLocked(row) && '🔒 '}{row.status}</span>
                  </td>
                  <td>
                    {camButtons(row)}
                    {photoStrip(row)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="note">
          {t('att.note')}
        </div>
      </div>

      {camera && (
        <CheckCameraModal
          title={`${rows.find((r) => r.employee.id === camera.employeeId)?.employee.name ?? ''} · ${t(
            KIND_LABEL[camera.kind] as Parameters<typeof t>[0]
          )}`}
          onCapture={handleCapture}
          onClose={() => setCamera(null)}
        />
      )}
      {viewer && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4" onClick={() => setViewer(null)}>
          <img src={viewer} alt="" className="max-h-full max-w-full rounded-lg" />
        </div>
      )}
      {pinOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setPinOpen(false)}>
          <div className="w-full max-w-xs bg-white rounded-xl p-5 shadow-lg" onClick={(e) => e.stopPropagation()}>
            <b className="block text-dark mb-1">🔒 {t('att.pinTitle')}</b>
            <p className="text-xs text-muted mb-3">{t('att.pinHint')}</p>
            <input
              type="password"
              inputMode="numeric"
              maxLength={4}
              autoComplete="off"
              autoFocus
              className="border border-line rounded px-3 py-2 w-full tracking-widest text-center text-lg"
              value={pin}
              onChange={(e) => enterPin(e.target.value)}
            />
            {pinError && <div className="text-xs text-red-600 mt-2">{pinError}</div>}
            <button type="button" className="btn ghost w-full mt-3" onClick={() => setPinOpen(false)}>
              {t('set.cancel')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
