import { describe, it, expect, vi, beforeEach } from 'vitest';

// The Contacts screens' guards (#2622): writes need contact.manage, a role's
// own capability opens only that role's view, and people stay behind
// contact.read.

let held = new Set<string>();
const requireCapability = vi.fn(async (cap: string) => {
	if (!held.has(cap)) throw new Error(`403: ${cap}`);
	return { id: 'acting-staff' };
});
vi.mock('#lib/server/authorization.js', () => ({
	requireCapability: (cap: string) => requireCapability(cap),
	requireUser: async () => ({ id: 'acting-staff' }),
	can: async (cap: string) => held.has(cap)
}));
const recordAuditEntry = vi.hoisted(() => vi.fn());
vi.mock('#lib/server/audit/audit-service.js', () => ({ recordAuditEntry }));

const org = { id: 'o1', name: 'Arts Council', website: null, notes: null, archivedAt: null };
const orgs = {
	listOrganizations: vi.fn(async () => [{ ...org, roles: ['funder'] }]),
	getOrganization: vi.fn(async () => ({ ...org, directoryEntryId: null, roles: ['funder'] })),
	organizationRecords: vi.fn(async () => ({
		grants: [],
		sponsorships: [],
		jobs: [],
		orders: [],
		markets: [],
		bands: [],
		shows: [{ eventId: 'ev-1', title: 'Recital', terms: { guaranteeCents: 20000 } }]
	})),
	createOrganization: vi.fn(async () => ({ id: 'o2' })),
	updateOrganization: vi.fn(async () => undefined),
	setOrganizationArchived: vi.fn(async () => undefined),
	addRole: vi.fn(async () => undefined),
	removeRole: vi.fn(async () => false),
	listOrganizationMergeSuggestions: vi.fn(async () => []),
	mergeOrganizations: vi.fn(async () => ({ survivor: 'A', other: 'B' })),
	deleteUnusedOrganization: vi.fn(async () => true)
};
vi.mock('#lib/server/party/organization-service.js', () => orgs);

const people = {
	primaryContacts: vi.fn(async () => new Map([['o1', { id: 'c1', name: 'Priya' }]])),
	listPeople: vi.fn(async () => [{ id: 'c1', name: 'Priya' }]),
	createContact: vi.fn(async () => ({ id: 'c1', merged: false })),
	updateContact: vi.fn(async () => undefined),
	deleteContact: vi.fn(async () => undefined),
	moveOrganizationPeople: vi.fn(async () => undefined),
	listContactMergeSuggestions: vi.fn(async () => []),
	mergeContacts: vi.fn(async () => 'Priya'),
	getPerson: vi.fn(async (id: string) => ({ id, name: id === 'c2' ? 'Sam Okafor' : 'Priya' }))
};
vi.mock('#lib/server/directory/contact-service.js', () => people);
vi.mock('#lib/server/directory/contact-sheet-service.js', () => ({
	liveContactSheetLink: async () => ({ email: 'act@example.test', emailed: true })
}));
const list = {
	listContacts: vi.fn(async (input: { people: boolean }) => ({
		rows: [
			{
				type: 'organization',
				...org,
				roles: ['funder'],
				mainPerson: input.people ? 'Priya' : null,
				lastActivity: '2026-11-01',
				nextTask: { id: 'wo-1', title: 'Call them', dueAt: null }
			}
		],
		pagination: { page: 1, pageSize: 50, total: 1, totalPages: 1 }
	}))
};
vi.mock('#lib/server/party/contact-list.js', () => list);
const notes = {
	addActivity: vi.fn(async () => ({ id: 'n1' })),
	updateActivity: vi.fn(async () => ({ type: 'organization', id: 'o1' })),
	deleteActivity: vi.fn(async () => ({ type: 'organization', id: 'o1' }))
};
vi.mock('#lib/server/party/activity-service.js', () => notes);
const timeline = { partyTimeline: vi.fn(async () => ({ items: [], hasMore: false })) };
vi.mock('#lib/server/party/timeline.js', () => timeline);
const gifts = { recordInKindGift: vi.fn(async () => ({ giftId: 'g1' })) };
vi.mock('#lib/server/finance/in-kind-gift.js', () => gifts);
vi.mock('#lib/server/development/funding-project.js', () => ({
	listFundableProjects: vi.fn(async () => [])
}));
vi.mock('#lib/server/contractor/contractor-service.js', () => ({
	listLapsingInsurance: vi.fn(async () => [
		{ id: 'k1', name: 'Volt Electric', insuranceExpiresAt: new Date('2026-01-01') }
	])
}));
vi.mock('#lib/server/contractor/contractor-job-service.js', () => ({
	listOverdueJobs: vi.fn(async () => [{ id: 'j1' }, { id: 'j2' }])
}));

