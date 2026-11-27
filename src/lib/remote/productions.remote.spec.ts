import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Who may do what on a show (docs/architecture/domain-model.md#ownership-is-a-roster-row),
 * as a matrix: every write, against Booking, Production, a committee on some
 * other show, the treasurer and staff. The committee guard is faked here from
 * the persona's grants; its resolution against the show's committees has its
 * own spec. What this file pins is which capability each write names, and that
 * the project is read off the record, never off the request.
 */

type Persona = 'booking' | 'production' | 'otherShow' | 'treasurer' | 'staff';
const SHOW = 'proj-show';

/** What each persona's committee grants on the show's project. */
const COMMITTEE_GRANTS: Record<Persona, string[]> = {
	booking: ['production.run', 'event.publish'],
	production: ['production.run'],
	otherShow: [],
	treasurer: [],
	staff: []
};
/** What each persona holds by position, everywhere. */
const POSITION_GRANTS: Record<Persona, string[]> = {
	booking: [],
	production: [],
	otherShow: [],
	treasurer: ['finance.refund'],
	staff: [
		'production.book',
		'production.run',
		'production.create',
		'finance.refund',
		'event.manage'
	]
};
/** What each persona's committee grants org-wide, with no record in hand (#1675, #2959). */
const ORG_GRANTS: Record<Persona, string[]> = {
	booking: ['production.create', 'production.book'],
	production: [],
	otherShow: [],
	treasurer: [],
	staff: []
};
const holds = (who: Persona, cap: string) =>
	POSITION_GRANTS[who].includes(cap) || ORG_GRANTS[who].includes(cap);
let persona: Persona = 'staff';

const denied = () => Object.assign(new Error('403: Not permitted'), { status: 403 });

const requireCapability = vi.fn(async (cap: string) => {
	if (!holds(persona, cap)) throw denied();
	return { id: `${persona}-1` };
});
vi.mock('#lib/server/authorization.js', () => ({
	requireCapability: (cap: string) => requireCapability(cap),
	// The listing guard asks these before it falls to the committee.
	can: async (cap: string) => holds(persona, cap),
	requireUser: () => ({ id: `${persona}-1` })
}));

const requireProjectCommittee = vi.fn(async (projectId: string | null, cap: string) => {
	if (projectId === SHOW && COMMITTEE_GRANTS[persona].includes(cap)) {
		return {
			user: { id: `${persona}-1` },
			groups: [{ id: persona, slug: persona }],
			via: 'committee'
		};
	}
	if (holds(persona, cap)) {
		return { user: { id: `${persona}-1` }, groups: [], via: 'staff' };
	}
	throw denied();
});
vi.mock('#lib/server/group/group-context.js', () => ({
	requireProjectCommittee: (projectId: string | null, cap: string) =>
		requireProjectCommittee(projectId, cap)
}));

/** Where each record lives. `slot-other` is on a show the committees are not part of. */
const scope = vi.hoisted(() => ({
	projectOfProduction: vi.fn(async (id: string) => (id === 'prod-1' ? 'proj-show' : 'proj-other')),
	projectOfSlot: vi.fn(async (id: string) => (id === 'slot-1' ? 'proj-show' : 'proj-other')),
	projectOfExpense: vi.fn(async () => 'proj-show'),
	projectOfEvent: vi.fn(async () => ({ projectId: 'proj-show', productionId: 'prod-1' })),
	projectOfArtifactRequest: vi.fn(async () => 'proj-show')
}));
vi.mock('#lib/server/production/production-scope.js', () => scope);

const service = {
	createProduction: vi.fn(),
	updateProductionDetails: vi.fn(),
	markShowTiming: vi.fn(),
	transitionProduction: vi.fn(async () => ({ moved: true, warnings: [] as string[] })),
	reopenProduction: vi.fn()
};
vi.mock('#lib/server/production/production-service.js', () => ({
	createProduction: (...a: unknown[]) => service.createProduction(...a),
	updateProductionDetails: (...a: unknown[]) => service.updateProductionDetails(...a),
	markShowTiming: (...a: unknown[]) => service.markShowTiming(...a),
	showStartsAt: async () => new Date('2026-11-06T03:00:00Z'),
	transitionProduction: (...a: unknown[]) => service.transitionProduction(...(a as [])),
	reopenProduction: (...a: unknown[]) => service.reopenProduction(...a)
}));

const listings = { create: vi.fn() };
vi.mock('#lib/server/event/event-service.js', () => ({
	create: (...a: unknown[]) => listings.create(...a)
}));

const attachable = { listAttachableListings: vi.fn(async () => [] as unknown[]) };
vi.mock('#lib/server/production/attachable-listings.js', () => ({
	listAttachableListings: () => attachable.listAttachableListings()
}));

const runOfShow = {
	addSlot: vi.fn(),
	updateSlot: vi.fn(),
	markSlotTiming: vi.fn(),
	moveSlot: vi.fn(),
	removeSlot: vi.fn(),
	setSlotTerms: vi.fn(),
	buildSlotsFromLineup: vi.fn()
};
const lineup = { addActToShow: vi.fn(), removeActFromShow: vi.fn() };
vi.mock('#lib/server/production/lineup-service.js', () => ({
	addActToShow: (...a: unknown[]) => lineup.addActToShow(...a),
	removeActFromShow: (...a: unknown[]) => lineup.removeActFromShow(...a)
}));
const outsideActs = { createExternalAct: vi.fn(async () => 'act-new') };
vi.mock('#lib/server/directory/entry-service.js', () => ({
	createExternalAct: (...a: unknown[]) => outsideActs.createExternalAct(...(a as []))
}));
const contacts = { addShowActContact: vi.fn() };
vi.mock('#lib/server/directory/contact-service.js', () => ({
	addShowActContact: (...a: unknown[]) => contacts.addShowActContact(...a)
}));
vi.mock('#lib/server/party/organization-service.js', () => ({
	performerFor: async () => 'org-new'
}));
vi.mock('#lib/server/production/host-service.js', () => ({
	openHostShift: vi.fn()
}));
vi.mock('#lib/server/production/run-of-show-service.js', () => ({
	addSlot: (...a: unknown[]) => runOfShow.addSlot(...a),
	updateSlot: (...a: unknown[]) => runOfShow.updateSlot(...a),
	markSlotTiming: (...a: unknown[]) => runOfShow.markSlotTiming(...a),
	moveSlot: (...a: unknown[]) => runOfShow.moveSlot(...a),
	removeSlot: (...a: unknown[]) => runOfShow.removeSlot(...a),
	setSlotTerms: (...a: unknown[]) => runOfShow.setSlotTerms(...a),
	buildSlotsFromLineup: (...a: unknown[]) => runOfShow.buildSlotsFromLineup(...a)
}));

const settlement = { recordSlotPayout: vi.fn(), undoSlotPayout: vi.fn(), recordPayouts: vi.fn() };
vi.mock('#lib/server/production/settlement-service.js', () => ({
	recordPayouts: (...a: unknown[]) => settlement.recordPayouts(...(a as [])),
	recordSlotPayout: (...a: unknown[]) => settlement.recordSlotPayout(...(a as [])),
	undoSlotPayout: (...a: unknown[]) => settlement.undoSlotPayout(...(a as []))
}));

const tillCounts = { recordStaffCount: vi.fn() };
vi.mock('#lib/server/production/till-count-service.js', () => ({
	recordStaffCount: (...a: unknown[]) => tillCounts.recordStaffCount(...a)
}));

const expenses = { addExpense: vi.fn(), removeExpense: vi.fn() };
vi.mock('#lib/server/production/expense-service.js', () => ({
	addExpense: (...a: unknown[]) => expenses.addExpense(...a),
	removeExpense: (...a: unknown[]) => expenses.removeExpense(...a)
}));

const artifacts = {
	requestArtifact: vi.fn(),
	cancelArtifactRequest: vi.fn(),
	promotePosterArt: vi.fn()
};
vi.mock('#lib/server/production/artifact-request-service.js', () => ({
	requestArtifact: (...a: unknown[]) => artifacts.requestArtifact(...a),
	cancelArtifactRequest: (...a: unknown[]) => artifacts.cancelArtifactRequest(...a),
	promotePosterArt: (...a: unknown[]) => artifacts.promotePosterArt(...a)
}));

const riderStock = { setRiderElementStock: vi.fn() };
vi.mock('#lib/server/production/rider-stock-service.js', () => ({
	setRiderElementStock: (...a: unknown[]) => riderStock.setRiderElementStock(...a)
}));

const flyers = { useTemplateFlyer: vi.fn(), useArtWithFooter: vi.fn() };
vi.mock('#lib/server/poster/flyer-service.js', () => ({
	useTemplateFlyer: (...a: unknown[]) => flyers.useTemplateFlyer(...a),
	useArtWithFooter: (...a: unknown[]) => flyers.useArtWithFooter(...a)
}));

const refresh = vi.fn();
vi.mock('./events.remote', () => ({
	getStaffEventPage: () => ({ refresh }),
	getStaffEventProduction: () => ({ refresh }),
	getStaffEvents: () => ({ refresh })
}));

vi.mock('./projects.remote', () => ({ getProjectDetail: () => ({ refresh: vi.fn() }) }));

// The house shape for a remote spec: `form()` applies its schema and calls the
// handler, so a payload the schema rejects never reaches the service — which is
// the half of the validation this file is asserting.
vi.mock('$app/server', () => ({
	getRequestEvent: () => ({
		locals: { user: { id: 'staff-1' } },
		request: { headers: new Headers() }
	}),
	query: (...args: unknown[]) => wrap(args),
	command: (...args: unknown[]) => wrap(args),
	form: (...args: unknown[]) => wrap(args)
}));

function wrap(args: unknown[]) {
	const schema = args.length > 1 ? (args[0] as { parse: (v: unknown) => unknown }) : null;
	const handler = (args.length > 1 ? args[1] : args[0]) as (data: unknown) => Promise<unknown>;
	const fn = (async (data: unknown) => {
		const parsed = schema && typeof schema.parse === 'function' ? schema.parse(data) : data;
		return handler(parsed);
	}) as Record<string, unknown> & ((data: unknown) => Promise<unknown>);
	fn.__ = { type: 'form' };
	fn.for = () => fn;
	return fn;
}

import * as productions from './productions.remote';

const SLOT = { eventId: 'evt-1', slotId: 'slot-1' };

/**
 * A `RemoteForm` is not callable at the type level, but the `$app/server` mock
 * above makes it a plain function at runtime. One cast, named, rather than one
 * per call site.
 */
const submit = (fn: unknown, data: unknown) => (fn as (d: unknown) => Promise<unknown>)(data);

/**
 * Every write in the module, with the half of the show it must name.
 * `positionOnly`: no committee on the show reaches it — no project exists yet,
 * or it is the treasurer's. An org-wide committee grant still can.
 */
type Write = {
	name: keyof typeof productions;
	args: unknown[];
	capability:
		| 'production.book'
		| 'production.run'
		| 'production.create'
		| 'production.reopen'
		| 'finance.refund';
	positionOnly?: boolean;
};
const BOOK = 'production.book' as const;
const RUN = 'production.run' as const;
const NEW_SHOW = {
	title: 'Friday Night',
	eventDate: '2026-11-06',
	eventStartTime: '19:00',
	eventEndTime: '23:00'
};
const WRITES: Write[] = [
	{
		name: 'createShow',
		args: [NEW_SHOW],
		capability: 'production.create',
		positionOnly: true
	},
	{
		name: 'createProduction',
		args: [{ eventId: 'evt-1' }],
		capability: 'production.create',
		positionOnly: true
	},
	// A read, but the picker for the write above, so it takes the same guard.
	{
		name: 'getAttachableListings',
		args: [undefined],
		capability: 'production.create',
		positionOnly: true
	},
	{
		name: 'updateProduction',
		args: [{ id: 'prod-1', eventId: 'evt-1' }],
		capability: RUN
	},
	{
		name: 'advanceProduction',
		args: [{ id: 'prod-1', eventId: 'evt-1', status: 'offered' }],
		capability: BOOK
	},
	{
		name: 'reopenProduction',
		args: [{ id: 'prod-1', eventId: 'evt-1', status: 'confirmed', reason: 'Door count was wrong' }],
		capability: 'production.reopen',
		positionOnly: true
	},
	{
		name: 'markSlotTiming',
		args: [{ slotId: 'slot-1', eventId: 'evt-1', edge: 'start', action: 'now' }],
		capability: RUN
	},
	{
		name: 'recordStaffCount',
		args: [{ id: 'prod-1', eventId: 'evt-1', doorCashCents: 12_000 }],
		capability: RUN
	},
	{ name: 'openHostShift', args: [{ eventId: 'evt-1' }], capability: RUN },
	// The lineup is the bill: confirming who plays is booking's, not production's.
	{
		name: 'addLineupAct',
		args: [{ eventId: 'evt-1', name: 'Moon Pie', setLengthMinutes: 30 }],
		capability: BOOK
	},
	{ name: 'removeLineupAct', args: [{ eventId: 'evt-1', slotId: 'slot-1' }], capability: BOOK },
	{
		name: 'setRunOfShowTime',
		args: [{ id: 'prod-1', eventId: 'evt-1', row: 'firstSet', time: '20:00' }],
		capability: RUN
	},
	{
		name: 'markRunOfShowDone',
		args: [{ id: 'prod-1', eventId: 'evt-1', row: 'doors', action: 'now' }],
		capability: RUN
	},
	{
		name: 'updateRunOfShowSlot',
		args: [{ ...SLOT, setLengthMinutes: 30 }],
		capability: RUN
	},
	{
		name: 'moveRunOfShowSlot',
		args: [{ ...SLOT, direction: 'up' }],
		capability: RUN
	},
	{ name: 'setRunOfShowTerms', args: [SLOT], capability: BOOK },
	{
		name: 'buildRunOfShowFromLineup',
		args: [{ eventId: 'evt-1', productionId: 'prod-1' }],
		capability: RUN
	},
	{
		name: 'askForArtifact',
		args: [{ eventId: 'evt-1', entryId: 'entry-1', artifact: 'tech_rider' }],
		capability: RUN
	},
	{
		name: 'dropArtifactRequest',
		args: [{ id: 'req-1', eventId: 'evt-1' }],
		capability: RUN
	},
	{
		name: 'setRiderStock',
		args: [{ eventId: 'evt-1', elementId: 'el-1', itemId: 'item-1' }],
		capability: RUN
	},
	{
		name: 'usePosterArt',
		args: [{ requestId: 'req-1', eventId: 'evt-1' }],
		capability: RUN
	},
	{
		name: 'usePosterArtWithFooter',
		args: [{ requestId: 'req-1', eventId: 'evt-1' }],
		capability: RUN
	},
	{
		name: 'useTemplateFlyerAsPoster',
		args: [{ eventId: 'evt-1' }],
		capability: RUN
	},
	{
		name: 'recordPayouts',
		args: [{ productionId: 'prod-1', payouts: [{ slotId: 'slot-1', amountCents: 1000 }] }],
		capability: 'finance.refund',
		positionOnly: true
	},
	{
		name: 'undoActPayout',
		args: [SLOT],
		capability: 'finance.refund',
		positionOnly: true
	},
	{
		name: 'addProductionExpense',
		args: [
			{
				eventId: 'evt-1',
				productionId: 'prod-1',
				label: 'Sound engineer',
				category: 'sound',
				amountCents: 15_000
			}
		],
		capability: RUN
	},
	{
		name: 'removeProductionExpense',
		args: [{ eventId: 'evt-1', expenseId: 'exp-1' }],
		capability: RUN
	}
];

const PERSONAS: Persona[] = ['booking', 'production', 'otherShow', 'treasurer', 'staff'];

function allowed(who: Persona, write: Write): boolean {
	if (holds(who, write.capability)) return true;
	return !write.positionOnly && COMMITTEE_GRANTS[who].includes(write.capability);
}

const allSpies = () =>
	Object.values({
		...service,
		...listings,
		...attachable,
		...runOfShow,
		...artifacts,
		...riderStock,
		...flyers,
		...settlement,
		...expenses,
		...tillCounts,
		...lineup,
		...outsideActs,
		...contacts
	});

beforeEach(() => {
	vi.clearAllMocks();
	persona = 'staff';
});

describe('the production matrix', () => {
	for (const write of WRITES) {
		for (const who of PERSONAS) {
			const ok = allowed(who, write);
			it(`${write.name}: ${who} is ${ok ? 'allowed' : 'refused'} (${write.capability})`, async () => {
				persona = who;
				const run = submit(productions[write.name], write.args[0]);
				if (ok) {
					// A refusal is the only failure this row is about.
					const outcome = await run.then(
						() => null,
						(err: { status?: number }) => err
					);
					expect(outcome?.status).not.toBe(403);
				} else {
					await expect(run).rejects.toMatchObject({ status: 403 });
					for (const spy of allSpies()) expect(spy).not.toHaveBeenCalled();
				}
			});
		}
	}

	it('lets Booking open a production, and refuses Production', async () => {
		persona = 'booking';
		service.createProduction.mockResolvedValueOnce({ id: 'prod-new' });
		await submit(productions.createProduction, { eventId: 'evt-1' });
		expect(requireCapability).toHaveBeenCalledWith('production.create');
		expect(service.createProduction).toHaveBeenCalledTimes(1);
		persona = 'production';
		await expect(submit(productions.createProduction, { eventId: 'evt-1' })).rejects.toMatchObject({
			status: 403
		});
		expect(service.createProduction).toHaveBeenCalledTimes(1);
	});

	it('lets production.create alone open a show, as a show, authored by the caller', async () => {
		persona = 'booking';
		listings.create.mockResolvedValueOnce({ id: 'evt-new' });
		await expect(submit(productions.createShow, NEW_SHOW)).resolves.toEqual({
			eventId: 'evt-new'
		});
		expect(requireCapability).toHaveBeenCalledWith('production.create');
		expect(requireCapability).not.toHaveBeenCalledWith('event.read');
		expect(requireCapability).not.toHaveBeenCalledWith('event.manage');
		expect(listings.create).toHaveBeenCalledWith(
			expect.objectContaining({
				title: 'Friday Night',
				kind: 'show',
				groupId: null,
				createdByUserId: 'booking-1',
				// The one create path that asks for the back-of-house (#1947).
				withProduction: true
			})
		);
		const [{ startsAt, endsAt }] = listings.create.mock.calls[0] as [
			{ startsAt: Date; endsAt: Date }
		];
		expect(endsAt.getTime() - startsAt.getTime()).toBe(4 * 60 * 60 * 1000);
	});

	it('offers the listings a production can attach to on production.create alone', async () => {
		persona = 'booking';
		const row = { id: 'evt-2', title: 'Saturday', startsAt: new Date('2026-11-07T03:00:00Z') };
		attachable.listAttachableListings.mockResolvedValueOnce([row]);
		await expect(submit(productions.getAttachableListings, undefined)).resolves.toEqual([row]);
		expect(requireCapability).toHaveBeenCalledWith('production.create');
	});

	it('refuses to open a show without production.create', async () => {
		for (const who of ['production', 'otherShow', 'treasurer'] as const) {
			persona = who;
			await expect(submit(productions.createShow, NEW_SHOW)).rejects.toMatchObject({
				status: 403
			});
		}
		expect(listings.create).not.toHaveBeenCalled();
	});

	// The Budget page posts no event, and may post a forged project beside the production.
	it('guards a cost added from the Budget page on the production’s project', async () => {
		persona = 'production';
		const line = { productionId: 'prod-1', label: 'PA', category: 'sound', amountCents: 500 };
		await submit(productions.addProductionExpense, { ...line, projectId: 'proj-other' });
		expect(requireProjectCommittee).toHaveBeenCalledWith('proj-show', 'production.run');
		expect(expenses.addExpense).toHaveBeenCalledOnce();
		expect(refresh).not.toHaveBeenCalled();
	});

	it('refuses a cost added to another show’s production from the Budget page', async () => {
		persona = 'production';
		const line = { productionId: 'prod-other', label: 'PA', category: 'sound', amountCents: 500 };
		await expect(submit(productions.addProductionExpense, line)).rejects.toMatchObject({
			status: 403
		});
		expect(expenses.addExpense).not.toHaveBeenCalled();
	});

	it('removes a cost from the Budget page, guarded by the line’s project', async () => {
		persona = 'production';
		await submit(productions.removeProductionExpense, { expenseId: 'exp-1' });
		expect(scope.projectOfExpense).toHaveBeenCalledWith('exp-1');
		expect(expenses.removeExpense).toHaveBeenCalledWith('exp-1');
	});

	describe('recordPayouts', () => {
		const line = (extra: Record<string, unknown> = {}) => ({
			productionId: 'prod-1',
			payouts: [{ slotId: 'slot-1', amountCents: 1000, ...extra }]
		});

		it('records a donated set as zero whatever the amount says', async () => {
			await submit(productions.recordPayouts, line({ donated: true, amountCents: 5000 }));
			expect(settlement.recordPayouts).toHaveBeenCalledWith(
				'prod-1',
				[{ slotId: 'slot-1', amountCents: 0 }],
				'staff-1'
			);
		});

		it('records the typed amount, for the production it names', async () => {
			await submit(productions.recordPayouts, line());
			expect(settlement.recordPayouts).toHaveBeenCalledWith(
				'prod-1',
				[{ slotId: 'slot-1', amountCents: 1000 }],
				'staff-1'
			);
		});

		it('refuses an act with no amount that is not donated, before any service call', async () => {
			await expect(
				submit(productions.recordPayouts, line({ amountCents: undefined }))
			).rejects.toBeDefined();
			expect(settlement.recordPayouts).not.toHaveBeenCalled();
		});

		it('refuses a negative amount', async () => {
			await expect(
				submit(productions.recordPayouts, line({ amountCents: -1 }))
			).rejects.toBeDefined();
			expect(settlement.recordPayouts).not.toHaveBeenCalled();
		});
	});

	it('refuses show work on a slot of a show the committee is not on', async () => {
		persona = 'production';
		await expect(
			submit(productions.updateRunOfShowSlot, {
				eventId: 'evt-1',
				slotId: 'slot-other',
				setLengthMinutes: 30
			})
		).rejects.toMatchObject({ status: 403 });
		expect(scope.projectOfSlot).toHaveBeenCalledWith('slot-other');
		expect(runOfShow.updateSlot).not.toHaveBeenCalled();
	});

	// The deal is org-wide (#2959): no show widens or narrows who may make it.
	it('lets Booking set the deal on any show, and refuses Production on its own', async () => {
		persona = 'booking';
		await submit(productions.setRunOfShowTerms, { eventId: 'evt-1', slotId: 'slot-other' });
		expect(runOfShow.setSlotTerms).toHaveBeenCalled();

		vi.clearAllMocks();
		persona = 'production';
		await expect(
			submit(productions.setRunOfShowTerms, { eventId: 'evt-1', slotId: 'slot-1' })
		).rejects.toMatchObject({ status: 403 });
		expect(runOfShow.setSlotTerms).not.toHaveBeenCalled();
	});

	it('reads the project off the slot, not off the eventId the form carries', async () => {
		persona = 'production';
		await submit(productions.updateRunOfShowSlot, { ...SLOT, setLengthMinutes: 30 });
		expect(scope.projectOfSlot).toHaveBeenCalledWith('slot-1');
		expect(scope.projectOfEvent).not.toHaveBeenCalled();
	});

	it('refuses a lineup build whose event does not announce the production', async () => {
		scope.projectOfEvent.mockResolvedValueOnce({
			projectId: SHOW,
			productionId: 'prod-9'
		});
		await expect(
			submit(productions.buildRunOfShowFromLineup, {
				eventId: 'evt-1',
				productionId: 'prod-1'
			})
		).rejects.toMatchObject({ status: 404 });
		expect(runOfShow.buildSlotsFromLineup).not.toHaveBeenCalled();
	});

	// The list above is hand-maintained, and a hand-maintained list of things to
	// guard is exactly what a new export slips past.
	it('lists every exported write', () => {
		const exported = Object.keys(productions).filter(
			(key) => typeof (productions as Record<string, unknown>)[key] === 'function'
		);
		const listed = new Set(WRITES.map((w) => w.name as string));
		expect(exported.filter((name) => !listed.has(name))).toEqual([]);
	});
});

describe('advancing a show', () => {
	it.each([
		['offered', 'booking', true],
		['confirmed', 'booking', true],
		['cancelled', 'booking', true],
		['completed', 'booking', true],
		['completed', 'production', true],
		['settled', 'production', true],
		['closed', 'production', true],
		['confirmed', 'production', false]
	] as const)('to %s: %s allowed is %s', async (status, who, ok) => {
		persona = who;
		const run = submit(productions.advanceProduction, {
			id: 'prod-1',
			eventId: 'evt-1',
			status
		});
		if (ok) {
			await run;
			expect(service.transitionProduction).toHaveBeenCalled();
		} else {
			await expect(run).rejects.toMatchObject({ status: 403 });
			expect(service.transitionProduction).not.toHaveBeenCalled();
		}
	});
});

describe('moving a show over its warnings', () => {
	it('hands the warnings back unmoved, so the dialog can show them', async () => {
		service.transitionProduction.mockResolvedValueOnce({
			moved: false,
			warnings: ['Skips confirmed.']
		} as never);
		await expect(
			submit(productions.advanceProduction, { id: 'prod-1', eventId: 'evt-1', status: 'settled' })
		).resolves.toEqual({ conflict: true, warnings: ['Skips confirmed.'] });
		expect(refresh).not.toHaveBeenCalled();
	});

	it('passes the acknowledgement and the reason through', async () => {
		await submit(productions.advanceProduction, {
			id: 'prod-1',
			eventId: 'evt-1',
			status: 'settled',
			acknowledged: true,
			reason: 'Entered late'
		});
		expect(service.transitionProduction).toHaveBeenCalledWith('prod-1', 'settled', {
			actorUserId: 'staff-1',
			acknowledged: true,
			reason: 'Entered late'
		});
	});
});

describe('reopening a show', () => {
	// Staff hold everything but the admin-only complement, and this is in it.
	it('is refused to staff, and reaches the service for an admin', async () => {
		await expect(
			submit(productions.reopenProduction, {
				id: 'prod-1',
				eventId: 'evt-1',
				status: 'confirmed',
				reason: 'x'
			})
		).rejects.toMatchObject({ status: 403 });

		requireCapability.mockResolvedValueOnce({ id: 'admin-1' });
		await submit(productions.reopenProduction, {
			id: 'prod-1',
			eventId: 'evt-1',
			status: 'confirmed',
			reason: 'Door count was wrong'
		});
		expect(requireCapability).toHaveBeenLastCalledWith('production.reopen');
		expect(service.reopenProduction).toHaveBeenCalledWith(
			'prod-1',
			'confirmed',
			'Door count was wrong'
		);
	});
});

describe('the details form is show work (#2959)', () => {
	const base = { id: 'prod-1', eventId: 'evt-1' };

	it.each([
		['production', { internalNotes: 'new' }],
		['booking', { changeoverMinutes: 20 }]
	] as const)('lets %s, on the show, change any field', async (who, fields) => {
		persona = who;
		await submit(productions.updateProduction, { ...base, ...fields });
		expect(service.updateProductionDetails).toHaveBeenCalled();
	});

	it('refuses a committee not on the show', async () => {
		persona = 'otherShow';
		await expect(
			submit(productions.updateProduction, { ...base, internalNotes: 'new' })
		).rejects.toMatchObject({ status: 403 });
		expect(service.updateProductionDetails).not.toHaveBeenCalled();
	});
});

describe('run of show validation', () => {
	// The CHECK makes a zero-length set unrepresentable, so the schema has to
	// refuse it before the service ever sees one.
	it('refuses a zero-length set before the service is called', async () => {
		await expect(
			submit(productions.addLineupAct, { eventId: 'evt-1', name: 'Moon Pie', setLengthMinutes: 0 })
		).rejects.toThrow();

		expect(lineup.addActToShow).not.toHaveBeenCalled();
	});

	it('adds an act by name alone without saving it as an outside act', async () => {
		await submit(productions.addLineupAct, {
			eventId: 'evt-1',
			name: 'Moon Pie',
			setLengthMinutes: 45
		});

		expect(outsideActs.createExternalAct).not.toHaveBeenCalled();
		expect(lineup.addActToShow).toHaveBeenCalledWith(
			'evt-1',
			'prod-1',
			{ name: 'Moon Pie', bandId: undefined, actId: undefined },
			45
		);
	});

	it('saves a new outside act with its contact, then adds it', async () => {
		await submit(productions.addLineupAct, {
			eventId: 'evt-1',
			name: 'Moon Pie',
			newAct: true,
			hometown: 'Eugene',
			email: 'moon@example.com',
			setLengthMinutes: 30
		});

		expect(outsideActs.createExternalAct).toHaveBeenCalledWith({
			name: 'Moon Pie',
			hometown: 'Eugene'
		});
		expect(contacts.addShowActContact).toHaveBeenCalledWith(
			'org-new',
			'proj-show',
			'moon@example.com'
		);
		expect(lineup.addActToShow).toHaveBeenCalledWith(
			'evt-1',
			'prod-1',
			{ name: 'Moon Pie', bandId: undefined, actId: 'act-new' },
			30
		);
	});

	it('refuses to remove an act without saying which', async () => {
		await expect(submit(productions.removeLineupAct, { eventId: 'evt-1' })).rejects.toMatchObject({
			status: 400
		});
		expect(lineup.removeActFromShow).not.toHaveBeenCalled();
	});

	// A cleared number field is dropped from the payload rather than sent as null,
	// so the missing key is what "no guarantee" has to mean.
	it('reads a missing guarantee as no guarantee rather than zero', async () => {
		await submit(productions.setRunOfShowTerms, { ...SLOT, percentageBps: 7000 });

		expect(runOfShow.setSlotTerms).toHaveBeenCalledWith('slot-1', {
			guaranteeCents: null,
			percentageBps: 7000,
			versus: false,
			againstNet: false,
			contributed: false
		});
	});

	it('refuses a percentage over 100%', async () => {
		await expect(
			submit(productions.setRunOfShowTerms, { ...SLOT, percentageBps: 10_001 })
		).rejects.toThrow();

		expect(runOfShow.setSlotTerms).not.toHaveBeenCalled();
	});

	// Zero and zero is a real deal — a donated set — and has to survive a schema
	// that could as easily have treated it as absent.
	it('keeps a guarantee of zero', async () => {
		await submit(productions.setRunOfShowTerms, {
			...SLOT,
			guaranteeCents: 0,
			percentageBps: 0,
			contributed: true
		});

		expect(runOfShow.setSlotTerms).toHaveBeenCalledWith(
			'slot-1',
			expect.objectContaining({ guaranteeCents: 0, percentageBps: 0, contributed: true })
		);
	});

	it('clears one row of the run of show with a blank time, leaving the others', async () => {
		await submit(productions.setRunOfShowTime, {
			id: 'prod-1',
			eventId: 'evt-1',
			row: 'curfew',
			time: ''
		});

		const [, patch] = service.updateProductionDetails.mock.calls[0] as [
			string,
			Record<string, unknown>
		];
		expect(patch.curfewAt).toBeNull();
		expect(patch.firstSetAt).toBeUndefined();
	});

	it('puts a small-hours time after midnight, on the morning after the show date', async () => {
		await submit(productions.setRunOfShowTime, {
			id: 'prod-1',
			eventId: 'evt-1',
			row: 'curfew',
			time: '00:30'
		});

		const [, patch] = service.updateProductionDetails.mock.calls[0] as [string, { curfewAt: Date }];
		expect(patch.curfewAt.getTime()).toBeGreaterThan(new Date('2026-11-06T03:00:00Z').getTime());
	});
});

describe('the staff count names the caller as the counter (#3273)', () => {
	it('passes the signed-in user, never a field, and an empty cash box clears the count', async () => {
		persona = 'production';
		await submit(productions.recordStaffCount, {
			id: 'prod-1',
			eventId: 'evt-1',
			doorCashCents: 500_00,
			countedByUserId: 'someone-else'
		});
		expect(tillCounts.recordStaffCount).toHaveBeenCalledWith('prod-1', 'production-1', {
			cashCents: 500_00,
			count: null,
			splitActsPercent: null
		});
		persona = 'staff';
		await submit(productions.recordStaffCount, { id: 'prod-1', eventId: 'evt-1' });
		expect(tillCounts.recordStaffCount).toHaveBeenLastCalledWith('prod-1', 'staff-1', {
			cashCents: null,
			count: null,
			splitActsPercent: null
		});
	});
});
