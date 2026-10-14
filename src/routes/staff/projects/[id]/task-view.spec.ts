import { describe, expect, it } from 'vitest';
import {
	checkState,
	costOf,
	engagementLabel,
	groupBySection,
	matchesFilter,
	parseFilter,
	whenOf,
	type Section,
	type Task
} from './task-view';

const day = (d: number, h = 12) => new Date(2026, 9, d, h);

function task(over: Partial<Task> = {}): Task {
	return {
		id: 't',
		title: 't',
		sectionId: null,
		state: 'open',
		mode: 'unassigned',
		people: [],
		engagement: null,
		doneWhen: null,
		resolvedAt: null,
		cancelledAt: null,
		startsAt: null,
		endsAt: null,
		dueAt: null,
		...over
	} as Task;
}

const engagement = (over: Partial<NonNullable<Task['engagement']>> = {}) =>
	({
		id: 'cj',
		contractorId: 'c',
		contractorName: 'Benton',
		status: 'booked',
		quotedCents: null,
		costCents: null,
		isDonated: false,
		fairValueCents: null,
		invoiceRef: null,
		paidAt: null,
		scheduledFor: null,
		...over
	}) as NonNullable<Task['engagement']>;

describe('filters', () => {
	it('reads an unknown filter as All', () => {
		expect(parseFilter('nonsense')).toBe('all');
		expect(parseFilter('contractors')).toBe('contractors');
	});

	it('Mine is the tasks the viewer is on', () => {
		const t = task({ people: [{ userId: 'me', name: 'Me', image: null, status: 'confirmed' }] });
		expect(matchesFilter(t, 'mine', 'me')).toBe(true);
		expect(matchesFilter(t, 'mine', 'someone')).toBe(false);
	});

	it('the mode filters read the derived mode', () => {
		expect(matchesFilter(task({ mode: 'open' }), 'open', 'me')).toBe(true);
		expect(matchesFilter(task({ mode: 'members' }), 'open', 'me')).toBe(false);
		expect(matchesFilter(task({ mode: 'contractor' }), 'contractors', 'me')).toBe(true);
		expect(matchesFilter(task(), 'unassigned', 'me')).toBe(true);
	});
});

describe('the checkbox', () => {
	it('draws a condition holding apart from a hand tick', () => {
		expect(checkState(task({ doneWhen: 'poster_set', state: 'done' }))).toBe('derived_done');
		expect(checkState(task({ doneWhen: 'poster_set', resolvedAt: day(1) }))).toBe('ticked');
		expect(checkState(task({ doneWhen: 'poster_set' }))).toBe('derived_open');
		expect(checkState(task({ state: 'overdue' }))).toBe('overdue');
		expect(checkState(task({ cancelledAt: day(1), resolvedAt: day(1) }))).toBe('cancelled');
	});
});

describe('When', () => {
	it('is the window, else the due date, and flags a window past the deadline', () => {
		const both = whenOf({ startsAt: day(3, 9), endsAt: day(3, 12), dueAt: day(2) });
		expect(both).toMatchObject({ kind: 'window', endsAfterDue: true });
		expect(whenOf({ startsAt: null, endsAt: null, dueAt: day(2) })).toMatchObject({
			kind: 'due',
			endsAfterDue: false
		});
		expect(whenOf({ startsAt: null, endsAt: null, dueAt: null }).kind).toBe('none');
	});
});

describe('Cost', () => {
	it('is the invoice, else donated, else the quote, and nothing for a dead engagement', () => {
		expect(costOf(task({ engagement: engagement({ costCents: 48000 }) }))).toBe('$480.00');
		expect(costOf(task({ engagement: engagement({ isDonated: true }) }))).toBe('Donated');
		expect(costOf(task({ engagement: engagement({ quotedCents: 22000 }) }))).toBe('~$220.00');
		expect(costOf(task({ engagement: engagement({ status: 'declined', costCents: 1 }) }))).toBe('');
	});

	it('reads a completed engagement with no invoice as awaiting one', () => {
		expect(engagementLabel(engagement({ status: 'completed' }))).toBe('Awaiting invoice');
		expect(engagementLabel(engagement({ status: 'completed', costCents: 1 }))).toBe('Completed');
	});
});

describe('sections', () => {
	const sections = [
		{ id: 's1', name: 'Prep' },
		{ id: 's2', name: 'Empty' }
	] as Section[];

	it('keeps empty sections, counts live tasks, and puts loose ones first', () => {
		const groups = groupBySection(sections, [
			task({ id: 'a', sectionId: 's1', state: 'done' }),
			task({ id: 'b', sectionId: 's1' }),
			task({ id: 'c', sectionId: 's1', state: 'cancelled' }),
			task({ id: 'loose' })
		]);
		expect(groups.map((g) => [g.section?.id ?? null, g.done, g.total])).toEqual([
			[null, 0, 1],
			['s1', 1, 2],
			['s2', 0, 0]
		]);
	});

	it('filters the rows but not the counts, and drops an empty loose group', () => {
		const groups = groupBySection(
			sections,
			[task({ id: 'a', sectionId: 's1', state: 'done' }), task({ id: 'b', sectionId: 's1' })],
			(t) => t.state !== 'done'
		);
		expect(groups).toHaveLength(2);
		expect(groups[0]).toMatchObject({ done: 1, total: 2 });
		expect(groups[0].tasks.map((t) => t.id)).toEqual(['b']);
	});
});