vi.mock('$app/server', () => ({
	getRequestEvent: () => ({ locals: {} }),
	query: (...args: unknown[]) => {
		const handler = (typeof args[0] === 'function' ? args[0] : args[1]) as (
			...a: unknown[]
		) => Promise<unknown>;
		const wrapped = (...a: unknown[]) => {
			const p = handler(...a) as Promise<unknown> & { refresh?: () => Promise<void> };
			p.refresh = async () => undefined;
			return p;
		};
		(wrapped as unknown as Record<string, unknown>).__ = { type: 'query' };
		return wrapped;
	},
	form: (_schema: unknown, handler: (data: unknown) => unknown) => {
		const wrapped = (data: unknown) => handler(data);
		(wrapped as unknown as Record<string, unknown>).for = () => wrapped;
		(wrapped as unknown as Record<string, unknown>).__ = { type: 'form' };
		return wrapped;
	},
	command: (h: unknown) => h
}));

const remote = (await import('./contacts.remote')) as unknown as Record<
	string,
	(arg?: unknown) => Promise<unknown>
>;

const WRITES: Array<{ name: string; arg: unknown; spy: ReturnType<typeof vi.fn> }> = [
	{
		name: 'createOrganization',
		arg: { name: 'Press Co', role: 'press' },
		spy: orgs.createOrganization
	},
	{ name: 'updateOrganization', arg: { id: 'o1', name: 'X' }, spy: orgs.updateOrganization },
	{
		name: 'archiveOrganization',
		arg: { id: 'o1', archived: true },
		spy: orgs.setOrganizationArchived
	},
	{ name: 'addOrganizationRole', arg: { id: 'o1', role: 'press' }, spy: orgs.addRole },
	{ name: 'deleteOrganization', arg: { id: 'o1' }, spy: orgs.deleteUnusedOrganization },
	{ name: 'removeOrganizationRole', arg: { id: 'o1', role: 'press' }, spy: orgs.removeRole },
	{ name: 'addPerson', arg: { organizationId: 'o1', name: 'Priya' }, spy: people.createContact },
	{
		name: 'updatePerson',
		arg: { id: 'c1', organizationId: 'o1', name: 'Priya' },
		spy: people.updateContact
	},
	{ name: 'removePerson', arg: { id: 'c1', organizationId: 'o1' }, spy: people.deleteContact },
	{ name: 'mergePeople', arg: { survivorId: 'c1', otherId: 'c2' }, spy: people.mergeContacts },
	{
		name: 'mergeOrganizations',
		arg: { survivorId: 'o1', otherId: 'o2' },
		spy: orgs.mergeOrganizations
	},
	{
		name: 'addActivityForm',
		arg: {
			partyType: 'organization',
			partyId: 'o1',
			kind: 'call',
			occurredOn: '2026-11-01',
			body: 'Rang'
		},
		spy: notes.addActivity
	},
	{
		name: 'updateActivityForm',
		arg: { id: 'n1', kind: 'call', occurredOn: '2026-11-01', body: 'Rang' },
		spy: notes.updateActivity
	},
	{ name: 'deleteActivityForm', arg: { id: 'n1' }, spy: notes.deleteActivity }
];

beforeEach(() => {
	vi.clearAllMocks();
	held = new Set();
});

describe('contacts.remote writes', () => {
	for (const { name, arg, spy } of WRITES) {
		it(`${name} refuses a caller without contact.manage before the service`, async () => {
			held = new Set(['contact.read', 'sponsor.manage', 'grant.manage']);
			await expect(remote[name](arg)).rejects.toThrow('403');
			expect(spy).not.toHaveBeenCalled();
		});

		it(`${name} reaches the service with contact.manage`, async () => {
			held = new Set(['contact.read', 'contact.manage']);
			await remote[name](arg);
			expect(spy).toHaveBeenCalled();
		});
	}

	// A deleted person's name is the only trace of them the log can keep (#2823).
	it('names the person a removal deleted', async () => {
		held = new Set(['contact.read', 'contact.manage']);
		await remote.removePerson({ id: 'c2', organizationId: 'o1' });
		expect(recordAuditEntry).toHaveBeenCalledWith(
			expect.objectContaining({
				action: 'contact.deleted',
				subject: { type: 'contact', id: 'c2', label: 'Sam Okafor' }
			})
		);
	});

	it('names the person a merge folded away', async () => {
		held = new Set(['contact.read', 'contact.manage']);
		await remote.mergePeople({ survivorId: 'c1', otherId: 'c2' });
		expect(recordAuditEntry).toHaveBeenCalledWith(
			expect.objectContaining({
				action: 'contact.merged',
				details: { mergedId: 'c2', mergedName: 'Sam Okafor' }
			})
		);
	});

	it('sends a contractor to the Contractors page, which asks for the trade', async () => {
		held = new Set(['contact.manage']);
		await expect(
			remote.createOrganization({ name: 'Amp Works', role: 'contractor' })
		).rejects.toMatchObject({ status: 422 });
		expect(orgs.createOrganization).not.toHaveBeenCalled();
	});
});

