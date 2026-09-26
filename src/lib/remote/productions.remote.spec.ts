import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Who may do what on a show (docs/specs/production-projects-spec.md), as a
 * matrix: every write, against Booking, Production, a committee on some other
 * show, the treasurer and staff. The committee guard is faked here from the
 * persona's grants; its resolution against `project_committee` has its own
 * spec. What this file pins is which half each write names, and that the
 * project is read off the record, never off the request.
 */

type Persona = 'booking' | 'production' | 'otherShow' | 'treasurer' | 'staff';
const SHOW = 'proj-show';

/** What each persona's committee grants on the show's project. */
const COMMITTEE_GRANTS: Record<Persona, string[]> = {
	booking: ['production.book', 'event.publish'],
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
	staff: ['production.book', 'production.run', 'finance.refund', 'event.manage']
};
let persona: Persona = 'staff';

const denied = () => Object.assign(new Error('403: Not permitted'), { status: 403 });

const requireCapability = vi.fn(async (cap: string) => {
	if (!POSITION_GRANTS[persona].includes(cap)) throw denied();
	return { id: `${persona}-1` };
});
vi.mock('$lib/server/authorization', () => ({
	requireCapability: (cap: string) => requireCapability(cap)
}));

const requireProjectCommittee = vi.fn(async (projectId: string | null, cap: string) => {
	if (projectId === SHOW && COMMITTEE_GRANTS[persona].includes(cap)) {
		return {
			user: { id: `${persona}-1` },
			groups: [{ id: persona, slug: persona }],
			via: 'committee'
		};
	}
	if (POSITION_GRANTS[persona].includes(cap)) {
		return { user: { id: `${persona}-1` }, groups: [], via: 'staff' };
	}
	throw denied();
});
vi.mock('$lib/server/group/group-context', () => ({
	requireProjectCommittee: (projectId: string | null, cap: string) =>
		requireProjectCommittee(projectId, cap)
}));

/** Where each record lives. `slot-other` is on a show the committees are not part of. */
const scope = vi.hoisted(() => ({
	projectOfProduction: vi.fn(async (id: string) => (id === 'prod-1' ? 'proj-show' : 'proj-other')),
	projectOfSlot: vi.fn(async (id: string) => (id === 'slot-1' ? 'proj-show' : 'proj-other')),
	projectOfExpense: vi.fn(async () => 'proj-show'),
	projectOfEvent: vi.fn(async () => ({ projectId: 'proj-show', productionId: 'prod-1' })),
	projectOfArtifactRequest: vi.fn(async () => 'proj-show'),
	currentProduction: vi.fn(async () => currentRow)
}));
vi.mock('$lib/server/production/production-scope', () => scope);

