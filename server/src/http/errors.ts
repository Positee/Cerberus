import type { z } from 'zod';
import type { ApiError } from '../../../shared/api.js';

/**
 * Every failure leaves the API in this shape, so the browser has one branch
 * to write. Both the auth routes and the profile routes build errors here.
 */

export function fail(
  code: ApiError['error']['code'],
  message: string,
  fields?: Record<string, string>,
): ApiError {
  return { error: { code, message, ...(fields ? { fields } : {}) } };
}

/** Turns a zod failure into a field to message map the form can read. */
export function fieldErrors(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join('.') || 'form';
    out[key] ??= issue.message;
  }
  return out;
}
