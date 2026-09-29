import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * Idea → decision → work, as rows: a suggestion, the ballot that decides it,
 * and the project a passing result authorises. Real SQLite, because every rule
 * here is a foreign key, a partial unique index or a conditional `UPDATE`.
 */

const { sqlite, testDb } = await vi.hoisted(async () => {
	const { migratedSqlite } = await import('$lib/server/testing/migrated-sqlite');
	return migratedSqlite({ foreignKeys: true });
});

vi.mock('$lib/server/db', () => ({
	db: Object.assign(testDb, {
		batch: async (stmts: PromiseLike<unknown>[]) => {
			const out = [];
			for (const s of stmts) out.push(await s);
			return out;
		}
	}),
	getRowCount: (result: unknown) => (result as { changes?: number })?.changes ?? 0
}));

vi.mock('$lib/server/site-config/site-config-service', () => ({
	config: vi.fn(async () => 60)
}));

vi.mock('$lib/server/event-bus/event-bus', () => ({
	domainEvents: { emit: vi.fn(async () => undefined), on: vi.fn() }
}));

vi.mock('$lib/server/audit/audit-service', () => ({
	recordAuditEntry: vi.fn(async () => undefined)
}));

const ballots = await import('$lib/server/ballot/ballot-service');
const chain = await import('./decision-chain');
const { startProjectFromSuggestion } = await import('./project-service');
const { user } = await import('$lib/server/db/schema/authentication');
const { memberOrientation } = await import('$lib/server/db/schema/volunteer');
const { suggestion } = await import('$lib/server/db/schema/suggestion');
const { project } = await import('$lib/server/db/schema/project');
const { eq } = await import('drizzle-orm');

const DAY = 86_400_000;
const NOW = new Date('2026-09-24T12:00:00Z');
const LATER = new Date(NOW.getTime() + 7 * DAY);
const AFTER_CLOSE = new Date(LATER.getTime() + 60_000);

const STAFF = 'usr-staff';
const CERTIFIER = 'usr-certifier';
const VOTERS = ['usr-a', 'usr-b', 'usr-c'];
const IDEA = 'sug-idea';

beforeEach(async () => {
	for (const t of [
		'ballot_choice',
		'ballot_participation',
		'ballot_elector',
		'ballot_option',
		'project',
		'ballot',
		'suggestion',
		'member_orientation',
		'user'
	]) {
		sqlite.exec(`delete from ${t}`);
	}
	const everyone = [STAFF, CERTIFIER, ...VOTERS];
	await testDb.insert(user).values(
		everyone.map((id) => ({
			id,
			name: id,
			email: `${id}@example.com`,
			emailVerified: true,
			createdAt: new Date(NOW.getTime() - 400 * DAY)
		})) as never
	);
	await testDb
		.insert(memberOrientation)
		.values(
			everyone.map((userId) => ({ userId, completedAt: new Date(NOW.getTime() - 300 * DAY) }))
		);
	await testDb
		.insert(suggestion)
		.values({ id: IDEA, authorUserId: VOTERS[0], title: 'A PA for the back room', body: '…' });
});

async function suggestionStatus() {
	const [row] = await testDb
		.select({ status: suggestion.status })
		.from(suggestion)
		.where(eq(suggestion.id, IDEA));
	return row.status;
}

function ballotOnIdea(links: { suggestionId?: string | null; projectId?: string | null } = {}) {
	return ballots.createBallot(
		{
			kind: 'member',
			title: 'Buy a PA for the back room?',
			options: ['Yes', 'No'],
			closesAt: LATER,
			certifierId: CERTIFIER,
			suggestionId: IDEA,
			...links
		},
		{ actorId: STAFF, now: NOW }
	);
}

/** Open, vote `yes` of three, then certify. */
async function certified(yes: number) {
	const id = await ballotOnIdea();
	await ballots.openBallot(id, { now: NOW });
	const [y, n] = (await ballots.getBallotDetail(id)).options;
	for (const [i, voter] of VOTERS.entries()) {
		await ballots.castVote(id, voter, (i < yes ? y : n).id, { now: NOW });
	}
	await ballots.certifyBallot(id, CERTIFIER, { now: AFTER_CLOSE });
	return id;
}

describe('a ballot names what it decides', () => {
	it('keeps the suggestion it was opened from', async () => {
		const id = await ballotOnIdea();
		expect((await ballots.getBallot(id)).suggestionId).toBe(IDEA);
	});

	it('can stand alone', async () => {
		const id = await ballotOnIdea({ suggestionId: null });
		const b = await ballots.getBallot(id);
		expect(b.suggestionId).toBeNull();
		expect(b.projectId).toBeNull();
	});

	it('refuses a suggestion that does not exist', async () => {
		await expect(ballotOnIdea({ suggestionId: 'sug-nope' })).rejects.toBeInstanceOf(
			ballots.BallotValidationError
		);
	});

	it('refuses a project that does not exist', async () => {
		await expect(
			ballotOnIdea({ suggestionId: null, projectId: 'proj-nope' })
		).rejects.toBeInstanceOf(ballots.BallotValidationError);
	});

	it('refuses a suggestion a project already answers', async () => {
		await startProjectFromSuggestion(IDEA, { name: 'PA' });
		await expect(ballotOnIdea()).rejects.toBeInstanceOf(ballots.BallotValidationError);
	});
});

