import { sql } from 'drizzle-orm';
import { db } from './db';

/**
 * The tasks seeded records call for (#2756, #2757): restock, late orders, Form
 * 8282 filings and lapsing insurance, one per record, linked as the app links
 * them. The services' rules, in SQL, since seeders share no server code.
 */
export async function seedSourcedTasks() {
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
		insert into work_order (id, title, source, source_id)
		select lower(hex(randomblob(16))),
			'Chase late order' || coalesce(' from ' || g.name, '') || coalesce(' (' || o.reference || ')', ''),
			'late_order', o.id
		from purchase_order o left join organization g on g.id = o.organization_id
		where o.status = 'placed' and o.expected_at < unixepoch()
			and exists (
				select 1 from purchase_order_line l
				where l.order_id = o.id and l.quantity_received < l.quantity_ordered
			)
	`);
	await db.run(sql`
		insert into work_order (id, title, source, source_id, due_at)
		select lower(hex(randomblob(16))),
			'File Form 8282 for ' || i.name || coalesce(' (' || a.asset_tag || ')', ''),
			'form_8282', a.id, a.retired_at + 125 * 86400
		from inventory_asset a
		join inventory_item i on i.id = a.item_id
		join acquisition q on q.id = a.acquisition_id
		where q.kind = 'donation' and q.acknowledged_at is not null
			and a.retired_at is not null and a.form_8282_resolved_at is null
			and a.retired_at < q.occurred_at + 1095 * 86400
	`);
	await db.run(sql`
		insert into work_order (id, title, source, source_id, due_at)
		select lower(hex(randomblob(16))),
			'Get a new insurance certificate from ' || g.name, 'insurance', g.id, d.insurance_expires_at
		from contractor_detail d join organization g on g.id = d.organization_id
		where g.archived_at is null and d.insurance_expires_at is not null
			and d.insurance_expires_at <= unixepoch() + 30 * 86400
	`);
	await db.run(sql`
		insert into work_order_link (id, work_order_id, item_id, asset_id, organization_id)
		select lower(hex(randomblob(16))), w.id,
			case when w.source = 'restock' then w.source_id end,
			case when w.source = 'form_8282' then w.source_id end,
			case
				when w.source = 'insurance' then w.source_id
				else (select o.organization_id from purchase_order o
					where w.source = 'late_order' and o.id = w.source_id)
			end
		from work_order w
		where w.source in ('restock', 'form_8282', 'insurance')
			or (w.source = 'late_order'
				and (select o.organization_id from purchase_order o where o.id = w.source_id) is not null)
	`);
	const rows = await db.all<{ source: string; n: number }>(
		sql`select source, count(*) as n from work_order
			where source in ('restock', 'late_order', 'form_8282', 'insurance') group by source`
	);
	return Object.fromEntries(rows.map((r) => [r.source, r.n])) as Record<string, number>;
}
