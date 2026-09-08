/**
 * The seed's source of randomness, and the small helpers built on it.
 *
 * **Seeded, deliberately.** Every one of these used to call `Math.random()`, so
 * two runs of `pnpm db:reset` produced different row counts — which made the
 * summary block impossible to diff and any "did my change alter the seed?"
 * question unanswerable. `createPrng` is `zod4-mock`'s SFC32 generator, already
 * a devDependency and already what `src/lib/server/db/test-factory.ts` runs on.
 *
 * `SEED_RANDOM_SEED` overrides the seed for anyone who wants a different — but
 * still reproducible — dataset.
 *
 * Note this covers *values*, not identity or time: `randomUUID()` and `new
 * Date()` are still live, so ids and timestamps differ run to run by design.
 */
import { createPrng } from 'zod4-mock';

export const SEED = Number(process.env.SEED_RANDOM_SEED ?? 42);

const prng = createPrng(SEED);

/** Drop-in for `Math.random()`. Seeders must use this, never the global. */
export function random(): number {
	return prng.random();
}

/**
 * `const T` so a literal pool keeps its literal type: `pick(['a', 'b'])` is
 * `'a' | 'b'`, not `string`. Several seeders feed the result straight into an
 * enum column, where the widened type is exactly what stops being checked.
 */
export function pick<const T>(arr: readonly T[]): T {
	return arr[prng.int(0, arr.length - 1)];
}

export function pickN<const T>(arr: readonly T[], n: number): T[] {
	return prng.sample(arr, n);
}

export function randomInt(min: number, max: number): number {
	return prng.int(min, max);
}

/**
 * A stream of its own, keyed by name.
 *
 * Per-key derivation rather than a shared sequence, so adding or removing a
 * seeder does not shift the values every *other* seeder draws.
 */
export function forkRandom(key: string) {
	return prng.fork(key);
}

export function ptDate(daysOffset: number, hour: number, minute = 0): Date {
	const d = new Date();
	d.setDate(d.getDate() + daysOffset);
	d.setUTCHours(hour + 7, minute, 0, 0);
	return d;
}