describe('the suggestion follows its ballot', () => {
	it('stays open while the ballot is a draft', async () => {
		await ballotOnIdea();
		expect(await suggestionStatus()).toBe('open');
	});

	it('reads in ballot once voting opens', async () => {
		const id = await ballotOnIdea();
		await ballots.openBallot(id, { now: NOW });
		expect(await suggestionStatus()).toBe('in_ballot');
	});

	it('goes back to open when the ballot is cancelled', async () => {
		const id = await ballotOnIdea();
		await ballots.openBallot(id, { now: NOW });
		await ballots.cancelBallot(id, 'Wrong wording', { now: NOW });
		expect(await suggestionStatus()).toBe('open');
	});

	it('is not pulled back from planned by a ballot opening', async () => {
		const id = await ballotOnIdea();
		await testDb.update(suggestion).set({ status: 'planned' }).where(eq(suggestion.id, IDEA));
		await ballots.openBallot(id, { now: NOW });
		expect(await suggestionStatus()).toBe('planned');
	});
});

describe('a passing result', () => {
	it('is the first choice strictly ahead of every other', () => {
		const r = (votes: number[]) => ({
			options: votes.map((v, i) => ({ optionId: `o${i}`, label: `o${i}`, votes: v })),
			turnout: votes.reduce((a, b) => a + b, 0),
			electorateSize: 10
		});
		expect(ballots.ballotPassed(r([2, 1]))).toBe(true);
		expect(ballots.ballotPassed(r([1, 1]))).toBe(false);
		expect(ballots.ballotPassed(r([1, 2]))).toBe(false);
		expect(ballots.ballotPassed(r([0, 0]))).toBe(false);
		expect(ballots.ballotPassed(r([3, 1, 2]))).toBe(true);
		expect(ballots.ballotPassed(null)).toBe(false);
	});
});

describe('starting a project from a ballot', () => {
	it('creates the project linked to the ballot and its suggestion, both planned', async () => {
		const id = await certified(2);
		const p = await chain.startProjectFromBallot(
			id,
			{ name: 'Back room PA' },
			{ now: AFTER_CLOSE }
		);

		expect(p.ballotId).toBe(id);
		expect(p.suggestionId).toBe(IDEA);
		expect(p.status).toBe('planned');
		expect(await suggestionStatus()).toBe('planned');
	});

	it('is refused when the result did not pass', async () => {
		const id = await certified(1);
		await expect(
			chain.startProjectFromBallot(id, { name: 'Back room PA' }, { now: AFTER_CLOSE })
		).rejects.toBeInstanceOf(chain.DecisionChainError);
	});

	it('is refused before certification', async () => {
		const id = await ballotOnIdea();
		await ballots.openBallot(id, { now: NOW });
		await expect(
			chain.startProjectFromBallot(id, { name: 'Back room PA' }, { now: AFTER_CLOSE })
		).rejects.toBeInstanceOf(chain.DecisionChainError);
	});

	it('happens once per ballot', async () => {
		const id = await certified(3);
		await chain.startProjectFromBallot(id, { name: 'Back room PA' }, { now: AFTER_CLOSE });
		await expect(
			chain.startProjectFromBallot(id, { name: 'Again' }, { now: AFTER_CLOSE })
		).rejects.toBeInstanceOf(chain.DecisionChainError);
	});
});

describe('the chain, read back', () => {
	it("walks a project's origin: suggestion, then the ballot and its certified result", async () => {
		const id = await certified(2);
		const p = await chain.startProjectFromBallot(
			id,
			{ name: 'Back room PA' },
			{ now: AFTER_CLOSE }
		);

		const origin = await chain.getProjectOrigin(p.id, { now: AFTER_CLOSE });
		expect(origin.suggestion).toMatchObject({ id: IDEA, title: 'A PA for the back room' });
		expect(origin.ballot).toMatchObject({ id, status: 'certified', passed: true });
		expect(origin.ballot?.result?.turnout).toBe(3);
	});

	it('has neither link for a project nobody suggested or voted on', async () => {
		const [p] = await testDb.insert(project).values({ name: 'Breaker panel' }).returning();
		const origin = await chain.getProjectOrigin(p.id, { now: AFTER_CLOSE });
		expect(origin.suggestion).toBeNull();
		expect(origin.ballot).toBeNull();
		expect(origin.decidedBy).toEqual([]);
	});

	it("lists a suggestion's ballots without drafts, and its project", async () => {
		await ballotOnIdea();
		const id = await certified(2);
		await chain.startProjectFromBallot(id, { name: 'Back room PA' }, { now: AFTER_CLOSE });

		const links = await chain.getSuggestionChain(IDEA, { now: AFTER_CLOSE });
		expect(links.ballots.map((b) => b.id)).toEqual([id]);
		expect(links.project).toMatchObject({ name: 'Back room PA', ballotId: id });
	});

	it('says what a ballot decides and what it authorised', async () => {
		const id = await certified(2);
		const p = await chain.startProjectFromBallot(
			id,
			{ name: 'Back room PA' },
			{ now: AFTER_CLOSE }
		);

		const links = await chain.getBallotChain(id);
		expect(links.suggestion).toMatchObject({ id: IDEA });
		expect(links.project).toBeNull();
		expect(links.authorised).toMatchObject({ id: p.id, name: 'Back room PA' });
	});
});
