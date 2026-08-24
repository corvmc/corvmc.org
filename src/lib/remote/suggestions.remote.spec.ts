import { describe, it, expect, vi, beforeEach } from 'vitest';

// Remote functions are directly addressable endpoints: SvelteKit dispatches a
// remote call before any route load runs, so these are only as guarded as their
// own first line. There is no +layout.server.ts under /member or /staff to fall
// back on — and unlike every other recent feature, this one has no feature flag
// in front of it either. These guards are the whole access-control story, so
// every one of them is pinned here.

let currentUser: { id: string; name: string; email: string } | null = null;
let isStaff = false;

vi.mock('$lib/server/authorization', () => ({
	requireStaff: async () => {
		if (!currentUser) throw new Error('401: Not authenticated');
		if (!isStaff) throw new Error('403: Staff access required');
		return currentUser;
	},
	requireUser: () => {
		if (!currentUser) throw new Error('401: Not authenticated');
		return currentUser;
	}
}));

// Any service call on a rejected request is a failure — the guard has to run
// first, so these spies must stay clean.
const svc = {
	listSuggestions: vi.fn(async () => ({ rows: [], pagination: {} })),
	getSuggestion: vi.fn(async () => ({
		id: 's1',
		visibility: 'visible',
		authorUserId: 'other-member'
	})),
	listMergeCandidates: vi.fn(async () => []),
	createSuggestion: vi.fn(async () => ({ id: 's1', visibility: 'visible' })),
	toggleVote: vi.fn(async () => ({ voted: true, voteCount: 1 })),
	respondToSuggestion: vi.fn(async () => undefined),
	reviewSuggestion: vi.fn(async () => undefined),
	setVisibility: vi.fn(async () => undefined),
	mergeSuggestions: vi.fn(async () => ({ transferred: 0 })),
	getEditableState: vi.fn(async () => ({ canEdit: true, direct: true, pendingEditId: null })),
	editSuggestion: vi.fn(async () => ({ applied: true, editId: null })),
	cancelEditRequest: vi.fn(async () => undefined),
	reviewEdit: vi.fn(async () => undefined),
	getPendingEditFor: vi.fn(async () => null),
	getEditRequest: vi.fn(async () => null),
	listPendingEdits: vi.fn(async () => []),
	SuggestionNotFoundError: class extends Error {}
};
vi.mock('$lib/server/suggestion/suggestion-service', () => svc);

// Standing moved out of the domain services into one shared one. It stays a
// spy here for the same reason the others are: a guard that runs late would
// show up as a service call on a rejected request.
const standingSvc = {
	getStanding: vi.fn(async () => ({
		status: 'none' as const,
		reason: null,
		triggeringFlagId: null,
		updatedAt: null
	}))
};
vi.mock('$lib/server/moderation/standing-service', () => standingSvc);

const createFlag = vi.fn(async () => ({ id: 'f1' }));
vi.mock('$lib/server/flag/flag-service', () => ({
	createFlag: (...a: unknown[]) => createFlag(...(a as [])),
	FLAG_REASON_MAX: 100,
	FLAG_DESCRIPTION_MAX: 1000
}));

let rateLimitAllows = true;
vi.mock('$lib/server/rate-limit', () => ({
	allowRateLimited: async () => rateLimitAllows
}));

vi.mock('$lib/server/errors', () => ({
	mapDomainError: (e: unknown) => {
		throw e;
	}
}));

vi.mock('@sveltejs/kit', async (orig) => {
	const actual = (await orig()) as Record<string, unknown>;
	return {
		...actual,
		error: (status: number, message: unknown) => {
			throw new Error(`${status}: ${typeof message === 'string' ? message : ''}`);
		},
		invalid: (...issues: unknown[]) => {
			throw new Error(`invalid: ${JSON.stringify(issues)}`);
		}
	};
});

vi.mock('$app/server', () => ({
	getRequestEvent: () => ({
		locals: { user: currentUser },
		params: {},
		url: new URL('http://localhost/'),
		request: { headers: new Headers() }
	}),
	query: (...args: unknown[]) => {
		const handler = (typeof args[0] === 'function' ? args[0] : args[1]) as (
			...a: unknown[]
		) => Promise<unknown>;
		const wrapped = (...a: unknown[]) => {
			const promise = handler(...a) as Promise<unknown> & { refresh?: () => void };
			promise.refresh = () => undefined;
			return promise;
		};
		// SvelteKit validates every export of a .remote.ts at import time, so the
		// stubs have to carry the same marker the real helpers attach.
		(wrapped as unknown as Record<string, unknown>).__ = { type: 'query' };
		return wrapped;
	},
	form: (_schema: unknown, handler: (...a: unknown[]) => unknown) => {
		const fn = handler as unknown as Record<string, unknown>;
		fn.__ = { type: 'form' };
		fn.for = () => fn;
		return handler;
	},
	command: (...args: unknown[]) => {
		const handler = (typeof args[0] === 'function' ? args[0] : args[1]) as (
			...a: unknown[]
		) => unknown;
		(handler as unknown as Record<string, unknown>).__ = { type: 'command' };
		return handler;
	}
}));

