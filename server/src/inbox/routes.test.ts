import assert from 'node:assert/strict';
import test from 'node:test';
import { sql } from '../db/client.js';
import { inboxConversationListQuery, participantInWorkspaceQuery } from './routes.js';

const userId = '11111111-1111-4111-8111-111111111111';
const organizationId = '22222222-2222-4222-8222-222222222222';
const conversationId = '33333333-3333-4333-8333-333333333333';

test('conversation lists require the active organization', () => {
  const query = inboxConversationListQuery(userId, organizationId).toSQL();

  assert.match(query.sql, /inner join "conversations"/i);
  assert.match(query.sql, /"conversation_participants"\."user_id" = \$1/);
  assert.match(query.sql, /"conversations"\."organization_id" = \$2/);
  assert.deepEqual(query.params, [userId, organizationId]);
});

test('conversation access requires participant, conversation, and organization', () => {
  const query = participantInWorkspaceQuery(conversationId, userId, organizationId).toSQL();

  assert.match(query.sql, /inner join "conversations"/i);
  assert.match(query.sql, /"conversation_participants"\."conversation_id" = \$1/);
  assert.match(query.sql, /"conversation_participants"\."user_id" = \$2/);
  assert.match(query.sql, /"conversations"\."organization_id" = \$3/);
  assert.deepEqual(query.params, [conversationId, userId, organizationId, 1]);
});

test.after(async () => {
  await sql.end({ timeout: 1 });
});
