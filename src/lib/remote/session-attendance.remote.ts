import { z } from 'zod';
import { error } from '@sveltejs/kit';
import { query } from '$app/server';
import { form } from './_remote';
import { requireProgramRole } from '#lib/server/group/group-context.js';
import { getById as getEventById } from '#lib/server/event/event-service.js';
import {
	listSessionAttendance,
	setSessionAttendance
} from '#lib/server/event/attendance-service.js';

/**
 * Who came to a program session. A lead's tool, guarded as every other session
 * write is: `requireProgramRole(ref, 'admin')`, then the event re-scoped to
 * that group, because the event id is the client's.
 */

const sessionRef = z.object({
	groupId: z.string().min(1),
	eventId: z.string().min(1)
});

async function requireOwnSession(data: { groupId: string; eventId: string }) {
	const { user, group } = await requireProgramRole({ id: data.groupId }, 'admin');
	const evt = await getEventById(data.eventId);
	if (!evt || evt.groupId !== group.id) error(404, 'Session not found');
	return { user, group, evt };
}

export const getSessionAttendance = query(sessionRef, async (data) => {
	const { group, evt } = await requireOwnSession(data);
	return listSessionAttendance(evt.id, group.id);
});

export const markSessionAttendance = form(
	sessionRef.extend({
		// An unticked list submits nothing, so absent means nobody came.
		attended: z.array(z.string().min(1)).max(500).default([])
	}),
	async (data) => {
		const { user, group, evt } = await requireOwnSession(data);
		if (evt.status === 'cancelled') error(409, 'A cancelled session has no attendance');
		await setSessionAttendance({
			eventId: evt.id,
			groupId: group.id,
			userIds: data.attended,
			markedByUserId: user.id
		});
		void getSessionAttendance({ groupId: data.groupId, eventId: data.eventId }).refresh();
		return { success: true };
	}
);
