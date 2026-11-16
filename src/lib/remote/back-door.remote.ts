import { z } from 'zod';
import { query } from '$app/server';
import { command } from './_remote';
import { requireUser } from '#lib/server/authorization.js';
import { checkOut, getDoorState, openDoor } from '#lib/server/lock/door-service.js';

// The back-door page (#2120). Each mutation re-checks that the booking is the
// member's and open now: the id comes from the client.

/** The member's open booking, its check-in state, and the code it already holds. */
export const getBackDoor = query(async () => {
	const user = requireUser();
	return getDoorState(user.id);
});

/** Check in, or re-enter once checked in. */
export const openBackDoor = command(z.string().min(1), async (reservationId) => {
	const user = requireUser();
	const result = await openDoor(user.id, reservationId);
	void getBackDoor().refresh();
	return result;
});

/** Lock up and check out. */
export const checkOutBackDoor = command(z.string().min(1), async (reservationId) => {
	const user = requireUser();
	const result = await checkOut(user.id, reservationId);
	void getBackDoor().refresh();
	return result;
});
