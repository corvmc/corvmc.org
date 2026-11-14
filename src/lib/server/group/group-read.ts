import type { Capability } from '#lib/config.js';

/** Reading a group's panel: `band.read` for a band, `group.read` for a club or committee. */
export const groupRead = (group: { kind: string }): Capability =>
	group.kind === 'band' ? 'band.read' : 'group.read';