// Hoisted: the module graph costs seconds to evaluate, and an in-test import
// races the default 5s testTimeout.
// Cast to a plain callable record: svelte-check resolves the real `RemoteForm`
// types, which aren't callable, while at runtime the $app/server mock above has
// made every export a plain function. Same treatment as
// community-events.remote.spec.ts.
const remote = (await import('./suggestions.remote')) as unknown as Record<
	string,
	(...args: unknown[]) => Promise<unknown>
>;

beforeEach(() => {
	currentUser = null;
	isStaff = false;
	rateLimitAllows = true;
	vi.clearAllMocks();
	svc.getSuggestion.mockResolvedValue({
		id: 's1',
		visibility: 'visible',
		authorUserId: 'other-member'
	});
});

const member = { id: 'm1', name: 'Ada', email: 'ada@example.com' };
const staff = { id: 'st1', name: 'Sam', email: 'sam@example.com' };

// Every member-facing endpoint, with the argument shape it really takes.
const memberEndpoints: Array<[string, () => Promise<unknown>]> = [
	['getSuggestionBoard', () => remote.getSuggestionBoard({ sort: 'top' })],
	['getSuggestionDetail', () => remote.getSuggestionDetail('s1')],
	['getMySuggestionStanding', () => remote.getMySuggestionStanding()],
	['createSuggestion', () => remote.createSuggestion({ title: 'T', body: 'B', category: 'other' })],
	['toggleSuggestionVote', () => remote.toggleSuggestionVote({ suggestionId: 's1' })],
	['flagSuggestion', () => remote.flagSuggestion({ suggestionId: 's1', reason: 'spam' }, {})]
];

const staffEndpoints: Array<[string, () => Promise<unknown>]> = [
	['getSuggestionsQueue', () => remote.getSuggestionsQueue({ sort: 'top' })],
	['getStaffSuggestionDetail', () => remote.getStaffSuggestionDetail('s1')],
	['getMergeCandidates', () => remote.getMergeCandidates('s1')],
	[
		'respondToSuggestion',
		() => remote.respondToSuggestion({ suggestionId: 's1', status: 'planned' })
	],
	['reviewSuggestion', () => remote.reviewSuggestion({ suggestionId: 's1', decision: 'approve' })],
	[
		'setSuggestionVisibility',
		() => remote.setSuggestionVisibility({ suggestionId: 's1', visibility: 'hidden' })
	],
	['mergeSuggestion', () => remote.mergeSuggestion({ sourceId: 's1', targetId: 's2' })],
	['getPendingSuggestionEdits', () => remote.getPendingSuggestionEdits()],
	['getSuggestionPendingEdit', () => remote.getSuggestionPendingEdit('s1')],
	[
		'reviewSuggestionEdit',
		() => remote.reviewSuggestionEdit({ suggestionId: 's1', editId: 'e1', decision: 'approve' })
	]
];

describe('signed-out callers', () => {
	it.each([...memberEndpoints, ...staffEndpoints])('%s rejects with 401', async (_name, call) => {
		await expect(call()).rejects.toThrow(/401/);
	});
});

describe('staff endpoints reject a plain member', () => {
	it.each(staffEndpoints)('%s rejects with 403', async (_name, call) => {
		currentUser = member;
		isStaff = false;
		await expect(call()).rejects.toThrow(/403/);
	});

	it('rejects before touching the database', async () => {
		currentUser = member;
		isStaff = false;
		await expect(remote.getSuggestionsQueue({ sort: 'top' })).rejects.toThrow(/403/);
		expect(svc.listSuggestions).not.toHaveBeenCalled();
	});
});

