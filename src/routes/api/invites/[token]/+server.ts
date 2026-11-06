import type { RequestHandler } from './$types';
import { getByToken } from '#lib/server/group/group-invite-service.js';

export const GET: RequestHandler = async ({ params }) => {
	const result = await getByToken(params.token);

	if (!result) {
		return Response.json({ error: 'Invite not found or expired' }, { status: 404 });
	}

	return Response.json({
		groupName: result.groupName,
		inviterName: result.inviterName,
		role: result.role,
		email: result.email
	});
};
