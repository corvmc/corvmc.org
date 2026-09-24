import { describe, it, expect, vi, beforeEach } from 'vitest';

// The executable form of the appeal rules, in the register of flag-service.spec.ts:
// only the subject of an upheld report may appeal it, once; the staffer who
// upheld it may grant but never deny; effects land before the appeal is stamped.

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

let selectResultQueue: unknown[][] = [];
let insertResult: unknown[] = [];
let insertError: Error | null = null;
const inserted: { values: Record<string, unknown> }[] = [];
const updated: { set: Record<string, unknown> }[] = [];
/** Every side effect, in the order it happened. */
const calls: string[] = [];

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
			values: vi.fn((values: Record<string, unknown>) => {
				inserted.push({ values });
				return {
					returning: vi.fn(() =>
						insertError ? Promise.reject(insertError) : Promise.resolve(insertResult)
					)
				};
			})
		})),
		update: vi.fn(() => ({
			set: vi.fn((set: Record<string, unknown>) => {
				calls.push('stamp');
				updated.push({ set });
				return { where: vi.fn(() => Promise.resolve({ meta: { changes: 1 } })) };
			})
		}))
	}
}));

const emitMock = vi.fn().mockResolvedValue(undefined);
vi.mock('$lib/server/event-bus/event-bus', () => ({
	domainEvents: { emit: (...args: unknown[]) => emitMock(...args) }
}));
vi.mock('$lib/server/sentry', () => ({ captureException: vi.fn() }));

const restoreStandingMock = vi.fn(async () => {
	calls.push('restoreStanding');
});
vi.mock('$lib/server/moderation/standing-service', () => ({
	restoreStanding: (...args: unknown[]) => restoreStandingMock(...(args as []))
}));

const setVisibilityMock = vi.fn(async () => {
	calls.push('setVisibility');
});
vi.mock('$lib/server/suggestion/suggestion-service', () => ({
	setVisibility: (...args: unknown[]) => setVisibilityMock(...(args as []))
}));

// `publish` is the direct path; `submitForReview` is the standing-aware one a
// granted listing must NOT go through, or it lands in the review queue again.
const publishMock = vi.fn(async () => {
	calls.push('publish');
});
const submitMock = vi.fn();
vi.mock('$lib/server/event/event-service', () => ({
	publish: (...args: unknown[]) => publishMock(...(args as [])),
	submitCommunityEvent: submitMock
}));

const {
	fileAppeal,
	decideAppeal,
	reopenAppeal,
	AppealNotFoundError,
	AppealAlreadyFiledError,
	AppealAlreadyDecidedError,
	AppealNotDecidedError,
	SelfReviewError
} = await import('./appeal-service');

beforeEach(() => {
	selectResultQueue = [];
	insertResult = [];
	insertError = null;
	inserted.length = 0;
	updated.length = 0;
	calls.length = 0;
	emitMock.mockClear();
	restoreStandingMock.mockClear();
	setVisibilityMock.mockClear();
	publishMock.mockClear();
	submitMock.mockClear();
});

const FLAG = {
	id: 'f1',
	entityType: 'suggestion',
	entityId: 's1',
	origin: 'report',
	resolutionNotes: 'Off-topic',
	resolvedAt: new Date('2026-09-01'),
	resolvedByUserId: 'staff-a'
};

// ---------------------------------------------------------------------------
// fileAppeal
// ---------------------------------------------------------------------------

