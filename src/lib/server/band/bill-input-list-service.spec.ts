import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Three properties, each the reason a per-act list was not enough: numbering
 * runs straight through the bill; console order still wins inside each act
 * (the same `compareElements` spine); and repeats are marked, never collapsed.
 */

let selectResults: unknown[][] = [];

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
	db: { select: vi.fn(() => chain(next)) }
}));

const { buildBillChannels, countDistinctSources, getBillInputList } =
	await import('./bill-input-list-service');

type Act = Parameters<typeof buildBillChannels>[0][number];

function input(label: string, source = 'mic', phantom = false) {
	return {
		id: `in-${label}-${Math.random().toString(36).slice(2, 7)}`,
		channel: 0,
		label,
		source,
		micPref: null,
		phantom,
		stand: 'none',
		monitorMixUserId: null,
		notes: null
	};
}

function element(kind: string, label: string, labels: string[], sortOrder = 0) {
	return {
		id: `el-${label}`,
		userId: null,
		x: null,
		y: null,
		ownerName: null,
		kind,
		label,
		providedBy: 'band',
		notes: null,
		sortOrder,
		inputs: labels.map((l) => input(l))
	};
}

function act(id: string, name: string, elements: unknown[]): Act {
	return { id, name, elements } as Act;
}

beforeEach(() => {
	selectResults = [];
});

describe('buildBillChannels', () => {
	it('numbers straight through the bill rather than restarting per act', () => {
		const channels = buildBillChannels([
			act('eb-1', 'Openers', [element('drums', 'Kit', ['Kick', 'Snare'])]),
			act('eb-2', 'Headliners', [element('vocals', 'Lead vox', ['Vox'])])
		]);
		expect(channels.map((c) => [c.channel, c.actName, c.label])).toEqual([
			[1, 'Openers', 'Kick'],
			[2, 'Openers', 'Snare'],
			[3, 'Headliners', 'Vox']
		]);
	});

	it('keeps console order inside an act, whatever order the rows arrive in', () => {
		// Vocals entered first, drums second. `compareElements` puts the kit
		// first anyway — the same spine the per-band list runs on.
		const channels = buildBillChannels([
			act('eb-1', 'Openers', [
				element('vocals', 'Lead vox', ['Vox'], 0),
				element('drums', 'Kit', ['Kick'], 1)
			])
		]);
		expect(channels.map((c) => c.label)).toEqual(['Kick', 'Vox']);
	});

	it('marks a source two acts both ask for, and names the other act', () => {
		const channels = buildBillChannels([
			act('eb-1', 'Openers', [element('drums', 'Kit', ['Kick'])]),
			act('eb-2', 'Headliners', [element('drums', 'Kit', ['kick '])])
		]);
		expect(channels[0].sharedWith).toEqual(['Headliners']);
		expect(channels[1].sharedWith).toEqual(['Openers']);
		// Marked, not merged: both are still patched until somebody decides.
		expect(channels).toHaveLength(2);
	});

	it('does not mark an act as sharing with itself', () => {
		const channels = buildBillChannels([
			act('eb-1', 'Openers', [element('drums', 'Kit', ['Tom', 'Tom'])])
		]);
		expect(channels.map((c) => c.sharedWith)).toEqual([[], []]);
	});

	it('gives an act with no rider no channels at all', () => {
		expect(buildBillChannels([act('eb-1', 'A bare name', [])])).toEqual([]);
	});
});

describe('countDistinctSources', () => {
	it('counts what the desk needs once every repeat is patched once', () => {
		const channels = buildBillChannels([
			act('eb-1', 'Openers', [element('drums', 'Kit', ['Kick', 'Snare'])]),
			act('eb-2', 'Headliners', [element('drums', 'Kit', ['Kick', 'Overhead'])])
		]);
		expect(channels).toHaveLength(4);
		expect(countDistinctSources(channels)).toBe(3);
	});
});

describe('getBillInputList', () => {
	it('reports both totals against the desk, and which acts said nothing', async () => {
		selectResults = [
			// The bill: one linked act, one bare name.
			[
				{ id: 'eb-1', name: 'Openers', groupId: 'g-1', slug: 'openers' },
				{ id: 'eb-2', name: 'A bare name', groupId: null, slug: null }
			],
			// Elements across every linked act.
			[
				{
					id: 'el-1',
					groupId: 'g-1',
					userId: null,
					ownerName: null,
					kind: 'drums',
					label: 'Kit',
					providedBy: 'band',
					notes: null,
					sortOrder: 0
				}
			],
			// Inputs.
			[
				{
					id: 'in-1',
					elementId: 'el-1',
					label: 'Kick',
					source: 'mic',
					micPref: 'Beta 52',
					phantom: false,
					stand: 'none',
					monitorMixUserId: null,
					notes: null
				},
				{
					id: 'in-2',
					elementId: 'el-1',
					label: 'Overhead',
					source: 'mic',
					micPref: null,
					phantom: true,
					stand: 'tall',
					monitorMixUserId: null,
					notes: null
				}
			]
		];

		const list = await getBillInputList('event-1', 24);

		expect(list.channelCount).toBe(2);
		expect(list.distinctCount).toBe(2);
		expect(list.phantomCount).toBe(1);
		expect(list.consoleChannels).toBe(24);
		expect(list.acts).toEqual([
			{ id: 'eb-1', name: 'Openers', slug: 'openers', channelCount: 2, empty: false },
			{ id: 'eb-2', name: 'A bare name', slug: null, channelCount: 0, empty: true }
		]);
	});

	it('asks for no rider rows at all when nothing on the bill is a CMC band', async () => {
		// The guard that matters: `inArray(…, [])` is a SQL error on D1, and an
		// external-only bill is the normal case for a community show.
		selectResults = [[{ id: 'eb-1', name: 'A bare name', groupId: null, slug: null }]];
		const list = await getBillInputList('event-1', 16);
		expect(list.channels).toEqual([]);
		expect(list.acts[0].empty).toBe(true);
	});
});
