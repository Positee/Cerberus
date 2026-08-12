import { hash, verify } from '@node-rs/argon2';

/**
 * Argon2id at the OWASP baseline: 19 MiB of memory, two passes, one lane.
 * Raise memoryCost before timeCost if you want it slower.
 *
 * The algorithm is left at the library default, which is Argon2id. The
 * Algorithm enum is an ambient const enum, and isolatedModules forbids reading
 * one at runtime, so naming it here would not compile.
 */
const OPTIONS = {
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
} as const;

/** A real hash of a throwaway value, used to burn time on unknown emails. */
const DECOY_HASH = await hash('cerberus-decoy-value', OPTIONS);

export function hashPassword(plain: string): Promise<string> {
  return hash(plain, OPTIONS);
}

export async function verifyPassword(storedHash: string, plain: string): Promise<boolean> {
  try {
    return await verify(storedHash, plain, OPTIONS);
  } catch {
    // A corrupt or unreadable hash is a failed login, not a 500.
    return false;
  }
}

/**
 * Call this when the email does not exist. Without it, a missing account
 * answers in about a millisecond and a real one takes far longer, which tells
 * an attacker which emails are registered.
 */
export async function burnTime(): Promise<void> {
  await verifyPassword(DECOY_HASH, 'cerberus-decoy-value-x');
}
