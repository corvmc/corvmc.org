import { describe, it, expect } from 'vitest';
import {
	committeeApplicationQuestions,
	committeeApplicationStatuses,
	committeeApplicationStatusLabels,
	capabilities,
	positions,
	positionOrder,
	positionLabels,
	allCapabilities,
	adminOnlyCapabilities,
	grantsCapability,
	positionsGranting,
	hasCapability,
	grantableCapabilities,
	grantableBy,
	type Capability,
	type Resource,
	classifiedKindLabel
} from './config';

// Every capability, as the flat "resource.action" strings a guard names.
const everyCapability = Object.entries(capabilities).flatMap(([r, actions]) =>
	(actions as readonly string[]).map((a) => `${r}.${a}` as Capability)
);

describe('the grantable-capability allowlist', () => {
	// Resources whose every action is admin work or moves money, plus the one
	// money-moving action elsewhere. A role or a committee must never carry one.
	const neverGrantable: readonly string[] = ['user', 'audit', 'credit', 'settings', 'lock'];
	const neverGrantableActions: readonly string[] = ['finance.refund'];

	it('names only real capabilities', () => {
		for (const cap of Object.keys(grantableCapabilities)) {
			expect(everyCapability, `${cap} is not a real capability`).toContain(cap);
		}
	});

	it('holds nothing admin-only or money-moving', () => {
		for (const cap of Object.keys(grantableCapabilities)) {
			expect(adminOnlyCapabilities as readonly string[], cap).not.toContain(cap);
			expect(neverGrantable, cap).not.toContain(cap.split('.')[0]);
			expect(neverGrantableActions, cap).not.toContain(cap);
		}
		expect(Object.keys(grantableCapabilities)).not.toContain('finance.refund');
		expect(Object.keys(grantableCapabilities)).not.toContain('user.ban');
	});

	it('says how every entry is carried, with a non-negative grace for roles', () => {
		for (const [cap, rule] of Object.entries(grantableCapabilities)) {
			const r = rule as { role?: { graceDays: number }; committee?: string };
			expect(r.role || r.committee, `${cap} has no carrier`).toBeTruthy();
			if (r.role) expect(r.role.graceDays, cap).toBeGreaterThanOrEqual(0);
		}
	});

	it('lets finance reach a committee only for records it owns', () => {
		for (const [cap, rule] of Object.entries(grantableCapabilities)) {
			if (!cap.startsWith('finance.') || cap === 'finance.collect') continue;
			expect(rule, cap).toMatchObject({ committee: 'owned' });
			expect(rule, cap).not.toHaveProperty('role');
		}
	});

	it('lets a door shift take payments for its show during the shift, and nothing wider', () => {
		// #1630: collecting is a role grant only, with no grace after the shift.
		expect(grantableCapabilities).toHaveProperty('finance.collect', {
			label: expect.any(String),
			role: { graceDays: 0 }
		});
		expect(grantableBy('committee')).not.toContain('finance.collect');
	});

	it('splits the list by carrier', () => {
		expect(grantableBy('role')).toContain('event.uploadRecap');
		expect(grantableBy('role')).not.toContain('sponsor.manage');
		expect(grantableBy('committee')).toContain('sponsor.manage');
		expect(grantableBy('committee')).not.toContain('event.uploadRecap');
	});
});

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

	it('gives staff everything except the admin-only complement', () => {
		// The narrowing. `staff` was identical to `admin` for the whole migration —
		// that is what made sixteen guard-swapping PRs inert — and this is where
		// that stops. A staff holder can no longer grant themselves admin, purge
		// an account, or move credit.
		const withheld = new Set<string>(adminOnlyCapabilities);
		for (const cap of everyCapability) {
			expect(grantsCapability(positions.staff, cap), `staff/${cap}`).toBe(!withheld.has(cap));
		}
	});

	it('withholds from staff only by way of adminOnlyCapabilities', () => {
		// staffCapabilities is derived, so a NEW capability is granted to staff
		// automatically and the only way to withhold one is to name it in the
		// complement. Pinned because the failure direction of a hand-maintained
		// list is silent: a capability forgotten there is one staff quietly gains.
		const missing = everyCapability.filter((c) => !grantsCapability(positions.staff, c));
		expect([...missing].sort()).toEqual([...adminOnlyCapabilities].sort());
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

	it('gives staff the bounded comp and keeps the unbounded adjust admin-only (#579)', () => {
		expect(grantsCapability(positions.staff, 'credit.comp')).toBe(true);
		expect(grantsCapability(positions.staff, 'credit.adjust')).toBe(false);
		expect(grantsCapability(positions.treasurer, 'credit.comp')).toBe(false);
	});

	it('lets exactly admin, staff, the site moderator and volunteer coordinator read incidents (#1466)', () => {
		expect(positionsGranting('incident.read').sort()).toEqual(
			['admin', 'site_moderator', 'staff', 'volunteer_coordinator'].sort()
		);
		expect(grantsCapability(positions.technology_coordinator, 'incident.read')).toBe(false);
		expect(grantsCapability(positions.treasurer, 'incident.read')).toBe(false);
	});

	it('keeps recording an incident with admin and staff (#1466)', () => {
		expect(positionsGranting('incident.record').sort()).toEqual(['admin', 'staff']);
		expect(grantsCapability(positions.site_moderator, 'incident.record')).toBe(false);
		expect(grantsCapability(positions.volunteer_coordinator, 'incident.record')).toBe(false);
	});

	it('lets the treasurer read a production, and no more than read it', () => {
		// The settlement is on the production console, behind `event.read`. A
		// treasurer who cannot open it cannot see where the night's money went
		// (#930). Writing the show stays with the people who run it.
		expect(grantsCapability(positions.treasurer, 'event.read')).toBe(true);
		expect(grantsCapability(positions.treasurer, 'event.manage')).toBe(false);
		expect(grantsCapability(positions.treasurer, 'event.publish')).toBe(false);
		expect(grantsCapability(positions.treasurer, 'event.manageTickets')).toBe(false);
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

describe('committeeApplicationQuestions', () => {
	/**
	 * The Zod schema in `committee-applications.remote.ts` spells its answer
	 * fields out, because a schema built in a loop infers as `{}` and every
	 * field loses its type. This is what stops the two lists drifting: add a
	 * question here and the schema, the form and the chair's view all still
	 * have to learn about it, and this test is where they are told.
	 */
	it('declares exactly the ids the apply form has fields for', () => {
		expect(committeeApplicationQuestions.map((q) => q.id)).toEqual(['experience', 'vision']);
	});

	it('gives every question a prompt, since the prompt is the label', () => {
		for (const question of committeeApplicationQuestions) {
			expect(question.prompt.trim().length).toBeGreaterThan(0);
		}
	});

	it('labels every status, so a badge never renders a raw enum', () => {
		expect(Object.keys(committeeApplicationStatusLabels).sort()).toEqual(
			[...committeeApplicationStatuses].sort()
		);
	});
});

describe('classifiedKindLabel', () => {
	it('reads an offered gear post as for sale, and leaves other categories alone', () => {
		expect(classifiedKindLabel('offered', 'gear')).toBe('For sale');
		expect(classifiedKindLabel('offered', 'service')).toBe('Offered');
		expect(classifiedKindLabel('trade', 'gear')).toBe('Trade');
	});
});
