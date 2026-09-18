import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Productions are guarded on the event capabilities, not a set of their own, so
 * "is it guarded" is not the interesting question — "which one" is. A write
 * handler that asked for `event.read` would hand every reader authority over
 * the running order the day staff is narrowed.
 */

const requireCapability = vi.fn<(cap: string) => Promise<unknown>>(async () => {
	throw new Error('403: Staff access required');
});
vi.mock('$lib/server/authorization', () => ({
	requireCapability: (...args: unknown[]) => requireCapability(...(args as [string]))
}));

const service = {
	createProduction: vi.fn(),
	updateProductionDetails: vi.fn(),
	transitionProduction: vi.fn()
};
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
	cancelArtifactRequest: vi.fn()
};
vi.mock('$lib/server/production/artifact-request-service', () => ({
	requestArtifact: (...a: unknown[]) => artifacts.requestArtifact(...a),
	cancelArtifactRequest: (...a: unknown[]) => artifacts.cancelArtifactRequest(...a)
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
 * Every write in the module, with the capability it must name.
 *
 * `capability` defaults to `event.manage`, which is the console's. Recording a
 * payout is the exception and says so: the rest of this page arranges a night,
 * that one moves money out of the till and writes the ledger.
 */
const WRITES: { name: keyof typeof productions; args: unknown[]; capability?: string }[] = [
	{ name: 'createProduction', args: [{ eventId: 'evt-1' }] },
	{ name: 'updateProduction', args: [{ id: 'prod-1', eventId: 'evt-1' }] },
	{ name: 'setProductionProducer', args: [{ id: 'prod-1', eventId: 'evt-1', producer: 'me' }] },
	{ name: 'advanceProduction', args: [{ id: 'prod-1', eventId: 'evt-1', status: 'offered' }] },
	{
		name: 'markSlotTiming',
		args: [{ slotId: 'slot-1', eventId: 'evt-1', edge: 'start', action: 'now' }]
	},
	{ name: 'recordDoorTake', args: [{ id: 'prod-1', eventId: 'evt-1', doorCashCents: 12_000 }] },
	{
		name: 'addRunOfShowSlot',
		args: [{ eventId: 'evt-1', productionId: 'prod-1', setLengthMinutes: 30 }]
	},
	{
		name: 'updateRunOfShowSlot',
		args: [{ ...SLOT, setLengthMinutes: 30, changeoverMinutes: 10 }]
	},
	{ name: 'moveRunOfShowSlot', args: [{ ...SLOT, direction: 'up' }] },
	{ name: 'removeRunOfShowSlot', args: [SLOT] },
	{ name: 'setRunOfShowTerms', args: [SLOT] },
	{ name: 'buildRunOfShowFromLineup', args: [{ eventId: 'evt-1', productionId: 'prod-1' }] },
	{
		name: 'askForArtifact',
		args: [{ eventId: 'evt-1', entryId: 'entry-1', artifact: 'tech_rider' }]
	},
	{ name: 'dropArtifactRequest', args: [{ id: 'req-1', eventId: 'evt-1' }] },
	{
		name: 'recordActPayout',
		args: [{ ...SLOT, amountCents: 1000 }],
		capability: 'finance.refund'
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
		]
	},
	{ name: 'removeProductionExpense', args: [{ eventId: 'evt-1', expenseId: 'exp-1' }] }
];

beforeEach(() => {
	vi.clearAllMocks();
	requireCapability.mockRejectedValue(new Error('403: Staff access required'));
});

describe('productions.remote guards', () => {
	for (const { name, args, capability = 'event.manage' } of WRITES) {
		it(`${name} requires ${capability} before doing any work`, async () => {
			await expect(submit(productions[name], args[0])).rejects.toThrow('Staff access required');

			expect(requireCapability).toHaveBeenCalledWith(capability);
			for (const spy of Object.values({
				...service,
				...runOfShow,
				...artifacts,
				...settlement,
				...expenses
			})) {
				expect(spy).not.toHaveBeenCalled();
			}
		});
	}

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

describe('run of show validation', () => {
	beforeEach(() => requireCapability.mockResolvedValue(undefined));

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
