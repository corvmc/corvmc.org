import { error } from '@sveltejs/kit';
import { DomainError } from './domain-error';

// Re-exported so existing importers keep working. The definition lives in a
// dependency-free leaf module because this file used to import every service in
// order to build an `instanceof` ladder — see domain-error.ts.
export { DomainError } from './domain-error';

/**
 * Maps a domain error to a SvelteKit HTTP error. Unknown errors are re-thrown so
 * SvelteKit's default 500 handling kicks in.
 *
 * A new domain error needs no registration here: it declares its own
 * `httpStatus` and this resolves it. A service that throws a bare `Error`
 * reaches a caller as a 500, which is the right answer for a fault and the
 * wrong one for a rule — so give a rule a `DomainError` subclass.
 */
export function mapDomainError(err: unknown): never {
	if (err instanceof DomainError) error(err.httpStatus, err.message);

	throw err;
}
