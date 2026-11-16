import { describe, it, expect, vi, beforeEach } from 'vitest';

// Filing a staff conversation to an outside party (#2622): reading where it is
// filed needs inbox.read and contact.read, filing needs inbox.reply and
// contact.manage, and each guard runs before any service.

let held = new Set<string>();
vi.mock('#lib/server/authorization.js', () => ({
	requireUser: () => ({ id: 'staff-1' }),
	can: async (cap: string) => held.has(cap),
	requireCapability: async (cap: string) => {
		if (!held.has(cap)) throw new Error(`403: ${cap}`);
		return { id: 'staff-1' };
	},
	listUsersWithCapability: async () => []
}));

const filing = {
	threadFiling: vi.fn(async () => ({
		groupId: null as string | null,
		organizationId: null as string | null,
		contactId: null as string | null,
		contactEmail: 'priya@example.org'
	})),
	fileThread: vi.fn(async () => undefined)
};
vi.mock('#lib/server/party/thread-filing.js', () => filing);
const orgs = {
	getOrganization: vi.fn(async (id: string) => ({ id, name: 'Arts Council', roles: [] })),
	listOrganizations: vi.fn(async () => [{ id: 'o1', name: 'Arts Council' }])
};
vi.mock('#lib/server/party/organization-service.js', () => orgs);
const people = {
	findPersonByEmail: vi.fn(async () => ({
		id: 'p1',
		name: 'Priya',
		organizationId: 'o1',
		organizationName: 'Arts Council'
	})),
	getPerson: vi.fn(async (id: string) => ({ id, name: 'Priya', email: null }))
};
vi.mock('#lib/server/directory/contact-service.js', () => people);
vi.mock('./contacts.remote', () => ({
	getPartyTimeline: () => ({ refresh: () => undefined })
}));

// Everything else inbox.remote.ts pulls in at module scope.
vi.mock('#lib/server/inbox/thread-service.js', () => ({
	listThreads: vi.fn(),
	getThread: vi.fn(),
	assignThread: vi.fn(),
	updateStatus: vi.fn(),
	getUnresolvedCount: vi.fn(),
	countThreadsByStatus: vi.fn()
}));
vi.mock('#lib/server/inbox/message-service.js', () => ({
	addOutboundMessage: vi.fn(),
	addNote: vi.fn()
}));
vi.mock('#lib/server/inbox/channel-config-service.js', () => ({
	getAllChannelConfigs: vi.fn(),
	getEnabledChannels: vi.fn(),
	updateChannelConfig: vi.fn()
}));
vi.mock('#lib/server/inbox/inbound-handlers.js', () => ({ handleContactForm: vi.fn() }));
vi.mock('#lib/server/turnstile.js', () => ({ verifyTurnstile: vi.fn(async () => true) }));
vi.mock('#lib/server/notification/dispatcher.js', () => ({ dispatch: vi.fn() }));
vi.mock('#lib/server/reservation/timezone.js', () => ({ buildDateInTz: vi.fn() }));
vi.mock('#lib/remote/layout.remote.js', () => ({
	getStaffLayout: () => ({ refresh: () => undefined }),
	getMemberLayout: () => ({ refresh: () => undefined })
}));

vi.mock('$app/server', () => ({
	getRequestEvent: () => ({
		locals: { user: { id: 'staff-1' } },
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

const remote = (await import('./inbox.remote')) as unknown as Record<
	string,
	(...args: unknown[]) => Promise<unknown>
>;

beforeEach(() => {
	vi.clearAllMocks();
	held = new Set();
});

describe('getThreadFiling', () => {
	it('shows nothing to an inbox reader without contact.read', async () => {
		held = new Set(['inbox.read']);
		expect(await remote.getThreadFiling('t1')).toBeNull();
		expect(filing.threadFiling).not.toHaveBeenCalled();
	});

	it('suggests the person holding the address, and offers filing only with both writes', async () => {
		held = new Set(['inbox.read', 'contact.read']);
		const read = (await remote.getThreadFiling('t1')) as Record<string, unknown>;
		expect(read).toMatchObject({ filed: null, suggestion: { id: 'p1' }, canFile: false });
		expect(read.organizations).toEqual([]);

		held = new Set(['inbox.read', 'contact.read', 'contact.manage', 'inbox.reply']);
		const write = (await remote.getThreadFiling('t1')) as Record<string, unknown>;
		expect(write).toMatchObject({ canFile: true, organizations: [{ id: 'o1' }] });
	});

	it("leaves a band's conversation alone", async () => {
		held = new Set(['inbox.read', 'contact.read']);
		filing.threadFiling.mockResolvedValueOnce({
			groupId: 'band',
			organizationId: null,
			contactId: null,
			contactEmail: null
		} as never);
		expect(await remote.getThreadFiling('t1')).toBeNull();
	});
});

describe('fileThreadForm', () => {
	it('refuses without contact.manage before the service', async () => {
		held = new Set(['inbox.reply', 'contact.read']);
		await expect(
			remote.fileThreadForm({ threadId: 't1', organizationId: 'o1' }, {})
		).rejects.toThrow('403');
		expect(filing.fileThread).not.toHaveBeenCalled();
	});

	it('files to an organization, to a person, or to nothing', async () => {
		held = new Set(['inbox.read', 'inbox.reply', 'contact.read', 'contact.manage']);
		await remote.fileThreadForm({ threadId: 't1', organizationId: 'o1' }, {});
		await remote.fileThreadForm({ threadId: 't1', contactId: 'p1' }, {});
		await remote.fileThreadForm({ threadId: 't1' }, {});
		expect(filing.fileThread.mock.calls).toEqual([
			['t1', { type: 'organization', id: 'o1' }],
			['t1', { type: 'contact', id: 'p1' }],
			['t1', null]
		]);
	});
});
