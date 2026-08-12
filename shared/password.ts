/**
 * The password policy. Both the browser and the API import this file.
 *
 * Keep it here and nowhere else. If the form and the server disagree on the
 * rules, the form accepts a password that the API then rejects.
 */

export const PASSWORD_RULES: Array<{ id: string; label: string; test: (value: string) => boolean }> = [
  { id: 'length', label: '8 characters', test: (v) => v.length >= 8 },
  { id: 'letter', label: 'a letter', test: (v) => /[A-Za-z]/.test(v) },
  { id: 'number', label: 'a number', test: (v) => /\d/.test(v) },
  { id: 'symbol', label: 'a symbol', test: (v) => /[^A-Za-z0-9]/.test(v) },
];

/** Argon2 caps the input. Reject long strings before they reach the hasher. */
export const PASSWORD_MAX_LENGTH = 200;

export const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export type PasswordGrade = {
  /** 0 to 4. Drives the meter in the interface. */
  score: number;
  valid: boolean;
  missing: string[];
};

export function gradePassword(value: string): PasswordGrade {
  const missing = PASSWORD_RULES.filter((rule) => !rule.test(value)).map((rule) => rule.label);
  const met = PASSWORD_RULES.length - missing.length;
  const valid = missing.length === 0 && value.length <= PASSWORD_MAX_LENGTH;

  // The bar stays low until every rule passes. Extra length is the strongest
  // single signal after that, so it earns the last segment.
  let score: number;
  if (!value) score = 0;
  else if (!valid) score = Math.min(met, 2) || 1;
  else if (value.length >= 12) score = 4;
  else score = 3;

  return { score, valid, missing };
}

export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}