describe('fileAppeal', () => {
	const suggestionTarget = { kind: 'suggestion', suggestionId: 's1' } as const;

	it('404s on a suggestion the member did not write, so nobody can probe decisions', async () => {
		selectResultQueue = [[{ authorUserId: 'someone-else' }]];
		await expect(
			fileAppeal({ userId: 'm1', userName: 'Sam', target: suggestionTarget, body: 'Unfair' })
		).rejects.toThrow(AppealNotFoundError);
		expect(inserted).toHaveLength(0);
	});

	it('404s when nothing was upheld — a dismissed report cost nothing to contest', async () => {
		selectResultQueue = [[{ authorUserId: 'm1' }], []];
		await expect(
			fileAppeal({ userId: 'm1', userName: 'Sam', target: suggestionTarget, body: 'Unfair' })
		).rejects.toThrow(AppealNotFoundError);
		expect(inserted).toHaveLength(0);
	});

	it('files against the upheld flag the service found, never one the member named', async () => {
		selectResultQueue = [[{ authorUserId: 'm1' }], [FLAG], []];
		insertResult = [{ id: 'a1', flagId: 'f1' }];
		await fileAppeal({ userId: 'm1', userName: 'Sam', target: suggestionTarget, body: 'Unfair' });
		expect(inserted[0].values).toMatchObject({
			flagId: 'f1',
			appellantUserId: 'm1',
			body: 'Unfair'
		});
		expect(emitMock).toHaveBeenCalledWith(
			'moderation.appeal_filed',
			expect.objectContaining({ flagId: 'f1' })
		);
	});

	it('refuses a second appeal against the same decision', async () => {
		selectResultQueue = [[{ authorUserId: 'm1' }], [FLAG], [{ id: 'a1' }]];
		await expect(
			fileAppeal({ userId: 'm1', userName: 'Sam', target: suggestionTarget, body: 'Again' })
		).rejects.toThrow(AppealAlreadyFiledError);
		expect(inserted).toHaveLength(0);
	});

	it('maps the unique index losing a race to the same refusal', async () => {
		selectResultQueue = [[{ authorUserId: 'm1' }], [FLAG], []];
		insertError = new Error('D1_ERROR: UNIQUE constraint failed: moderation_appeal.flag_id');
		await expect(
			fileAppeal({ userId: 'm1', userName: 'Sam', target: suggestionTarget, body: 'Again' })
		).rejects.toThrow(AppealAlreadyFiledError);
	});

	it('appeals a standing through the report that caused it', async () => {
		selectResultQueue = [
			[{ status: 'restricted', triggeringFlagId: 'f9' }],
			[{ ...FLAG, id: 'f9' }],
			[]
		];
		insertResult = [{ id: 'a1', flagId: 'f9' }];
		await fileAppeal({
			userId: 'm1',
			userName: 'Sam',
			target: { kind: 'standing', scope: 'messaging' },
			body: 'I was replying'
		});
		expect(inserted[0].values).toMatchObject({ flagId: 'f9' });
	});

	it('has nothing to appeal on a standing that is already restored', async () => {
		selectResultQueue = [[{ status: 'none', triggeringFlagId: 'f9' }]];
		await expect(
			fileAppeal({
				userId: 'm1',
				userName: 'Sam',
				target: { kind: 'standing', scope: 'messaging' },
				body: 'x'
			})
		).rejects.toThrow(AppealNotFoundError);
	});

	it('only offers a listing appeal on a community listing the member posted', async () => {
		selectResultQueue = [[{ createdByUserId: 'm1', source: 'band' }]];
		await expect(
			fileAppeal({
				userId: 'm1',
				userName: 'Sam',
				target: { kind: 'listing', eventId: 'e1' },
				body: 'x'
			})
		).rejects.toThrow(AppealNotFoundError);
	});
});

// ---------------------------------------------------------------------------
// decideAppeal
// ---------------------------------------------------------------------------

const PENDING = { id: 'a1', flagId: 'f1', appellantUserId: 'm1', decidedAt: null };

/** appeal, flag, content state, standing rows, then the appellant for the email. */
function queueDecision(opts: {
	flag?: Partial<typeof FLAG>;
	content?: unknown[];
	standing?: unknown[];
}) {
	const flag = { ...FLAG, ...opts.flag };
	selectResultQueue = [
		[PENDING],
		[flag],
		opts.content ?? [{ visibility: 'hidden' }],
		opts.standing ?? [{ userId: 'm1', scope: 'suggestion' }],
		[{ name: 'Sam', email: 'sam@example.com' }]
	];
}

