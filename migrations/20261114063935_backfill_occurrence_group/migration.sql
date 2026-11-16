-- Open recurring occurrences take their schedule's committee (#2987).
UPDATE work_order
SET group_id = (
	SELECT ms.group_id FROM maintenance_schedule ms WHERE ms.id = work_order.maintenance_schedule_id
)
WHERE group_id IS NULL
	AND resolved_at IS NULL
	AND cancelled_at IS NULL
	AND maintenance_schedule_id IN (
		SELECT id FROM maintenance_schedule WHERE group_id IS NOT NULL
	);
