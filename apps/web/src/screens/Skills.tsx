import { useState, useEffect, useMemo, useRef } from 'react';
import { SKILL_KEYS } from '@brightem/shared';
import type { Employee, EmployeeSkill } from '@brightem/shared';
import { api } from '../api';
import { useI18n } from '../i18n';
import type { TKey } from '../i18n';
import { downloadCsv } from '../lib/csv';

const ALL_CREWS = '__ALL__';
const LEVELS = Array.from({ length: 11 }, (_, i) => i); // 0..10

const keyOf = (empId: string, skill: string) => `${empId}::${skill}`;

type SortCol = 'name' | 'crew' | 'avg' | (typeof SKILL_KEYS)[number];

// Cell background shading by proficiency (0 = neutral, 10 = strong blue).
function cellStyle(level: number): React.CSSProperties {
  if (!level) return {};
  const alpha = 0.08 + (level / 10) * 0.5;
  return { backgroundColor: `rgba(37, 99, 235, ${alpha.toFixed(3)})`, color: level >= 7 ? '#fff' : undefined };
}

export default function Skills() {
  const { t } = useI18n();
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [levels, setLevels] = useState<Record<string, number>>({});
  const [dirty, setDirty] = useState<Set<string>>(new Set());
  const [selectedCrew, setSelectedCrew] = useState(ALL_CREWS);
  const [query, setQuery] = useState('');
  const [saving, setSaving] = useState(false);
  const [sortCol, setSortCol] = useState<SortCol>('name');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');

  // Editable ID info (age / id number) and photo URLs, keyed by employee id.
  const [ages, setAges] = useState<Record<string, string>>({});
  const [idNos, setIdNos] = useState<Record<string, string>>({});
  const [photos, setPhotos] = useState<Record<string, string>>({});
  const [uploadFor, setUploadFor] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let alive = true;
    Promise.all([api.getEmployees(), api.getEmployeeSkills()]).then(([emps, skills]) => {
      if (!alive) return;
      setEmployees(emps);
      const map: Record<string, number> = {};
      skills.forEach((s: EmployeeSkill) => {
        map[keyOf(s.employeeId, s.skillKey)] = s.level;
      });
      setLevels(map);
      const a: Record<string, string> = {};
      const n: Record<string, string> = {};
      const p: Record<string, string> = {};
      emps.forEach((e) => {
        if (e.age != null) a[e.id] = String(e.age);
        if (e.idNo) n[e.id] = e.idNo;
        if (e.photoUrl) p[e.id] = e.photoUrl;
      });
      setAges(a);
      setIdNos(n);
      setPhotos(p);
    });
    return () => {
      alive = false;
    };
  }, []);

  // Persist age/id changes for one employee (called on blur).
  const saveInfo = (empId: string, patch: { age?: number | null; idNo?: string | null }) => {
    api.updateEmployeeInfo(empId, patch).catch(() => alert(t('skill.saveError')));
  };

  // Trigger the hidden file picker for a given worker's photo.
  const pickPhoto = (empId: string) => {
    setUploadFor(empId);
    fileRef.current?.click();
  };

  const onPhotoFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !uploadFor) return;
    const empId = uploadFor;
    try {
      const url = await api.uploadEmployeePhoto(empId, file);
      setPhotos((prev) => ({ ...prev, [empId]: url }));
    } catch {
      alert(t('skill.photoError'));
    } finally {
      setUploadFor(null);
    }
  };

  const getLevel = (empId: string, skill: string) => levels[keyOf(empId, skill)] ?? 0;

  const setLevel = (empId: string, skill: string, level: number) => {
    const k = keyOf(empId, skill);
    setLevels((prev) => ({ ...prev, [k]: level }));
    setDirty((prev) => new Set(prev).add(k));
  };

  const avgOf = (empId: string) => {
    const sum = SKILL_KEYS.reduce((s, k) => s + getLevel(empId, k), 0);
    return sum / SKILL_KEYS.length;
  };

  // Crew list for the filter dropdown.
  const crewList = useMemo(() => {
    const counts = new Map<string, number>();
    employees.forEach((e) => counts.set(e.crewId, (counts.get(e.crewId) ?? 0) + 1));
    return Array.from(counts.entries())
      .map(([id, count]) => ({ id, count }))
      .sort((a, b) => b.count - a.count);
  }, [employees]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return employees.filter(
      (e) =>
        (selectedCrew === ALL_CREWS || e.crewId === selectedCrew) &&
        (q === '' || e.name.toLowerCase().includes(q))
    );
  }, [employees, selectedCrew, query]);

  // Click a column header to sort by it; click again to flip direction.
  const toggleSort = (col: SortCol) => {
    if (col === sortCol) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortCol(col);
      // Names/crews read best A→Z; skill/avg columns best high→low.
      setSortDir(col === 'name' || col === 'crew' ? 'asc' : 'desc');
    }
  };

  const arrow = (col: SortCol) => (sortCol === col ? (sortDir === 'asc' ? ' ▲' : ' ▼') : '');

  const sorted = useMemo(() => {
    const dir = sortDir === 'asc' ? 1 : -1;
    const val = (e: Employee): string | number => {
      if (sortCol === 'name') return e.name.toLowerCase();
      if (sortCol === 'crew') return e.crewId.toLowerCase();
      if (sortCol === 'avg') return avgOf(e.id);
      return getLevel(e.id, sortCol);
    };
    return [...visible].sort((a, b) => {
      const av = val(a);
      const bv = val(b);
      if (av < bv) return -dir;
      if (av > bv) return dir;
      return a.name.localeCompare(b.name);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, sortCol, sortDir, levels]);

  const handleSave = async () => {
    if (!dirty.size) return;
    const rows: EmployeeSkill[] = Array.from(dirty).map((k) => {
      const [employeeId, skillKey] = k.split('::');
      return { employeeId, skillKey, level: levels[k] ?? 0 };
    });
    setSaving(true);
    try {
      await api.saveEmployeeSkills(rows);
      setDirty(new Set());
      alert(t('skill.saved'));
    } catch {
      alert(t('skill.saveError'));
    } finally {
      setSaving(false);
    }
  };

  const handleExport = () => {
    const header = [
      t('skill.thName'),
      t('skill.thCrew'),
      ...SKILL_KEYS.map((k) => t(`skill.${k}` as TKey)),
      t('skill.thAvg'),
    ];
    const body = sorted.map((e) => [
      e.name,
      e.crewId,
      ...SKILL_KEYS.map((k) => getLevel(e.id, k)),
      avgOf(e.id).toFixed(1),
    ]);
    const crewTag = selectedCrew === ALL_CREWS ? 'all' : selectedCrew;
    downloadCsv(`skills_${crewTag}.csv`, [header, ...body]);
  };

  // Build a printable A4-landscape sign-up sheet (one page per crew) with each
  // worker's photo, name, age and ID, and each trade column filled in with the
  // saved proficiency level (0–10) and the same blue shading as the on-screen
  // matrix, so the printout mirrors the Skills sheet.
  const handlePrint = () => {
    const esc = (s: string) =>
      String(s).replace(
        /[&<>"']/g,
        (c) =>
          (({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }) as Record<
            string,
            string
          >)[c]
      );

    // Inline print styling for a proficiency cell (mirrors cellStyle()).
    const skillCell = (level: number) => {
      if (!level) return '<td class="sk"></td>';
      const alpha = (0.08 + (level / 10) * 0.5).toFixed(3);
      const color = level >= 7 ? '#fff' : '#15304e';
      return `<td class="sk" style="background:rgba(37,99,235,${alpha});color:${color}">${level}</td>`;
    };

    const groups = new Map<string, Employee[]>();
    sorted.forEach((e) => {
      const arr = groups.get(e.crewId) ?? [];
      arr.push(e);
      groups.set(e.crewId, arr);
    });

    const skillHead = SKILL_KEYS.map(
      (k) => `<th class="sk">${esc(t(`skill.${k}` as TKey))}</th>`
    ).join('');

    const pages = Array.from(groups.entries())
      .map(([crew, list]) => {
        const rows = list
          .map((e, i) => {
            const photo = photos[e.id];
            const cell = photo
              ? `<img class="ph" src="${esc(photo)}" />`
              : `<div class="ph ph-empty"></div>`;
            return `<tr>
              <td class="num">${i + 1}</td>
              <td class="pht">${cell}</td>
              <td class="nm">${esc(e.name)}</td>
              <td class="age">${esc(ages[e.id] ?? '')}</td>
              <td class="idn">${esc(idNos[e.id] ?? '')}</td>
              ${SKILL_KEYS.map((k) => skillCell(getLevel(e.id, k))).join('')}
              <td class="avg">${avgOf(e.id).toFixed(1)}</td>
            </tr>`;
          })
          .join('');
        return `<section class="page">
          <h1>${esc(t('skill.thCrew'))}: ${esc(crew)} <span class="cnt">(${list.length})</span></h1>
          <table>
            <thead><tr>
              <th class="num">#</th>
              <th class="pht">${esc(t('skill.thPhoto'))}</th>
              <th class="nm">${esc(t('skill.thName'))}</th>
              <th class="age">${esc(t('skill.thAge'))}</th>
              <th class="idn">${esc(t('skill.thId'))}</th>
              ${skillHead}
              <th class="avg">${esc(t('skill.thAvg'))}</th>
            </tr></thead>
            <tbody>${rows}</tbody>
          </table>
        </section>`;
      })
      .join('');

    const html = `<!doctype html><html><head><meta charset="utf-8" />
      <title>${esc(t('skill.signupTitle'))}</title>
      <style>
        * { box-sizing: border-box; }
        body { font-family: -apple-system, Segoe UI, Roboto, sans-serif; margin: 0; color: #15304e; }
        .bar { padding: 10px 14px; display: flex; gap: 12px; align-items: center; background: #f1f5f9; }
        .bar button { background: #2E75B6; color: #fff; border: 0; border-radius: 6px; padding: 8px 14px; font-size: 14px; cursor: pointer; }
        .bar span { font-size: 12px; color: #475569; }
        .page { background: #fff; padding: 6mm 8mm; }
        h1 { font-size: 15px; margin: 0 0 6px; }
        h1 .cnt { font-size: 12px; color: #64748b; font-weight: 400; }
        table { width: 100%; border-collapse: collapse; }
        th, td { border: 1px solid #94a3b8; padding: 2px 4px; font-size: 10px; text-align: center;
                 -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        th { background: #e2e8f0; }
        td.nm, th.nm { text-align: left; white-space: nowrap; }
        td.avg, th.avg { font-weight: 700; }
        .num { width: 22px; }
        .pht { width: 44px; }
        .age { width: 34px; }
        .idn { width: 90px; }
        .sk { width: 26px; }
        .avg { width: 30px; }
        img.ph { width: 34px; height: 42px; object-fit: cover; display: block; margin: 0 auto; }
        .ph-empty { width: 34px; height: 42px; margin: 0 auto; background: repeating-linear-gradient(45deg,#f1f5f9,#f1f5f9 4px,#e2e8f0 4px,#e2e8f0 8px); }
        @media print {
          .no-print { display: none; }
          .page { page-break-after: always; padding: 0; }
          .page:last-child { page-break-after: auto; }
          @page { size: A4 landscape; margin: 8mm; }
        }
      </style></head><body>
      <div class="bar no-print">
        <button onclick="window.print()">🖨️ ${esc(t('skill.printBtn'))}</button>
        <span>${esc(t('skill.printHint'))}</span>
      </div>
      ${pages}
    </body></html>`;

    const w = window.open('', '_blank');
    if (!w) {
      alert(t('skill.popupBlocked'));
      return;
    }
    w.document.write(html);
    w.document.close();
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
          <option value={ALL_CREWS}>{t('pay.allCrews')}</option>
          {crewList.map((c) => (
            <option key={c.id} value={c.id}>
              {c.id} ({c.count})
            </option>
          ))}
        </select>

        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('skill.search')}
          className="border border-line rounded-lg px-3 py-2 text-sm bg-white"
        />

        <div className="flex-1" />

        {dirty.size > 0 && (
          <span className="text-xs text-red-600 font-bold">
            {dirty.size} {t('skill.unsaved')}
          </span>
        )}
        <button className="btn gray" onClick={handlePrint}>
          {t('skill.printSignup')}
        </button>
        <button className="btn gray" onClick={handleExport}>
          {t('skill.export')}
        </button>
        <button className="btn" onClick={handleSave} disabled={saving || dirty.size === 0}>
          {saving ? t('skill.saving') : t('skill.save')}
        </button>
      </div>

      {/* Hidden picker used for uploading a worker's ID photo. */}
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={onPhotoFile}
      />

      <div className="panel">
        <h3 className="text-sm font-bold text-dark mb-3">
          <span className="inline-block w-1 h-4 bg-primary rounded mr-2" />
          {t('skill.title')}
        </h3>

        {/* Mobile card view — read-only skill chips (edit levels on desktop table) */}
        <div className="md:hidden space-y-3">
          {sorted.map((e) => {
            const skills = SKILL_KEYS.map((k) => ({ k, lvl: getLevel(e.id, k) }))
              .filter((s) => s.lvl > 0)
              .sort((a, b) => b.lvl - a.lvl);
            const avg = avgOf(e.id);
            return (
              <div key={e.id} className="bg-white border border-line rounded-xl p-3 shadow-sm">
                <div className="flex items-center justify-between gap-2">
                  <div className="font-bold text-sm text-dark truncate">{e.name}</div>
                  <span className={`pill flex-shrink-0 ${avg >= 6 ? 'ok' : 'half'}`}>
                    {t('skill.thAvg')} {avg.toFixed(1)}
                  </span>
                </div>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {skills.length === 0 && <span className="text-xs text-muted">—</span>}
                  {skills.map((s) => (
                    <span
                      key={s.k}
                      className="text-[10px] font-bold px-2 py-0.5 rounded"
                      style={cellStyle(s.lvl)}
                    >
                      {t(`skill.${s.k}` as TKey)} {s.lvl}
                    </span>
                  ))}
                </div>
              </div>
            );
          })}
        </div>

        {/* Desktop table view */}
        <div className="overflow-x-auto hidden md:block">
          <table className="text-sm">
            <thead>
              <tr>
                <th className="text-center whitespace-nowrap">{t('skill.thPhoto')}</th>
                <th
                  onClick={() => toggleSort('name')}
                  className="text-left sticky left-0 bg-white cursor-pointer select-none whitespace-nowrap hover:text-primary"
                >
                  {t('skill.thName')}
                  {arrow('name')}
                </th>
                <th className="text-center whitespace-nowrap">{t('skill.thAge')}</th>
                <th className="text-center whitespace-nowrap">{t('skill.thId')}</th>
                <th
                  onClick={() => toggleSort('crew')}
                  className="text-center cursor-pointer select-none whitespace-nowrap hover:text-primary"
                >
                  {t('skill.thCrew')}
                  {arrow('crew')}
                </th>
                {SKILL_KEYS.map((k) => (
                  <th
                    key={k}
                    onClick={() => toggleSort(k)}
                    className="text-center whitespace-nowrap cursor-pointer select-none hover:text-primary"
                  >
                    {t(`skill.${k}` as TKey)}
                    {arrow(k)}
                  </th>
                ))}
                <th
                  onClick={() => toggleSort('avg')}
                  className="text-center cursor-pointer select-none whitespace-nowrap hover:text-primary"
                >
                  {t('skill.thAvg')}
                  {arrow('avg')}
                </th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((e) => (
                <tr key={e.id}>
                  <td className="text-center p-1">
                    <button
                      onClick={() => pickPhoto(e.id)}
                      title={t('skill.photoTitle')}
                      className="mx-auto block h-11 w-9 overflow-hidden rounded border border-line bg-gray-50 hover:ring-2 hover:ring-primary"
                    >
                      {photos[e.id] ? (
                        <img
                          src={photos[e.id]}
                          alt=""
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        <span className="text-base leading-none text-muted">＋</span>
                      )}
                    </button>
                  </td>
                  <td className="whitespace-nowrap sticky left-0 bg-white">{e.name}</td>
                  <td className="text-center p-0.5">
                    <input
                      type="number"
                      min={0}
                      inputMode="numeric"
                      value={ages[e.id] ?? ''}
                      onChange={(ev) =>
                        setAges((prev) => ({ ...prev, [e.id]: ev.target.value }))
                      }
                      onBlur={() =>
                        saveInfo(e.id, {
                          age: ages[e.id] ? Math.max(0, Math.floor(Number(ages[e.id]))) : null,
                        })
                      }
                      className="w-12 rounded border border-line bg-white px-1 py-1 text-center text-sm"
                      placeholder="—"
                    />
                  </td>
                  <td className="text-center p-0.5">
                    <input
                      type="text"
                      value={idNos[e.id] ?? ''}
                      onChange={(ev) =>
                        setIdNos((prev) => ({ ...prev, [e.id]: ev.target.value }))
                      }
                      onBlur={() => saveInfo(e.id, { idNo: idNos[e.id]?.trim() || null })}
                      className="w-24 rounded border border-line bg-white px-1 py-1 text-center text-sm"
                      placeholder="—"
                    />
                  </td>
                  <td className="text-center text-muted">{e.crewId}</td>
                  {SKILL_KEYS.map((k) => {
                    const lvl = getLevel(e.id, k);
                    return (
                      <td key={k} className="text-center p-0.5" style={cellStyle(lvl)}>
                        <select
                          value={lvl}
                          onChange={(ev) => setLevel(e.id, k, Number(ev.target.value))}
                          className="w-12 bg-transparent text-center text-sm border-0 cursor-pointer focus:outline-none"
                        >
                          {LEVELS.map((n) => (
                            <option key={n} value={n}>
                              {n}
                            </option>
                          ))}
                        </select>
                      </td>
                    );
                  })}
                  <td className="text-center font-bold">{avgOf(e.id).toFixed(1)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <p className="text-xs text-muted mt-3">{t('skill.note')}</p>
      </div>
    </div>
  );
}
