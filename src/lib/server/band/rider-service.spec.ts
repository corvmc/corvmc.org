import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * The tech rider.
 *
 * Three things are worth pinning, and they are the three a reader cannot check
 * by eye:
 *
 * - **Channel order comes from `kind`, not from `sortOrder`.** A drum kit
 *   somebody entered last is still channel one. This is the rule that lets two
 *   members edit their own corners without either renumbering the other, so a
 *   regression here is silent until an engineer is standing at a desk.
 * - **A member's save cannot reach another member's rows.** `saveOwnElements`
 *   takes no owner argument; the scoping is structural, and this asserts it
 *   stays that way.
 * - **Submitted order is ignored.** `sortOrder` is re-derived from array
 *   position, so a client cannot post a position at all.
 */

let selectResults: unknown[][] = [];
let inserts: { table: unknown; values: unknown }[] = [];
let deletes: unknown[] = [];
let updates: Record<string, unknown>[] = [];

function chain(queue: () => unknown[]): unknown {
	const proxy: unknown = new Proxy(() => proxy, {
		get(_, prop) {
			if (prop === 'then') {
				return (resolve: (v: unknown[]) => void) => resolve(queue());
			}
			return () => proxy;
		}
	});
	return proxy;
}

const next = () => (selectResults.length > 0 ? selectResults.shift()! : []);

vi.mock('$lib/server/db', () => ({
	db: {
		select: vi.fn(() => chain(next)),
		insert: vi.fn((table: unknown) => ({
			values: (values: unknown) => {
				inserts.push({ table, values });
				return chain(() => [{ id: 'rider-1' }]);
			}
		})),
		update: vi.fn(() => ({
			set: (values: Record<string, unknown>) => {
				updates.push(values);
				return chain(() => []);
			}
		})),
		delete: vi.fn((table: unknown) => ({
			where: (condition: unknown) => {
				deletes.push({ table, condition });
				return chain(() => []);
			}
		}))
	}
}));

const { riderElement, riderInput } = await import('$lib/server/db/schema/rider');
const {
	numberChannels,
	compareElements,
	getRider,
	saveOwnElements,
	saveElementsFor,
	savePlacements,
	clampCoord,
	RiderTooLargeError,
	RiderNotPlaceableError
} = await import('./rider-service');
const { RIDER_MAX_ELEMENTS, RIDER_MAX_INPUTS_PER_ELEMENT } = await import('$lib/config');

type Element = Parameters<typeof numberChannels>[0][number];

const el = (over: Partial<Element> = {}): Element => ({
	id: 'e-1',
	userId: null,
	ownerName: null,
	x: null,
	y: null,
	kind: 'vocals',
	label: 'Vocal',
	providedBy: 'band',
	notes: null,
	sortOrder: 0,
	inputs: [],
	...over
});

const input = (label: string) => ({
	id: `i-${label}`,
	channel: 0,
	label,
	source: 'mic' as const,
	micPref: null,
	phantom: false,
	stand: 'none' as const,
	monitorMixUserId: null,
	notes: null
});

beforeEach(() => {
	selectResults = [];
	inserts = [];
	deletes = [];
	updates = [];
});

describe('numberChannels', () => {
	it('numbers by kind, not by the order rows were entered', () => {
		// The singer filled their corner in first and the drummer last. The
		// engineer still reads the kit first.
		const numbered = numberChannels([
			el({ id: 'vox', kind: 'vocals', label: 'Lead vocal', sortOrder: 0, inputs: [input('Vox')] }),
			el({
				id: 'kit',
				kind: 'drum_kit',
				label: "Sam's kit",
				sortOrder: 9,
				inputs: [input('Kick'), input('Snare')]
			})
		]);

		expect(numbered.map((e) => e.id)).toEqual(['kit', 'vox']);
		expect(numbered.flatMap((e) => e.inputs.map((i) => [i.label, i.channel]))).toEqual([
			['Kick', 1],
			['Snare', 2],
			['Vox', 3]
		]);
	});

	it('runs one sequence across elements rather than restarting per element', () => {
		const numbered = numberChannels([
			el({ id: 'a', kind: 'drum_kit', inputs: [input('Kick'), input('Snare')] }),
			el({ id: 'b', kind: 'bass_rig', inputs: [input('Bass DI')] })
		]);

		expect(numbered.flatMap((e) => e.inputs.map((i) => i.channel))).toEqual([1, 2, 3]);
	});

	it('gives a monitor no channel — it is on the stage, not on the desk', () => {
		const numbered = numberChannels([
			el({ id: 'wedge', kind: 'monitor', label: 'Sam wedge', inputs: [] }),
			el({ id: 'vox', kind: 'vocals', inputs: [input('Vox')] })
		]);

		expect(numbered.find((e) => e.id === 'wedge')!.inputs).toEqual([]);
		expect(numbered.find((e) => e.id === 'vox')!.inputs[0].channel).toBe(1);
	});

	it('does not mutate what it was handed', () => {
		const original = [el({ id: 'a', kind: 'vocals', inputs: [input('Vox')] })];
		numberChannels(original);
		expect(original[0].inputs[0].channel).toBe(0);
	});
});

