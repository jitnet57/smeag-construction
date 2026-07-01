import { useState, useEffect, useMemo } from 'react';
import { SKILL_KEYS } from '@brightem/shared';
import type { Employee, EmployeeSkill } from '@brightem/shared';
import { api } from '../api';
import { useI18n } from '../i18n';
import type { TKey } from '../i18n';
import { downloadCsv } from '../lib/csv';

const ALL_CREWS = '__ALL__';
const LEVELS = Array.from({ length: 11 }, (_, i) => i); // 0..10

const keyOf = (empId: string, skill: string) => `${empId}::${skill}`;

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
    });
    return () => {
      alive = false;
    };
  }, []);

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
    const body = visible.map((e) => [
      e.name,
      e.crewId,
      ...SKILL_KEYS.map((k) => getLevel(e.id, k)),
      avgOf(e.id).toFixed(1),
    ]);
    const crewTag = selectedCrew === ALL_CREWS ? 'all' : selectedCrew;
    downloadCsv(`skills_${crewTag}.csv`, [header, ...body]);
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
        <button className="btn gray" onClick={handleExport}>
          {t('skill.export')}
        </button>
        <button className="btn" onClick={handleSave} disabled={saving || dirty.size === 0}>
          {saving ? t('skill.saving') : t('skill.save')}
        </button>
      </div>

      <div className="panel">
        <h3 className="text-sm font-bold text-dark mb-3">
          <span className="inline-block w-1 h-4 bg-primary rounded mr-2" />
          {t('skill.title')}
        </h3>

        <div className="overflow-x-auto">
          <table className="text-sm">
            <thead>
              <tr>
                <th className="text-left sticky left-0 bg-white">{t('skill.thName')}</th>
                <th className="text-center">{t('skill.thCrew')}</th>
                {SKILL_KEYS.map((k) => (
                  <th key={k} className="text-center whitespace-nowrap">
                    {t(`skill.${k}` as TKey)}
                  </th>
                ))}
                <th className="text-center">{t('skill.thAvg')}</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((e) => (
                <tr key={e.id}>
                  <td className="whitespace-nowrap sticky left-0 bg-white">{e.name}</td>
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
