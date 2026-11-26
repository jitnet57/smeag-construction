import { useState, useEffect } from 'react';
import {
  DEFAULT_EMPLOYEE_FIELDS,
  DEFAULT_SKILLS,
  FOREMAN_TEAM_KEY,
  REQUIRED_EMPLOYEE_FIELDS,
  employeeFieldsOf,
  skillsOf,
} from '@brightem/shared';
import type {
  PayrollConfig,
  OvertimeMultipliers,
  NightDifferential,
  SkillDef,
  EmployeeFieldDef,
  EmployeeFieldType,
} from '@brightem/shared';
import { api } from '../api';
import { useI18n } from '../i18n';

// A skill row being edited; `isNew` rows get their key generated on save.
type SkillRow = SkillDef & { isNew?: boolean };
// An employee info field row being edited; `isNew` rows get a key on save.
type FieldRow = EmployeeFieldDef & { isNew?: boolean };

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');

export default function Settings() {
  const { t } = useI18n();
  const [config, setConfig] = useState<PayrollConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [skills, setSkills] = useState<SkillRow[]>([]);
  const [fields, setFields] = useState<FieldRow[]>([]);

  useEffect(() => {
    setLoading(true);
    api
      .getConfig()
      .then((data) => {
        setConfig(data);
        setSkills(skillsOf(data).map((sk) => ({ ...sk })));
        setFields(employeeFieldsOf(data).map((f) => ({ ...f })));
      })
      .finally(() => setLoading(false));
  }, []);

  const handleOvertimeChange = (field: keyof OvertimeMultipliers, value: number) => {
    if (!config) return;
    setConfig({
      ...config,
      overtime: {
        ...config.overtime,
        [field]: value,
      },
    });
  };

  const handleNightDiffChange = (field: keyof NightDifferential, value: number) => {
    if (!config) return;
    setConfig({
      ...config,
      nightDifferential: {
        ...config.nightDifferential,
        [field]: value,
      },
    });
  };

  const updateSkill = (i: number, patch: Partial<SkillDef>) =>
    setSkills((prev) => prev.map((sk, j) => (j === i ? { ...sk, ...patch } : sk)));

  const moveSkill = (i: number, dir: -1 | 1) =>
    setSkills((prev) => {
      const j = i + dir;
      if (j < 0 || j >= prev.length) return prev;
      const next = [...prev];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });

  const removeSkill = (i: number) => {
    if (!skills[i].isNew && !window.confirm(t('set.skillDeleteConfirm'))) return;
    setSkills((prev) => prev.filter((_, j) => j !== i));
  };

  const addSkill = () =>
    setSkills((prev) => [...prev, { key: '', header: '', en: '', ko: '', isNew: true }]);

  const resetSkills = () => {
    if (!window.confirm(t('set.skillResetConfirm'))) return;
    setSkills(DEFAULT_SKILLS.map((sk) => ({ ...sk })));
  };

  // Validate the skill list and give new rows a stable, unique key.
  const finalizeSkills = (): SkillDef[] | null => {
    const rows = skills.map((sk) => ({
      ...sk,
      header: sk.header.trim().toUpperCase(),
      en: sk.en.trim(),
      ko: sk.ko.trim(),
    }));
    if (rows.some((sk) => !sk.header && !sk.en && !sk.ko)) {
      alert(t('set.skillNeedName'));
      return null;
    }
    const heads = rows.map((sk) => sk.header).filter(Boolean);
    const dup = heads.find((h, i) => heads.indexOf(h) !== i);
    if (dup) {
      alert(`${t('set.skillDupHeader')}: ${dup}`);
      return null;
    }
    const used = new Set<string>([FOREMAN_TEAM_KEY, ...rows.filter((sk) => !sk.isNew).map((sk) => sk.key)]);
    return rows.map(({ isNew, ...sk }) => {
      if (!isNew) return sk;
      const base = slug(sk.header || sk.en) || 'skill';
      let key = base;
      for (let n = 2; used.has(key); n++) key = `${base}_${n}`;
      used.add(key);
      return { ...sk, key };
    });
  };

  // --- Employee info fields ------------------------------------------------
  const updateField = (i: number, patch: Partial<EmployeeFieldDef>) =>
    setFields((prev) => prev.map((f, j) => (j === i ? { ...f, ...patch } : f)));

  const moveField = (i: number, dir: -1 | 1) =>
    setFields((prev) => {
      const j = i + dir;
      if (j < 0 || j >= prev.length) return prev;
      const next = [...prev];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });

  const removeField = (i: number) => {
    if (!fields[i].isNew && !window.confirm(t('set.fieldDeleteConfirm'))) return;
    setFields((prev) => prev.filter((_, j) => j !== i));
  };

  const addField = () =>
    setFields((prev) => [
      ...prev,
      { key: '', en: '', ko: '', visible: true, builtin: false, type: 'text', isNew: true },
    ]);

  const resetFields = () => {
    if (!window.confirm(t('set.fieldResetConfirm'))) return;
    setFields(DEFAULT_EMPLOYEE_FIELDS.map((f) => ({ ...f })));
  };

  const finalizeFields = (): EmployeeFieldDef[] | null => {
    const rows = fields.map((f) => ({ ...f, en: f.en.trim(), ko: f.ko.trim() }));
    if (rows.some((f) => !f.en && !f.ko)) {
      alert(t('set.fieldNeedName'));
      return null;
    }
    const used = new Set<string>([
      ...DEFAULT_EMPLOYEE_FIELDS.map((f) => f.key),
      ...rows.filter((f) => !f.isNew).map((f) => f.key),
    ]);
    return rows.map(({ isNew, ...f }) => {
      if (!isNew) return f;
      const base = `c_${slug(f.en) || 'field'}`;
      let key = base;
      for (let n = 2; used.has(key); n++) key = `${base}_${n}`;
      used.add(key);
      return { ...f, key };
    });
  };

  const handleSave = async () => {
    if (!config) return;
    const finalSkills = finalizeSkills();
    if (!finalSkills) return;
    const finalFields = finalizeFields();
    if (!finalFields) return;
    setSaving(true);
    try {
      const next = { ...config, skills: finalSkills, employeeFields: finalFields };
      await api.updateConfig(next);
      setConfig(next);
      setSkills(finalSkills.map((sk) => ({ ...sk })));
      setFields(finalFields.map((f) => ({ ...f })));
      alert(t('set.saved'));
    } catch (error) {
      alert(t('set.saveError'));
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div className="text-center text-gray-500 py-8">{t('set.loading')}</div>;
  }

  if (!config) {
    return (
      <div className="text-center text-gray-500 py-8">{t('set.loadError')}</div>
    );
  }

  return (
    <div className="w-full max-w-4xl">
      {/* Overtime & Holiday Multipliers */}
      <div className="panel">
        <h3 className="text-sm font-bold text-dark mb-3">
          <span className="inline-block w-1 h-4 bg-primary rounded mr-2" />
          {t('set.otTitle')}
        </h3>
        <div className="overflow-x-auto">
          <table>
            <thead>
              <tr>
                <th>{t('set.thType')}</th>
                <th className="text-center">{t('set.thMultiplier')}</th>
                <th>{t('set.thCondition')}</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>{t('set.regularOt')}</td>
                <td className="text-center">
                  <input
                    type="number"
                    step="0.01"
                    value={config.overtime.regularDay}
                    onChange={(e) => handleOvertimeChange('regularDay', parseFloat(e.target.value))}
                    className="border border-line rounded px-2 py-1 w-20 text-center"
                  />
                </td>
                <td>{t('set.regularOtCond')}</td>
              </tr>
              <tr>
                <td>{t('set.drd')}</td>
                <td className="text-center">
                  <input
                    type="number"
                    step="0.01"
                    value={config.overtime.restDay}
                    onChange={(e) => handleOvertimeChange('restDay', parseFloat(e.target.value))}
                    className="border border-line rounded px-2 py-1 w-20 text-center"
                  />
                </td>
                <td>{t('set.drdCond')}</td>
              </tr>
              <tr>
                <td>{t('set.specialHoliday')}</td>
                <td className="text-center">
                  <input
                    type="number"
                    step="0.01"
                    value={config.overtime.specialHoliday}
                    onChange={(e) => handleOvertimeChange('specialHoliday', parseFloat(e.target.value))}
                    className="border border-line rounded px-2 py-1 w-20 text-center"
                  />
                </td>
                <td>{t('set.specialHolidayCond')}</td>
              </tr>
              <tr>
                <td>{t('set.legalHoliday')}</td>
                <td className="text-center">
                  <input
                    type="number"
                    step="0.01"
                    value={config.overtime.legalHoliday}
                    onChange={(e) => handleOvertimeChange('legalHoliday', parseFloat(e.target.value))}
                    className="border border-line rounded px-2 py-1 w-20 text-center"
                  />
                </td>
                <td>{t('set.legalHolidayCond')}</td>
              </tr>
              <tr>
                <td>{t('set.nightDiff')}</td>
                <td className="text-center">
                  <input
                    type="number"
                    step="0.01"
                    value={config.nightDifferential.ratePct}
                    onChange={(e) => handleNightDiffChange('ratePct', parseFloat(e.target.value))}
                    className="border border-line rounded px-2 py-1 w-20 text-center"
                  />
                </td>
                <td>{t('set.nightWindow')} {config.nightDifferential.windowStart}:00 ~ {config.nightDifferential.windowEnd}:00</td>
              </tr>
            </tbody>
          </table>
        </div>
        <div className="note">
          {t('set.otNote')}
        </div>
      </div>

      {/* Statutory Deductions */}
      <div className="panel">
        <h3 className="text-sm font-bold text-dark mb-3">
          <span className="inline-block w-1 h-4 bg-primary rounded mr-2" />
          {t('set.statutoryTitle')}
        </h3>
        <div className="overflow-x-auto">
          <table>
            <thead>
              <tr>
                <th>{t('set.thItem')}</th>
                <th>{t('set.thMethod')}</th>
                <th>{t('set.thRemark')}</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>
                  <b>SSS</b>
                </td>
                <td>{t('set.sssMethod')}</td>
                <td>
                  <div className="banner" style={{ margin: 0, padding: '4px 8px', fontSize: '10px' }}>
                    {t('set.clientProvide')}
                  </div>
                </td>
              </tr>
              <tr>
                <td>
                  <b>PhilHealth</b>
                </td>
                <td>{t('set.rateMethod')}</td>
                <td>
                  <div className="banner" style={{ margin: 0, padding: '4px 8px', fontSize: '10px' }}>
                    {t('set.clientProvide')}
                  </div>
                </td>
              </tr>
              <tr>
                <td>
                  <b>Pag-IBIG</b>
                </td>
                <td>{t('set.rateMethod')}</td>
                <td>
                  <div className="banner" style={{ margin: 0, padding: '4px 8px', fontSize: '10px' }}>
                    {t('set.clientProvide')}
                  </div>
                </td>
              </tr>
              <tr>
                <td>
                  <b>{t('set.loan')}</b>
                </td>
                <td>{t('set.loanMethod')}</td>
                <td>{t('set.loanRemark')}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <div className="note">
          {t('set.statutoryNote')}
        </div>
      </div>

      {/* Incentive Configuration */}
      <div className="panel">
        <h3 className="text-sm font-bold text-dark mb-3">
          <span className="inline-block w-1 h-4 bg-primary rounded mr-2" />
          {t('set.otherTitle')}
        </h3>
        <div className="space-y-3">
          <div>
            <label className="block text-sm font-bold text-dark mb-1">
              {t('set.incentiveRate')}
            </label>
            <div className="flex gap-2">
              <input
                type="number"
                value={config.incentiveDailyRate}
                onChange={(e) =>
                  setConfig({ ...config, incentiveDailyRate: parseFloat(e.target.value) })
                }
                className="border border-line rounded px-3 py-2 w-32"
              />
              <span className="text-sm text-muted pt-2">{t('set.perWorkedDay')}</span>
            </div>
          </div>
          <div>
            <label className="block text-sm font-bold text-dark mb-1">
              {t('set.stdHours')}
            </label>
            <div className="flex gap-2">
              <input
                type="number"
                value={config.standardHoursPerDay}
                onChange={(e) =>
                  setConfig({ ...config, standardHoursPerDay: parseFloat(e.target.value) })
                }
                className="border border-line rounded px-3 py-2 w-32"
              />
              <span className="text-sm text-muted pt-2">{t('set.hours')}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Skill catalog */}
      <div className="panel">
        <div className="flex items-center justify-between gap-2 mb-3">
          <h3 className="text-sm font-bold text-dark">
            <span className="inline-block w-1 h-4 bg-primary rounded mr-2" />
            {t('set.skillsTitle')} ({skills.length})
          </h3>
          <div className="flex gap-2">
            <button type="button" className="btn ghost" onClick={resetSkills}>
              {t('set.skillReset')}
            </button>
            <button type="button" className="btn gray" onClick={addSkill}>
              {t('set.skillAdd')}
            </button>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table>
            <thead>
              <tr>
                <th className="text-center">#</th>
                <th>{t('set.skillHeader')}</th>
                <th>{t('set.skillEn')}</th>
                <th>{t('set.skillKo')}</th>
                <th>{t('set.skillKey')}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {skills.map((sk, i) => (
                <tr key={sk.isNew ? `new-${i}` : sk.key}>
                  <td className="text-center text-muted">{i + 1}</td>
                  <td>
                    <input
                      type="text"
                      value={sk.header}
                      onChange={(e) => updateSkill(i, { header: e.target.value })}
                      className="border border-line rounded px-2 py-1 w-40 uppercase"
                      placeholder="CARPENTER"
                    />
                  </td>
                  <td>
                    <input
                      type="text"
                      value={sk.en}
                      onChange={(e) => updateSkill(i, { en: e.target.value })}
                      className="border border-line rounded px-2 py-1 w-36"
                    />
                  </td>
                  <td>
                    <input
                      type="text"
                      value={sk.ko}
                      onChange={(e) => updateSkill(i, { ko: e.target.value })}
                      className="border border-line rounded px-2 py-1 w-28"
                    />
                  </td>
                  <td className="text-xs text-muted whitespace-nowrap">
                    {sk.isNew ? slug(sk.header || sk.en) || '—' : sk.key}
                  </td>
                  <td className="whitespace-nowrap text-right">
                    <button
                      type="button"
                      className="btn ghost px-2"
                      title={t('set.skillUp')}
                      disabled={i === 0}
                      onClick={() => moveSkill(i, -1)}
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      className="btn ghost px-2"
                      title={t('set.skillDown')}
                      disabled={i === skills.length - 1}
                      onClick={() => moveSkill(i, 1)}
                    >
                      ↓
                    </button>
                    <button
                      type="button"
                      className="btn ghost px-2 text-red-600"
                      title={t('set.skillDelete')}
                      onClick={() => removeSkill(i)}
                    >
                      ✕
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="note">{t('set.skillsNote')}</div>
      </div>

      {/* Employee info fields */}
      <div className="panel">
        <div className="flex items-center justify-between gap-2 mb-3">
          <h3 className="text-sm font-bold text-dark">
            <span className="inline-block w-1 h-4 bg-primary rounded mr-2" />
            {t('set.fieldsTitle')} ({fields.length})
          </h3>
          <div className="flex gap-2">
            <button type="button" className="btn ghost" onClick={resetFields}>
              {t('set.skillReset')}
            </button>
            <button type="button" className="btn gray" onClick={addField}>
              {t('set.fieldAdd')}
            </button>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table>
            <thead>
              <tr>
                <th className="text-center">#</th>
                <th>{t('set.skillKo')}</th>
                <th>{t('set.skillEn')}</th>
                <th>{t('set.fieldType')}</th>
                <th className="text-center">{t('set.fieldVisible')}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {fields.map((f, i) => {
                const required = f.builtin && REQUIRED_EMPLOYEE_FIELDS.includes(f.key);
                return (
                  <tr key={f.isNew ? `new-${i}` : f.key} className={f.visible ? '' : 'opacity-60'}>
                    <td className="text-center text-muted">{i + 1}</td>
                    <td>
                      <input
                        type="text"
                        value={f.ko}
                        onChange={(e) => updateField(i, { ko: e.target.value })}
                        className="border border-line rounded px-2 py-1 w-32"
                      />
                    </td>
                    <td>
                      <input
                        type="text"
                        value={f.en}
                        onChange={(e) => updateField(i, { en: e.target.value })}
                        className="border border-line rounded px-2 py-1 w-36"
                      />
                    </td>
                    <td className="whitespace-nowrap">
                      {f.builtin ? (
                        <span className="text-xs text-muted">{t('set.fieldBuiltin')}</span>
                      ) : (
                        <select
                          value={f.type ?? 'text'}
                          onChange={(e) =>
                            updateField(i, { type: e.target.value as EmployeeFieldType })
                          }
                          className="border border-line rounded px-2 py-1 bg-white"
                        >
                          <option value="text">{t('set.fieldTypeText')}</option>
                          <option value="number">{t('set.fieldTypeNumber')}</option>
                          <option value="date">{t('set.fieldTypeDate')}</option>
                        </select>
                      )}
                    </td>
                    <td className="text-center">
                      <input
                        type="checkbox"
                        checked={f.visible}
                        disabled={required}
                        title={required ? t('set.fieldRequired') : undefined}
                        onChange={(e) => updateField(i, { visible: e.target.checked })}
                      />
                    </td>
                    <td className="whitespace-nowrap text-right">
                      <button
                        type="button"
                        className="btn ghost px-2"
                        title={t('set.skillUp')}
                        disabled={i === 0}
                        onClick={() => moveField(i, -1)}
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        className="btn ghost px-2"
                        title={t('set.skillDown')}
                        disabled={i === fields.length - 1}
                        onClick={() => moveField(i, 1)}
                      >
                        ↓
                      </button>
                      <button
                        type="button"
                        className="btn ghost px-2 text-red-600"
                        title={f.builtin ? t('set.fieldBuiltinNoDelete') : t('set.skillDelete')}
                        disabled={f.builtin}
                        onClick={() => removeField(i)}
                      >
                        ✕
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="note">{t('set.fieldsNote')}</div>
      </div>

      {/* Save Button */}
      <div className="flex gap-2 justify-end">
        <button className="btn ghost">{t('set.cancel')}</button>
        <button onClick={handleSave} disabled={saving} className="btn">
          {saving ? t('set.saving') : t('set.save')}
        </button>
      </div>
    </div>
  );
}
