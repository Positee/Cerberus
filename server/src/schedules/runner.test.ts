import assert from 'node:assert/strict';
import test from 'node:test';
import { sql } from '../db/client.js';
import { scheduleForRunQuery } from './runner.js';

test('the manual-run lookup is scoped to both schedule and organization', () => {
  const scheduleId = '11111111-1111-4111-8111-111111111111';
  const organizationId = '22222222-2222-4222-8222-222222222222';
  const query = scheduleForRunQuery(scheduleId, organizationId).toSQL();

  assert.match(query.sql, /"schedules"\."id" = \$1/);
  assert.match(query.sql, /"schedules"\."organization_id" = \$2/);
  assert.deepEqual(query.params, [scheduleId, organizationId, 1]);
});

test.after(async () => {
  await sql.end({ timeout: 1 });
});
