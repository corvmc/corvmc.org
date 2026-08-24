import { error } from '@sveltejs/kit';
import { DomainError } from './domain-error';

// Domain error imports — grouped by service module
import {
	BandNotFoundError,
	BandMemberExistsError,
	CannotRemoveOwnerError,
	OwnerCannotLeaveError
} from './band/band-service';
import {
	ReservationConflictError,
	ReservationValidationError,
	ReservationStateError,
	ReservationNotFoundError,
	ReservationAuthorizationError
} from './reservation/reservation-service';
import { SubscriptionStateError } from './finance/subscription-service';
import { RecurringSeriesError } from './reservation/recurring-series-service';
import {
	EquipmentNotFoundError,
	CategoryNotFoundError,
	CategoryHasEquipmentError
} from './equipment/equipment-service';
import {
	LoanNotFoundError,
	InvalidLoanTransitionError,
	InsufficientQuantityError
} from './equipment/loan-service';

// ---------------------------------------------------------------------------
// Base class for future domain errors
// ---------------------------------------------------------------------------

// Re-exported so existing importers keep working. The definition lives in a
// dependency-free leaf module because this file imports every service, and the
// services now extend the base — see domain-error.ts.
export { DomainError } from './domain-error';

// ---------------------------------------------------------------------------
// Mapper
// ---------------------------------------------------------------------------

/**
 * Maps a known domain error to a SvelteKit HTTP error. Unknown errors are
 * re-thrown so SvelteKit's default 500 handling kicks in.
 *
 * Usage in .remote.ts catch blocks:
 * ```ts
 * import { mapDomainError } from '$lib/server/errors';
 *
 * form(async ({ request }) => {
 *   try {
 *     await someService.doThing(…);
 *   } catch (err) {
 *     mapDomainError(err);
 *   }
 * });
 * ```
 */
export function mapDomainError(err: unknown): never {
	// Future domain errors that extend DomainError
	if (err instanceof DomainError) {
		error(err.httpStatus, err.message);
	}

	// --- 404 Not Found ---
	if (
		err instanceof BandNotFoundError ||
		err instanceof EquipmentNotFoundError ||
		err instanceof CategoryNotFoundError ||
		err instanceof LoanNotFoundError ||
		err instanceof ReservationNotFoundError
	) {
		error(404, (err as Error).message);
	}

	// --- 403 Forbidden ---
	if (err instanceof ReservationAuthorizationError) {
		error(403, (err as Error).message);
	}

	// --- 409 Conflict ---
	if (
		err instanceof ReservationConflictError ||
		err instanceof ReservationStateError ||
		err instanceof SubscriptionStateError ||
		err instanceof BandMemberExistsError
	) {
		error(409, (err as Error).message);
	}

	// --- 400 Validation ---
	if (err instanceof ReservationValidationError) {
		error(400, err.message);
	}

	// --- 422 Business rule violations ---
	//
	// InsufficientCreditsError is deliberately absent. Every service that spends
	// credits clamps to the balance first, so the error only ever means "someone
	// spent between my read and my write" — a race to retry, not a request the
	// caller can fix, and no 4xx describes that. The one place a human can cause
	// it is the staff credit adjustment form, which answers with a field issue on
	// the amount instead. See adjustCredits in users.remote.ts.
	if (
		err instanceof CannotRemoveOwnerError ||
		err instanceof OwnerCannotLeaveError ||
		err instanceof CategoryHasEquipmentError ||
		err instanceof InvalidLoanTransitionError ||
		err instanceof InsufficientQuantityError ||
		err instanceof RecurringSeriesError
	) {
		error(422, (err as Error).message);
	}

	// Unknown — re-throw for SvelteKit's default 500 handling
	throw err;
}
