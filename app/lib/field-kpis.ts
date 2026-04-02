// @ts-nocheck
// ============================================================
// Shared Field KPI Computation
// Used by both field-dashboard API and the bi-weekly snapshot cron
// ============================================================

export interface FieldKPIs {
  scheduleAdherence: number | null;
  totalCompletedLast30: number;
  avgDaysOverdue: number;
  overdueTaskCount: number;
  staleTaskCount: number;
  completedThisWeek: number;
  completedLastWeek: number;
  completionTrend: number;
  tasksNext7: number;
  tasksNext30: number;
}

/**
 * Compute field KPIs from job task data.
 * @param jobDataResults - Array of { tasks } where each task has: isGroup, progress, endDate
 * @param today - Date object representing "today" (zeroed to midnight)
 */
export function computeFieldKPIs(
  jobDataResults: Array<{ tasks: any[] }>,
  today: Date
): FieldKPIs {
  const todayStr = today.toISOString().split('T')[0];
  const sevenDaysAgo = new Date(today.getTime() - 7 * 86400000).toISOString().split('T')[0];
  const fourteenDaysAgo = new Date(today.getTime() - 14 * 86400000).toISOString().split('T')[0];

  let allOverdueDaysSum = 0;
  let allOverdueCount = 0;
  let staleTaskCount = 0;
  let totalTasksWithDueDate = 0;
  let totalCompletedTasks = 0;
  let completedOnOrBeforeDue = 0;
  let completedThisWeek = 0;
  let completedLastWeek = 0;

  for (const { tasks } of jobDataResults) {
    for (const task of tasks) {
      if (task.isGroup) continue;
      const isComplete = task.progress !== null && task.progress >= 1;
      const endDate = task.endDate ? task.endDate.split('T')[0] : null;

      // KPI 1: Schedule Adherence
      if (endDate) {
        totalTasksWithDueDate++;
        if (isComplete || endDate >= todayStr) {
          completedOnOrBeforeDue++;
        }
      }

      // KPI 4: Tasks completed in recent windows
      if (isComplete && endDate) {
        totalCompletedTasks++;
        if (endDate >= sevenDaysAgo && endDate <= todayStr) completedThisWeek++;
        if (endDate >= fourteenDaysAgo && endDate < sevenDaysAgo) completedLastWeek++;
      }

      // KPI 2 & 3: Average Days Overdue + Stale count
      if (!isComplete && endDate && endDate < todayStr) {
        const daysOver = Math.floor((today.getTime() - new Date(endDate + 'T12:00:00').getTime()) / 86400000);
        allOverdueDaysSum += daysOver;
        allOverdueCount++;
        if (daysOver >= 30 && (task.progress === null || task.progress === 0)) {
          staleTaskCount++;
        }
      }
    }
  }

  const scheduleAdherence = totalTasksWithDueDate > 0
    ? Math.round((completedOnOrBeforeDue / totalTasksWithDueDate) * 100)
    : null;

  const avgDaysOverdue = allOverdueCount > 0
    ? Math.round((allOverdueDaysSum / allOverdueCount) * 10) / 10
    : 0;

  const completionTrend = completedThisWeek - completedLastWeek;

  // KPI 5: Upcoming Task Density
  const sevenDaysOut = new Date(today.getTime() + 7 * 86400000).toISOString().split('T')[0];
  const thirtyDaysOut = new Date(today.getTime() + 30 * 86400000).toISOString().split('T')[0];
  let tasksNext7 = 0;
  let tasksNext30 = 0;
  for (const { tasks } of jobDataResults) {
    for (const task of tasks) {
      if (task.isGroup) continue;
      const isComplete = task.progress !== null && task.progress >= 1;
      if (isComplete) continue;
      const ed = task.endDate ? task.endDate.split('T')[0] : null;
      if (!ed || ed < todayStr) continue;
      if (ed <= sevenDaysOut) tasksNext7++;
      if (ed <= thirtyDaysOut) tasksNext30++;
    }
  }

  return {
    scheduleAdherence,
    totalCompletedLast30: totalCompletedTasks,
    avgDaysOverdue,
    overdueTaskCount: allOverdueCount,
    staleTaskCount,
    completedThisWeek,
    completedLastWeek,
    completionTrend,
    tasksNext7,
    tasksNext30,
  };
}
