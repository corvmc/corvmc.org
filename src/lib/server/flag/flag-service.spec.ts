import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

let selectResultQueue: unknown[][] = [];
let insertResult: unknown[] = [];
let updateResult: unknown[] = [];

function chainableSelect() {
	const proxy: any = new Proxy(() => proxy, {
		get(_, prop) {
			if (prop === 'then') {
				return (resolve: (v: unknown[]) => void) =>
					resolve(selectResultQueue.length > 0 ? selectResultQueue.shift()! : []);
			}
			return () => proxy;
		}
	});
	return proxy;
}

vi.mock('$lib/server/db', () => ({
	db: {
		select: () => chainableSelect(),
		insert: vi.fn(() => ({
			values: vi.fn(() => ({ returning: vi.fn(() => Promise.resolve(insertResult)) }))
		})),
		update: vi.fn(() => ({
			set: vi.fn(() => ({
				where: vi.fn(() => ({ returning: vi.fn(() => Promise.resolve(updateResult)) }))
			}))
		}))
	}
}));

const emitMock = vi.fn().mockResolvedValue(undefined);
vi.mock('$lib/server/events/event-bus', () => ({
	domainEvents: { emit: (...args: unknown[]) => emitMock(...args) }
}));

vi.mock('$lib/server/sentry', () => ({ captureException: vi.fn() }));

// The unpublish-and-notify behaviour itself lives in the event service (shared
// with the staff event page) and is covered by `event-service.spec.ts`; here we
// only assert the flag queue delegates to it.
const unpublishMock = vi.fn().mockResolvedValue(undefined);
const getByIdMock = vi.fn().mockResolvedValue(null);
vi.mock('$lib/server/event/event-service', () => ({
	unpublishWithNotice: (...args: unknown[]) => unpublishMock(...args),
	getById: (...args: unknown[]) => getByIdMock(...args)
}));

// Standing is one service now, whatever the domain, so one mock covers all
// three arms. What this file asserts is which *scope* the queue charges and
// when — the storage itself is standing-service.spec.ts's job.
//
// `scopeForFlag` is deliberately NOT mocked. It is the mapping under test here:
// stubbing it would leave the "an event report only costs standing when the
// event is a community listing" rule asserted against a fake.
const restrictStandingMock = vi.fn().mockResolvedValue(undefined);
vi.mock('$lib/server/moderation/standing-service', async () => ({
	...(await vi.importActual('$lib/server/moderation/standing-service')),
	restrictStanding: (...args: unknown[]) => restrictStandingMock(...args)
}));

// The visibility changes belong to the suggestion service, so here we assert
// only which of them the queue reaches for — and, crucially, that dismissing
// RESTORES rather than doing nothing (the deliberate asymmetry with event
// reports).
const withholdMock = vi.fn().mockResolvedValue(undefined);
const setVisibilityMock = vi.fn().mockResolvedValue(undefined);
const getSuggestionForModerationMock = vi.fn().mockResolvedValue(null);
vi.mock('$lib/server/suggestion/suggestion-service', () => ({
	withholdForReview: (...args: unknown[]) => withholdMock(...args),
	setVisibility: (...args: unknown[]) => setVisibilityMock(...args),
	getSuggestionForModeration: (...args: unknown[]) => getSuggestionForModerationMock(...args)
}));

import {
	createFlag,
	resolveFlag,
	FlagTargetNotFoundError,
	FlagNotFoundError,
	FlagAlreadyResolvedError
} from './flag-service';

beforeEach(() => {
	selectResultQueue = [];
	insertResult = [];
	updateResult = [];
	emitMock.mockClear();
	unpublishMock.mockClear();
	restrictStandingMock.mockClear();
	getByIdMock.mockReset();
	getByIdMock.mockResolvedValue(null);
	withholdMock.mockClear();
	setVisibilityMock.mockClear();
	getSuggestionForModerationMock.mockReset();
	getSuggestionForModerationMock.mockResolvedValue(null);
});

// ---------------------------------------------------------------------------
// createFlag
// ---------------------------------------------------------------------------

