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
	moveSlot: vi.fn(),
	removeSlot: vi.fn(),
	buildSlotsFromLineup: vi.fn()
};
vi.mock('$lib/server/production/run-of-show-service', () => ({
	addSlot: (...a: unknown[]) => runOfShow.addSlot(...a),
	updateSlot: (...a: unknown[]) => runOfShow.updateSlot(...a),
	moveSlot: (...a: unknown[]) => runOfShow.moveSlot(...a),
	removeSlot: (...a: unknown[]) => runOfShow.removeSlot(...a),
	buildSlotsFromLineup: (...a: unknown[]) => runOfShow.buildSlotsFromLineup(...a)
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

/** Every write in the module, with the capability it must name. */
const WRITES: { name: keyof typeof productions; args: unknown[] }[] = [
	{ name: 'createProduction', args: [{ eventId: 'evt-1' }] },
	{ name: 'updateProduction', args: [{ id: 'prod-1', eventId: 'evt-1' }] },
	{ name: 'setProductionProducer', args: [{ id: 'prod-1', eventId: 'evt-1', producer: 'me' }] },
	{ name: 'advanceProduction', args: [{ id: 'prod-1', eventId: 'evt-1', status: 'offered' }] },
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
	{ name: 'buildRunOfShowFromLineup', args: [{ eventId: 'evt-1', productionId: 'prod-1' }] }
];

beforeEach(() => {
	vi.clearAllMocks();
	requireCapability.mockRejectedValue(new Error('403: Staff access required'));
});

describe('productions.remote guards', () => {
	for (const { name, args } of WRITES) {
		it(`${name} requires event.manage before doing any work`, async () => {
			await expect(submit(productions[name], args[0])).rejects.toThrow('Staff access required');

			expect(requireCapability).toHaveBeenCalledWith('event.manage');
			for (const spy of Object.values({ ...service, ...runOfShow })) {
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
