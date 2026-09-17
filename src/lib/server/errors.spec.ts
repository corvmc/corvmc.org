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
import {
	BandTierManagedByStripeError,
	BandNotFoundError,
	BandMemberExistsError,
	CannotRemoveOwnerError
} from './band/band-service';
import { CustomDomainError } from './band/custom-domain-service';
import { SlugUnavailableError } from './band/band-address-service';
import { ReservationNotFoundError } from './reservation/reservation-service';
import { LocationNotFoundError } from './inventory/item-service';
import { InsufficientStockError } from './inventory/stock-service';
import { AcquisitionNotFoundError } from './inventory/acquisition-service';
import { AssetNotFlaggableError, WorkRequestNotFoundError } from './inventory/work-request-service';
import { StandingStatusNotAllowedError } from './moderation/standing-service';

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
	['CustomDomainError', () => new CustomDomainError('domain already claimed'), 400],
	['BandNotFoundError', () => new BandNotFoundError(), 404],
	['BandMemberExistsError', () => new BandMemberExistsError(), 409],
	['CannotRemoveOwnerError', () => new CannotRemoveOwnerError(), 422],
	['ReservationNotFoundError', () => new ReservationNotFoundError(), 404]
];

/**
 * These had no entry in the `instanceof` ladder this file used to assert, so a
 * remote that mapped them correctly still answered 500. Two of them were hidden
 * by a name collision with a class that *was* listed.
 */
const PREVIOUSLY_UNMAPPED: Array<[string, () => Error, number]> = [
	['SlugUnavailableError', () => new SlugUnavailableError('That address is taken.'), 400],
	['LocationNotFoundError', () => new LocationNotFoundError(), 404],
	['AcquisitionNotFoundError', () => new AcquisitionNotFoundError(), 404],
	['InsufficientStockError', () => new InsufficientStockError(2, 5), 422],
	['AssetNotFlaggableError', () => new AssetNotFlaggableError(), 422],
	[
		'StandingStatusNotAllowedError',
		() => new StandingStatusNotAllowedError('messaging', 'disabled'),
		422
	],
	// Shadowed flag-service's FlagNotFoundError until it was renamed for its table.
	['WorkRequestNotFoundError', () => new WorkRequestNotFoundError(), 404]
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

	for (const [name, make, status] of PREVIOUSLY_UNMAPPED) {
		it(`maps ${name} to ${status} — it used to fall through to a 500`, () => {
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

	// The storage fault half of the same rule: a missing private-bucket object is
	// ours, not the caller's, so it must keep paging us as a 500.
	it('does not classify PosterRestoreError — a storage fault is not a 4xx', async () => {
		const { PosterRestoreError } = await import('./event/event-service');
		const err = new PosterRestoreError('withheld poster is missing');
		expect(() => mapDomainError(err)).toThrow(err);
	});

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
