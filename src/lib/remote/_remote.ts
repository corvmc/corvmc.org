import { form as kitForm, command as kitCommand } from '$app/server';
import { DomainError } from '$lib/server/domain-error';
import { mapDomainError } from '$lib/server/errors';

/**
 * `form` and `command`, with domain-error mapping already applied.
 *
 * Every mutation here imports these rather than the `$app/server` originals, so
 * a domain error reaches the caller as the status it declares whether or not
 * the author remembered a catch — forgetting made it a 500 and a Sentry crash.
 * `scripts/remote-domain-error.spec.ts` is the gate.
 */

type Handler<D, I, O> = (data: D, issue: I) => O | Promise<O>;

/**
 * The same catch the call sites wrote by hand, hoisted. `invalid()`, `error()`
 * and an ordinary fault pass through untouched, as does an inner catch.
 *
 * The `DomainError` test is not redundant: this runs for every value a mutation
 * throws, and a spec that mocks a service module partially would otherwise make
 * `mapDomainError` compare against `undefined`.
 */
function withDomainErrors<D, I, O>(fn: Handler<D, I, O>): Handler<D, I, O> {
	return async (data, issue) => {
		try {
			return await fn(data, issue);
		} catch (err) {
			if (err instanceof DomainError) mapDomainError(err);
			throw err;
		}
	};
}

type KitForm = typeof kitForm;
type KitCommand = typeof kitCommand;

export const form: KitForm = ((...args: unknown[]) => {
	const fn = args.pop() as Handler<unknown, unknown, unknown>;
	return (kitForm as (...a: unknown[]) => unknown)(...args, withDomainErrors(fn));
}) as KitForm;

export const command: KitCommand = ((...args: unknown[]) => {
	const fn = args.pop() as Handler<unknown, unknown, unknown>;
	return (kitCommand as (...a: unknown[]) => unknown)(...args, withDomainErrors(fn));
}) as KitCommand;
