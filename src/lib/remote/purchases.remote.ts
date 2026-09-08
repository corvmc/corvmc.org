/**
 * The member's own receipts.
 *
 * One query for the whole page: it spans two domains, and a component that
 * fans several remote queries out is a lint error here and a render loop past
 * kit 2.64.
 */
import { query } from '$app/server';
import { requireUser } from '$lib/server/authorization';
import { listPurchasesForUser } from '$lib/server/purchase/purchase-service';

export const getMyPurchases = query(async () => {
	const user = requireUser();
	return listPurchasesForUser(user.id);
});