describe('recording an in-kind gift', () => {
	const gift = {
		partyType: 'organization',
		partyId: 'o1',
		description: 'Printed posters',
		valueCents: 12000,
		occurredOn: '2026-11-01'
	};

	it('refuses a caller without finance.refund, whatever contact powers they hold', async () => {
		held = new Set(['contact.read', 'contact.manage']);
		await expect(remote.recordGiftForm(gift)).rejects.toThrow('finance.refund');
		await expect(remote.getGiftProjects()).rejects.toThrow('finance.refund');
		expect(gifts.recordInKindGift).not.toHaveBeenCalled();
	});

	it('records it against the party for a finance holder', async () => {
		held = new Set(['contact.read', 'finance.refund']);
		await remote.recordGiftForm(gift);
		expect(gifts.recordInKindGift).toHaveBeenCalledWith(
			{ type: 'organization', id: 'o1' },
			expect.objectContaining({ valueCents: 12000, occurredOn: '2026-11-01' }),
			'acting-staff'
		);
	});

	it('records the gift in the audit log after it is written', async () => {
		held = new Set(['contact.read', 'finance.refund']);
		recordAuditEntry.mockClear();
		await remote.recordGiftForm(gift);
		expect(recordAuditEntry).toHaveBeenCalledWith({
			action: 'gift.recorded',
			subject: { type: 'organization', id: 'o1', label: 'Arts Council' },
			details: {
				giftId: 'g1',
				description: 'Printed posters',
				valueCents: 12000,
				occurredOn: '2026-11-01',
				projectId: null
			}
		});
		const written = gifts.recordInKindGift.mock.invocationCallOrder.at(-1)!;
		expect(recordAuditEntry.mock.invocationCallOrder[0]).toBeGreaterThan(written);
	});

	it('writes no audit row when the gift is refused', async () => {
		held = new Set(['contact.read', 'finance.refund']);
		recordAuditEntry.mockClear();
		gifts.recordInKindGift.mockRejectedValueOnce(new Error('refused'));
		await expect(remote.recordGiftForm(gift)).rejects.toThrow('refused');
		expect(recordAuditEntry).not.toHaveBeenCalled();
	});
});

