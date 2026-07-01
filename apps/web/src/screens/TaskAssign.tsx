import { useState, useEffect, useMemo, useCallback } from 'react';
import { SKILL_KEYS } from '@brightem/shared';
import type {
  PayPeriod,
  Employee,
  EmployeeSkill,
  Task,
  AttendanceRecord,
} from '@brightem/shared';
import { api } from '../api';
import { useI18n } from '../i18n';
import type { TKey } from '../i18n';

interface Props {
  period: PayPeriod | null;
}

const skillKeyOf = (empId: string, skill: string) => `${empId}::${skill}`;

// Local id for tasks not yet persisted (distinguishable from DB uuids).
let localSeq = 1;
const newLocalId = () => `new-${localSeq++}`;

export default function TaskAssign({ period }: Props) {
  const { t } = useI18n();

  const [workDate, setWorkDate] = useState<string>(
    period?.endDate ?? new Date().toISOString().slice(0, 10)
  );
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [skillLevels, setSkillLevels] = useState<Record<string, number>>({});
  const [attendance, setAttendance] = useState<AttendanceRecord[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [tasksDirty, setTasksDirty] = useState(false);
  const [savingPlan, setSavingPlan] = useState(false);

  // taskId -> ordered list of assigned employeeIds
  const [assignMap, setAssignMap] = useState<Record<string, string[]>>({});
  const [assignDirty, setAssignDirty] = useState(false);
  const [savingAssign, setSavingAssign] = useState(false);
  const [matched, setMatched] = useState(false);

  // --- load master data once ------------------------------------------------
  useEffect(() => {
    Promise.all([api.getEmployees(), api.getEmployeeSkills()]).then(
      ([emps, skills]) => {
        setEmployees(emps);
        const map: Record<string, number> = {};
        skills.forEach((s: EmployeeSkill) => {
          map[skillKeyOf(s.employeeId, s.skillKey)] = s.level;
        });
        setSkillLevels(map);
      }
    );
  }, []);

  // --- load attendance for the current period (to know who is present) ------
  useEffect(() => {
    if (!period) return;
    api.getAttendance(period.id).then(setAttendance);
  }, [period]);

  // --- load tasks + assignments whenever the work date changes --------------
  const loadForDate = useCallback(async (date: string) => {
    const [tk, asg] = await Promise.all([
      api.getTasks(date),
      api.getAssignments(date),
    ]);
    setTasks(tk);
    const m: Record<string, string[]> = {};
    asg.forEach((a) => {
      (m[a.taskId] = m[a.taskId] ?? []).push(a.employeeId);
    });
    setAssignMap(m);
    setTasksDirty(false);
    setAssignDirty(false);
    setMatched(asg.length > 0);
  }, []);

  useEffect(() => {
    loadForDate(workDate);
  }, [workDate, loadForDate]);

  const empById = useMemo(() => {
    const m = new Map<string, Employee>();
    employees.forEach((e) => m.set(e.id, e));
    return m;
  }, [employees]);

  const skillOf = (empId: string, trade: string) =>
    skillLevels[skillKeyOf(empId, trade)] ?? 0;

  // Present workers on the selected work date (status !== absent).
  const presentIds = useMemo(() => {
    return attendance
      .filter((r) => r.date === workDate && r.status !== 'absent')
      .map((r) => r.employeeId)
      .filter((id) => empById.has(id));
  }, [attendance, workDate, empById]);

  // --- task editing ---------------------------------------------------------
  const updateTask = (id: string, patch: Partial<Task>) => {
    setTasks((prev) => prev.map((tk) => (tk.id === id ? { ...tk, ...patch } : tk)));
    setTasksDirty(true);
  };

  const addTask = () => {
    setTasks((prev) => [
      ...prev,
      {
        id: newLocalId(),
        workDate,
        name: '',
        skillKey: SKILL_KEYS[0],
        requiredManday: 1,
        requiredHeadcount: 1,
        status: 'draft',
      },
    ]);
    setTasksDirty(true);
  };

  const removeTask = async (id: string) => {
    // If it exists in the DB (not a local-only row), delete it there too.
    if (!id.startsWith('new-')) {
      try {
        await api.deleteTask(id);
      } catch {
        alert(t('task.saveError'));
        return;
      }
    }
    setTasks((prev) => prev.filter((tk) => tk.id !== id));
    setAssignMap((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
  };

  const toggleClose = (id: string) => {
    const tk = tasks.find((x) => x.id === id);
    if (!tk) return;
    updateTask(id, { status: tk.status === 'closed' ? 'draft' : 'closed' });
  };

  const handleSavePlan = async () => {
    setSavingPlan(true);
    try {
      // Persist each task; swap local ids for DB-issued ids.
      const saved: Task[] = [];
      for (const tk of tasks) {
        const toSave: Task = { ...tk, workDate };
        if (tk.id.startsWith('new-')) toSave.id = '';
        const result = await api.saveTask(toSave);
        // remap assignments from the old local id to the new persisted id
        if (tk.id !== result.id && assignMap[tk.id]) {
          setAssignMap((prev) => {
            const next = { ...prev };
            next[result.id] = next[tk.id];
            delete next[tk.id];
            return next;
          });
        }
        saved.push(result);
      }
      setTasks(saved);
      setTasksDirty(false);
      alert(t('task.saved'));
    } catch {
      alert(t('task.saveError'));
    } finally {
      setSavingPlan(false);
    }
  };

  // --- auto-match -----------------------------------------------------------
  const runMatch = () => {
    // Only tasks with a headcount requirement participate.
    const active = tasks.filter((tk) => tk.requiredHeadcount > 0);
    // Build all (worker, task, score) candidate pairs, then assign greedily
    // by descending skill score for the task's trade — highest skill first.
    type Cand = { empId: string; taskId: string; score: number };
    const cands: Cand[] = [];
    for (const tk of active) {
      for (const empId of presentIds) {
        cands.push({ empId, taskId: tk.id, score: skillOf(empId, tk.skillKey) });
      }
    }
    cands.sort((a, b) => b.score - a.score);

    const need: Record<string, number> = {};
    active.forEach((tk) => (need[tk.id] = tk.requiredHeadcount));
    const usedEmp = new Set<string>();
    const result: Record<string, string[]> = {};
    active.forEach((tk) => (result[tk.id] = []));

    for (const c of cands) {
      if (usedEmp.has(c.empId)) continue;
      if ((need[c.taskId] ?? 0) <= 0) continue;
      result[c.taskId].push(c.empId);
      need[c.taskId] -= 1;
      usedEmp.add(c.empId);
    }

    setAssignMap(result);
    setMatched(true);
    setAssignDirty(true);
  };

  const handleSaveAssign = async () => {
    setSavingAssign(true);
    try {
      const rows = Object.entries(assignMap).flatMap(([taskId, ids]) =>
        ids.map((employeeId) => ({ taskId, employeeId, workDate }))
      );
      await api.saveAssignments(workDate, rows);
      setAssignDirty(false);
      alert(t('task.assignSaved'));
    } catch {
      alert(t('task.assignError'));
    } finally {
      setSavingAssign(false);
    }
  };

  const assignedIds = useMemo(() => {
    const s = new Set<string>();
    Object.values(assignMap).forEach((ids) => ids.forEach((id) => s.add(id)));
    return s;
  }, [assignMap]);

  const standby = presentIds.filter((id) => !assignedIds.has(id));

  const tradeLabel = (k: string) => t(`skill.${k}` as TKey);

  return (
    <div className="w-full">
      {/* Toolbar */}
      <div className="flex gap-2 items-center flex-wrap mb-3.5">
        <label className="text-sm text-muted">{t('task.workDate')}</label>
        <input
          type="date"
          value={workDate}
          onChange={(e) => setWorkDate(e.target.value)}
          className="border border-line rounded-lg px-3 py-2 text-sm bg-white"
        />
        <div className="flex-1" />
        <span className="text-xs text-muted">
          {t('task.present')}: <b className="text-dark">{presentIds.length}</b>
        </span>
      </div>

      {/* Planned tasks */}
      <div className="panel mb-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-bold text-dark">
            <span className="inline-block w-1 h-4 bg-primary rounded mr-2 align-middle" />
            {t('task.planTitle')}
          </h3>
          <div className="flex gap-2 items-center">
            <button className="btn gray" onClick={addTask}>
              {t('task.addTask')}
            </button>
            <button
              className="btn"
              onClick={handleSavePlan}
              disabled={savingPlan || !tasksDirty}
            >
              {savingPlan ? t('task.saving') : t('task.save')}
            </button>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="text-sm w-full">
            <thead>
              <tr>
                <th className="text-left">{t('task.thName')}</th>
                <th className="text-center">{t('task.thTrade')}</th>
                <th className="text-center">{t('task.thManday')}</th>
                <th className="text-center">{t('task.thHeadcount')}</th>
                <th className="text-center">{t('task.thStatus')}</th>
                <th className="text-center">{t('task.thActions')}</th>
              </tr>
            </thead>
            <tbody>
              {tasks.length === 0 && (
                <tr>
                  <td colSpan={6} className="text-center text-muted py-4">
                    {t('task.noTasks')}
                  </td>
                </tr>
              )}
              {tasks.map((tk) => (
                <tr key={tk.id}>
                  <td>
                    <input
                      type="text"
                      value={tk.name}
                      placeholder={t('task.newTaskName')}
                      onChange={(e) => updateTask(tk.id, { name: e.target.value })}
                      className="border border-line rounded px-2 py-1 text-sm w-44 bg-white"
                    />
                  </td>
                  <td className="text-center">
                    <select
                      value={tk.skillKey}
                      onChange={(e) => updateTask(tk.id, { skillKey: e.target.value })}
                      className="border border-line rounded px-2 py-1 text-sm bg-white"
                    >
                      {SKILL_KEYS.map((k) => (
                        <option key={k} value={k}>
                          {tradeLabel(k)}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="text-center">
                    <input
                      type="number"
                      min={0}
                      step={0.5}
                      value={tk.requiredManday}
                      onChange={(e) =>
                        updateTask(tk.id, { requiredManday: Number(e.target.value) })
                      }
                      className="border border-line rounded px-2 py-1 text-sm w-20 text-center bg-white"
                    />
                  </td>
                  <td className="text-center">
                    <input
                      type="number"
                      min={0}
                      step={1}
                      value={tk.requiredHeadcount}
                      onChange={(e) =>
                        updateTask(tk.id, {
                          requiredHeadcount: Number(e.target.value),
                        })
                      }
                      className="border border-line rounded px-2 py-1 text-sm w-16 text-center bg-white"
                    />
                  </td>
                  <td className="text-center">
                    <span
                      className={`text-xs px-2 py-0.5 rounded-full ${
                        tk.status === 'closed'
                          ? 'bg-blue-100 text-blue-800'
                          : 'bg-gray-100 text-gray-600'
                      }`}
                    >
                      {tk.status === 'closed' ? t('task.stClosed') : t('task.stDraft')}
                    </span>
                  </td>
                  <td className="text-center whitespace-nowrap">
                    <button
                      className="text-xs text-blue-700 hover:underline mr-2"
                      onClick={() => toggleClose(tk.id)}
                    >
                      {tk.status === 'closed' ? t('task.reopen') : t('task.close')}
                    </button>
                    <button
                      className="text-xs text-red-600 hover:underline"
                      onClick={() => removeTask(tk.id)}
                    >
                      {t('task.delete')}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Auto-match */}
      <div className="panel">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-bold text-dark">
            <span className="inline-block w-1 h-4 bg-primary rounded mr-2 align-middle" />
            {t('task.matchTitle')}
          </h3>
          <div className="flex gap-2 items-center">
            <button
              className="btn gray"
              onClick={runMatch}
              disabled={presentIds.length === 0 || tasks.length === 0}
            >
              {t('task.runMatch')}
            </button>
            <button
              className="btn"
              onClick={handleSaveAssign}
              disabled={savingAssign || !assignDirty}
            >
              {savingAssign ? t('task.saving') : t('task.saveAssign')}
            </button>
          </div>
        </div>

        {presentIds.length === 0 ? (
          <p className="text-sm text-muted py-4 text-center">{t('task.noPresent')}</p>
        ) : !matched ? (
          <p className="text-sm text-muted py-4 text-center">{t('task.needMatch')}</p>
        ) : (
          <div className="space-y-4">
            {tasks
              .filter((tk) => tk.requiredHeadcount > 0)
              .map((tk) => {
                const ids = assignMap[tk.id] ?? [];
                return (
                  <div key={tk.id} className="border border-line rounded-lg p-3">
                    <div className="flex items-center justify-between mb-2">
                      <div className="text-sm font-bold text-dark">
                        {tk.name || t('task.newTaskName')}{' '}
                        <span className="text-xs font-normal text-muted">
                          ({tradeLabel(tk.skillKey)})
                        </span>
                      </div>
                      <div className="text-xs text-muted">
                        {ids.length}/{tk.requiredHeadcount} {t('task.filled')}
                      </div>
                    </div>
                    {ids.length === 0 ? (
                      <div className="text-xs text-muted">—</div>
                    ) : (
                      <div className="flex flex-wrap gap-2">
                        {ids.map((id) => {
                          const emp = empById.get(id);
                          return (
                            <span
                              key={id}
                              className="text-xs bg-blue-50 text-blue-900 rounded-full px-2.5 py-1"
                            >
                              {emp?.name ?? id}
                              <span className="text-blue-500 ml-1">
                                {skillOf(id, tk.skillKey)}
                              </span>
                            </span>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}

            {/* Standby (present but unassigned) */}
            <div className="border border-dashed border-line rounded-lg p-3">
              <div className="text-sm font-bold text-muted mb-2">
                {t('task.unassigned')} ({standby.length})
              </div>
              {standby.length === 0 ? (
                <div className="text-xs text-muted">—</div>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {standby.map((id) => (
                    <span
                      key={id}
                      className="text-xs bg-gray-100 text-gray-600 rounded-full px-2.5 py-1"
                    >
                      {empById.get(id)?.name ?? id}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        <p className="text-xs text-muted mt-3">{t('task.note')}</p>
      </div>
    </div>
  );
}