describe('compareElements', () => {
	it('breaks a tie inside one kind by label', () => {
		const a = { kind: 'guitar_amp' as const, sortOrder: 0, label: 'Guitar 2' };
		const b = { kind: 'guitar_amp' as const, sortOrder: 0, label: 'Guitar 1' };
		expect(compareElements(a, b)).toBeGreaterThan(0);
	});

	it('prefers the owner’s own ordering over the label', () => {
		const a = { kind: 'guitar_amp' as const, sortOrder: 0, label: 'Zeta' };
		const b = { kind: 'guitar_amp' as const, sortOrder: 1, label: 'Alpha' };
		expect(compareElements(a, b)).toBeLessThan(0);
	});
});

describe('getRider', () => {
	it('reports an unstarted rider without creating one', async () => {
		selectResults = [[]];

		const view = await getRider('band-1');

		expect(view.id).toBeNull();
		expect(view.elements).toEqual([]);
		expect(view.channelCount).toBe(0);
		expect(inserts).toHaveLength(0);
	});

	it('counts channels, phantom and what the band needs from CMC', async () => {
		selectResults = [
			[{ id: 'rider-1', groupId: 'band-1', techContactUserId: null, monitorFormat: null }],
			[
				{
					id: 'kit',
					userId: 'u-1',
					ownerName: 'Sam',
					kind: 'drum_kit',
					label: 'Kit',
					providedBy: 'band',
					notes: null,
					sortOrder: 0
				},
				{
					id: 'amp',
					userId: 'u-2',
					ownerName: 'Ali',
					kind: 'bass_rig',
					label: 'Bass rig',
					providedBy: 'venue',
					notes: null,
					sortOrder: 0
				}
			],
			[
				{
					id: 'i1',
					elementId: 'kit',
					label: 'Kick',
					source: 'mic',
					micPref: null,
					phantom: false,
					stand: 'clip',
					monitorMixUserId: null,
					notes: null,
					sortOrder: 0
				},
				{
					id: 'i2',
					elementId: 'kit',
					label: 'Overheads',
					source: 'mic',
					micPref: null,
					phantom: true,
					stand: 'tall_boom',
					monitorMixUserId: null,
					notes: null,
					sortOrder: 1
				},
				{
					id: 'i3',
					elementId: 'amp',
					label: 'Bass DI',
					source: 'di',
					micPref: null,
					phantom: true,
					stand: 'none',
					monitorMixUserId: null,
					notes: null,
					sortOrder: 0
				}
			]
		];

		const view = await getRider('band-1');

		expect(view.channelCount).toBe(3);
		expect(view.phantomCount).toBe(2);
		expect(view.venueProvidedCount).toBe(1);
		expect(view.elements[0].inputs.map((i) => i.channel)).toEqual([1, 2]);
	});
});

describe('saveOwnElements', () => {
	it('writes every row against the caller, and re-derives the order', async () => {
		selectResults = [
			[{ id: 'rider-1', groupId: 'band-1' }], // findRider
			[] // the caller had no rows yet
		];

		await saveOwnElements('band-1', 'u-1', [
			{ kind: 'vocals', label: 'Lead vocal', inputs: [{ label: 'Vox', source: 'mic' }] },
			{ kind: 'guitar_amp', label: 'Deluxe', inputs: [] }
		]);

		const elementInsert = inserts.find((i) => i.table === riderElement);
		const rows = elementInsert!.values as { userId: string; sortOrder: number; label: string }[];

		expect(rows.map((r) => r.userId)).toEqual(['u-1', 'u-1']);
		expect(rows.map((r) => r.sortOrder)).toEqual([0, 1]);
		expect(rows.map((r) => r.label)).toEqual(['Lead vocal', 'Deluxe']);
	});

	it('hangs inputs off the element they arrived with', async () => {
		selectResults = [[{ id: 'rider-1', groupId: 'band-1' }], []];

		await saveOwnElements('band-1', 'u-1', [
			{ kind: 'drum_kit', label: 'Kit', inputs: [{ label: 'Kick', source: 'mic' }] },
			{ kind: 'vocals', label: 'Vocal', inputs: [{ label: 'Vox', source: 'mic' }] }
		]);

		const elementRows = inserts.find((i) => i.table === riderElement)!.values as { id: string }[];
		const inputRows = inserts.find((i) => i.table === riderInput)!.values as {
			elementId: string;
			label: string;
		}[];

		expect(inputRows.find((r) => r.label === 'Kick')!.elementId).toBe(elementRows[0].id);
		expect(inputRows.find((r) => r.label === 'Vox')!.elementId).toBe(elementRows[1].id);
	});

	it('refuses a payload larger than a real band', async () => {
		const tooMany = Array.from({ length: RIDER_MAX_ELEMENTS + 1 }, () => ({
			kind: 'other' as const,
			label: 'Thing'
		}));

		await expect(saveOwnElements('band-1', 'u-1', tooMany)).rejects.toThrow(RiderTooLargeError);
		expect(inserts).toHaveLength(0);
	});

	it('refuses an element carrying more inputs than a console channel strip', async () => {
		const overloaded = [
			{
				kind: 'drum_kit' as const,
				label: 'Kit',
				inputs: Array.from({ length: RIDER_MAX_INPUTS_PER_ELEMENT + 1 }, (_, i) => ({
					label: `Mic ${i}`,
					source: 'mic' as const
				}))
			}
		];

		await expect(saveOwnElements('band-1', 'u-1', overloaded)).rejects.toThrow(RiderTooLargeError);
	});
});

