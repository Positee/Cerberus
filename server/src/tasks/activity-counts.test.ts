import assert from 'node:assert/strict';
import test from 'node:test';
import { sql } from '../db/client.js';
import { indexTaskActivityCounts } from './activity-counts.js';

test('task activity aggregates are indexed independently for each task', () => {
  const indexed = indexTaskActivityCounts(
    [{ taskId: 'task-a', total: 2 }],
    [{ taskId: 'task-a', total: 3 }, { taskId: 'task-b', total: 1 }],
    [{ taskId: 'task-a', total: 4 }],
  );

  assert.deepEqual(indexed.get('task-a'), { subtasks: 2, comments: 3, attachments: 4 });
  assert.deepEqual(indexed.get('task-b'), { subtasks: 0, comments: 1, attachments: 0 });
});

test.after(async () => {
  await sql.end({ timeout: 1 });
});
