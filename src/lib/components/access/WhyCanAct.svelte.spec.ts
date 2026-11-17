import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import WhyCanAct from './WhyCanAct.svelte';
import { allCapabilities, positionDescriptions, type Capability } from '#lib/config.js';

const adminCaps = Object.entries(allCapabilities).flatMap(([resource, actions]) =>
	(actions as string[]).map((a) => `${resource}.${a}` as Capability)
);

const why = {
	positions: [{ position: 'admin' as const, capabilities: adminCaps }],
	departments: [
		{
			groupId: 'g1',
			name: 'Events committee',
			positions: ['Chair'],
			grants: [{ capability: 'event.read' as Capability, reach: 'owned' as const }],
			projects: [{ projectId: 'p1', name: 'Fall show', via: 'deliverable' as const }]
		}
	],
	shiftRoles: [
		{
			roleName: 'Door',
			eventId: 'e1',
			eventTitle: 'Friday show',
			capabilities: ['event.read' as Capability]
		}
	]
} as never;

describe('WhyCanAct', () => {
	it('describes a position in one sentence and lists no permissions', async () => {
		const { container } = await render(WhyCanAct, { why });
		const positions = container.querySelector('[data-testid="why-positions"]')!;
		expect(positions.textContent).toContain(positionDescriptions.admin);
		expect(container.querySelectorAll('[data-testid="why-permissions"]')).toHaveLength(0);
		expect(container.querySelector('[data-testid="why-projects"]')).toBeNull();
		// Name and sentence only: no capability rows under any card.
		expect(positions.querySelectorAll('li li')).toHaveLength(0);
	});

	it('folds each permission list on the staff view', async () => {
		const { container } = await render(WhyCanAct, { why, showPermissions: true });
		const folds = [
			...container.querySelectorAll<HTMLDetailsElement>('[data-testid="why-permissions"]')
		];
		expect(folds).toHaveLength(3);
		expect(folds.every((d) => !d.open)).toBe(true);
		const positionFold = container.querySelector(
			'[data-testid="why-positions"] [data-testid="why-permissions"]'
		)!;
		expect(positionFold.querySelectorAll('li')).toHaveLength(adminCaps.length);
	});
});

describe('positionDescriptions', () => {
	it('is one sentence per position', () => {
		for (const sentence of Object.values(positionDescriptions)) {
			expect(sentence).toMatch(/^[A-Z][^.]*\.$/);
		}
	});
});