describe('decideAppeal', () => {
	it('refuses the staffer who upheld the report a denial, naming the rule', async () => {
		queueDecision({});
		await expect(
			decideAppeal({
				flagId: 'f1',
				staffId: 'staff-a',
				restoreContent: false,
				restoreStanding: false,
				notes: 'I stand by it'
			})
		).rejects.toThrow(SelfReviewError);
		expect(calls).toEqual([]);
	});

	it('lets the same staffer overturn themselves', async () => {
		queueDecision({});
		await decideAppeal({
			flagId: 'f1',
			staffId: 'staff-a',
			restoreContent: false,
			restoreStanding: true,
			notes: 'First offense'
		});
		expect(restoreStandingMock).toHaveBeenCalledWith({
			userId: 'm1',
			scope: 'suggestion',
			staffId: 'staff-a'
		});
		expect(updated[0].set).toMatchObject({
			contentOutcome: 'upheld',
			standingOutcome: 'restored'
		});
	});

	it('frees the appeal when the resolving account is gone', async () => {
		queueDecision({ flag: { resolvedByUserId: null as unknown as string } });
		await decideAppeal({
			flagId: 'f1',
			staffId: 'staff-b',
			restoreContent: false,
			restoreStanding: false,
			notes: 'Upheld'
		});
		expect(updated[0].set).toMatchObject({ contentOutcome: 'upheld', standingOutcome: 'upheld' });
	});

	it('does the effects first and stamps the appeal last', async () => {
		queueDecision({});
		await decideAppeal({
			flagId: 'f1',
			staffId: 'staff-b',
			restoreContent: true,
			restoreStanding: true,
			notes: 'Fair point'
		});
		expect(calls).toEqual(['restoreStanding', 'setVisibility', 'stamp']);
		expect(setVisibilityMock).toHaveBeenCalledWith(
			's1',
			expect.objectContaining({ visibility: 'visible', staffId: 'staff-b' })
		);
	});

	it('republishes a granted listing directly rather than through review', async () => {
		queueDecision({
			flag: { entityType: 'event', entityId: 'e1' },
			content: [{ status: 'draft', source: 'community' }],
			standing: [{ userId: 'm1', scope: 'community_event' }]
		});
		await decideAppeal({
			flagId: 'f1',
			staffId: 'staff-b',
			restoreContent: true,
			restoreStanding: false,
			notes: 'Fine to post'
		});
		expect(publishMock).toHaveBeenCalledWith('e1');
		expect(submitMock).not.toHaveBeenCalled();
		expect(updated[0].set).toMatchObject({ contentOutcome: 'restored', standingOutcome: 'upheld' });
	});

	it('records not_applicable for a takedown that never happened, whatever the form said', async () => {
		queueDecision({
			flag: { entityType: 'event', entityId: 'e1' },
			content: [{ status: 'published', source: 'community' }],
			standing: []
		});
		await decideAppeal({
			flagId: 'f1',
			staffId: 'staff-b',
			restoreContent: true,
			restoreStanding: true,
			notes: 'n/a'
		});
		expect(publishMock).not.toHaveBeenCalled();
		expect(restoreStandingMock).not.toHaveBeenCalled();
		expect(updated[0].set).toMatchObject({
			contentOutcome: 'not_applicable',
			standingOutcome: 'not_applicable'
		});
	});

	it('refuses to decide twice', async () => {
		selectResultQueue = [[{ ...PENDING, decidedAt: new Date() }]];
		await expect(
			decideAppeal({
				flagId: 'f1',
				staffId: 'staff-b',
				restoreContent: true,
				restoreStanding: true,
				notes: 'x'
			})
		).rejects.toThrow(AppealAlreadyDecidedError);
	});

	it('tells the member, with the notes', async () => {
		queueDecision({});
		await decideAppeal({
			flagId: 'f1',
			staffId: 'staff-b',
			restoreContent: false,
			restoreStanding: false,
			notes: 'Still off-topic'
		});
		expect(emitMock).toHaveBeenCalledWith(
			'moderation.appeal_decided',
			expect.objectContaining({
				appellantUserId: 'm1',
				verdict: 'denied',
				notes: 'Still off-topic'
			})
		);
	});
});

// ---------------------------------------------------------------------------
// reopenAppeal
// ---------------------------------------------------------------------------

describe('reopenAppeal', () => {
	it('returns a decided appeal to pending by clearing the decision', async () => {
		selectResultQueue = [[{ ...PENDING, decidedAt: new Date() }]];
		await reopenAppeal({ flagId: 'f1' });
		expect(updated[0].set).toEqual({
			decidedAt: null,
			decidedByUserId: null,
			contentOutcome: null,
			standingOutcome: null,
			decisionNotes: null
		});
	});

	it('refuses to reopen one that is still pending', async () => {
		selectResultQueue = [[PENDING]];
		await expect(reopenAppeal({ flagId: 'f1' })).rejects.toThrow(AppealNotDecidedError);
	});
});
