import assert from 'node:assert/strict';
import test from 'node:test';
import { sql } from '../db/client.js';
import { BUILT_IN_KNOWLEDGE_LESSONS, KNOWLEDGE_TOPICS, youtubeVideoId } from '../../../shared/knowledge.js';
import { can } from '../../../shared/permissions.js';
import { knowledgeResourceListQuery } from './routes.js';

const organizationId = '22222222-2222-4222-8222-222222222222';
const policy = {
  membersCanInvite: true,
  membersCanCreateProjects: true,
  membersCanManageAlerts: true,
};

test('YouTube links use only supported hosts and valid video identifiers', () => {
  assert.equal(youtubeVideoId('https://www.youtube.com/watch?v=_DVVNOGYtmU'), '_DVVNOGYtmU');
  assert.equal(youtubeVideoId('https://youtu.be/u8AYAr0Fus8?t=20'), 'u8AYAr0Fus8');
  assert.equal(youtubeVideoId('https://www.youtube.com/shorts/fow7C_0EoRs'), 'fow7C_0EoRs');
  assert.equal(youtubeVideoId('https://example.com/watch?v=_DVVNOGYtmU'), null);
  assert.equal(youtubeVideoId('not a link'), null);
});

test('the built-in learning path has unique keys and lessons for each topic', () => {
  const keys = BUILT_IN_KNOWLEDGE_LESSONS.map((lesson) => lesson.key);
  assert.equal(new Set(keys).size, keys.length);

  for (const topic of KNOWLEDGE_TOPICS) {
    assert.ok(BUILT_IN_KNOWLEDGE_LESSONS.some((lesson) => lesson.topic === topic.id));
  }
});

test('only a personal owner or admin can publish knowledge resources', () => {
  assert.equal(can('knowledge.manage', { role: 'owner', kind: 'personal', policy }), true);
  assert.equal(can('knowledge.manage', { role: 'admin', kind: 'personal', policy }), true);
  assert.equal(can('knowledge.manage', { role: 'member', kind: 'personal', policy }), false);
  assert.equal(can('knowledge.manage', { role: 'owner', kind: 'organization', policy }), false);
});

test('published resource queries stay inside the active workspace', () => {
  const query = knowledgeResourceListQuery(organizationId, false).toSQL();

  assert.match(query.sql, /"knowledge_resources"\."organization_id" = \$1/);
  assert.match(query.sql, /"knowledge_resources"\."published" = \$2/);
  assert.deepEqual(query.params.slice(0, 2), [organizationId, true]);
});

test('editor resource queries still stay inside the active workspace', () => {
  const query = knowledgeResourceListQuery(organizationId, true).toSQL();

  assert.match(query.sql, /"knowledge_resources"\."organization_id" = \$1/);
  assert.doesNotMatch(query.sql, /"knowledge_resources"\."published" =/);
  assert.deepEqual(query.params[0], organizationId);
});

test.after(async () => {
  await sql.end({ timeout: 1 });
});