const service = {
	createProduction: vi.fn(),
	updateProductionDetails: vi.fn(),
	transitionProduction: vi.fn()
};
/** The stored row `updateProduction` compares a submission against. */
let currentRow: Record<string, unknown> = {};
vi.mock('$lib/server/production/production-service', () => ({
	createProduction: (...a: unknown[]) => service.createProduction(...a),
	updateProductionDetails: (...a: unknown[]) => service.updateProductionDetails(...a),
	transitionProduction: (...a: unknown[]) => service.transitionProduction(...a)
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
vi.mock('$lib/server/production/host-service', () => ({
	openHostShift: vi.fn()
}));
vi.mock('$lib/server/production/run-of-show-service', () => ({
	addSlot: (...a: unknown[]) => runOfShow.addSlot(...a),
	updateSlot: (...a: unknown[]) => runOfShow.updateSlot(...a),
	markSlotTiming: (...a: unknown[]) => runOfShow.markSlotTiming(...a),
	moveSlot: (...a: unknown[]) => runOfShow.moveSlot(...a),
	removeSlot: (...a: unknown[]) => runOfShow.removeSlot(...a),
	setSlotTerms: (...a: unknown[]) => runOfShow.setSlotTerms(...a),
	buildSlotsFromLineup: (...a: unknown[]) => runOfShow.buildSlotsFromLineup(...a)
}));

const settlement = { recordSlotPayout: vi.fn() };
vi.mock('$lib/server/production/settlement-service', () => ({
	recordSlotPayout: (...a: unknown[]) => settlement.recordSlotPayout(...(a as []))
}));

const expenses = { addExpense: vi.fn(), removeExpense: vi.fn() };
vi.mock('$lib/server/production/expense-service', () => ({
	addExpense: (...a: unknown[]) => expenses.addExpense(...a),
	removeExpense: (...a: unknown[]) => expenses.removeExpense(...a)
}));

const artifacts = {
	requestArtifact: vi.fn(),
	cancelArtifactRequest: vi.fn(),
	promotePosterArt: vi.fn()
};
vi.mock('$lib/server/production/artifact-request-service', () => ({
	requestArtifact: (...a: unknown[]) => artifacts.requestArtifact(...a),
	cancelArtifactRequest: (...a: unknown[]) => artifacts.cancelArtifactRequest(...a),
	promotePosterArt: (...a: unknown[]) => artifacts.promotePosterArt(...a)
}));

const flyers = { useTemplateFlyer: vi.fn(), useArtWithFooter: vi.fn() };
vi.mock('$lib/server/poster/flyer-service', () => ({
	useTemplateFlyer: (...a: unknown[]) => flyers.useTemplateFlyer(...a),
	useArtWithFooter: (...a: unknown[]) => flyers.useArtWithFooter(...a)
}));

const refresh = vi.fn();
vi.mock('./events.remote', () => ({
	getStaffEventPage: () => ({ refresh }),
	getStaffEventProduction: () => ({ refresh }),
	getStaffEvents: () => ({ refresh })
}));

// The house shape for a remote spec: `form()` applies its schema and calls the
// handler, so a payload the schema rejects never reaches the service — which is
// the half of the validation this file is asserting.
vi.mock('$app/server', () => ({
	getRequestEvent: () => ({
		locals: { user: { id: 'staff-1' } },
		request: { headers: new Headers() }
	}),
	query: () => {
		const stub = (() => ({ refresh: async () => undefined })) as unknown as Record<string, unknown>;
		stub.__ = { type: 'query' };
		return stub;
	},
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
 * `positionOnly`: no committee can reach it — no project exists yet, or it is
 * the treasurer's.
 */
type Write = {
	name: keyof typeof productions;
	args: unknown[];
	capability: 'production.book' | 'production.run' | 'finance.refund';
	positionOnly?: boolean;
};
const BOOK = 'production.book' as const;
const RUN = 'production.run' as const;
const WRITES: Write[] = [
	{
		name: 'createProduction',
		args: [{ eventId: 'evt-1' }],
		capability: BOOK,
		positionOnly: true
	},
	{
		name: 'updateProduction',
		args: [{ id: 'prod-1', eventId: 'evt-1' }],
		capability: RUN
	},
	{
		name: 'setProductionProducer',
		args: [{ id: 'prod-1', eventId: 'evt-1', producer: 'me' }],
		capability: RUN
	},
	{
		name: 'advanceProduction',
		args: [{ id: 'prod-1', eventId: 'evt-1', status: 'offered' }],
		capability: BOOK
	},
	{
		name: 'markSlotTiming',
		args: [{ slotId: 'slot-1', eventId: 'evt-1', edge: 'start', action: 'now' }],
		capability: RUN
	},
	{
		name: 'recordDoorTake',
		args: [{ id: 'prod-1', eventId: 'evt-1', doorCashCents: 12_000 }],
		capability: RUN
	},
	{ name: 'openHostShift', args: [{ eventId: 'evt-1' }], capability: RUN },
	{
		name: 'addRunOfShowSlot',
		args: [{ eventId: 'evt-1', productionId: 'prod-1', setLengthMinutes: 30 }],
		capability: RUN
	},
	{
		name: 'updateRunOfShowSlot',
		args: [{ ...SLOT, setLengthMinutes: 30, changeoverMinutes: 10 }],
		capability: RUN
	},
	{
		name: 'moveRunOfShowSlot',
		args: [{ ...SLOT, direction: 'up' }],
		capability: RUN
	},
	{ name: 'removeRunOfShowSlot', args: [SLOT], capability: RUN },
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
		name: 'usePosterArt',
		args: [{ requestId: 'req-1', eventId: 'evt-1' }],
		capability: BOOK
	},
	{
		name: 'usePosterArtWithFooter',
		args: [{ requestId: 'req-1', eventId: 'evt-1' }],
		capability: BOOK
	},
	{
		name: 'useTemplateFlyerAsPoster',
		args: [{ eventId: 'evt-1' }],
		capability: BOOK
	},
	{
		name: 'recordActPayout',
		args: [{ ...SLOT, amountCents: 1000 }],
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
	if (POSITION_GRANTS[who].includes(write.capability)) return true;
	return !write.positionOnly && COMMITTEE_GRANTS[who].includes(write.capability);
}

const allSpies = () =>
	Object.values({
		...service,
		...runOfShow,
		...artifacts,
		...flyers,
		...settlement,
		...expenses
	});

beforeEach(() => {
	vi.clearAllMocks();
	persona = 'staff';
	currentRow = {};
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

	it('refuses Booking on a slot of a show its committee is not part of', async () => {
		persona = 'booking';
		await expect(
			submit(productions.setRunOfShowTerms, {
				eventId: 'evt-1',
				slotId: 'slot-other'
			})
		).rejects.toMatchObject({ status: 403 });
		expect(scope.projectOfSlot).toHaveBeenCalledWith('slot-other');
		expect(runOfShow.setSlotTerms).not.toHaveBeenCalled();
	});

	it('reads the project off the slot, not off the eventId the form carries', async () => {
		persona = 'production';
		await submit(productions.removeRunOfShowSlot, SLOT);
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
		['completed', 'booking', false],
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

describe('the details form asks for the half that changed', () => {
	const base = { id: 'prod-1', eventId: 'evt-1' };

	it('lets Booking change the billing notes, and refuses Production', async () => {
		currentRow = { billingNotes: 'old' };
		persona = 'booking';
		await submit(productions.updateProduction, {
			...base,
			billingNotes: 'new'
		});
		expect(service.updateProductionDetails).toHaveBeenCalled();

		vi.clearAllMocks();
		persona = 'production';
		await expect(
			submit(productions.updateProduction, { ...base, billingNotes: 'new' })
		).rejects.toMatchObject({ status: 403 });
		expect(service.updateProductionDetails).not.toHaveBeenCalled();
	});

	it('lets Production move load-in, and refuses Booking', async () => {
		currentRow = { loadInAt: null };
		const moved = { ...base, loadInDate: '2031-04-17', loadInTime: '18:00' };
		persona = 'production';
		await submit(productions.updateProduction, moved);
		expect(service.updateProductionDetails).toHaveBeenCalled();

		vi.clearAllMocks();
		persona = 'booking';
		await expect(submit(productions.updateProduction, moved)).rejects.toMatchObject({
			status: 403
		});
	});

	it('does not count a field posted back unchanged', async () => {
		currentRow = { billingNotes: 'same', hospitalityNotes: 'rider' };
		persona = 'booking';
		await submit(productions.updateProduction, {
			...base,
			billingNotes: 'changed',
			hospitalityNotes: 'rider'
		});
		expect(service.updateProductionDetails).toHaveBeenCalled();
	});

	it('needs both halves when both change', async () => {
		currentRow = { billingNotes: 'a', hospitalityNotes: 'b' };
		const both = { ...base, billingNotes: 'x', hospitalityNotes: 'y' };
		persona = 'booking';
		await expect(submit(productions.updateProduction, both)).rejects.toMatchObject({
			status: 403
		});
		persona = 'staff';
		await submit(productions.updateProduction, both);
		expect(service.updateProductionDetails).toHaveBeenCalledTimes(1);
	});
});
describe('run of show validation', () => {
	// The CHECK makes a zero-length set unrepresentable, so the schema has to
	// refuse it before the service ever sees one.
	it('refuses a zero-length set before the service is called', async () => {
		await expect(
			submit(productions.addRunOfShowSlot, {
				eventId: 'evt-1',
				productionId: 'prod-1',
				setLengthMinutes: 0
			})
		).rejects.toThrow();

		expect(runOfShow.addSlot).not.toHaveBeenCalled();
	});

	it("passes a blank act through as a slot on nobody's poster", async () => {
		await submit(productions.addRunOfShowSlot, {
			eventId: 'evt-1',
			productionId: 'prod-1',
			eventBandId: '',
			setLengthMinutes: 45
		});

		expect(runOfShow.addSlot).toHaveBeenCalledWith(
			'prod-1',
			expect.objectContaining({ eventBandId: null, setLengthMinutes: 45 })
		);
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

	it('turns a blank note into null rather than an empty string', async () => {
		await submit(productions.updateRunOfShowSlot, {
			...SLOT,
			setLengthMinutes: 30,
			changeoverMinutes: 10,
			techNotes: '   '
		});

		expect(runOfShow.updateSlot).toHaveBeenCalledWith(
			'slot-1',
			expect.objectContaining({ techNotes: null, soundcheckAt: null })
		);
	});
});
