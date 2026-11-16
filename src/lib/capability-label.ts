import { capabilities, type Capability, type Resource } from '#lib/config.js';

/** `manageShifts` → "Manage shifts"; `localResource` → "Local resource". */
function words(camel: string): string {
	const spaced = camel.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();
	return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/** Resources whose interface term is not their key (docs/development/writing.md). */
const RESOURCE_LABELS: Partial<Record<Resource, string>> = { instructor: 'Teaching' };

export function resourceLabel(resource: string): string {
	return RESOURCE_LABELS[resource as Resource] ?? words(resource);
}

/** Actions whose interface term is not their key, as for resources above. */
const ACTION_LABELS: Record<string, string> = { manageCertifications: 'Manage clearances' };

export function actionLabel(cap: Capability | string): string {
	const action = cap.slice(cap.indexOf('.') + 1);
	return ACTION_LABELS[action] ?? words(action);
}

/** "Volunteer: Manage shifts" — for a picker, where the group is not on screen. */
export function capabilityLabel(cap: Capability | string): string {
	return `${resourceLabel(cap.slice(0, cap.indexOf('.')))}: ${actionLabel(cap)}`;
}

export interface CapabilityGroup {
	resource: Resource;
	label: string;
	caps: Capability[];
}

/** Capabilities grouped by resource, in the matrix's own order. */
export function groupByResource(caps: readonly string[]): CapabilityGroup[] {
	return (Object.keys(capabilities) as Resource[])
		.map((resource) => ({
			resource,
			label: resourceLabel(resource),
			caps: caps.filter((c) => c.startsWith(`${resource}.`)) as Capability[]
		}))
		.filter((g) => g.caps.length > 0);
}

/** Every capability in the matrix, for the "By permission" picker. */
export const everyCapability = groupByResource(
	Object.entries(capabilities).flatMap(([r, as]) =>
		(as as readonly string[]).map((a) => `${r}.${a}`)
	)
);
