import { describe, it, expect } from 'vitest';
import {
	capabilities,
	positions,
	positionOrder,
	positionLabels,
	allCapabilities,
	adminOnlyCapabilities,
	grantsCapability,
	positionsGranting,
	hasCapability,
	type Capability,
	type Resource
} from './config';

// Every capability, as the flat "resource.action" strings a guard names.
const everyCapability = Object.entries(capabilities).flatMap(([r, actions]) =>
	(actions as readonly string[]).map((a) => `${r}.${a}` as Capability)
);

describe('the capability matrix', () => {
	it('grants only capabilities that exist', () => {
		// The mapped type catches this at compile time; this catches an `as const`
		// widening, a hand-edit, or a resource renamed on one side only.
		for (const [name, grants] of Object.entries(positions)) {
			for (const [resource, actions] of Object.entries(grants)) {
				expect(capabilities, `${name} names unknown resource ${resource}`).toHaveProperty(resource);
				const known = capabilities[resource as Resource] as readonly string[];
				for (const a of actions as readonly string[]) {
					expect(known, `${name} grants unknown ${resource}.${a}`).toContain(a);
				}
			}
		}
	});

	it('gives admin every capability', () => {
		// Fails the day somebody adds a capability and forgets the matrix.
		for (const cap of everyCapability) {
			expect(grantsCapability(positions.admin, cap), `admin lacks ${cap}`).toBe(true);
		}
	});

	it('still gives staff everything, so the narrowing PRs are inert', () => {
		// `staff` is transitional and identical to `admin` for the whole
		// migration: that is exactly what makes a PR swapping 55 guards in one
		// module change nothing observable. When the narrowing lands, this
		// assertion flips to `!adminOnlyCapabilities.includes(cap)` — one line of
		// test beside one line of config, and nothing else moves.
		for (const cap of everyCapability) {
			expect(grantsCapability(positions.staff, cap), `staff lacks ${cap}`).toBe(true);
		}
	});

	it('names a complement of real capabilities that admin holds', () => {
		// The policy is declared before it is enforced, so it is reviewable now.
		for (const cap of adminOnlyCapabilities) {
			expect(everyCapability, `${cap} is not a real capability`).toContain(cap);
			expect(grantsCapability(positions.admin, cap)).toBe(true);
		}
	});

	it('leaves no capability unheld', () => {
		// A capability nobody can hold is a guard nobody can pass. This is the
		// test that stops this file rotting the way the spatie tables did.
		for (const cap of everyCapability) {
			expect(positionsGranting(cap), `nobody grants ${cap}`).not.toHaveLength(0);
		}
	});

	it('gives no named position an admin-only capability', () => {
		// `staff` is exempt only because it is transitional. If a named position
		// ever grants one of these, either the matrix or the complement is wrong
		// — which is how `settings.update` was found not to belong in the
		// complement at all: it is the Technology Coordinator's job.
		for (const cap of adminOnlyCapabilities) {
			const named = positionsGranting(cap).filter((p) => p !== 'admin' && p !== 'staff');
			expect(named, `${cap} is granted by a named position`).toEqual([]);
		}
	});

	it('has a label and an order entry for every position', () => {
		expect(positionOrder).toEqual(Object.keys(positionLabels));
		expect(Object.keys(positions).sort()).toEqual([...positionOrder].sort());
	});

	it('ranks admin first for display', () => {
		// Display precedence only — no guard may rank positions against each
		// other. `topPositionFor` reads this order for the member badge.
		expect(positionOrder[0]).toBe('admin');
	});
});

describe('grantsCapability', () => {
	it('is false for a resource the position does not name at all', () => {
		expect(grantsCapability(positions.treasurer, 'volunteer.reviewHours')).toBe(false);
	});

	it('is false for an unheld action on a resource the position does hold', () => {
		// The treasurer reads credit but does not adjust it.
		expect(grantsCapability(positions.treasurer, 'credit.read')).toBe(true);
		expect(grantsCapability(positions.treasurer, 'credit.adjust')).toBe(false);
	});

	it('round-trips against allCapabilities', () => {
		for (const cap of everyCapability) {
			expect(grantsCapability(allCapabilities, cap)).toBe(true);
		}
	});
});

describe('hasCapability', () => {
	it('reads a shipped capability list', () => {
		expect(hasCapability(['user.list', 'credit.read'], 'user.list')).toBe(true);
		expect(hasCapability(['user.list'], 'user.purge')).toBe(false);
		expect(hasCapability([], 'user.list')).toBe(false);
	});
});
