import { useState, useEffect } from 'react';
import type { PayrollConfig, OvertimeMultipliers, NightDifferential } from '@brightem/shared';
import { api } from '../api';
import { useI18n } from '../i18n';

export default function Settings() {
  const { t } = useI18n();
  const [config, setConfig] = useState<PayrollConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setLoading(true);
    api
      .getConfig()
      .then((data) => {
        setConfig(data);
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

  const handleSave = async () => {
    if (!config) return;
    setSaving(true);
    try {
      await api.updateConfig(config);
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
