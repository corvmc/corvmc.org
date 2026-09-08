import type { RunOfShowWarning } from '../../types/run-of-show';

/**
 * The run of show, as arithmetic. Nothing here touches a database.
 *
 * Separate from `run-of-show-service` because a seeder runs under plain tsx
 * with no `$lib` alias map, so a module importing `$lib/server/db` is
 * unreachable from one — and the seed must derive set times with this exact
 * function or the fixture disagrees with the feature.
 */

/** Matching `LINEUP_MAX` — the bill this mirrors is already capped there. */
export const SLOT_MAX = 12;

/** Beyond this a set length is a typo, not a set. Warned about, never refused. */
const SET_LENGTH_WARN_MINUTES = 240;

// ---------------------------------------------------------------------------
// The pure half — no database, directly unit-tested
// ---------------------------------------------------------------------------

/** The shape the walk needs, and nothing more. */
export interface SetTimeSlot {
	id: string;
	sortOrder: number;
	createdAt: Date;
	setLengthMinutes: number;
	changeoverMinutes: number;
}

/**
 * Running order: `sortOrder`, then `createdAt` for the tie two clients can
 * produce.
 *
 * Exported so a read and a write cannot disagree about it — an `ORDER BY` in one
 * query and a sort in another is two answers waiting to drift.
 */
export function orderSlots<T extends { sortOrder: number; createdAt: Date }>(
	slots: readonly T[]
): T[] {
	return [...slots].sort(
		(a, b) => a.sortOrder - b.sortOrder || a.createdAt.getTime() - b.createdAt.getTime()
	);
}

/**
 * The walk: each set starts where the previous one's changeover ended.
 *
 * A null `firstSetAt` maps every slot to null. A production with no downbeat
 * has no schedule, and falling back to the listing's `startsAt` would be a
 * second, silent source of truth for the number the whole night hangs off.
 */
export function computeSetTimes(
	firstSetAt: Date | null,
	slots: readonly SetTimeSlot[]
): Map<string, Date | null> {
	const out = new Map<string, Date | null>();
	if (!firstSetAt) {
		for (const slot of slots) out.set(slot.id, null);
		return out;
	}

	let cursor = firstSetAt.getTime();
	for (const slot of orderSlots(slots)) {
		out.set(slot.id, new Date(cursor));
		cursor += (slot.setLengthMinutes + slot.changeoverMinutes) * 60_000;
	}
	return out;
}

/** What `runOfShowWarnings` needs to know about one slot. */
export interface WarnableSlot extends SetTimeSlot {
	name: string | null;
	soundcheckAt: Date | null;
}

/**
 * Warnings, never errors: a schedule that refuses to save because the headliner
 * is nine minutes past curfew is a schedule nobody keeps up to date.
 *
 * Computed from the walk, not from a stored `scheduledStartAt`. There is no
 * `set_length_zero` — the CHECK makes it unrepresentable, so it is a 422 out of
 * the mutations instead.
 */
export function runOfShowWarnings(input: {
	firstSetAt: Date | null;
	curfewAt: Date | null;
	doorsAt: Date | null;
	slots: readonly WarnableSlot[];
}): RunOfShowWarning[] {
	const { firstSetAt, curfewAt, doorsAt, slots } = input;
	const warnings: RunOfShowWarning[] = [];

	for (const slot of slots) {
		if (slot.setLengthMinutes > SET_LENGTH_WARN_MINUTES) {
			warnings.push({
				code: 'set_too_long',
				slotId: slot.id,
				message: `${slot.name ?? 'A set'} is ${slot.setLengthMinutes} minutes long.`
			});
		}
		if (firstSetAt && slot.soundcheckAt && slot.soundcheckAt.getTime() > firstSetAt.getTime()) {
			warnings.push({
				code: 'soundcheck_after_first_set',
				slotId: slot.id,
				message: `${slot.name ?? 'A set'} soundchecks after the first set starts.`
			});
		}
	}

	if (!firstSetAt) return warnings;

	if (doorsAt && firstSetAt.getTime() < doorsAt.getTime()) {
		warnings.push({
			code: 'before_doors',
			slotId: null,
			message: 'The first set starts before doors.'
		});
	}

	// `production_curfew_after_first_set` already guarantees a curfew is after the
	// downbeat, so this can only ever be about accumulated set lengths — there is
	// no "curfew before the first set" case to add.
	if (curfewAt && slots.length > 0) {
		const total = slots.reduce((m, s) => m + s.setLengthMinutes + s.changeoverMinutes, 0);
		const endsAt = firstSetAt.getTime() + total * 60_000;
		if (endsAt > curfewAt.getTime()) {
			const over = Math.round((endsAt - curfewAt.getTime()) / 60_000);
			warnings.push({
				code: 'past_curfew',
				slotId: null,
				message: `The running order finishes ${over} minutes past curfew.`
			});
		}
	}

	return warnings;
}

// ---------------------------------------------------------------------------
// How the acts' pool divides
// ---------------------------------------------------------------------------

/** A whole pool. `percentageBps` is basis points **of the acts' pool**, not of the door. */
export const POOL_BPS = 10_000;

/**
 * Equal shares of the acts' pool, in basis points, summing to exactly `POOL_BPS`.
 *
 * CMC takes 30% of the door and the acts split the rest among themselves, on an
 * equal basis — there is no house headliner/opener split. Three acts get
 * 3333/3333/3334: the remainder goes one basis point at a time down the billing
 * order, so the total is exact rather than approximately right.
 *
 * Returned in `sortOrder` order, so index 0 is the first act on the bill.
 */
export function equalPoolShares(count: number): number[] {
	if (count <= 0) return [];
	const base = Math.floor(POOL_BPS / count);
	const shares = Array.from({ length: count }, () => base);
	// `POOL_BPS - base * count` is at most `count - 1`, so this never wraps.
	for (let i = 0; i < POOL_BPS - base * count; i++) shares[shares.length - 1 - i] += 1;
	return shares;
}

/**
 * Whether a proposed share fits in what the pool has left.
 *
 * Over-allocating is the dangerous direction: three acts at 7000 each pays out
 * 210% of a pool that only holds 100%, and the overspend comes out of the
 * collective's own 30%. Under-allocating is merely unfinished — a bill mid-edit
 * legitimately sums low — so this refuses only the overspend.
 */
export function poolShareFits(otherSharesBps: number[], proposedBps: number): boolean {
	const used = otherSharesBps.reduce((sum, bps) => sum + bps, 0);
	return used + proposedBps <= POOL_BPS;
}
