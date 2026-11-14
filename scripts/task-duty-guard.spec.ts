import { describe, it, expect } from 'vitest';
import { sourceFiles } from './lib/source-files';
import { CallGraph, walkEvents, type Key } from './lib/remote-calls';

/**
 * One rule decides who may act on a task (#2989): a remote that takes, ticks,
 * marks done or hands back a task guards with `requireActOnTask`, so a list
 * built from the same rule never offers what a remote refuses. This walks each
 * remote and the `src/lib/remote` helpers it reaches, and fails on one that
 * calls a duty write without the rule.
 */
const REMOTE_GLOB = ['src/lib/remote/*.remote.ts'];

const ASSIGNEE = 'src/lib/server/volunteer/assignee-service.ts';
const DUTY_LIST = 'src/lib/server/volunteer/duty-list-service.ts';

/** The service writes that are a task's duty, not an edit of it. */
export const DUTY_WRITES = new Set<Key>([
	`${ASSIGNEE}#markTaskDone`,
	`${ASSIGNEE}#takeTask`,
	`${ASSIGNEE}#handBackTask`,
	`${ASSIGNEE}#setTaskChecklistItemDone`,
	`${DUTY_LIST}#setWorkTaskDone`,
	`${DUTY_LIST}#setWorkTaskDoneAsAssignee`,
	'src/lib/server/volunteer/work-order-service.ts#resolveWorkOrder'
]);

const RULE = new Set<Key>([
	'src/lib/server/task/can-act.ts#requireActOnTask',
	'src/lib/server/task/can-act.ts#canActOnTask'
]);

/** `file#name` → why it may write a duty without the rule. */
const EXEMPT: Record<string, string> = {
	'src/lib/remote/volunteer.remote.ts#setMyWorkTaskDone':
		"a shift sign-up ticks its own shift's checklist; the service checks the sign-up row"
};

/** Every call the handler and the `src/lib/remote` functions it reaches make. */
function reachedCalls(g: CallGraph, start: Key): Set<Key> {
	const calls = new Set<Key>();
	const seen = new Set<Key>([start]);
	const stack: Key[] = [start];
	while (stack.length) {
		const key = stack.pop()!;
		const body = g.body(key);
		if (!body) continue;
		walkEvents(g, body.mod, body.node, (e) => {
			if (e.kind !== 'call') return undefined;
			calls.add(e.key);
			if (e.key.startsWith('src/lib/remote/') && !seen.has(e.key)) {
				seen.add(e.key);
				stack.push(e.key);
			}
			return undefined;
		});
	}
	return calls;
}

describe('task duty writes guard with canActOnTask', () => {
	const g = new CallGraph();
	const remotes = g.remotes(sourceFiles(REMOTE_GLOB, new Set()));
	// Walked at collection, not in the test: a whole-program walk under load outruns a test timeout (#2916).
	const reached = remotes.map((r) => ({
		id: `${r.file}#${r.name}`,
		calls: reachedCalls(g, r.key)
	}));
	const writers = reached.filter((r) => [...r.calls].some((k) => DUTY_WRITES.has(k)));

	it('finds the duty writers', () => {
		expect(writers.map((w) => w.id)).toEqual(
			expect.arrayContaining([
				'src/lib/remote/volunteer.remote.ts#markMyTaskDone',
				'src/lib/remote/deliverables.remote.ts#takeDeliverable',
				'src/lib/remote/duty-lists.remote.ts#setWorkTaskDone'
			])
		);
	});

	it('guard every one with the rule', () => {
		const offenders = writers
			.filter((w) => !(w.id in EXEMPT))
			.filter((w) => ![...w.calls].some((k) => RULE.has(k)))
			.map((w) => w.id);
		expect(offenders).toEqual([]);
	});

	it('lists only exemptions that still write a duty', () => {
		const ids = new Set(writers.map((w) => w.id));
		expect(Object.keys(EXEMPT).filter((k) => !ids.has(k))).toEqual([]);
	});
});
