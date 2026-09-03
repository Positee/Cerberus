import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applyCertificateHealth,
  daysUntilCertificateExpiry,
  inspectCertificateExpiry,
} from './certificate.js';

test('certificate dates are converted to rounded-up days remaining', () => {
  const now = new Date('2026-09-03T12:00:00.000Z');

  assert.equal(daysUntilCertificateExpiry('Oct  3 18:00:00 2026 GMT', now), 31);
  assert.equal(daysUntilCertificateExpiry('not a certificate date', now), null);
});

test('an expiring certificate degrades an otherwise healthy probe without retries', () => {
  const result = applyCertificateHealth(
    { status: 'up', errorMessage: null, retryable: false },
    12,
  );

  assert.equal(result.status, 'degraded');
  assert.equal(result.errorMessage, 'TLS certificate expires in 12 days.');
  assert.equal(result.retryable, false);
});

test('an expired certificate marks the probe down', () => {
  const result = applyCertificateHealth(
    { status: 'up' as const, errorMessage: null, retryable: false },
    -1,
  );

  assert.equal(result.status, 'down');
  assert.equal(result.errorMessage, 'TLS certificate has expired.');
});

test('plain HTTP endpoints do not open a certificate connection', async () => {
  assert.equal(await inspectCertificateExpiry('http://127.0.0.1:1', 10), null);
});