describe('contacts.remote views', () => {
	type Page = {
		roles: string[];
		people: boolean;
		sort: string;
		rows: { mainPerson: unknown; lastActivity: unknown; nextTask: unknown }[];
	};
	const listed = () => list.listContacts.mock.calls.at(-1)?.[0] as Record<string, unknown>;

	it('lists a role-only viewer their own roles, without the people', async () => {
		held = new Set(['grant.read', 'sponsor.read']);
		const page = (await remote.getContactsPage({})) as Page;
		expect(page.roles).toEqual(['funder', 'sponsor']);
		expect(page.people).toBe(false);
		expect(listed()).toMatchObject({ visibleRoles: ['funder', 'sponsor'], people: false });
		expect(page.rows[0].mainPerson).toBeNull();
	});

	it('drops role filters outside the viewer’s roles', async () => {
		held = new Set(['grant.read']);
		await remote.getContactsPage({ roles: ['press', 'funder'] });
		expect(listed()).toMatchObject({ roles: ['funder'] });
	});

	it('refuses the page to a viewer with no role at all', async () => {
		held = new Set(['event.read']);
		await expect(remote.getContactsPage({})).rejects.toMatchObject({ status: 403 });
		expect(list.listContacts).not.toHaveBeenCalled();
	});

	it('gives contact.read every role, the people and the main person', async () => {
		held = new Set(['contact.read']);
		const page = (await remote.getContactsPage({ roles: ['press'] })) as Page;
		expect(listed()).toMatchObject({ visibleRoles: 'all', people: true, roles: ['press'] });
		expect(page.rows[0].mainPerson).toBe('Priya');
	});

	it('sorts only on a column the viewer may see', async () => {
		held = new Set(['grant.read']);
		expect(((await remote.getContactsPage({ sort: '-activity' })) as Page).sort).toBe('name');
		expect(((await remote.getContactsPage({ sort: 'task' })) as Page).sort).toBe('name');
		held = new Set(['contact.read', 'project.read']);
		expect(((await remote.getContactsPage({ sort: '-activity' })) as Page).sort).toBe('-activity');
		expect(((await remote.getContactsPage({ sort: 'task' })) as Page).sort).toBe('task');
		expect(listed()).toMatchObject({ sort: 'task' });
	});

	it('shows an organization page to its role’s capability, with the people withheld', async () => {
		held = new Set(['grant.read']);
		const page = (await remote.getOrganizationPage('o1')) as { people: unknown };
		expect(page.people).toBeNull();
		expect(people.listPeople).not.toHaveBeenCalled();
	});

	it('lists last activity to contact.read and the next task to project.read', async () => {
		held = new Set(['contact.read']);
		const staff = (await remote.getContactsPage({})) as Page;
		expect(staff.rows[0]).toMatchObject({ lastActivity: '2026-11-01', nextTask: null });
		held = new Set(['grant.read', 'project.read']);
		const funders = (await remote.getContactsPage({})) as Page;
		expect(funders.rows[0]).toMatchObject({ lastActivity: null, nextTask: { id: 'wo-1' } });
	});

	it("keeps a party's timeline behind contact.read and the organization's own guard", async () => {
		held = new Set(['grant.read']);
		await expect(remote.getPartyTimeline({ type: 'organization', id: 'o1' })).rejects.toThrow(
			'403'
		);
		held = new Set(['contact.read']);
		await remote.getPartyTimeline({ type: 'organization', id: 'o1' });
		expect(orgs.getOrganization).toHaveBeenCalledWith('o1');
		expect(timeline.partyTimeline).toHaveBeenCalledWith(
			{ type: 'organization', id: 'o1' },
			{ limit: undefined }
		);
	});

	// #2783: an act's shows carry its deal and pay, so they follow event.read.
	it("shows an act's shows and actions only to events staff", async () => {
		orgs.getOrganization.mockResolvedValue({
			...org,
			directoryEntryId: 'de-1',
			roles: ['performer']
		} as never);
		type ActPage = { records: { shows: unknown[] }; act: Record<string, unknown> | null };
		held = new Set(['contact.read']);
		const page = (await remote.getOrganizationPage('o1')) as ActPage;
		expect(page.records.shows).toEqual([]);
		expect(page.act).toEqual({
			entryId: 'de-1',
			canClaim: false,
			canSendContactSheet: false,
			sheetLink: null
		});

		held = new Set(['event.read', 'event.manage', 'directory.shareContactSheet']);
		const booker = (await remote.getOrganizationPage('o1')) as ActPage;
		expect(booker.records.shows).toHaveLength(1);
		expect(booker.act).toMatchObject({
			canClaim: true,
			canSendContactSheet: true,
			sheetLink: { email: 'act@example.test' }
		});
		orgs.getOrganization.mockReset();
		orgs.getOrganization.mockImplementation(async () => ({
			...org,
			directoryEntryId: null,
			roles: ['funder']
		}));
	});

	// #2764: the old grant, sponsor and contractor pages each had their own
	// capability; folded into one page, each section keeps it.
	it("keeps each role's records behind that role's capability", async () => {
		orgs.organizationRecords.mockResolvedValueOnce({
			grants: [{ id: 'g1' }],
			sponsorships: [{ id: 's1' }],
			jobs: [{ id: 'j1' }],
			orders: [],
			markets: [],
			bands: [],
			shows: []
		} as never);
		held = new Set(['contact.read']);
		const page = (await remote.getOrganizationPage('o1')) as {
			records: Record<string, unknown[]>;
			sections: Record<string, boolean>;
		};
		expect([page.records.grants, page.records.sponsorships, page.records.jobs]).toEqual([
			[],
			[],
			[]
		]);
		expect(page.sections).toEqual({
			grant: false,
			contractor: false,
			manageContractor: false,
			sponsor: false
		});

		held = new Set(['grant.read']);
		const funderPage = (await remote.getOrganizationPage('o1')) as {
			records: Record<string, unknown[]>;
			sections: Record<string, boolean>;
		};
		expect(funderPage.sections.grant).toBe(true);
	});

	it('refuses to delete an organization still in use', async () => {
		held = new Set(['contact.manage']);
		orgs.deleteUnusedOrganization.mockResolvedValueOnce(false);
		await expect(remote.deleteOrganization({ id: 'o1' })).rejects.toMatchObject({
			status: 409
		});
	});

	it('gives the contractor view its warnings, and only to contractor.read', async () => {
		held = new Set(['contractor.read']);
		const view = (await remote.getContactsPage({ roles: ['contractor'] })) as {
			contractorWarnings: { overdue: number; lapsing: { id: string }[] } | null;
		};
		expect(view.contractorWarnings).toMatchObject({ overdue: 2, lapsing: [{ id: 'k1' }] });

		held = new Set(['contact.read']);
		const other = (await remote.getContactsPage({ roles: ['contractor'] })) as {
			contractorWarnings: unknown;
		};
		expect(other.contractorWarnings).toBeNull();
	});

	it('refuses an organization page to a viewer with none of its roles', async () => {
		held = new Set(['sponsor.read']);
		await expect(remote.getOrganizationPage('o1')).rejects.toMatchObject({ status: 403 });
	});
});
