import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import WhyCanAct from './WhyCanAct.svelte';
import { allCapabilities, positionDescriptions, type Capability } from '#lib/config.js';
import { capabilityLabel } from '#lib/capability-label.js';

const adminCaps = Object.entries(allCapabilities).flatMap(([resource, actions]) =>
	(actions as string[]).map((a) => `${resource}.${a}` as Capability)
);

const project = 'Fall show';

const why = {
	positions: [{ position: 'admin' as const, capabilities: adminCaps }],
	departments: [
		{
			groupId: 'g1',
			name: 'Events committee',
			positions: ['Chair'],
			grants: [{ capability: 'event.read' as Capability, reach: 'owned' as const }],
			projects: [{ projectId: 'p1', name: project, via: 'deliverable' as const }]
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
		const text = container.textContent ?? '';
		expect(text).toContain(positionDescriptions.admin);
		expect(container.querySelector('details')).toBeNull();
		expect(adminCaps.filter((cap) => text.includes(capabilityLabel(cap)))).toEqual([]);
		expect(text).not.toContain(project);
	});

	it('folds each permission list on the staff view', async () => {
		const { container } = await render(WhyCanAct, { why, showPermissions: true });
		const folds = [...container.querySelectorAll<HTMLDetailsElement>('details')];
		expect(folds).toHaveLength(3);
		expect(folds.every((d) => !d.open)).toBe(true);
		const listed = folds.flatMap((d) =>
			[...d.querySelectorAll('li')].map((li) => li.textContent?.trim())
		);
		expect(adminCaps.filter((cap) => !listed.includes(capabilityLabel(cap)))).toEqual([]);
		expect(container.textContent).toContain(project);
	});
});

describe('positionDescriptions', () => {
	it('is one sentence per position', () => {
		for (const sentence of Object.values(positionDescriptions)) {
			expect(sentence).toMatch(/^[A-Z][^.]*\.$/);
		}
	});
});
