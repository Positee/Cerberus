import { isIP } from 'node:net';
import { connect } from 'node:tls';

const MS_PER_DAY = 24 * 60 * 60 * 1000;
export const CERTIFICATE_WARNING_DAYS = 30;

export type ProbeHealth = {
  status: 'up' | 'down' | 'degraded';
  errorMessage: string | null;
  retryable: boolean;
};

/** Converts OpenSSL's certificate date into whole calendar days remaining. */
export function daysUntilCertificateExpiry(validTo: string, now: Date = new Date()): number | null {
  const expiresAt = Date.parse(validTo);
  if (!Number.isFinite(expiresAt)) return null;
  return Math.ceil((expiresAt - now.getTime()) / MS_PER_DAY);
}

/** Converts certificate timing into the health fields used by a probe result. */
export function applyCertificateHealth(result: ProbeHealth, days: number | null): ProbeHealth {
  if (days === null || days > CERTIFICATE_WARNING_DAYS) return result;

  if (days <= 0) {
    return {
      status: 'down',
      errorMessage: 'TLS certificate has expired.',
      retryable: false,
    };
  }

  if (result.status !== 'up') return result;

  return {
    status: 'degraded',
    errorMessage: `TLS certificate expires in ${days} day${days === 1 ? '' : 's'}.`,
    retryable: false,
  };
}

/** Reads the certificate presented by an HTTPS endpoint. Failures return null. */
export function inspectCertificateExpiry(urlValue: string, timeoutMs: number): Promise<number | null> {
  let target: URL;
  try {
    target = new URL(urlValue);
  } catch {
    return Promise.resolve(null);
  }

  if (target.protocol !== 'https:') return Promise.resolve(null);

  const hostname = target.hostname.replace(/^\[|\]$/g, '');
  const port = target.port ? Number(target.port) : 443;
  if (!hostname || !Number.isInteger(port) || port < 1 || port > 65_535) return Promise.resolve(null);

  return new Promise((resolve) => {
    let settled = false;
    let timer: NodeJS.Timeout | null = null;

    // Certificate validation remains the fetch request's job. Disabling it here
    // lets Cerberus read and report a certificate that has already expired.
    const socket = connect({
      host: hostname,
      port,
      rejectUnauthorized: false,
      ...(isIP(hostname) === 0 ? { servername: hostname } : {}),
    });

    const finish = (days: number | null) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      socket.destroy();
      resolve(days);
    };

    timer = setTimeout(() => finish(null), Math.max(1, timeoutMs));
    socket.once('secureConnect', () => {
      const certificate = socket.getPeerCertificate();
      finish(certificate.valid_to ? daysUntilCertificateExpiry(certificate.valid_to) : null);
    });
    socket.once('error', () => finish(null));
  });
}
