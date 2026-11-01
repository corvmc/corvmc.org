import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ResolvedPathname } from '$app/types';
import { readStarred, resolveStarred, toggleStarred } from './nav-stars';
import type { NavNode } from './active-nav';

const node = (key: string, children?: NavNode[]): NavNode => ({
	key,
	href: `/staff/${key}` as ResolvedPathname,
	children
});

const tree = [node('dashboard'), node('volunteer', [node('volunteer-schedule')]), node('payments')];

function stubStorage(initial: Record<string, string> = {}) {
	const data = new Map(Object.entries(initial));
	vi.stubGlobal('localStorage', {
		getItem: (k: string) => data.get(k) ?? null,
		setItem: (k: string, v: string) => void data.set(k, v)
	});
	return data;
}

afterEach(() => vi.unstubAllGlobals());

describe('resolveStarred', () => {
	it('returns starred rows in nav order, children included', () => {
		const keys = ['payments', 'volunteer-schedule', 'dashboard'];
		expect(resolveStarred(keys, tree).map((n) => n.key)).toEqual([
			'dashboard',
			'volunteer-schedule',
			'payments'
		]);
	});

	it('drops a key the filtered tree no longer holds, and an unknown one', () => {
		const filtered = tree.filter((n) => n.key !== 'payments');
		expect(resolveStarred(['payments', 'renamed-row', 'dashboard'], filtered)).toEqual([tree[0]]);
	});

	it('is empty with nothing starred', () => {
		expect(resolveStarred([], tree)).toEqual([]);
	});
});

describe('star storage', () => {
	it('toggles a key on and off, per scope', () => {
		stubStorage();
		expect(toggleStarred('staff', 'payments')).toEqual(['payments']);
		expect(toggleStarred('member', 'events')).toEqual(['events']);
		expect(readStarred('staff')).toEqual(['payments']);
		expect(toggleStarred('staff', 'payments')).toEqual([]);
		expect(readStarred('member')).toEqual(['events']);
	});

	it('reads garbage as nothing starred', () => {
		stubStorage({ 'cmc:nav-starred:staff': '{"payments":true}' });
		expect(readStarred('staff')).toEqual([]);
		stubStorage({ 'cmc:nav-starred:staff': 'not json' });
		expect(readStarred('staff')).toEqual([]);
		stubStorage({ 'cmc:nav-starred:staff': '["payments",3]' });
		expect(readStarred('staff')).toEqual(['payments']);
	});

	it('survives storage that throws', () => {
		vi.stubGlobal('localStorage', {
			getItem: () => {
				throw new Error('SecurityError');
			},
			setItem: () => {
				throw new Error('QuotaExceededError');
			}
		});
		expect(readStarred('staff')).toEqual([]);
		expect(toggleStarred('staff', 'payments')).toEqual(['payments']);
	});

	it('survives no storage at all, as on the server', () => {
		vi.stubGlobal('localStorage', undefined);
		expect(readStarred('staff')).toEqual([]);
		expect(toggleStarred('staff', 'payments')).toEqual(['payments']);
	});
});
