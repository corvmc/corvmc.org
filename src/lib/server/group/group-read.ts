import type { Capability } from '#lib/config.js';

/** Reading a group's panel: `band.read` for a band, `group.read` for a club or committee. */
export const groupRead = (group: { kind: string }): Capability =>
	group.kind === 'band' ? 'band.read' : 'group.read';

/** Staff oversight of a club or committee: `committee.manage` for a committee (#3009). */
export const programManage = (group: { kind: string }): Capability =>
	group.kind === 'committee' ? 'committee.manage' : 'group.manage';