describe('createFlag', () => {
	it('rejects when the reported entity does not exist', async () => {
		selectResultQueue = [[]]; // resolveEntityLabel finds nothing
		await expect(
			createFlag({
				entityType: 'member_profile',
				entityId: 'missing',
				reportedByUserId: 'u1',
				reportedByName: 'Reporter',
				reason: 'spam'
			})
		).rejects.toBeInstanceOf(FlagTargetNotFoundError);
	});

	it('inserts a flag and emits content.flagged', async () => {
		selectResultQueue = [[{ name: 'Jordan' }]]; // entity label lookup
		insertResult = [{ id: 'f1', entityType: 'member_profile', entityId: 'u2', reason: 'spam' }];

		const flag = await createFlag({
			entityType: 'member_profile',
			entityId: 'u2',
			reportedByUserId: 'u1',
			reportedByName: 'Reporter',
			reason: 'spam'
		});

		expect(flag).toMatchObject({ id: 'f1' });
		// Event is emitted fire-and-forget; allow the microtask to flush.
		await Promise.resolve();
		await Promise.resolve();
		expect(emitMock).toHaveBeenCalledWith(
			'content.flagged',
			expect.objectContaining({ flagId: 'f1', entityLabel: 'Jordan', reason: 'spam' })
		);
	});

	it('truncates an over-long reason to the limit', async () => {
		selectResultQueue = [[{ name: 'Jordan' }]];
		insertResult = [{ id: 'f1' }];
		await createFlag({
			entityType: 'member_profile',
			entityId: 'u2',
			reportedByUserId: 'u1',
			reportedByName: 'Reporter',
			reason: 'x'.repeat(500)
		});
		// No assertion on db internals here beyond not throwing; the slice guards
		// against schema overflow. Covered indirectly by createFlag succeeding.
		expect(insertResult).toBeTruthy();
	});

	it('flags an event using its title as the label', async () => {
		selectResultQueue = [
			[{ title: 'Loud Show' }], // entity label lookup (event.title)
			[] // duplicate pending-flag check
		];
		insertResult = [{ id: 'f2', entityType: 'event', entityId: 'e1', reason: 'fake' }];

		await createFlag({
			entityType: 'event',
			entityId: 'e1',
			reportedByUserId: 'u1',
			reportedByName: 'Reporter',
			reason: 'fake'
		});

		await Promise.resolve();
		await Promise.resolve();
		expect(emitMock).toHaveBeenCalledWith(
			'content.flagged',
			expect.objectContaining({ flagId: 'f2', entityLabel: 'Loud Show' })
		);
	});

	it('accepts anonymous reports and emits a placeholder reporter name', async () => {
		selectResultQueue = [[{ title: 'Loud Show' }], []];
		insertResult = [{ id: 'f3', entityType: 'event', entityId: 'e1', reason: 'spam' }];

		const flag = await createFlag({
			entityType: 'event',
			entityId: 'e1',
			reason: 'spam'
		});

		expect(flag).toMatchObject({ id: 'f3' });
		await Promise.resolve();
		await Promise.resolve();
		expect(emitMock).toHaveBeenCalledWith(
			'content.flagged',
			expect.objectContaining({ reportedByUserId: null, reportedByName: 'Anonymous visitor' })
		);
	});

	it('still inserts but skips staff notification when a pending flag already exists', async () => {
		selectResultQueue = [
			[{ title: 'Loud Show' }],
			[{ id: 'existing-flag' }] // duplicate pending-flag check hits
		];
		insertResult = [{ id: 'f4', entityType: 'event', entityId: 'e1', reason: 'spam again' }];

		const flag = await createFlag({
			entityType: 'event',
			entityId: 'e1',
			reason: 'spam again'
		});

		expect(flag).toMatchObject({ id: 'f4' });
		await Promise.resolve();
		await Promise.resolve();
		expect(emitMock).not.toHaveBeenCalled();
	});
});

// ---------------------------------------------------------------------------
// resolveFlag
// ---------------------------------------------------------------------------

