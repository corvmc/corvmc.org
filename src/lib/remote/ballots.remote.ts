import { z } from 'zod';
import { error } from '@sveltejs/kit';
import { query } from '$app/server';
import { form } from './_remote';
import { can, requireCapability, requireUser } from '$lib/server/authorization';
import { requireGroupRole } from '$lib/server/group/group-context';
import { mapDomainError } from '$lib/server/errors';
import { buildDateInTz } from '$lib/server/reservation/timezone';
import {
	ballotKinds,
	BALLOT_DESCRIPTION_MAX,
	BALLOT_REASON_MAX,
	BALLOT_TITLE_MAX,
	DEFAULT_TIMEZONE
} from '$lib/config';
import {
	ballotStatusOf,
	cancelBallot,
	castVote,
	certifyBallot,
	createBallot as createBallotSvc,
	getBallotDetail,
	getMyVote,
	getTally,
	getTurnout,
	isElector,
	listAllBallots,
	listBallotsForMember,
	listCommitteeRosters,
	listOverrides,
	openBallot,
	previewElectorateSize,
	setCertifier,
	setElectorOverride,
	updateDraft,
	type BallotDetail
} from '$lib/server/ballot/ballot-service';

/**
 * Ballots. See docs/specs/formal-balloting-spec.md for who may do what.
 *
 * A member-wide ballot is managed only through `ballot.manage`. A committee
 * ballot is managed by that committee's owner or admin, or through
 * `ballot.manage`. The group comes off the ballot row, never off the request.
 */

async function canManage(b: Pick<BallotDetail, 'kind' | 'groupId'>): Promise<boolean> {
	if (await can('ballot.manage')) return true;
	if (b.kind !== 'group' || !b.groupId) return false;
	try {
		await requireGroupRole({ id: b.groupId }, 'admin');
		return true;
	} catch {
		return false;
	}
}

async function loadBallot(ballotId: string): Promise<BallotDetail> {
	try {
		return await getBallotDetail(ballotId);
	} catch (err) {
		mapDomainError(err);
	}
}

async function requireManager(ballotId: string) {
	const me = requireUser();
	const b = await loadBallot(ballotId);
	if (b.kind === 'member') await requireCapability('ballot.manage');
	else if (!(await can('ballot.manage'))) await requireGroupRole({ id: b.groupId! }, 'admin');
	return { me, ballot: b };
}

/** One close per named day: the ballot closes at the end of it, in the collective's zone. */
function closesAt(day: string): Date {
	return buildDateInTz(day, '23:59', DEFAULT_TIMEZONE);
}

/** One choice per line. Split here, not in the schema: a `.transform()` breaks `fields` typing. */
function choices(text: string): string[] {
	return text
		.split('\n')
		.map((l) => l.trim())
		.filter(Boolean);
}

const draftFields = {
	title: z.string().trim().min(1, 'Ask the question').max(BALLOT_TITLE_MAX),
	description: z.string().trim().max(BALLOT_DESCRIPTION_MAX).optional(),
	options: z.string().trim().min(1, 'List the choices, one per line'),
	closesOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Pick the closing day'),
	certifierId: z.string().min(1, 'Name who certifies the result')
};

const ballotIdField = z.object({ ballotId: z.string().min(1) });

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

/** `/member/ballots`: what the caller can vote on, certify or read, and where they can create. */
export const getMemberBallots = query(async () => {
	const me = requireUser();
	const [committees, staff] = await Promise.all([
		listCommitteeRosters({ adminUserId: me.id }),
		can('ballot.manage')
	]);
	const ballots = await listBallotsForMember(me.id, {
		managedGroupIds: committees.map((c) => c.id)
	});
	return { ballots, committees, canManageMemberWide: staff };
});

/** `/staff/ballots`: every ballot, and every committee a ballot could belong to. */
export const getStaffBallots = query(async () => {
	await requireCapability('ballot.manage');
	const [ballots, committees] = await Promise.all([listAllBallots(), listCommitteeRosters()]);
	return { ballots, committees };
});

/**
 * One ballot, shaped for whoever is asking. A draft is its managers' alone; an
 * open or closed ballot is its electors', certifier's and managers'; a
 * certified result is every member's. Anyone else gets a 404.
 */
