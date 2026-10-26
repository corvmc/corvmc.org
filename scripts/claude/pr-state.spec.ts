import { describe, it, expect } from 'vitest';
import { classify } from './lib/pr-state.mjs';

// Each case is a reading a session has actually acted on wrongly. The two that
// matter most: an unarmed PR in the queue is running, not dropped; and an armed
// PR with a red required check is stranded, though nothing ever labels it.
const REQUIRED = ['Unit tests', 'E2E'];

type Snapshot = Parameters<typeof classify>[0];

function pr(over: Partial<Snapshot> = {}): Snapshot {
	return {
		number: 1,
		title: 't',
		url: 'u',
		state: 'OPEN',
		isDraft: false,
		author: 'DevonCash',
		headSha: 'abc',
		labels: [],
		armed: true,
		mergeStateStatus: 'BLOCKED',
		queueEntry: null,
		checks: [],
		events: [],
		...over
	};
}

const status = (over: Partial<Snapshot>) => classify(pr(over), REQUIRED).status;

describe('classify', () => {
	it('reads a merged PR as merged even though the queue removed it on the way', () => {
		expect(
			status({
				state: 'MERGED',
				armed: false,
				events: [{ type: 'RemovedFromMergeQueueEvent', at: '' }]
			})
		).toBe('merged');
	});

	it('reads an unarmed PR with a queue entry as queued, not dropped', () => {
		expect(status({ armed: false, queueEntry: { state: 'AWAITING_CHECKS', position: 1 } })).toBe(
			'queued'
		);
	});

	it('reads the guard label, or an unmerged removal nothing re-armed, as rejected', () => {
		expect(status({ armed: false, labels: ['queue-rejected'] })).toBe('rejected');
		expect(
			status({
				armed: false,
				events: [
					{ type: 'AddedToMergeQueueEvent', at: '' },
					{ type: 'RemovedFromMergeQueueEvent', at: '', reason: 'CI failed' }
				]
			})
		).toBe('rejected');
	});

	it('reads a re-armed PR after a removal as pending, not rejected', () => {
		expect(
			status({
				events: [
					{ type: 'RemovedFromMergeQueueEvent', at: '' },
					{ type: 'AutoMergeEnabledEvent', at: '' }
				]
			})
		).toBe('pending');
	});

	it('reads an armed PR with a failed required check as stuck', () => {
		const state = classify(
			pr({ checks: [{ name: 'E2E', conclusion: 'FAILURE', url: 'x' }] }),
			REQUIRED
		);
		expect(state.status).toBe('stuck');
		expect(state.failing.map((c) => c.name)).toEqual(['E2E']);
	});

	it('ignores a failed check that is not required', () => {
		expect(
			status({ checks: [{ name: 'Workers Builds: corvmc', conclusion: 'FAILURE', url: 'x' }] })
		).toBe('pending');
	});

	it('reads an armed PR that conflicts with main as stuck', () => {
		expect(status({ mergeStateStatus: 'DIRTY' })).toBe('stuck');
	});

	it('reads checks still running as pending', () => {
		expect(status({ checks: [{ name: 'E2E', conclusion: null, url: 'x' }] })).toBe('pending');
	});

	it('tells drafts apart from ready PRs nobody armed', () => {
		expect(status({ armed: false, isDraft: true })).toBe('draft');
		expect(status({ armed: false })).toBe('unarmed');
	});
});
