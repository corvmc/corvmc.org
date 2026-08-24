import { describe, expect, it } from 'vitest';
import { mapDomainError } from './errors';
import {
	UserNotFoundError,
	UserNotDeactivatedError,
	UserHasOwnedBandsError,
	UserHasLinkedRecordsError,
	UserHasPublishedListingsError
} from './user/user-service';
import {
	FlagNotFoundError,
	FlagTargetNotFoundError,
	FlagAlreadyResolvedError
} from './flag/flag-service';
import { BandTierManagedByStripeError } from './band/band-service';
import { CustomDomainError } from './band/custom-domain-service';

/**
 * These classes used to be mapped by hand in each remote file's catch block.
 * They now carry their own `httpStatus` and are resolved by `mapDomainError`'s
 * generic DomainError branch, so the statuses live here rather than being
 * restated (and occasionally forgotten) per call site — which is how
 * UserHasPublishedListingsError ended up returning a 500.
 */
const CASES: Array<[string, () => Error, number]> = [
	['UserNotFoundError', () => new UserNotFoundError(), 404],
	['UserNotDeactivatedError', () => new UserNotDeactivatedError(), 409],
	['UserHasOwnedBandsError', () => new UserHasOwnedBandsError(), 409],
	['UserHasLinkedRecordsError', () => new UserHasLinkedRecordsError(), 409],
	['UserHasPublishedListingsError', () => new UserHasPublishedListingsError(), 409],
	['FlagNotFoundError', () => new FlagNotFoundError(), 404],
	['FlagTargetNotFoundError', () => new FlagTargetNotFoundError(), 404],
	['FlagAlreadyResolvedError', () => new FlagAlreadyResolvedError(), 409],
	['BandTierManagedByStripeError', () => new BandTierManagedByStripeError(), 409],
	['CustomDomainError', () => new CustomDomainError('domain already claimed'), 400]
];

describe('mapDomainError', () => {
	for (const [name, make, status] of CASES) {
		it(`maps ${name} to ${status}`, () => {
			const thrown = (() => {
				try {
					mapDomainError(make());
				} catch (e) {
					return e as { status?: number; body?: { message?: string } };
				}
			})();
			expect(thrown?.status).toBe(status);
			expect(thrown?.body?.message).toBeTruthy();
		});
	}

	it('keeps the message the service wrote', () => {
		const thrown = (() => {
			try {
				mapDomainError(new UserHasPublishedListingsError());
			} catch (e) {
				return e as { body?: { message?: string } };
			}
		})();
		expect(thrown?.body?.message).toContain('community listings');
	});

	// Regression: this used to map to 422. Every credit-spending service clamps to
	// the balance before deducting, so the error only signals a lost race, and the
	// one human-triggerable path (staff credit adjustment) now answers with a field
	// issue. Re-adding it here would resurrect a status nobody can act on.
	it('does not classify InsufficientCreditsError — it is a race signal, not a 4xx', async () => {
		const { InsufficientCreditsError } = await import('./finance/credit-service');
		const err = new InsufficientCreditsError('free_hours', 300, 200);
		expect(() => mapDomainError(err)).toThrow(err);
	});

	it('re-throws an error it does not recognise, so it surfaces as a 500', () => {
		const stranger = new Error('not a domain error');
		expect(() => mapDomainError(stranger)).toThrow(stranger);
	});
});
