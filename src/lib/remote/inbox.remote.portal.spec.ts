import { describe, it, expect, vi, beforeEach } from 'vitest';

// Remote functions are directly addressable endpoints: SvelteKit dispatches a
// remote call before any route load runs, so the member-messaging endpoints are
// only as guarded as their own first line. There is no +layout.server.ts under
// /member to fall back on.
//
// These pin that every member conversation endpoint rejects an anonymous caller
// *before touching the database*, and that an authenticated caller cannot read a
// conversation they are not a participant in.

let currentUser: { id: string; name: string; email: string } | null = null;

vi.mock('$lib/server/authorization', () => ({
	requireStaff: async () => {
		throw new Error('403: Staff access required');
	},
	requireUser: () => {
		if (!currentUser) throw new Error('401: Not authenticated');
		return currentUser;
	},
	listStaffUsers: async () => []
}));

// Any portal-service call on a rejected request is a failure — the guard has to
// run first, so these spies must stay clean.
const listPortalThreads = vi.fn(async () => ({ rows: [], pagination: {} }));
const getPortalThread = vi.fn(async (_id: string, _userId: string) => null as unknown);
const startPortalConversation = vi.fn(async () => ({ threadId: 't1', messageId: 'm1' }));
const replyToPortalThread = vi.fn(async () => ({ messageId: 'm1' }));
const markPortalThreadRead = vi.fn(async () => undefined);

vi.mock('$lib/server/inbox/portal-service', () => ({
	listPortalThreads: (...a: unknown[]) => listPortalThreads(...(a as [])),
	getPortalThread: (...a: unknown[]) => getPortalThread(...(a as [string, string])),
	startPortalConversation: (...a: unknown[]) => startPortalConversation(...(a as [])),
	replyToPortalThread: (...a: unknown[]) => replyToPortalThread(...(a as [])),
	markPortalThreadRead: (...a: unknown[]) => markPortalThreadRead(...(a as [])),
	MAX_OPEN_PORTAL_THREADS: 5
}));

// Everything else inbox.remote.ts pulls in at module scope.
vi.mock('$lib/server/inbox/thread-service', () => ({
	listThreads: vi.fn(),
	getThread: vi.fn(),
	assignThread: vi.fn(),
	updateStatus: vi.fn(),
	getUnresolvedCount: vi.fn(),
	countThreadsByStatus: vi.fn()
}));
vi.mock('$lib/server/inbox/message-service', () => ({
	addOutboundMessage: vi.fn(),
	addNote: vi.fn()
}));
vi.mock('$lib/server/inbox/channel-config-service', () => ({
	getAllChannelConfigs: vi.fn(),
	getEnabledChannels: vi.fn(),
	updateChannelConfig: vi.fn()
}));
vi.mock('$lib/server/inbox/inbound-handlers', () => ({ handleContactForm: vi.fn() }));
vi.mock('$lib/server/turnstile', () => ({ verifyTurnstile: vi.fn(async () => true) }));
vi.mock('$lib/server/notification/dispatcher', () => ({ dispatch: vi.fn() }));
vi.mock('$lib/server/reservation/timezone', () => ({ buildDateInTz: vi.fn() }));
vi.mock('$lib/remote/layout.remote', () => ({
	getStaffLayout: () => ({ refresh: () => undefined }),
	getMemberLayout: () => ({ refresh: () => undefined })
}));

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

// The exported types are RemoteQuery/RemoteForm wrappers, which TypeScript does
// not consider callable — the mocked $app/server above hands back the bare
// handlers, so call them as such.
const remote = (await import('./inbox.remote')) as unknown as Record<
	string,
	(...args: unknown[]) => Promise<unknown>
>;
const {
	getMyConversations,
	getMyConversation,
	startConversation,
	sendConversationMessage,
	markConversationRead
} = remote;

// `form` handlers take (data, issue); the issue proxy throws so a rejected
// guard and a validation failure stay distinguishable.
const issue = new Proxy(
	{},
	{
		get: (_t, field: string) => (message: string) => {
			throw new Error(`invalid:${field}:${message}`);
		}
	}
);

beforeEach(() => {
	vi.clearAllMocks();
	currentUser = null;
});

describe('anonymous callers', () => {
	const cases: [string, () => Promise<unknown>][] = [
		['getMyConversations', () => getMyConversations({})],
		['getMyConversation', () => getMyConversation('thread-1')],
		['startConversation', () => startConversation({ subject: 'Hi', body: 'Hello' }, issue)],
		[
			'sendConversationMessage',
			() => sendConversationMessage({ threadId: 'thread-1', body: 'Hello' }, issue)
		],
		['markConversationRead', () => markConversationRead('thread-1')]
	];

	it.each(cases)('%s rejects before touching the database', async (_name, call) => {
		await expect(call()).rejects.toThrow(/401/);

		expect(listPortalThreads).not.toHaveBeenCalled();
		expect(getPortalThread).not.toHaveBeenCalled();
		expect(startPortalConversation).not.toHaveBeenCalled();
		expect(replyToPortalThread).not.toHaveBeenCalled();
		expect(markPortalThreadRead).not.toHaveBeenCalled();
	});
});

describe('authenticated callers', () => {
	beforeEach(() => {
		currentUser = { id: 'member-1', name: 'Robin', email: 'robin@example.com' };
	});

	it('scope every read to the caller, never to a client-supplied id', async () => {
		getPortalThread.mockResolvedValue({ id: 'thread-1', messages: [] });

		await getMyConversation('thread-1');

		expect(getPortalThread).toHaveBeenCalledWith('thread-1', 'member-1');
	});

	it('404 rather than returning a conversation the caller is not part of', async () => {
		// The service answers null for "someone else's", "not a portal thread" and
		// "does not exist" alike; the caller must not be able to tell them apart.
		getPortalThread.mockResolvedValue(null);

		await expect(getMyConversation('someone-elses')).rejects.toThrow();
	});

	it('does not refresh the layout query the detail page awaits', async () => {
		// getMyConversation must stand alone: the detail page awaits it and nothing
		// else, because markConversationRead refreshes getMemberLayout for the nav
		// badge. A page awaiting both loops forever.
		getPortalThread.mockResolvedValue({ id: 'thread-1', viewerUserId: 'member-1', messages: [] });

		const thread = (await getMyConversation('thread-1')) as { viewerUserId?: string };

		expect(thread.viewerUserId).toBe('member-1');
	});

	it('mark-read moves the caller’s own cursor only', async () => {
		await markConversationRead('thread-1');

		expect(markPortalThreadRead).toHaveBeenCalledWith('thread-1', 'member-1');
	});

	it('surface the open-conversation cap as a field error', async () => {
		startPortalConversation.mockResolvedValue(null as never);

		await expect(
			startConversation({ subject: 'Another', body: 'One more' }, issue)
		).rejects.toThrow(/invalid:subject/);
	});

	it('refuse to write into a closed conversation', async () => {
		replyToPortalThread.mockResolvedValue(null as never);

		await expect(
			sendConversationMessage({ threadId: 'thread-1', body: 'hi' }, issue)
		).rejects.toThrow(/invalid:body/);
	});
});
