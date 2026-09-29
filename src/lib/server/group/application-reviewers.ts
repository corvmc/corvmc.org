import { db } from '$lib/server/db';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { group, groupMember } from '$lib/server/db/schema/group';
import { user } from '$lib/server/db/schema/authentication';
import { listUsersWithCapability } from '$lib/server/authorization';

export interface ApplicationReviewer {
	id: string;
	name: string;
	email: string;
	/** Where this reviewer answers it: a chair on the group page, the coordinator on the queue. */
	href: string;
}

export interface ApplicationNotice {
	groupName: string;
	applicantName: string;
	reviewers: ApplicationReviewer[];
}

/**
 * Who should hear that someone applied to a group, and where they answer it.
 *
 * The same doors `requireCommitteeReviewer` and `approveApplicationForm` check:
 * the group's active owner and admins, or for a committee with no chair, the
 * holders of `committee.reviewApplications`. Both submit paths share it (#1726).
 */
export async function applicationNotice(
	groupId: string,
	applicantUserId: string
): Promise<ApplicationNotice | null> {
	const [[g], [applicant], chairs] = await Promise.all([
		db
			.select({ name: group.name, slug: group.slug, kind: group.kind })
			.from(group)
			.where(and(eq(group.id, groupId), isNull(group.deletedAt)))
			.limit(1),
		db.select({ name: user.name }).from(user).where(eq(user.id, applicantUserId)).limit(1),
		db
			.select({ id: user.id, name: user.name, email: user.email })
			.from(groupMember)
			.innerJoin(user, eq(user.id, groupMember.userId))
			.where(
				and(
					eq(groupMember.groupId, groupId),
					eq(groupMember.status, 'active'),
					inArray(groupMember.role, ['owner', 'admin'])
				)
			)
	]);
	if (!g) return null;

	const groupHref = `/member/groups/${g.slug}`;
	let reviewers = chairs.map((c) => ({ ...c, href: groupHref }));
	if (reviewers.length === 0 && g.kind === 'committee') {
		const coordinators = await listUsersWithCapability('committee.reviewApplications');
		reviewers = coordinators.map((c) => ({ ...c, href: '/staff/committees' }));
	}

	return { groupName: g.name, applicantName: applicant?.name ?? 'A member', reviewers };
}
