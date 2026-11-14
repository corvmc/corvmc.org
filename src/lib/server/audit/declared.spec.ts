import { describe, it, expect, vi, beforeEach } from 'vitest';

const recordAuditEntry = vi.fn(async (_entry: unknown) => undefined);
vi.mock('./audit-service.js', () => ({ recordAuditEntry }));

const { audited, changedFields } = await import('./declared');

type Row = { name: string; visible: boolean } | null;
let row: Row;
const calls: string[] = [];

function remote() {
	return audited(
		{
			guard: async () => {
				calls.push('guard');
				return { id: 'staff-1' };
			},
			action: 'event.visibility_changed',
			read: async () => {
				calls.push('read');
				return row;
			},
			subject: ({ data }) => ({ type: 'event', id: data.id, label: 'Spring show' }),
			details: ({ changes }) => ({
				from: String(changes[0]?.from),
				to: String(changes[0]?.to)
			})
		},
		async (data: { id: string; visible: boolean }, { before }) => {
			calls.push('write');
			if (!before) throw new Error('missing');
			row = { ...before, visible: data.visible } as Row;
			return { ok: true };
		}
	);
}

beforeEach(() => {
	recordAuditEntry.mockClear();
	calls.length = 0;
	row = { name: 'Spring show', visible: false };
});

describe('audited', () => {
	it('guards before reading, and writes the row after the write with what changed', async () => {
		await expect(remote()({ id: 'ev-1', visible: true }, undefined)).resolves.toEqual({ ok: true });
		expect(calls).toEqual(['guard', 'read', 'write', 'read']);
		expect(recordAuditEntry).toHaveBeenCalledWith({
			action: 'event.visibility_changed',
			subject: { type: 'event', id: 'ev-1', label: 'Spring show' },
			details: { from: 'false', to: 'true' }
		});
	});

	it('writes no row when the save changed nothing', async () => {
		await remote()({ id: 'ev-1', visible: false }, undefined);
		expect(recordAuditEntry).not.toHaveBeenCalled();
	});

	it('writes no row when the write throws', async () => {
		row = null;
		await expect(remote()({ id: 'ev-1', visible: true }, undefined)).rejects.toThrow('missing');
		expect(recordAuditEntry).not.toHaveBeenCalled();
	});

	it('reads nothing for a caller the guard refuses', async () => {
		const refused = audited(
			{
				guard: async () => {
					throw new Error('forbidden');
				},
				action: 'closure.deleted',
				read: async () => {
					calls.push('read');
					return null;
				},
				subject: () => ({ type: 'setting', id: 'reservation' }),
				details: () => ({ closureId: 'x', startsAt: '', endsAt: '', reason: '' })
			},
			async () => ({ ok: true })
		);
		await expect(refused({}, undefined)).rejects.toThrow('forbidden');
		expect(calls).toEqual([]);
	});
});

describe('changedFields', () => {
	it('lists each differing field, a missing record reading as null', () => {
		expect(changedFields({ a: 1, b: 'x' }, { a: 1, b: 'y' })).toEqual([
			{ key: 'b', from: 'x', to: 'y' }
		]);
		expect(changedFields({ a: 1 }, null)).toEqual([{ key: 'a', from: 1, to: null }]);
		expect(changedFields(null, null)).toEqual([]);
	});
});
