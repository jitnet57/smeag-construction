import { useCallback, useEffect, useState } from 'react';
import { DEFAULT_EMPLOYEE_FIELDS, employeeFieldsOf } from '@brightem/shared';
import type { EmployeeFieldDef } from '@brightem/shared';
import { api } from '../api';
import { useI18n } from '../i18n';

/**
 * The editable Employees info columns (Settings → Employee fields), loaded
 * from the payroll config. Starts with the defaults until the config loads.
 */
export function useEmployeeFields() {
  const { lang } = useI18n();
  const [fields, setFields] = useState<EmployeeFieldDef[]>(DEFAULT_EMPLOYEE_FIELDS);

  useEffect(() => {
    let alive = true;
    api
      .getConfig()
      .then((cfg) => alive && setFields(employeeFieldsOf(cfg)))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  const label = useCallback(
    (f: EmployeeFieldDef) => (lang === 'ko' ? f.ko || f.en : f.en || f.ko) || f.key,
    [lang]
  );

  return { fields, label };
}