describe('the member board never leaks what is off it', () => {
	it('always asks for the signed-in member as the viewer', async () => {
		currentUser = member;
		await remote.getSuggestionBoard({ sort: 'top' });

		expect(svc.listSuggestions).toHaveBeenCalledWith(
			expect.anything(),
			expect.anything(),
			member.id
		);
	});

	it('drops a crafted visibility filter rather than honouring it', async () => {
		currentUser = member;
		// `visibility` and `includeMerged` are absent from the member schema, so a
		// hand-rolled request body cannot ask the board for hidden rows.
		await remote.getSuggestionBoard({
			sort: 'top',
			visibility: 'hidden',
			includeMerged: true
		});

		const filters = (svc.listSuggestions.mock.calls as unknown as unknown[][])[0][0] as Record<
			string,
			unknown
		>;
		expect(filters.visibility).toBeUndefined();
		expect(filters.includeMerged).toBeUndefined();
	});

	it('404s a withheld suggestion for anyone but its author', async () => {
		currentUser = member;
		svc.getSuggestion.mockResolvedValue({
			id: 's1',
			visibility: 'under_review',
			authorUserId: 'someone-else'
		});
		// 404 and not 403 on purpose: a 403 would confirm the suggestion exists,
		// which turns reporting into an enumeration oracle.
		await expect(remote.getSuggestionDetail('s1')).rejects.toThrow(/404/);
	});

	it('lets the author reach their own withheld suggestion', async () => {
		currentUser = member;
		svc.getSuggestion.mockResolvedValue({
			id: 's1',
			visibility: 'pending_review',
			authorUserId: member.id
		});
		await expect(remote.getSuggestionDetail('s1')).resolves.toMatchObject({ id: 's1' });
	});
});

describe('flagSuggestion', () => {
	it('files the report against the suggestion, attributed to the reporter', async () => {
		currentUser = member;
		await remote.flagSuggestion({ suggestionId: 's1', reason: 'spam' }, {} as never);

		expect(createFlag).toHaveBeenCalledWith(
			expect.objectContaining({
				entityType: 'suggestion',
				entityId: 's1',
				reportedByUserId: member.id
			})
		);
	});

	it('refuses once the member has reported too much, before writing anything', async () => {
		currentUser = member;
		rateLimitAllows = false;
		const issue = { reason: (m: string) => m };

		await expect(
			remote.flagSuggestion({ suggestionId: 's1', reason: 'spam' }, issue)
		).rejects.toThrow(/invalid/);
		expect(createFlag).not.toHaveBeenCalled();
	});
});

describe('staff endpoints accept staff', () => {
	it('merges and reports which suggestion to land on', async () => {
		currentUser = staff;
		isStaff = true;
		const result = await remote.mergeSuggestion({ sourceId: 's1', targetId: 's2' });

		expect(svc.mergeSuggestions).toHaveBeenCalledWith(
			expect.objectContaining({ sourceId: 's1', targetId: 's2', staffId: staff.id })
		);
		expect(result).toEqual({ targetId: 's2' });
	});

	it('attributes a response to the staff member who wrote it', async () => {
		currentUser = staff;
		isStaff = true;
		await remote.respondToSuggestion({
			suggestionId: 's1',
			status: 'planned',
			response: 'Good idea'
		});

		expect(svc.respondToSuggestion).toHaveBeenCalledWith(
			's1',
			expect.objectContaining({ status: 'planned', staffId: staff.id })
		);
	});
});

describe('editing', () => {
	it('never lets the caller choose whether an edit applies directly', async () => {
		currentUser = member;
		await remote.editSuggestion({
			suggestionId: 's1',
			title: 'T',
			body: 'B',
			category: 'other',
			// A hand-rolled request trying to force the direct-write path.
			direct: true,
			applied: true
		});

		// The service decides from the vote count; only the four real fields and
		// the caller's own id reach it.
		expect(svc.editSuggestion).toHaveBeenCalledWith('s1', {
			title: 'T',
			body: 'B',
			category: 'other',
			userId: member.id
		});
	});

	it('attributes an edit to the signed-in member, not to a supplied id', async () => {
		currentUser = member;
		await remote.editSuggestion({
			suggestionId: 's1',
			title: 'T',
			body: 'B',
			category: 'other',
			userId: 'someone-else'
		});

		expect(svc.editSuggestion).toHaveBeenCalledWith(
			's1',
			expect.objectContaining({ userId: member.id })
		);
	});

	it('cancels an edit as the signed-in member', async () => {
		currentUser = member;
		await remote.cancelSuggestionEdit({ suggestionId: 's1', editId: 'e1' });

		expect(svc.cancelEditRequest).toHaveBeenCalledWith('e1', member.id);
	});

	it('attributes a review to the staff member who made it', async () => {
		currentUser = staff;
		isStaff = true;
		await remote.reviewSuggestionEdit({
			suggestionId: 's1',
			editId: 'e1',
			decision: 'reject',
			notes: 'Changes the meaning'
		});

		expect(svc.reviewEdit).toHaveBeenCalledWith(
			'e1',
			expect.objectContaining({ decision: 'reject', staffId: staff.id })
		);
	});
});