export const getBallotPage = query(z.string().min(1), async (ballotId) => {
	const me = requireUser();
	const b = await loadBallot(ballotId);
	const status = ballotStatusOf(b);
	const [manager, elector] = await Promise.all([canManage(b), isElector(ballotId, me.id)]);
	const certifier = b.certifierId === me.id;
	const involved = manager || elector || certifier;

	if (status === 'draft' && !manager) error(404, 'Ballot not found');
	if (status !== 'certified' && !involved) error(404, 'Ballot not found');

	const tallyVisible = status === 'certified' || (status === 'closed' && involved);
	const staff = await can('ballot.manage');

	try {
		const [myVote, tally, turnout, previewSize, overrides] = await Promise.all([
			elector ? getMyVote(ballotId, me.id) : null,
			tallyVisible ? getTally(ballotId) : null,
			manager && (status === 'open' || status === 'closed') ? getTurnout(ballotId) : null,
			manager && status === 'draft' ? previewElectorateSize(ballotId) : null,
			staff && b.kind === 'member' ? listOverrides(ballotId) : null
		]);
		const committee =
			manager && b.kind === 'group'
				? ((await listCommitteeRosters()).find((c) => c.id === b.groupId) ?? null)
				: null;

		return {
			ballot: {
				id: b.id,
				kind: b.kind,
				title: b.title,
				description: b.description,
				status,
				closesAt: b.closesAt,
				openedAt: b.openedAt,
				electorateSize: b.electorateSize,
				cancelReason: b.cancelReason,
				certifiedAt: b.certifiedAt,
				options: b.options,
				group: b.group,
				certifier: b.certifier
			},
			viewer: { isManager: manager, isElector: elector, isCertifier: certifier, isStaff: staff },
			myVote,
			tally,
			turnout,
			previewSize,
			overrides,
			certifierChoices: committee?.members ?? null
		};
	} catch (err) {
		mapDomainError(err);
	}
});

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

export const createBallot = form(
	z.object({
		kind: z.enum(ballotKinds),
		groupId: z.string().optional(),
		...draftFields
	}),
	async (data) => {
		const me = requireUser();
		if (data.kind === 'member') {
			await requireCapability('ballot.manage');
		} else {
			if (!data.groupId) error(400, 'Choose the committee');
			if (!(await can('ballot.manage'))) await requireGroupRole({ id: data.groupId }, 'admin');
		}
		const id = await createBallotSvc(
			{
				kind: data.kind,
				groupId: data.kind === 'group' ? data.groupId : null,
				title: data.title,
				description: data.description,
				options: choices(data.options),
				closesAt: closesAt(data.closesOn),
				certifierId: data.certifierId
			},
			{ actorId: me.id }
		);
		await getMemberBallots().refresh();
		if (await can('ballot.manage')) await getStaffBallots().refresh();
		return { id };
	}
);

export const updateBallotDraft = form(
	z.object({ ballotId: z.string().min(1), ...draftFields }),
	async (data) => {
		await requireManager(data.ballotId);
		await updateDraft(data.ballotId, {
			title: data.title,
			description: data.description,
			options: choices(data.options),
			closesAt: closesAt(data.closesOn),
			certifierId: data.certifierId
		});
		await getBallotPage(data.ballotId).refresh();
	}
);

export const changeBallotCertifier = form(
	z.object({ ballotId: z.string().min(1), certifierId: z.string().min(1) }),
	async (data) => {
		await requireManager(data.ballotId);
		await setCertifier(data.ballotId, data.certifierId);
		await getBallotPage(data.ballotId).refresh();
	}
);

export const openBallotForm = form(ballotIdField, async ({ ballotId }) => {
	await requireManager(ballotId);
	await openBallot(ballotId);
	await getBallotPage(ballotId).refresh();
});

export const cancelBallotForm = form(
	z.object({
		ballotId: z.string().min(1),
		reason: z.string().trim().min(1, 'Say why').max(BALLOT_REASON_MAX)
	}),
	async (data) => {
		await requireManager(data.ballotId);
		await cancelBallot(data.ballotId, data.reason);
		await getBallotPage(data.ballotId).refresh();
	}
);

/** The option id travels to the service and nowhere else: never logged, never echoed. */
export const castBallotVote = form(
	z.object({ ballotId: z.string().min(1), optionId: z.string().min(1, 'Choose one') }),
	async (data) => {
		const me = requireUser();
		await castVote(data.ballotId, me.id, data.optionId);
		await getBallotPage(data.ballotId).refresh();
	}
);

export const certifyBallotForm = form(ballotIdField, async ({ ballotId }) => {
	const me = requireUser();
	await certifyBallot(ballotId, me.id);
	await getBallotPage(ballotId).refresh();
});

export const setElectorOverrideForm = form(
	z.object({
		ballotId: z.string().min(1),
		userId: z.string().min(1, 'Choose a member'),
		include: z.enum(['include', 'exclude']),
		reason: z.string().trim().min(1, 'Say why').max(BALLOT_REASON_MAX)
	}),
	async (data) => {
		const staff = await requireCapability('ballot.manage');
		await setElectorOverride(
			data.ballotId,
			{ userId: data.userId, include: data.include === 'include', reason: data.reason },
			{ actorId: staff.id }
		);
		await getBallotPage(data.ballotId).refresh();
	}
);
