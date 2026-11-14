import { sql } from 'drizzle-orm';
import { db } from './db';

/**
 * The restock tasks the seeded stock calls for (#2756): one per item at or
 * below its reorder point with nothing on a placed order, linked to the item.
 * The same rule as `syncRestockTasks`, in SQL, since seeders share no server code.
 */
export async function seedRestockTasks() {
	await db.run(sql`
		insert into work_order (id, title, source, source_id)
		select lower(hex(randomblob(16))), 'Restock ' || i.name, 'restock', i.id
		from inventory_item i
		where i.deleted_at is null and i.reorder_point is not null
			and coalesce((select sum(m.quantity) from stock_movement m where m.item_id = i.id), 0)
				<= i.reorder_point
			and not exists (
				select 1 from purchase_order_line l join purchase_order o on o.id = l.order_id
				where l.item_id = i.id and o.status = 'placed' and l.quantity_ordered > l.quantity_received
			)
	`);
	await db.run(sql`
		insert into work_order_link (id, work_order_id, item_id)
		select lower(hex(randomblob(16))), w.id, w.source_id from work_order w
		where w.source = 'restock'
	`);
	const [row] = await db.all<{ n: number }>(
		sql`select count(*) as n from work_order where source = 'restock'`
	);
	return { tasks: row?.n ?? 0 };
}
