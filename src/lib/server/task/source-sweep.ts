import { sendUntriagedToRepair } from '#lib/server/inventory/work-request-service.js';
import { syncRestockTasks } from '#lib/server/inventory/restock-tasks.js';
import { syncLateOrderTasks } from '#lib/server/inventory/order-service.js';
import { syncForm8282Tasks } from '#lib/server/inventory/asset-service.js';
import { syncInsuranceTasks } from '#lib/server/contractor/contractor-service.js';

/**
 * The daily pass over every task source (#2756, #2757). Each source also syncs
 * where its record changes; this opens what the clock made due (a late order,
 * a lapsing certificate), and what predates the source or a failed sync.
 * Unmatched door payments are opened by the 15-minute door sweeps instead.
 */
export async function sweepSourcedTasks(now = new Date()) {
	return {
		repair: await sendUntriagedToRepair(),
		restock: await syncRestockTasks(),
		lateOrder: await syncLateOrderTasks(now),
		form8282: await syncForm8282Tasks(now),
		insurance: await syncInsuranceTasks(now)
	};
}
