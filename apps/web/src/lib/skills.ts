import { useCallback, useEffect, useState } from 'react';
import { DEFAULT_SKILLS, skillsOf } from '@brightem/shared';
import type { SkillDef } from '@brightem/shared';
import { api } from '../api';
import { useI18n } from '../i18n';

/**
 * The editable skill catalog (Settings → Skills), loaded from the payroll
 * config. Starts with the defaults and swaps in the saved list once loaded.
 */
export function useSkills() {
  const { lang } = useI18n();
  const [skills, setSkills] = useState<SkillDef[]>(DEFAULT_SKILLS);

  useEffect(() => {
    let alive = true;
    api
      .getConfig()
      .then((cfg) => alive && setSkills(skillsOf(cfg)))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  const label = useCallback(
    (key: string) => {
      const s = skills.find((x) => x.key === key);
      if (!s) return key;
      return (lang === 'ko' ? s.ko : s.en) || s.en || s.header || key;
    },
    [skills, lang]
  );

  return { skills, keys: skills.map((s) => s.key), label };
}
