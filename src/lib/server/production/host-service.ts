import { and, eq, inArray } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { volunteerRole, workOrder, volunteerSignup } from '$lib/server/db/schema/volunteer';
import { user } from '$lib/server/db/schema/authentication';
import { HOST_VOLUNTEER_ROLE } from '$lib/config';
import { production } from '$lib/server/db/schema/production';
import { announcedBy } from './production-service';

/**
 * Who is running a show tonight — a volunteer shift, not a column (#932).
 *
 * The producer books the advance and then either works the night or hands it
 * over. As a work order, claiming, confirming, check-in and hours all already
 * work. `work_order.event_id` exists, so none of this needed schema.
 */

export interface ShowHost {
	signupId: string;
	userId: string;
	name: string;
	/** `claimed` is taken but unconfirmed; only `confirmed` is a promise. */
	status: string;
}

export interface HostShift {
	workOrderId: string;
	startsAt: Date | null;
	endsAt: Date | null;
	/** Everyone on it. Capacity is one, so this is zero or one in practice. */
	hosts: ShowHost[];
}

async function hostRoleId(): Promise<string | null> {
	const [row] = await db
		.select({ id: volunteerRole.id })
		.from(volunteerRole)
		.where(eq(volunteerRole.name, HOST_VOLUNTEER_ROLE))
		.limit(1);
	return row?.id ?? null;
}

/** The host shift for one show, if anybody has opened one. */
export async function getHostShift(eventId: string): Promise<HostShift | null> {
	const roleId = await hostRoleId();
	if (!roleId) return null;

	const [order] = await db
		.select({
			id: workOrder.id,
			startsAt: workOrder.startsAt,
			endsAt: workOrder.endsAt
		})
		.from(workOrder)
		.where(and(eq(workOrder.eventId, eventId), eq(workOrder.volunteerRoleId, roleId)))
		.limit(1);
	if (!order) return null;

	const hosts = await db
		.select({
			signupId: volunteerSignup.id,
			userId: volunteerSignup.userId,
			name: user.name,
			status: volunteerSignup.status
		})
		.from(volunteerSignup)
		.innerJoin(user, eq(user.id, volunteerSignup.userId))
		.where(
			and(
				eq(volunteerSignup.shiftId, order.id),
				// Cancelled and no-show are history, not an answer to "who is
				// running this".
				inArray(volunteerSignup.status, ['claimed', 'confirmed', 'completed'])
			)
		);

	return { workOrderId: order.id, startsAt: order.startsAt, endsAt: order.endsAt, hosts };
}

export class NoHostRoleError extends Error {
	constructor() {
		super(`No "${HOST_VOLUNTEER_ROLE}" volunteer role exists — seed it before opening a shift.`);
	}
}

/**
 * Open the host shift for a show, or return the one already open.
 *
 * Idempotent: two producers pressing it at once get the same work order, and
 * the roster is what decides who ends up on it.
 */
export async function openHostShift(eventId: string): Promise<string> {
	const roleId = await hostRoleId();
	if (!roleId) throw new NoHostRoleError();

	const existing = await getHostShift(eventId);
	if (existing) return existing.workOrderId;

	// The window is the show's, not a form's: a host owns the night from
	// load-in to load-out, and asking a producer to retype two times they
	// already entered on the same page is how they end up disagreeing.
	const [prod] = await db
		.select({ loadInAt: production.loadInAt, loadOutBy: production.loadOutBy })
		.from(production)
		.where(announcedBy(eventId))
		.limit(1);

	const [created] = await db
		.insert(workOrder)
		.values({
			volunteerRoleId: roleId,
			eventId,
			title: HOST_VOLUNTEER_ROLE,
			startsAt: prod?.loadInAt ?? null,
			endsAt: prod?.loadOutBy ?? null,
			capacity: 1
		})
		.returning({ id: workOrder.id });

	return created.id;
}
