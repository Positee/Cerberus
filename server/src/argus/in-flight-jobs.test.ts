import assert from 'node:assert/strict';
import test from 'node:test';
import { ConcurrencyGate, InFlightJobs } from './in-flight-jobs.js';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

test('a slow keyed job does not block another job', async () => {
  const jobs = new InFlightJobs<string>();
  const slowRelease = deferred();
  const slowFinished = deferred();
  const fastFinished = deferred();
  const errors: unknown[] = [];

  assert.equal(
    jobs.start(
      'slow-monitor',
      async () => {
        await slowRelease.promise;
        slowFinished.resolve();
      },
      (error) => errors.push(error),
    ),
    true,
  );

  assert.equal(
    jobs.start(
      'fast-monitor',
      async () => fastFinished.resolve(),
      (error) => errors.push(error),
    ),
    true,
  );

  await fastFinished.promise;

  assert.equal(jobs.has('slow-monitor'), true);
  assert.equal(jobs.start('slow-monitor', async () => undefined, () => undefined), false);
  assert.deepEqual(errors, []);

  slowRelease.resolve();
  await slowFinished.promise;
  await new Promise<void>((resolve) => setImmediate(resolve));

  assert.equal(jobs.has('slow-monitor'), false);
});

test('a failed job releases its key', async () => {
  const jobs = new InFlightJobs<string>();
  const failed = deferred();
  const expected = new Error('probe failed');
  let received: unknown;

  assert.equal(
    jobs.start(
      'monitor',
      async () => {
        throw expected;
      },
      (error) => {
        received = error;
        failed.resolve();
      },
    ),
    true,
  );

  await failed.promise;
  await new Promise<void>((resolve) => setImmediate(resolve));

  assert.equal(received, expected);
  assert.equal(jobs.has('monitor'), false);
});

test('the concurrency gate bounds active work and releases queued work', async () => {
  const gate = new ConcurrencyGate(2);
  const releases = [deferred(), deferred(), deferred()];
  const started: number[] = [];
  let active = 0;
  let highestActive = 0;

  const runs = releases.map((release, index) =>
    gate.run(async () => {
      started.push(index);
      active += 1;
      highestActive = Math.max(highestActive, active);
      await release.promise;
      active -= 1;
    }),
  );

  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.deepEqual(started, [0, 1]);

  releases[0]?.resolve();
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.deepEqual(started, [0, 1, 2]);

  releases[1]?.resolve();
  releases[2]?.resolve();
  await Promise.all(runs);

  assert.equal(highestActive, 2);
});