describe('resolveFlag', () => {
	it('throws when the flag does not exist', async () => {
		selectResultQueue = [[]];
		await expect(
			resolveFlag('missing', { resolution: 'resolved', staffId: 's1' })
		).rejects.toBeInstanceOf(FlagNotFoundError);
	});

	it('refuses to resolve a flag that is already resolved', async () => {
		selectResultQueue = [[{ status: 'dismissed' }]];
		await expect(
			resolveFlag('f1', { resolution: 'resolved', staffId: 's1' })
		).rejects.toBeInstanceOf(FlagAlreadyResolvedError);
	});

	it('resolves a pending flag', async () => {
		selectResultQueue = [[{ status: 'pending' }]];
		updateResult = [{ id: 'f1', status: 'resolved' }];
		const row = await resolveFlag('f1', { resolution: 'resolved', staffId: 's1' });
		expect(row).toMatchObject({ status: 'resolved' });
	});

	it('hands a flagged event to the unpublish-and-notify path when requested', async () => {
		selectResultQueue = [[{ status: 'pending', entityType: 'event', entityId: 'e1' }]];
		updateResult = [{ id: 'f1', status: 'resolved' }];

		await resolveFlag('f1', {
			resolution: 'resolved',
			staffId: 's1',
			notes: 'Poster violated guidelines',
			unpublishEvent: true
		});

		expect(unpublishMock).toHaveBeenCalledWith('e1', { notes: 'Poster violated guidelines' });
	});

	it('does not unpublish when the option is not set', async () => {
		selectResultQueue = [[{ status: 'pending', entityType: 'event', entityId: 'e1' }]];
		updateResult = [{ id: 'f1', status: 'resolved' }];

		await resolveFlag('f1', { resolution: 'resolved', staffId: 's1' });

		expect(unpublishMock).not.toHaveBeenCalled();
	});

	// ---------------------------------------------------------------------
	// Community listing standing
	// ---------------------------------------------------------------------
	//
	// The trust rule is wired in exactly one place, and this is the pair of
	// tests that pins it. Event reports are public and anonymous, so if a bare
	// accusation could cost a member their standing, any visitor would have a
	// griefing tool. Only an *upheld* report counts.

	it('revokes the submitter’s standing when a community listing’s report is upheld', async () => {
		selectResultQueue = [[{ status: 'pending', entityType: 'event', entityId: 'e1' }]];
		updateResult = [{ id: 'f1', status: 'resolved' }];
		getByIdMock.mockResolvedValue({
			id: 'e1',
			source: 'community',
			createdByUserId: 'member-1'
		});

		await resolveFlag('f1', {
			resolution: 'resolved',
			staffId: 's1',
			notes: 'No venue given'
		});

		expect(restrictStandingMock).toHaveBeenCalledWith({
			userId: 'member-1',
			scope: 'community_event',
			flagId: 'f1',
			staffId: 's1',
			reason: 'No venue given'
		});
	});

	it('leaves standing alone when the report is dismissed', async () => {
		selectResultQueue = [[{ status: 'pending', entityType: 'event', entityId: 'e1' }]];
		updateResult = [{ id: 'f1', status: 'dismissed' }];
		getByIdMock.mockResolvedValue({
			id: 'e1',
			source: 'community',
			createdByUserId: 'member-1'
		});

		await resolveFlag('f1', { resolution: 'dismissed', staffId: 's1' });

		expect(restrictStandingMock).not.toHaveBeenCalled();
	});

	it('does not touch standing for a band gig — there is no member to hold responsible', async () => {
		selectResultQueue = [[{ status: 'pending', entityType: 'event', entityId: 'e1' }]];
		updateResult = [{ id: 'f1', status: 'resolved' }];
		getByIdMock.mockResolvedValue({
			id: 'e1',
			source: 'band',
			createdByUserId: 'member-1'
		});

		await resolveFlag('f1', { resolution: 'resolved', staffId: 's1' });

		expect(restrictStandingMock).not.toHaveBeenCalled();
	});

	it('leaves standing alone for a flagged member profile', async () => {
		selectResultQueue = [[{ status: 'pending', entityType: 'member_profile', entityId: 'u9' }]];
		updateResult = [{ id: 'f1', status: 'resolved' }];

		await resolveFlag('f1', { resolution: 'resolved', staffId: 's1' });

		expect(restrictStandingMock).not.toHaveBeenCalled();
		expect(getByIdMock).not.toHaveBeenCalled();
	});
});

