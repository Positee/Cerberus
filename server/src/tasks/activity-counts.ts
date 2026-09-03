import { count, inArray } from 'drizzle-orm';
import { db } from '../db/client.js';
import { taskAttachments, taskComments, tasks } from '../db/schema.js';

export type TaskActivityCounts = {
  subtasks: number;
  comments: number;
  attachments: number;
};

type CountRow = { taskId: string | null; total: number };

/** Combines independent aggregates without multiplying rows across relations. */
export function indexTaskActivityCounts(
  subtaskRows: CountRow[],
  commentRows: CountRow[],
  attachmentRows: CountRow[],
): Map<string, TaskActivityCounts> {
  const indexed = new Map<string, TaskActivityCounts>();

  const apply = (rows: CountRow[], field: keyof TaskActivityCounts) => {
    for (const row of rows) {
      if (!row.taskId) continue;
      const current = indexed.get(row.taskId) ?? { subtasks: 0, comments: 0, attachments: 0 };
      current[field] = Number(row.total);
      indexed.set(row.taskId, current);
    }
  };

  apply(subtaskRows, 'subtasks');
  apply(commentRows, 'comments');
  apply(attachmentRows, 'attachments');
  return indexed;
}

export async function loadTaskActivityCounts(taskIds: string[]): Promise<Map<string, TaskActivityCounts>> {
  if (taskIds.length === 0) return new Map();

  const [subtaskRows, commentRows, attachmentRows] = await Promise.all([
    db
      .select({ taskId: tasks.parentId, total: count(tasks.id) })
      .from(tasks)
      .where(inArray(tasks.parentId, taskIds))
      .groupBy(tasks.parentId),
    db
      .select({ taskId: taskComments.taskId, total: count(taskComments.id) })
      .from(taskComments)
      .where(inArray(taskComments.taskId, taskIds))
      .groupBy(taskComments.taskId),
    db
      .select({ taskId: taskAttachments.taskId, total: count(taskAttachments.id) })
      .from(taskAttachments)
      .where(inArray(taskAttachments.taskId, taskIds))
      .groupBy(taskAttachments.taskId),
  ]);

  return indexTaskActivityCounts(subtaskRows, commentRows, attachmentRows);
}
