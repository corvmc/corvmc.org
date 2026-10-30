import { z } from 'zod';
import { count, desc, sql } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { user } from '$lib/server/db/schema/authentication';
import { memberRefColumns } from '$lib/server/entity/refs';
import { paginate, type PaginationInput, type PaginatedResult } from '$lib/server/db/paginate';
import { allRosterRows, rosterCsv, toRosterPerson } from '$lib/server/roster/roster';
import type { RosterPerson } from '$lib/types/roster';
import { sustainingUser, userListWhere, type UserListFilters } from './user-totals-service';

export interface UserRosterRow extends RosterPerson {
	id: string;
	phone: string | null;
	sustaining: boolean;
	deletedAt: Date | null;
	createdAt: Date;
}

/** The Members "All" view's rows, newest account first. */
export async function listStaffUsers(
	filters: UserListFilters,
	pagination: PaginationInput = {}
): Promise<PaginatedResult<UserRosterRow>> {
	const where = userListWhere(filters);
	const dataQ = db
		.select({
			member: memberRefColumns(),
			phone: user.phone,
			// The same predicate as the Sustaining filter and count.
			sustaining: sql<number>`${sustainingUser()}`,
			deletedAt: user.deletedAt,
			createdAt: user.createdAt
		})
		.from(user)
		.where(where)
		.orderBy(desc(user.createdAt), desc(user.id))
		.$dynamic();
	const countQ = db.select({ count: count() }).from(user).where(where);

	const { rows, pagination: page } = await paginate(dataQ, countQ, {
		page: pagination.page ?? 1,
		pageSize: pagination.pageSize ?? 20
	});
	return {
		rows: rows.map((u) => {
			const person = toRosterPerson({ ...u.member, id: u.member.id! });
			return {
				...person,
				// Deactivation rides the avatar like every other status in the app.
				member: { ...person.member, status: u.deletedAt ? 'deactivated' : null },
				id: person.personId,
				phone: u.phone,
				sustaining: Boolean(u.sustaining),
				deletedAt: u.deletedAt,
				createdAt: u.createdAt
			};
		}),
		pagination: page
	};
}

const yesNo = z
	.enum(['', 'yes', 'no'])
	.optional()
	.catch(undefined)
	.transform((v) => (v ? v === 'yes' : undefined));

/** The All view's filters under the keys its page writes to the URL. */
export const userRosterFilters = z.object({
	q: z.string().optional(),
	status: z.enum(['active', 'deactivated', 'all']).optional().catch(undefined),
	sustaining: yesNo,
	inBand: yesNo,
	staff: yesNo,
	instructor: yesNo
});

export type UserRosterFilters = z.output<typeof userRosterFilters>;

/** Everyone the filters match, unpaginated. */
export function listAllStaffUsers({ q, ...f }: UserRosterFilters): Promise<UserRosterRow[]> {
	return allRosterRows((p) => listStaffUsers({ ...f, search: q || undefined }, p));
}

export function userRosterCsv(rows: UserRosterRow[]): string {
	return rosterCsv(rows, [
		{ header: 'phone', value: (r) => r.phone },
		{ header: 'deactivated', value: (r) => (r.deletedAt ? 'yes' : 'no') },
		{ header: 'joined', value: (r) => r.createdAt.toISOString().slice(0, 10) }
	]);
}
