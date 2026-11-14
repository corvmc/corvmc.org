import type {
	AuditAction,
	AuditDetailsByAction,
	AuditFieldChange,
	AuditSubjectType
} from '#lib/types/audit.js';
import { recordAuditEntry } from './audit-service.js';

/**
 * How a staff `form` or `command` in `src/lib/remote/` declares its audit row.
 * The remote's handler is wrapped in exactly one of these; `custom/audit-declared`
 * refuses a staff remote that changes money, a clearance, a setting, a
 * visibility or a record's existence with none, and `scripts/audit-coverage.spec.ts`
 * checks each declaration against what the handler reaches.
 */

type Subject = { type: AuditSubjectType; id: string; label?: string | null };

/** A record's audited fields. `null` when the record does not exist. */
export type AuditSnapshot = Record<string, string | number | boolean | null> | null;

type Seen<D, G, O> = {
	data: D;
	actor: G;
	result: O;
	before: AuditSnapshot;
	after: AuditSnapshot;
};

export type AuditDeclaration<A extends AuditAction, D, G, O> = {
	/** The remote's guard. Runs before `read`, so nothing is read for a caller it refuses. */
	guard: () => G | Promise<G>;
	action: A;
	/** Read before and after the write; the row is skipped when no field changed. */
	read?: (data: D, actor: G) => Promise<AuditSnapshot>;
	subject: (seen: Seen<D, G, O>) => Subject;
	details: (seen: Seen<D, G, O> & { changes: AuditFieldChange[] }) => AuditDetailsByAction[A];
};

/** The fields whose values differ, in the order the snapshots list them. */
export function changedFields(before: AuditSnapshot, after: AuditSnapshot): AuditFieldChange[] {
	const keys = [...new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})])];
	return keys.flatMap((key) => {
		const from = before?.[key] ?? null;
		const to = after?.[key] ?? null;
		return from === to ? [] : [{ key, from, to }];
	});
}

/**
 * The handler runs after the guard, with the record as `read` found it, and
 * the row is written once it returns: a write that threw leaves no row.
 */
export function audited<A extends AuditAction, D, I, G, O>(
	decl: AuditDeclaration<A, D, G, O>,
	fn: (data: D, ctx: { issue: I; actor: G; before: AuditSnapshot }) => O | Promise<O>
): (data: D, issue: I) => Promise<O> {
	return async (data, issue) => {
		const actor = await decl.guard();
		const before = decl.read ? await decl.read(data, actor) : null;
		const result = await fn(data, { issue, actor, before });
		const after = decl.read ? await decl.read(data, actor) : null;
		const changes = changedFields(before, after);
		if (decl.read && changes.length === 0) return result;
		const seen = { data, actor, result, before, after };
		await recordAuditEntry({
			action: decl.action,
			subject: decl.subject(seen),
			details: decl.details({ ...seen, changes })
		} as Parameters<typeof recordAuditEntry>[0]);
		return result;
	};
}

/** The handler's services write these actions; the coverage spec checks it reaches each one. */
export function writesAudit<F extends (...args: never[]) => unknown>(
	_actions: AuditAction | AuditAction[],
	fn: F
): F {
	return fn;
}

/** A staff change that needs no row, and why. The reason is read by the coverage spec. */
export function unaudited<F extends (...args: never[]) => unknown>(_reason: string, fn: F): F {
	return fn;
}