describe('saveElementsFor', () => {
	it('refuses a target who is not on the roster', async () => {
		selectResults = [[]]; // the roster lookup finds nobody

		await expect(
			saveElementsFor('band-1', 'stranger', [{ kind: 'other', label: 'Amp' }])
		).rejects.toThrow(RiderTooLargeError);
		expect(inserts).toHaveLength(0);
	});

	it('writes the band’s shared items with no owner at all', async () => {
		selectResults = [
			[{ id: 'rider-1', groupId: 'band-1' }], // findRider — no roster lookup for shared
			[]
		];

		await saveElementsFor('band-1', null, [{ kind: 'playback', label: 'Backing tracks' }]);

		const rows = inserts.find((i) => i.table === riderElement)!.values as {
			userId: string | null;
		}[];
		expect(rows[0].userId).toBeNull();
	});
});

describe('savePlacements', () => {
	/**
	 * The placement writes only. Every save also bumps `rider.updatedAt`, which
	 * is a third `update` call and not what any of these are about — counting raw
	 * updates would make these tests fail the day something else touches the row.
	 */
	const placementWrites = () => updates.filter((u) => 'x' in u);

	it('lets a member move their own gear', async () => {
		selectResults = [[{ id: 'rider-1', groupId: 'band-1' }], [{ id: 'e-1', userId: 'u-1' }]];

		await savePlacements('band-1', { userId: 'u-1', isAdmin: false }, [
			{ elementId: 'e-1', x: 20, y: 80 }
		]);

		expect(placementWrites()[0]).toMatchObject({ x: 20, y: 80 });
	});

	/**
	 * The one that matters. The plot only offers you your own items to drag, so
	 * reaching this means a hand-written payload — and the guard on the remote
	 * function alone would not catch it, because a plain member is allowed to
	 * call this at all.
	 */
	it('refuses a member moving somebody else’s', async () => {
		selectResults = [
			[{ id: 'rider-1', groupId: 'band-1' }],
			[{ id: 'e-1', userId: 'someone-else' }]
		];

		await expect(
			savePlacements('band-1', { userId: 'u-1', isAdmin: false }, [
				{ elementId: 'e-1', x: 10, y: 10 }
			])
		).rejects.toThrow(RiderNotPlaceableError);
		expect(placementWrites()).toHaveLength(0);
	});

	it('lets an admin move anything, including the band’s shared kit', async () => {
		selectResults = [
			[{ id: 'rider-1', groupId: 'band-1' }],
			[
				{ id: 'e-1', userId: 'someone-else' },
				{ id: 'e-2', userId: null }
			]
		];

		await savePlacements('band-1', { userId: 'admin-1', isAdmin: true }, [
			{ elementId: 'e-1', x: 10, y: 10 },
			{ elementId: 'e-2', x: 90, y: 90 }
		]);

		expect(placementWrites()).toHaveLength(2);
	});

	it('refuses an element that is not on this rider at all', async () => {
		selectResults = [[{ id: 'rider-1', groupId: 'band-1' }], []];

		await expect(
			savePlacements('band-1', { userId: 'u-1', isAdmin: true }, [
				{ elementId: 'from-another-band', x: 0, y: 0 }
			])
		).rejects.toThrow(RiderNotPlaceableError);
	});

	it('unplaces on null rather than dropping the item at the origin', async () => {
		selectResults = [[{ id: 'rider-1', groupId: 'band-1' }], [{ id: 'e-1', userId: 'u-1' }]];

		await savePlacements('band-1', { userId: 'u-1', isAdmin: false }, [
			{ elementId: 'e-1', x: null, y: null }
		]);

		expect(placementWrites()[0]).toMatchObject({ x: null, y: null });
	});
});

describe('clampCoord', () => {
	it('holds the 0–100 bound a client could otherwise post past', () => {
		expect(clampCoord(-40)).toBe(0);
		expect(clampCoord(1e6)).toBe(100);
		expect(clampCoord(33.6)).toBe(34);
	});

	it('does not let a NaN through as a coordinate', () => {
		expect(clampCoord(Number.NaN)).toBe(0);
	});
});