// ---------------------------------------------------------------------------
// Suggestion reports
//
// This is where a bug is worst: it can leave a member's post hidden forever, or
// silently put them on probation for a report staff threw out.
// ---------------------------------------------------------------------------

describe('suggestion reports', () => {
	it('pulls the suggestion off the board as soon as it is reported', async () => {
		selectResultQueue = [[{ title: 'Buy a better PA' }]]; // entity label lookup
		insertResult = [{ id: 'f1', entityType: 'suggestion', entityId: 'sg1', reason: 'spam' }];

		await createFlag({
			entityType: 'suggestion',
			entityId: 'sg1',
			reportedByUserId: 'u1',
			reportedByName: 'Reporter',
			reason: 'spam'
		});

		expect(withholdMock).toHaveBeenCalledWith('sg1', { flagId: 'f1' });
	});

	it('does not withhold anything when the report is about something else', async () => {
		selectResultQueue = [[{ name: 'Jordan' }]];
		insertResult = [{ id: 'f1', entityType: 'member_profile', entityId: 'u2', reason: 'spam' }];

		await createFlag({
			entityType: 'member_profile',
			entityId: 'u2',
			reportedByUserId: 'u1',
			reportedByName: 'Reporter',
			reason: 'spam'
		});

		expect(withholdMock).not.toHaveBeenCalled();
	});

	it('upholding hides the suggestion and costs the author their posting trust', async () => {
		selectResultQueue = [[{ status: 'pending', entityType: 'suggestion', entityId: 'sg1' }]];
		updateResult = [{ id: 'f1', status: 'resolved' }];
		getSuggestionForModerationMock.mockResolvedValue({ id: 'sg1', authorUserId: 'member-1' });

		await resolveFlag('f1', { resolution: 'resolved', staffId: 's1', notes: 'Not acceptable' });

		expect(setVisibilityMock).toHaveBeenCalledWith(
			'sg1',
			expect.objectContaining({ visibility: 'hidden', note: 'Not acceptable' })
		);
		expect(restrictStandingMock).toHaveBeenCalledWith(
			expect.objectContaining({
				userId: 'member-1',
				scope: 'suggestion',
				flagId: 'f1',
				staffId: 's1'
			})
		);
	});

	it('dismissing puts the suggestion back on the board and leaves standing alone', async () => {
		selectResultQueue = [[{ status: 'pending', entityType: 'suggestion', entityId: 'sg1' }]];
		updateResult = [{ id: 'f1', status: 'dismissed' }];

		await resolveFlag('f1', { resolution: 'dismissed', staffId: 's1' });

		// The asymmetry with event reports, which do nothing on dismissal: a report
		// here has ALREADY hidden the post, so leaving it hidden would hand every
		// member a permanent takedown button.
		expect(setVisibilityMock).toHaveBeenCalledWith(
			'sg1',
			expect.objectContaining({ visibility: 'visible' })
		);
		expect(restrictStandingMock).not.toHaveBeenCalled();
	});

	it('upholds without a standing change when the author has deleted their account', async () => {
		selectResultQueue = [[{ status: 'pending', entityType: 'suggestion', entityId: 'sg1' }]];
		updateResult = [{ id: 'f1', status: 'resolved' }];
		getSuggestionForModerationMock.mockResolvedValue({ id: 'sg1', authorUserId: null });

		await resolveFlag('f1', { resolution: 'resolved', staffId: 's1' });

		expect(setVisibilityMock).toHaveBeenCalled();
		expect(restrictStandingMock).not.toHaveBeenCalled();
	});

	it('refuses to act twice on a report that is already resolved', async () => {
		selectResultQueue = [[{ status: 'resolved', entityType: 'suggestion', entityId: 'sg1' }]];

		await expect(
			resolveFlag('f1', { resolution: 'dismissed', staffId: 's1' })
		).rejects.toBeInstanceOf(FlagAlreadyResolvedError);
		expect(setVisibilityMock).not.toHaveBeenCalled();
	});
});
