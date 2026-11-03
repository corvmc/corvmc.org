<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	/**
	 * Work orders — work that needs doing with nobody booked to do it.
	 *
	 * These are the rows with no window. Every forward-looking query on the
	 * volunteering layer filters `starts_at >= now`, and `NULL >= x` is NULL in
	 * SQLite, so an unscheduled row falls out of the member list, the schedule,
	 * the reminder cron and the feedback cron on its own. That is deliberate —
	 * but it also meant nothing anywhere listed them, so the advance half of a
	 * duty list (a `dueOffsetMinutes` item: "Booking Lead, a week out") was
	 * created by `applyDutyList` and then invisible in the whole product.
	 *
	 * Two answers, matching the two the service already offers: **schedule it**,
	 * which gives it a window and turns it into an ordinary claimable shift, and
	 * **close it**, which says the work is done. Closing completes the signups
	 * itself, because the completion cron keys on `ends_at` and can never reach a
	 * row that never had one.
	 */
	import InfoCard from '#lib/components/ui/InfoCard.svelte';
	import Button from '#lib/components/ui/Button.svelte';
	import Table from '#lib/components/ui/Table.svelte';
	import Action from '#lib/components/ui/Action.svelte';
	import FormField from '#lib/components/ui/Form/FormField.svelte';
	import { IconCheck } from '@tabler/icons-svelte';
	import { resolve } from '$app/paths';
	import { formatDateShort, toLocalDateTime } from '#lib/utils/format.js';
	import { scheduleWorkOrder, resolveWorkOrder } from '#lib/remote/volunteer.remote.js';
	import { NO_ROLE_LABEL } from '#lib/utils/shift-label.js';

	type WorkOrder = {
		id: string;
		roleName: string | null;
		eventTitle: string | null;
		dueAt: Date | null;
		capacity: number;
		claimed: number;
		notes: string | null;
	};

	let { orders, total }: { orders: WorkOrder[]; total: number } = $props();

	const now = Date.now();

	/** Late is derived, never stored — the same rule `contractor_job` follows. */
	function isLate(dueAt: Date | null): boolean {
		return dueAt !== null && dueAt.getTime() < now;
	}

	/**
	 * A sensible window to open the schedule form on: the deadline itself where
	 * there is one, otherwise tomorrow — the anchor the rest of this page uses.
	 */
	function defaultStart(dueAt: Date | null): string {
		return toLocalDateTime(dueAt ?? new Date(now + 86_400_000));
	}

	function defaultEnd(dueAt: Date | null): string {
		const base = (dueAt ?? new Date(now + 86_400_000)).getTime();
		return toLocalDateTime(new Date(base + 2 * 3_600_000));
	}
</script>

<InfoCard title={m.staff_volunteer_needs_scheduling_card_title()} state={total}>
	{#snippet action()}
		<Button href="/staff/volunteer/schedule" variant="ghost" size="sm"
			>{m.staff_schedule_2()}</Button
		>
	{/snippet}

	<p class="text-muted">{m.staff_volunteer_needs_scheduling_card_work_orders_without_ti()}</p>

	<Table>
		{#snippet head()}
			<th>{m.staff_role()}</th>
			<th class="col-support whitespace-nowrap">{m.staff_due()}</th>
			<th class="col-support cell-num whitespace-nowrap">{m.staff_text_2()}</th>
			<th class="w-px"><span class="sr-only">{m.staff_actions()}</span></th>
		{/snippet}

		{#each orders as order (order.id)}
			<tr class="hover">
				<td class="cell-primary">
					<a href={resolve(`/staff/volunteer/shifts/${order.id}`)} class="link font-medium">
						{order.roleName ?? NO_ROLE_LABEL}
					</a>
					{#if order.eventTitle}
						<div class="truncate text-subtle">{order.eventTitle}</div>
					{/if}
				</td>

				<td class="col-support whitespace-nowrap">
					{#if order.dueAt}
						<span class:text-error={isLate(order.dueAt)}>
							{isLate(order.dueAt)
								? m.staff_volunteer_needs_scheduling_card_was_due()
								: m.staff_volunteer_needs_scheduling_card_due()}
							{formatDateShort(order.dueAt)}
						</span>
					{:else}
						<span class="text-subtle">{m.staff_volunteer_needs_scheduling_card_no_deadline()}</span>
					{/if}
				</td>

				<td class="col-support cell-num whitespace-nowrap">
					{#if order.claimed > 0}
						{m.staff_volunteer_needs_scheduling_card_text({
							claimed: order.claimed,
							capacity: order.capacity
						})}
					{:else}
						<span class="text-subtle">—</span>
					{/if}
				</td>

				<td class="w-px">
					<div class="flex w-max items-center gap-1">
						<Action
							action={scheduleWorkOrder.for(order.id)}
							label={m.staff_schedule()}
							variant="primary"
							size="xs"
							modalTitle={m.staff_volunteer_needs_scheduling_card_find_time({
								value: order.roleName ?? NO_ROLE_LABEL
							})}
							submitLabel={m.staff_schedule()}
							successToast={m.staff_scheduled()}
						>
							{#snippet form()}
								<input type="hidden" name="id" value={order.id} />
								<p class="text-sm">
									{m.staff_volunteer_needs_scheduling_card_once_has_window_appear()}
								</p>
								<FormField
									name="startsAt"
									label={m.staff_starts()}
									type="datetime-local"
									value={defaultStart(order.dueAt)}
								/>
								<FormField
									name="endsAt"
									label={m.staff_ends()}
									type="datetime-local"
									value={defaultEnd(order.dueAt)}
								/>
								<FormField
									name="closeReportsOnCompletion"
									type="checkbox"
									checkboxLabel={m.staff_volunteer_needs_scheduling_card_checkbox_label()}
									description={m.staff_volunteer_needs_scheduling_card_description()}
								/>
							{/snippet}
						</Action>

						<Action
							action={resolveWorkOrder.for(order.id)}
							label={m.staff_volunteer_needs_scheduling_card_close_work_order()}
							iconOnly
							icon={doneIcon}
							variant="ghost"
							size="sm"
							modalTitle={m.staff_volunteer_needs_scheduling_card_close({
								value: order.roleName ?? NO_ROLE_LABEL
							})}
							submitLabel={m.staff_volunteer_needs_scheduling_card_close_work_order()}
							successToast={m.staff_closed()}
						>
							{#snippet form()}
								<input type="hidden" name="id" value={order.id} />
								<p class="text-sm">
									{m.staff_volunteer_needs_scheduling_card_says_work_finished_whi()}
								</p>
								<FormField name="notes" label={m.staff_what_happened()} type="textarea" />
							{/snippet}
						</Action>
					</div>
				</td>
			</tr>
		{/each}
	</Table>
</InfoCard>

{#snippet doneIcon()}
	<IconCheck size={16} />
{/snippet}
