import { z } from 'zod';

/**
 * A form field carrying a JSON-encoded array (hidden inputs written by
 * TagSelect and the multi-select fields).
 *
 * `.transform((s) => JSON.parse(s))` looks equivalent but throws on malformed
 * input, and a throw inside a transform escapes validation as a 500 rather than
 * surfacing as a field issue. Remote functions are directly callable endpoints,
 * so malformed input is reachable. This reports a normal validation issue
 * instead.
 */
export function jsonArrayField<T extends z.ZodTypeAny>(element: T, message = 'Invalid selection') {
	return z
		.string()
		.transform((s, ctx) => {
			try {
				const parsed: unknown = JSON.parse(s);
				if (!Array.isArray(parsed)) {
					ctx.addIssue({ code: 'custom', message });
					return z.NEVER;
				}
				return parsed;
			} catch {
				ctx.addIssue({ code: 'custom', message });
				return z.NEVER;
			}
		})
		.pipe(z.array(element));
}

/**
 * The object counterpart of {@link jsonArrayField}: a form field carrying a
 * JSON-encoded object.
 *
 * Same rationale — a `JSON.parse` throw inside a transform escapes validation
 * rather than surfacing as a field issue. Arrays and `null` are rejected too,
 * since `typeof null === 'object'` and a caller sending `[]` for an object
 * field is not sending an object.
 */
export function jsonObjectField(message = 'Invalid value') {
	return z.string().transform((s, ctx): Record<string, unknown> => {
		try {
			const parsed: unknown = JSON.parse(s);
			if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
				ctx.addIssue({ code: 'custom', message });
				return z.NEVER;
			}
			return parsed as Record<string, unknown>;
		} catch {
			ctx.addIssue({ code: 'custom', message });
			return z.NEVER;
		}
	});
}
