<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import type { Snippet } from 'svelte';
	import { resolve } from '$app/paths';
	import Badge from '#lib/components/ui/Badge.svelte';
	import { shiftLabel } from '#lib/utils/shift-label.js';
	import { formatDateShort } from '#lib/utils/format.js';
	import { isOverdue } from '#lib/utils/work-order-due.js';
	import { whenOf, type ContractorMark, type TaskRow } from '#lib/utils/task-facts.js';

	/**
	 * One task as the Tasks table draws it (#2625). `compact` is the form a
	 * record's `RelatedTasks` card uses: no project column and no actions.
	 * `project={false}` drops the project column on one project's own list.
	 */
	let {
		task: t,
		marks,
		now,
		compact = false,
		project = true,
		waitsOn = [],
		actions,
		href: linkTo
	}: {
		task: TaskRow;
		marks: ContractorMark[];
		now: Date;
		compact?: boolean;
		project?: boolean;
		/** The open tasks it waits on, by name; empty when it is not blocked. */
		waitsOn?: { id: string; label: string }[];
		actions?: Snippet<[{ label: string; href: string }]>;
		/** Where the title links; null draws it as text. A member's card sets it (#2630). */
		href?: string | null;
	} = $props();

	const href = $derived(linkTo === undefined ? resolve('/staff/tasks/[id]', { id: t.id }) : linkTo);
	const label = $derived(shiftLabel(t));
	const when = $derived(whenOf(t));
	const overdue = $derived(!t.resolvedAt && isOverdue(t, now));
	// Blocked is derived on read (#2625): open, with open tasks it waits on.
	const blocked = $derived(!t.resolvedAt && t.blockers > 0);
</script>

<tr class="hover" class:opacity-60={blocked} data-task={t.id} data-blocked={blocked || undefined}>
	<td class="cell-primary">
		{#if href}
			<a {href} class="link truncate font-medium">{label}</a>
		{:else}
			<span class="truncate font-medium">{label}</span>
		{/if}
		{#if t.roleName && t.roleName !== label}
			<div class="truncate text-subtle text-xs">
				{t.roleName}{#if t.eventTitle && t.eventTitle !== label}
					· {t.eventTitle}{/if}
			</div>
		{/if}
		{#if blocked && waitsOn.length > 0}
			<div class="truncate text-subtle text-xs">
				{m.staff_tasks_waits_on_text({ names: waitsOn.map((w) => w.label).join(', ') })}
			</div>
		{/if}
	</td>
	{#if !compact && project}
		<td class="col-support">
			{#if t.projectId}
				<a class="link" href={resolve('/staff/tasks/projects/[id]', { id: t.projectId })}
					>{t.projectName}</a
				>
			{/if}
		</td>
	{/if}
	<td class="whitespace-nowrap">{when ? formatDateShort(when) : ''}</td>
	<td class="col-support">
		{#if marks.length > 0}
			{#each marks as c, i (i)}
				<div class="truncate text-xs">
					{c.name}
					{#if c.late}<Badge variant="error" size="sm">{m.staff_late_label()}</Badge>{/if}
					{#if c.awaitingInvoice}<Badge variant="warning" size="sm"
							>{m.staff_volunteer_schedule_awaiting_invoice_label()}</Badge
						>{/if}
				</div>
			{/each}
		{:else if t.shifts > 0}
			{m.staff_tasks_signed_up_text({ claimed: t.claimed, capacity: t.capacity })}
		{:else if t.assignees > 0}
			{m.staff_tasks_assigned_text({ count: t.assignees })}
		{:else}
			<span class="text-subtle">{m.staff_tasks_unassigned_text()}</span>
		{/if}
	</td>
	<td>
		{#if t.resolvedAt}
			<Badge variant="success" size="sm">{m.staff_done_label()}</Badge>
		{:else if overdue}
			<Badge variant="warning" size="sm">{m.staff_overdue_label()}</Badge>
		{:else if blocked}
			<Badge size="sm">{m.staff_tasks_blocked_label()}</Badge>
		{:else}
			<span class="text-subtle">{m.staff_open_label()}</span>
		{/if}
	</td>
	{#if !compact}
		<td class="w-px">
			{@render actions?.({ label, href: href ?? '' })}
		</td>
	{/if}
</tr>
