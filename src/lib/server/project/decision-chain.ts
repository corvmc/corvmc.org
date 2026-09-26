import { and, desc, eq, isNotNull, or } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { DomainError } from '$lib/server/domain-error';
import { suggestion } from '$lib/server/db/schema/suggestion';
import { project } from '$lib/server/db/schema/project';
import { ballot, type Ballot } from '$lib/server/db/schema/ballot';
import { ballotPassed, ballotStatusOf, getBallot } from '$lib/server/ballot/ballot-service';
import { assertCommittee, getProjectById, type CreateProjectInput } from './project-service';

/**
 * Idea → decision → work, read and written as rows: `ballot.suggestion_id` and
 * `ballot.project_id` say what a ballot decides, `project.suggestion_id` and
 * `project.ballot_id` say where a project came from. Every link is nullable.
 * docs/architecture/domain-model.md, model 7.
 */

export class DecisionChainError extends DomainError {
	readonly httpStatus = 409;
}

type Now = { now?: Date };

/** A ballot as a line on someone else's page. Never a tally: only a certified result. */
function ballotLink(b: Ballot, now: Date) {
	const status = ballotStatusOf(b, now);
	const certified = status === 'certified';
	return {
		id: b.id,
		title: b.title,
		kind: b.kind,
		status,
		closesAt: b.closesAt,
		certifiedAt: b.certifiedAt,
		result: certified ? b.certifiedResult : null,
		passed: certified ? ballotPassed(b.certifiedResult) : null
	};
}

export type BallotLink = ReturnType<typeof ballotLink>;

const projectLink = {
	id: project.id,
	name: project.name,
	status: project.status,
	ballotId: project.ballotId
};

const suggestionLink = {
	id: suggestion.id,
	title: suggestion.title,
	status: suggestion.status,
	visibility: suggestion.visibility
};

/**
 * Start the project a certified, passing ballot authorised, linked to the
 * ballot and to the suggestion it decided. The suggestion moves to `planned`
 * in the same batch, as `startProjectFromSuggestion` does.
 */
export async function startProjectFromBallot(
	ballotId: string,
	data: Omit<CreateProjectInput, 'suggestionId' | 'status'>,
	ctx: Now = {}
) {
	const now = ctx.now ?? new Date();
	const b = await getBallot(ballotId);
	if (ballotStatusOf(b, now) !== 'certified' || !ballotPassed(b.certifiedResult)) {
		throw new DecisionChainError('Only a certified, passing ballot can start a project');
	}
	if (b.projectId) {
		throw new DecisionChainError('This ballot decided an existing project');
	}

	const [taken] = await db
		.select({ id: project.id })
		.from(project)
		.where(
			or(
				eq(project.ballotId, ballotId),
				b.suggestionId ? eq(project.suggestionId, b.suggestionId) : undefined
			)
		)
		.limit(1);
	if (taken) throw new DecisionChainError('A project has already been started from this');
	if (data.groupId) await assertCommittee(data.groupId);

	const id = crypto.randomUUID();
	await db.batch([
		db.insert(project).values({
			...data,
			id,
			ballotId,
			suggestionId: b.suggestionId,
			status: 'planned'
		}),
		...(b.suggestionId
			? [
					db
						.update(suggestion)
						.set({ status: 'planned', updatedAt: now })
						.where(eq(suggestion.id, b.suggestionId))
				]
			: [])
	]);
	return getProjectById(id);
}

/** "Why this exists": the suggestion, the authorising ballot, and any ballot that decided it since. */
export async function getProjectOrigin(projectId: string, ctx: Now = {}) {
	const now = ctx.now ?? new Date();
	const p = await getProjectById(projectId);

	const [origin, authorising, deciding] = await Promise.all([
		p.suggestionId
			? db.select(suggestionLink).from(suggestion).where(eq(suggestion.id, p.suggestionId))
			: [],
		p.ballotId ? db.select().from(ballot).where(eq(ballot.id, p.ballotId)) : [],
		db.select().from(ballot).where(eq(ballot.projectId, projectId)).orderBy(desc(ballot.createdAt))
	]);

	return {
		suggestion: origin[0] ?? null,
		ballot: authorising[0] ? ballotLink(authorising[0], now) : null,
		decidedBy: deciding.map((b) => ballotLink(b, now)).filter((b) => b.status !== 'draft')
	};
}

/** A suggestion's ballots, drafts left out since only managers may see one, and its project. */
export async function getSuggestionChain(suggestionId: string, ctx: Now = {}) {
	const now = ctx.now ?? new Date();
	const [rows, answered] = await Promise.all([
		db
			.select()
			.from(ballot)
			.where(and(eq(ballot.suggestionId, suggestionId), isNotNull(ballot.openedAt)))
			.orderBy(desc(ballot.createdAt)),
		db.select(projectLink).from(project).where(eq(project.suggestionId, suggestionId)).limit(1)
	]);
	return { ballots: rows.map((b) => ballotLink(b, now)), project: answered[0] ?? null };
}

/** What a ballot decides, and the project its result authorised, if one was started. */
export async function getBallotChain(ballotId: string) {
	const b = await getBallot(ballotId);
	const [decided, decidedProject, authorised] = await Promise.all([
		b.suggestionId
			? db.select(suggestionLink).from(suggestion).where(eq(suggestion.id, b.suggestionId))
			: [],
		b.projectId ? db.select(projectLink).from(project).where(eq(project.id, b.projectId)) : [],
		db.select(projectLink).from(project).where(eq(project.ballotId, ballotId)).limit(1)
	]);
	return {
		suggestion: decided[0] ?? null,
		project: decidedProject[0] ?? null,
		authorised: authorised[0] ?? null
	};
}
