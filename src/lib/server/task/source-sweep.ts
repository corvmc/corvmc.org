import { sendUntriagedToRepair } from '#lib/server/inventory/work-request-service.js';
import { syncRestockTasks } from '#lib/server/inventory/restock-tasks.js';

/**
 * The daily pass over every task source (#2756). Each source also opens and
 * closes its tasks where its record changes; this catches records already in
 * that state when the source was added, and any write whose sync failed.
 */
export async function sweepSourcedTasks() {
	const repair = await sendUntriagedToRepair();
	const restock = await syncRestockTasks();
	return { repair, restock };
}
