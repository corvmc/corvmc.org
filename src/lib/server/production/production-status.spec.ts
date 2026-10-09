import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * Warn, record, allow (docs/development/conventions.md#workflow-gates), as it
 * applies to a show's status: any move between non-terminal states is allowed
 * once its warnings are acknowledged with a reason, terminal states are left
 * only by an admin reopen, and both are written to the audit log. Against a
 * real SQLite, because the answers are the rows the moves leave behind.
 */
const { sqlite, testDb } = await vi.hoisted(async () => {
	const { migratedSqlite } = await import('$lib/server/testing/migrated-sqlite');
	return migratedSqlite();
});

vi.mock('$lib/server/db', () => ({
	db: Object.assign(testDb, {
		batch: async (stmts: PromiseLike<unknown>[]) => {
			const out = [];
			for (const s of stmts) out.push(await s);
			return out;
		}
	}),
	getRowCount: (result: unknown) => (result as { changes?: number })?.changes ?? 0
}));
vi.mock('$lib/server/sentry', () => ({ captureException: vi.fn() }));
vi.mock('$app/server', () => ({
	getRequestEvent: () => {
		throw new Error('outside a request');
	}
}));
vi.mock('./cancellation-notice', () => ({
	announceShowsCancelled: async () => undefined,
	openDeliverablesOnProductions: async () => []
}));
vi.mock('$lib/server/volunteer/show-cancellation', () => ({
	cancelShiftsForProduction: async () => 0
}));

const { transitionProduction, reopenProduction, updateProductionDetails } =
	await import('./production-service');
const { ProductionTerminalError } = await import('./production-scope');
const { addSlot, updateSlot, setSlotTerms } = await import('./run-of-show-service');
const { addExpense, removeExpense } = await import('./expense-service');

const T0 = 1_890_000_000;
const exec = (sql: string) => sqlite.exec(sql);

function statusOf(): string {
	return (
		sqlite.prepare(`select status from production where id = 'prod'`).get() as { status: string }
	).status;
}

function projectStatus(): string {
	return (
		sqlite.prepare(`select status from project where id = 'proj'`).get() as { status: string }
	).status;
}

function audit(): { action: string; subject_type: string; details: Record<string, unknown> }[] {
	return (
		sqlite
			.prepare(`select action, subject_type, details from audit_log order by created_at, rowid`)
			.all() as { action: string; subject_type: string; details: string }[]
	).map((r) => ({ ...r, details: JSON.parse(r.details) }));
}

/** What the ledger holds against the show's costs, net of any reversals. */
function postedExpenseCents(): number {
	return (
		sqlite
			.prepare(
				`select coalesce(sum(amount_cents), 0) as t from financial_entry where subject_type = 'production_expense'`
			)
			.get() as { t: number }
	).t;
}

function show(status: string) {
	exec(`update production set status = '${status}' where id = 'prod'`);
}

function openLoadOutTask(label: string) {
	exec(`insert into duty_list (id, name, anchor) values ('lo', 'Load-out', 'load_out')`);
	exec(`insert into work_order (id, volunteer_role_id, event_id, starts_at, ends_at, duty_list_id)
		values ('lo-wo', 'crew', 'evt', ${T0}, ${T0 + 3600}, 'lo')`);
	exec(`insert into work_task (id, work_order_id, label, sort_order, done)
		values ('t1', 'lo-wo', '${label}', 0, 0)`);
}

beforeEach(() => {
	for (const t of [
		'audit_log',
		'financial_entry',
		'production_expense',
		'production_slot',
		'work_task',
		'work_order',
		'duty_list',
		'event_listing',
		'production',
		'project',
		'volunteer_role',
		'user'
	])
		exec(`delete from ${t}`);
	exec(`insert into user (id, name, email, email_verified) values ('u', 'Staff', 'u@x.test', 0)`);
	exec(`insert into volunteer_role (id, name) values ('crew', 'Load-out crew')`);
	exec(`insert into project (id, name, kind) values ('proj', 'Friday', 'production')`);
	exec(`insert into production (id, project_id, status) values ('prod', 'proj', 'draft')`);
	exec(`insert into event_listing (id, title, starts_at, ends_at, created_by_user_id, source, kind, production_id, project_id, status)
		values ('evt', 'Friday Night Fuzz', ${T0}, ${T0 + 7200}, 'u', 'cmc', 'show', 'prod', 'proj', 'published')`);
	exec(`insert into production_expense (id, production_id, label, category, amount_cents)
		values ('exp-1', 'prod', 'Sound engineer', 'sound', 15000)`);
});

describe('the usual path', () => {
	it('moves one step forward with no warning, and records it', async () => {
		show('confirmed');
		const outcome = await transitionProduction('prod', 'completed', { actorUserId: 'u' });

		expect(outcome).toMatchObject({ moved: true, warnings: [] });
		expect(statusOf()).toBe('completed');
		expect(audit()).toEqual([
			{
				action: 'production.status_changed',
				subject_type: 'production',
				details: expect.objectContaining({ eventId: 'evt', from: 'confirmed', to: 'completed' })
			}
		]);
	});

	it('books a show outright without the offer step counting as skipped', async () => {
		const outcome = await transitionProduction('prod', 'confirmed');
		expect(outcome).toMatchObject({ moved: true, warnings: [] });
	});
});

describe('a move off the usual path', () => {
	it('returns its warnings instead of moving when they were not acknowledged', async () => {
		const outcome = await transitionProduction('prod', 'settled');

		expect(outcome.moved).toBe(false);
		expect(outcome.warnings.join(' ')).toMatch(/confirmed/);
		expect(statusOf()).toBe('draft');
		expect(audit()).toEqual([]);
	});

	it('is allowed once acknowledged with a reason, and recorded as an override', async () => {
		const outcome = await transitionProduction('prod', 'settled', {
			acknowledged: true,
			reason: 'Entered after the fact'
		});

		expect(outcome.moved).toBe(true);
		expect(statusOf()).toBe('settled');
		const [entry] = audit();
		expect(entry.action).toBe('production.override');
		expect(entry.details).toMatchObject({
			from: 'draft',
			to: 'settled',
			reason: 'Entered after the fact'
		});
		expect((entry.details.warnings as string[]).length).toBeGreaterThan(0);
	});

	it('wants a reason for an acknowledged override', async () => {
		await expect(
			transitionProduction('prod', 'settled', { acknowledged: true, reason: '  ' })
		).rejects.toThrow(/reason/i);
		expect(statusOf()).toBe('draft');
	});

	it('walks a settled show back, and reverses the costs it posted', async () => {
		show('completed');
		await transitionProduction('prod', 'settled');
		expect(postedExpenseCents()).toBe(-15000);

		const warned = await transitionProduction('prod', 'confirmed');
		expect(warned.moved).toBe(false);

		await transitionProduction('prod', 'completed', { acknowledged: true, reason: 'Wrong night' });
		expect(statusOf()).toBe('completed');
		expect(postedExpenseCents()).toBe(0);

		// Settling again posts the line again rather than reading it as already done.
		await transitionProduction('prod', 'settled');
		expect(postedExpenseCents()).toBe(-15000);
	});

	it('puts the project back to open when a completed show is walked back', async () => {
		show('confirmed');
		await transitionProduction('prod', 'completed');
		expect(projectStatus()).toBe('done');

		await transitionProduction('prod', 'confirmed', { acknowledged: true, reason: 'Mis-click' });
		expect(projectStatus()).toBe('open');
	});

	it('cancels a night that already happened, as a warning', async () => {
		show('completed');
		expect((await transitionProduction('prod', 'cancelled')).moved).toBe(false);
		await transitionProduction('prod', 'cancelled', { acknowledged: true, reason: 'Never ran' });
		expect(statusOf()).toBe('cancelled');
	});
});

describe('close-out', () => {
	it('names an open load-out task as a warning rather than refusing', async () => {
		show('settled');
		openLoadOutTask('Reset the room');

		const warned = await transitionProduction('prod', 'closed');
		expect(warned.moved).toBe(false);
		expect(warned.warnings.join(' ')).toContain('Reset the room');

		await transitionProduction('prod', 'closed', {
			actorUserId: 'u',
			acknowledged: true,
			reason: 'Room reset; task not ticked'
		});
		const row = sqlite
			.prepare(`select status, closed_at, closed_by_user_id from production where id = 'prod'`)
			.get() as { status: string; closed_at: number | null; closed_by_user_id: string | null };
		expect(row.status).toBe('closed');
		expect(row.closed_at).not.toBeNull();
		expect(row.closed_by_user_id).toBe('u');
	});
});

describe('terminal states are the past', () => {
	it.each(['closed', 'cancelled'])('refuses to move a %s show, acknowledged or not', async (s) => {
		show(s);
		await expect(transitionProduction('prod', 'confirmed')).rejects.toBeInstanceOf(
			ProductionTerminalError
		);
		await expect(
			transitionProduction('prod', 'confirmed', { acknowledged: true, reason: 'x' })
		).rejects.toBeInstanceOf(ProductionTerminalError);
		expect(statusOf()).toBe(s);
	});

	it('refuses every edit to a closed show', async () => {
		exec(`insert into production_slot (id, production_id, sort_order, set_length_minutes)
			values ('slot-1', 'prod', 1, 30)`);
		show('closed');

		const refused = [
			updateProductionDetails('prod', { internalNotes: 'late edit' }),
			addSlot('prod', { setLengthMinutes: 30 }),
			updateSlot('slot-1', { setLengthMinutes: 45 }),
			setSlotTerms('slot-1', {
				guaranteeCents: 100,
				percentageBps: null,
				versus: false,
				againstNet: false,
				contributed: false
			}),
			addExpense({ productionId: 'prod', label: 'Pizza', category: 'hospitality', amountCents: 1 }),
			removeExpense('exp-1')
		];
		for (const write of refused)
			await expect(write).rejects.toBeInstanceOf(ProductionTerminalError);
	});
});

describe('reopening', () => {
	it('takes a closed show back, clears the close-out stamp, and records why', async () => {
		show('settled');
		await transitionProduction('prod', 'closed', { actorUserId: 'u' });

		await reopenProduction('prod', 'confirmed', 'Door count was wrong');

		const row = sqlite
			.prepare(`select status, closed_at, closed_by_user_id from production where id = 'prod'`)
			.get();
		expect(row).toEqual({ status: 'confirmed', closed_at: null, closed_by_user_id: null });
		expect(audit().at(-1)).toMatchObject({
			action: 'production.reopened',
			details: { from: 'closed', to: 'confirmed', reason: 'Door count was wrong' }
		});
		// Below settled, so what close-out posted is reversed.
		expect(postedExpenseCents()).toBe(0);
	});

	it('takes a cancelled show back and reopens its project', async () => {
		await transitionProduction('prod', 'cancelled');
		expect(projectStatus()).toBe('declined');

		await reopenProduction('prod', 'offered', 'Back on');
		expect(statusOf()).toBe('offered');
		expect(projectStatus()).toBe('open');
	});

	it('wants a reason', async () => {
		show('closed');
		await expect(reopenProduction('prod', 'settled', '')).rejects.toThrow(/reason/i);
		expect(statusOf()).toBe('closed');
	});

	it('is only for a show in a terminal state, and only out of one', async () => {
		show('settled');
		await expect(reopenProduction('prod', 'confirmed', 'x')).rejects.toThrow();
		show('closed');
		await expect(reopenProduction('prod', 'cancelled' as never, 'x')).rejects.toThrow();
		expect(statusOf()).toBe('closed');
	});
});
