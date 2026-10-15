import { z } from 'zod';
import { or } from 'drizzle-orm';
import { query } from '$app/server';
import { form } from './_remote';
import { requireCapability } from '$lib/server/authorization';
import { db } from '$lib/server/db';
import { user } from '$lib/server/db/schema/authentication';
import { containsLiteral } from '$lib/server/db/like';
import {
	getAccessSummary,
	getPersonAccess,
	listCapabilityHolders,
	listClearanceHolders,
	listHoldersOfPosition
} from '$lib/server/access/access-service';
import { setPosition as setPositionService } from '$lib/server/access/position-service';
import { listCertifications } from '$lib/server/volunteer/volunteer-certification-service';
import { capabilities, positionOrder, SEARCH_LIMIT, type Capability } from '$lib/config';

/**
 * The access dashboard (#1942). Every read is guarded on `user.setRole`, the
 * admin-only capability that already decides who may assign a position: seeing
 * who holds what is the same authority as changing it. Clearance and committee
 * edits go through their own remotes and keep their own guards.
 */
const GUARD = 'user.setRole' satisfies Capability;

const allCapabilities = Object.entries(capabilities).flatMap(([r, as]) =>
	(as as readonly string[]).map((a) => `${r}.${a}`)
) as [Capability, ...Capability[]];

export const getAccessPage = query(async () => {
	await requireCapability(GUARD);
	const [summary, certifications] = await Promise.all([
		getAccessSummary(),
		listCertifications({ includeInactive: true })
	]);
	return {
		summary,
		certifications: certifications.map((c) => ({ id: c.id, name: c.name, isActive: c.isActive }))
	};
});

export const searchAccessPeople = query(z.string(), async (q) => {
	await requireCapability(GUARD);
	if (q.length < 2) return [];
	return db
		.select({ id: user.id, name: user.name, email: user.email })
		.from(user)
		.where(or(containsLiteral(user.name, q), containsLiteral(user.email, q)))
		.limit(SEARCH_LIMIT);
});

export const getPersonAccessView = query(z.string().min(1), async (userId) => {
	await requireCapability(GUARD);
	return getPersonAccess(userId);
});

const holdersSchema = z.discriminatedUnion('kind', [
	z.object({ kind: z.literal('capability'), key: z.enum(allCapabilities) }),
	z.object({ kind: z.literal('position'), key: z.enum(positionOrder) }),
	z.object({ kind: z.literal('clearance'), key: z.string().min(1) })
]);

export const getAccessHolders = query(holdersSchema, async (sel) => {
	await requireCapability(GUARD);
	if (sel.kind === 'capability') {
		return { kind: sel.kind, ...(await listCapabilityHolders(sel.key)) };
	}
	if (sel.kind === 'position') {
		return { kind: sel.kind, members: await listHoldersOfPosition(sel.key) };
	}
	return { kind: sel.kind, clearances: await listClearanceHolders(sel.key) };
});

/** Give or take one position. The last admin and your own last position are refused. */
export const setPosition = form(
	z.object({
		userId: z.string().min(1),
		position: z.enum(positionOrder),
		change: z.enum(['add', 'remove'])
	}),
	async (data) => {
		const actor = await requireCapability(GUARD);
		const change = await setPositionService({
			actorId: actor.id,
			targetId: data.userId,
			position: data.position,
			held: data.change === 'add'
		});
		void getPersonAccessView(data.userId).refresh();
		void getAccessPage().refresh();
		return change;
	}
);
