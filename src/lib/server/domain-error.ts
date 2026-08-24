/**
 * Base class for domain errors.
 *
 * This lives in its own leaf module — importing nothing — on purpose. It used
 * to sit in `errors.ts`, which imports every service module in order to build
 * its `instanceof` ladder. Once services started extending the base, that was a
 * cycle: `errors.ts` → `band-service.ts` → `errors.ts`. `extends` is evaluated
 * at module-init, so whichever side lost the race got
 * `Class extends value undefined is not a constructor` at runtime — a failure
 * `svelte-check` cannot see, because it is about evaluation order, not types.
 *
 * Keep this file dependency-free.
 */
export abstract class DomainError extends Error {
	abstract readonly httpStatus: number;

	constructor(message: string) {
		super(message);
		this.name = this.constructor.name;
	}
}
