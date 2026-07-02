import { useState, useEffect, useMemo, useCallback } from 'react';
import { SKILL_KEYS } from '@brightem/shared';
import type {
  PayPeriod,
  Employee,
  EmployeeSkill,
  Task,
  TaskProgress,
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

// Working days a task takes = ceil(man-days / headcount).
const durationDays = (manday: number, headcount: number) =>
  manday > 0 && headcount > 0 ? Math.ceil(manday / headcount) : 0;

// Estimated finish date = start date + (duration - 1) calendar days.
const estFinishDate = (manday: number, headcount: number, start: string) => {
  const days = durationDays(manday, headcount);
  if (!start || days <= 0) return '';
  const d = new Date(`${start}T00:00:00`);
  d.setDate(d.getDate() + days - 1);
  return d.toISOString().slice(0, 10);
};

// Visual style per work-progress state.
const PROGRESS_STYLE: Record<TaskProgress, string> = {
  pending: 'bg-gray-100 text-gray-600',
  in_progress: 'bg-amber-100 text-amber-800',
  done: 'bg-green-100 text-green-800',
};

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
  // Which task a clicked standby worker gets assigned to (manual placement).
  const [targetTaskId, setTargetTaskId] = useState('');

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

  // Tasks that can receive workers (have a headcount requirement).
  const activeTasks = useMemo(
    () => tasks.filter((tk) => tk.requiredHeadcount > 0),
    [tasks]
  );

  // Keep the manual-assign target on a valid task.
  useEffect(() => {
    if (activeTasks.length === 0) {
      if (targetTaskId) setTargetTaskId('');
      return;
    }
    if (!activeTasks.some((tk) => tk.id === targetTaskId)) {
      setTargetTaskId(activeTasks[0].id);
    }
  }, [activeTasks, targetTaskId]);

  // Manually place a clicked standby worker onto the target task.
  const assignWorker = (empId: string, taskId = targetTaskId) => {
    if (!taskId) return;
    setAssignMap((prev) => {
      const next: Record<string, string[]> = {};
      // Remove the worker from any current task, then add to the target.
      for (const [tid, ids] of Object.entries(prev)) {
        next[tid] = ids.filter((id) => id !== empId);
      }
      next[taskId] = [...(next[taskId] ?? []), empId];
      return next;
    });
    setAssignDirty(true);
  };

  // Send an assigned worker back to standby.
  const unassignWorker = (taskId: string, empId: string) => {
    setAssignMap((prev) => ({
      ...prev,
      [taskId]: (prev[taskId] ?? []).filter((id) => id !== empId),
    }));
    setAssignDirty(true);
  };

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
        progress: 'pending',
      },
    ]);
    setTasksDirty(true);
  };

  // Change a task's work-progress state; persist immediately if it exists in DB.
  const setProgress = async (task: Task, progress: TaskProgress) => {
    setTasks((prev) =>
      prev.map((tk) => (tk.id === task.id ? { ...tk, progress } : tk))
    );
    if (task.id.startsWith('new-')) {
      // Not persisted yet — will be saved with the plan.
      setTasksDirty(true);
      return;
    }
    try {
      await api.saveTask({ ...task, progress });
    } catch {
      alert(t('task.saveError'));
    }
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

  // Roll-up of work-progress across the day's active tasks.
  const progressSummary = useMemo(() => {
    const s = { pending: 0, in_progress: 0, done: 0 };
    activeTasks.forEach((tk) => {
      s[(tk.progress ?? 'pending') as TaskProgress] += 1;
    });
    return s;
  }, [activeTasks]);

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
                <th className="text-center">{t('task.thEndDate')}</th>
                <th className="text-center">{t('task.thStatus')}</th>
                <th className="text-center">{t('task.thActions')}</th>
              </tr>
            </thead>
            <tbody>
              {tasks.length === 0 && (
                <tr>
                  <td colSpan={7} className="text-center text-muted py-4">
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
                  <td className="text-center whitespace-nowrap">
                    {(() => {
                      const days = durationDays(tk.requiredManday, tk.requiredHeadcount);
                      const end = estFinishDate(
                        tk.requiredManday,
                        tk.requiredHeadcount,
                        workDate
                      );
                      return end ? (
                        <span className="text-sm text-dark">
                          {end}
                          <span className="text-xs text-muted ml-1">
                            ({days} {t('task.durationDays')})
                          </span>
                        </span>
                      ) : (
                        <span className="text-xs text-muted">—</span>
                      );
                    })()}
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
        ) : activeTasks.length === 0 ? (
          <p className="text-sm text-muted py-4 text-center">{t('task.noTasks')}</p>
        ) : (
          <div className="space-y-4">
            {/* Work-progress roll-up across the day's tasks. */}
            <div className="flex items-center gap-3 flex-wrap border border-line rounded-lg px-3 py-2">
              <span className="text-xs font-bold text-dark">
                {t('task.progressTitle')}
              </span>
              <span className={`text-xs px-2 py-0.5 rounded-full ${PROGRESS_STYLE.pending}`}>
                {t('task.pgPending')} {progressSummary.pending}
              </span>
              <span className={`text-xs px-2 py-0.5 rounded-full ${PROGRESS_STYLE.in_progress}`}>
                {t('task.pgInProgress')} {progressSummary.in_progress}
              </span>
              <span className={`text-xs px-2 py-0.5 rounded-full ${PROGRESS_STYLE.done}`}>
                {t('task.pgDone')} {progressSummary.done}
              </span>
              <span className="text-xs text-muted">
                / {t('task.pgTotal')} {activeTasks.length}
              </span>
            </div>

            {/* Manual-assign target: clicked standby workers go to this task. */}
            <div className="flex items-center gap-2 flex-wrap bg-blue-50/60 border border-line rounded-lg px-3 py-2">
              <span className="text-xs text-muted">{t('task.assignTarget')}</span>
              <select
                value={targetTaskId}
                onChange={(e) => setTargetTaskId(e.target.value)}
                className="border border-line rounded px-2 py-1 text-sm bg-white"
              >
                {activeTasks.map((tk) => (
                  <option key={tk.id} value={tk.id}>
                    {(tk.name || t('task.newTaskName')) + ' — ' + tradeLabel(tk.skillKey)}
                  </option>
                ))}
              </select>
              <span className="text-xs text-muted">{t('task.clickHint')}</span>
            </div>

            {activeTasks.map((tk) => {
              const ids = assignMap[tk.id] ?? [];
              const isTarget = tk.id === targetTaskId;
              return (
                <div
                  key={tk.id}
                  className={`border rounded-lg p-3 ${
                    isTarget ? 'border-primary bg-blue-50/40' : 'border-line'
                  }`}
                >
                  <div className="flex items-center justify-between mb-2">
                    <button
                      className="text-sm font-bold text-dark text-left hover:text-primary"
                      onClick={() => setTargetTaskId(tk.id)}
                      title={t('task.assignTarget')}
                    >
                      {tk.name || t('task.newTaskName')}{' '}
                      <span className="text-xs font-normal text-muted">
                        ({tradeLabel(tk.skillKey)})
                      </span>
                    </button>
                    <div className="flex items-center gap-2">
                      <span
                        className={`text-xs px-2 py-0.5 rounded-full ${
                          PROGRESS_STYLE[(tk.progress ?? 'pending') as TaskProgress]
                        }`}
                      >
                        {t(`task.pg${
                          (tk.progress ?? 'pending') === 'in_progress'
                            ? 'InProgress'
                            : (tk.progress ?? 'pending') === 'done'
                            ? 'Done'
                            : 'Pending'
                        }` as TKey)}
                      </span>
                      <div
                        className={`text-xs ${
                          ids.length >= tk.requiredHeadcount
                            ? 'text-green-700 font-medium'
                            : 'text-muted'
                        }`}
                      >
                        {ids.length}/{tk.requiredHeadcount} {t('task.filled')}
                      </div>
                    </div>
                  </div>

                  {/* Progress transition buttons: pending → in_progress → done */}
                  <div className="flex items-center gap-2 mb-2">
                    {(tk.progress ?? 'pending') === 'pending' && (
                      <button
                        className="text-xs px-2.5 py-1 rounded-md bg-amber-100 text-amber-800 hover:bg-amber-200"
                        onClick={() => setProgress(tk, 'in_progress')}
                      >
                        {t('task.pgStart')}
                      </button>
                    )}
                    {(tk.progress ?? 'pending') === 'in_progress' && (
                      <>
                        <button
                          className="text-xs px-2.5 py-1 rounded-md bg-green-100 text-green-800 hover:bg-green-200"
                          onClick={() => setProgress(tk, 'done')}
                        >
                          {t('task.pgComplete')}
                        </button>
                        <button
                          className="text-xs px-2.5 py-1 rounded-md bg-gray-100 text-gray-600 hover:bg-gray-200"
                          onClick={() => setProgress(tk, 'pending')}
                        >
                          {t('task.pgToPending')}
                        </button>
                      </>
                    )}
                    {(tk.progress ?? 'pending') === 'done' && (
                      <button
                        className="text-xs px-2.5 py-1 rounded-md bg-gray-100 text-gray-600 hover:bg-gray-200"
                        onClick={() => setProgress(tk, 'in_progress')}
                      >
                        {t('task.pgReopen')}
                      </button>
                    )}
                  </div>
                  {ids.length === 0 ? (
                    <div className="text-xs text-muted">—</div>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      {ids.map((id) => {
                        const emp = empById.get(id);
                        return (
                          <button
                            key={id}
                            onClick={() => unassignWorker(tk.id, id)}
                            title={t('task.clickToRemove')}
                            className="text-xs bg-blue-50 text-blue-900 rounded-full px-2.5 py-1 hover:bg-red-50 hover:text-red-700 cursor-pointer"
                          >
                            {emp?.name ?? id}
                            <span className="text-blue-500 ml-1">
                              {skillOf(id, tk.skillKey)}
                            </span>
                            <span className="ml-1 opacity-60">✕</span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}

            {/* Standby (present but unassigned) — click to assign to target task */}
            <div className="border border-dashed border-line rounded-lg p-3">
              <div className="text-sm font-bold text-muted mb-2">
                {t('task.unassigned')} ({standby.length})
              </div>
              {standby.length === 0 ? (
                <div className="text-xs text-muted">—</div>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {standby.map((id) => {
                    const targetTask = activeTasks.find((tk) => tk.id === targetTaskId);
                    return (
                      <button
                        key={id}
                        onClick={() => assignWorker(id)}
                        title={t('task.clickToAssign')}
                        className="text-xs bg-gray-100 text-gray-700 rounded-full px-2.5 py-1 hover:bg-blue-100 hover:text-blue-800 cursor-pointer"
                      >
                        <span className="opacity-60 mr-1">＋</span>
                        {empById.get(id)?.name ?? id}
                        {targetTask && (
                          <span className="text-blue-500 ml-1">
                            {skillOf(id, targetTask.skillKey)}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}

        <p className="text-xs text-muted mt-3">{t('task.note')}</p>
        <p className="text-xs text-muted mt-1">{t('task.manualNote')}</p>
      </div>
    </div>
  );
}
