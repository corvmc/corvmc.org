import { describe, it, expect } from 'vitest';
import {
	byWhen,
	groupByProject,
	matchesChip,
	matchesKind,
	matchesTaskProject,
	matchesWindow,
	parseTaskQuery,
	taskQuerySearch,
	type TaskFacts
} from './task-filters';

const NOW = new Date('2026-06-15T12:00:00Z');
const DAY = 86_400_000;

function task(over: Partial<TaskFacts> = {}): TaskFacts {
	return {
		id: 't',
		volunteerRoleId: null,
		projectId: null,
		projectName: null,
		dueAt: null,
		shiftAt: null,
		shifts: 0,
		assignees: 0,
		blockers: 0,
		maintenanceScheduleId: null,
		resolvedAt: null,
		createdAt: new Date(0),
		...over
	};
}
const engaged = [{ name: 'Benton', late: false, awaitingInvoice: false }];
const invoiceOwed = [{ name: 'Benton', late: false, awaitingInvoice: true }];

describe('the URL', () => {
	it('round-trips every filter, and drops what it does not know', () => {
		const q = parseTaskQuery(
			new URLSearchParams(
				'group=project&days=30&project=p1&role=r&kind=contractor&chip=overdue&done=1&about=event:e:1'
			)
		);
		expect(q).toEqual({
			group: 'project',
			days: 30,
			project: 'p1',
			role: 'r',
			kind: 'contractor',
			chip: 'overdue',
			done: true,
			about: { type: 'event', id: 'e:1' }
		});
		expect(parseTaskQuery(new URLSearchParams(taskQuerySearch(q)))).toEqual(q);
		expect(taskQuerySearch(parseTaskQuery(new URLSearchParams('days=5&kind=x&chip=y')))).toBe('');
	});

	it('takes an about filter only with a known type and an id', () => {
		for (const raw of ['nonsense:1', 'event:', ':1', 'event']) {
			expect(parseTaskQuery(new URLSearchParams({ about: raw })).about).toBeNull();
		}
		expect(parseTaskQuery(new URLSearchParams({ about: 'group:g1' })).about).toEqual({
			type: 'group',
			id: 'g1'
		});
	});
});

describe('chips', () => {
	it('counts a task as unassigned only with no assignee, contractor or shift', () => {
		expect(matchesChip('unassigned', task(), [], NOW)).toBe(true);
		expect(matchesChip('unassigned', task({ assignees: 1 }), [], NOW)).toBe(false);
		expect(matchesChip('unassigned', task(), engaged, NOW)).toBe(false);
		expect(matchesChip('unassigned', task({ shifts: 1 }), [], NOW)).toBe(false);
		expect(matchesChip('unassigned', task({ resolvedAt: NOW }), [], NOW)).toBe(false);
	});

	it('counts volunteer work with no shift as having no time', () => {
		expect(matchesChip('untimed', task({ volunteerRoleId: 'door' }), [], NOW)).toBe(true);
		expect(matchesChip('untimed', task(), [], NOW)).toBe(false);
		expect(matchesChip('untimed', task({ volunteerRoleId: 'door', shifts: 1 }), [], NOW)).toBe(
			false
		);
	});

	it('counts open work past its deadline as overdue', () => {
		const late = task({ dueAt: new Date(NOW.getTime() - DAY) });
		expect(matchesChip('overdue', late, [], NOW)).toBe(true);
		expect(matchesChip('overdue', { ...late, resolvedAt: NOW }, [], NOW)).toBe(false);
	});

	it('counts open work waiting on an open task as blocked', () => {
		expect(matchesChip('blocked', task({ blockers: 2 }), [], NOW)).toBe(true);
		expect(matchesChip('blocked', task({ blockers: 2, resolvedAt: NOW }), [], NOW)).toBe(false);
		expect(matchesChip('blocked', task(), [], NOW)).toBe(false);
	});

	it('counts done contractor work with no cost as awaiting an invoice', () => {
		expect(matchesChip('invoice', task({ resolvedAt: NOW }), invoiceOwed, NOW)).toBe(true);
		expect(matchesChip('invoice', task(), engaged, NOW)).toBe(false);
	});
});

describe('filters', () => {
	it('reads kind from shifts, schedule and engagement', () => {
		expect(matchesKind('timed', task({ shifts: 2 }), [])).toBe(true);
		expect(matchesKind('untimed', task({ shifts: 2 }), [])).toBe(false);
		expect(matchesKind('recurring', task({ maintenanceScheduleId: 'm' }), [])).toBe(true);
		expect(matchesKind('contractor', task(), engaged)).toBe(true);
		expect(matchesKind('', task(), [])).toBe(true);
	});

	it('keeps overdue and undated work inside any window', () => {
		expect(matchesWindow(7, task({ dueAt: new Date(NOW.getTime() - 30 * DAY) }), NOW)).toBe(true);
		expect(matchesWindow(7, task(), NOW)).toBe(true);
		expect(matchesWindow(7, task({ dueAt: new Date(NOW.getTime() + 8 * DAY) }), NOW)).toBe(false);
		expect(matchesWindow(7, task({ shiftAt: new Date(NOW.getTime() + 2 * DAY) }), NOW)).toBe(true);
	});

	it('matches a project by id, or work in none', () => {
		expect(matchesTaskProject('p1', task({ projectId: 'p1' }))).toBe(true);
		expect(matchesTaskProject('p1', task({ projectId: 'p2' }))).toBe(false);
		expect(matchesTaskProject('none', task())).toBe(true);
		expect(matchesTaskProject('none', task({ projectId: 'p1' }))).toBe(false);
	});
});

describe('order and groups', () => {
	it('sorts soonest first, by shift or deadline, undated last', () => {
		const rows = [
			task({ id: 'undated' }),
			task({ id: 'due', dueAt: new Date(NOW.getTime() + 2 * DAY) }),
			task({ id: 'shift', shiftAt: new Date(NOW.getTime() + DAY) })
		];
		expect(rows.sort(byWhen).map((r) => r.id)).toEqual(['shift', 'due', 'undated']);
	});

	it('puts work in no project first, then projects by name', () => {
		const groups = groupByProject([
			task({ id: 'a', projectId: 'p2', projectName: 'Zine' }),
			task({ id: 'b', projectId: 'p1', projectName: 'Annex' }),
			task({ id: 'c' }),
			task({ id: 'd', projectId: 'p2', projectName: 'Zine' })
		]);
		expect(groups.map((g) => [g.projectId, g.rows.map((r) => r.id)])).toEqual([
			[null, ['c']],
			['p1', ['b']],
			['p2', ['a', 'd']]
		]);
	});
});
