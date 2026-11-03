<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	/**
	 * Scheduled repairs whose window has passed with their equipment reports still
	 * open, because staff did not flag them "close reports on completion" (#1544).
	 * Resolving closes the work order and its reports, and tells each reporter.
	 */
	import InfoCard from '$lib/components/ui/InfoCard.svelte';
	import Table from '$lib/components/ui/Table.svelte';
	import Action from '$lib/components/ui/Action.svelte';
	import FormField from '$lib/components/ui/Form/FormField.svelte';
	import { resolve } from '$app/paths';
	import { formatDateShort } from '$lib/utils/format';
	import { resolveWorkOrder } from '$lib/remote/volunteer.remote';
	import { NO_ROLE_LABEL } from '$lib/utils/shift-label';

	type FinishedOrder = {
		id: string;
		title: string | null;
		roleName: string | null;
		endsAt: Date | null;
		unitName: string | null;
		assetTag: string | null;
		reports: number;
	};

	let { orders, total }: { orders: FinishedOrder[]; total: number } = $props();

	function subject(o: FinishedOrder): string {
		if (o.unitName) return o.assetTag ? `${o.unitName} (${o.assetTag})` : o.unitName;
		return o.title ?? o.roleName ?? NO_ROLE_LABEL;
	}
</script>

<InfoCard title={m.staff_volunteer_confirm_fixed_card_title()} state={total}>
	<p class="text-muted">{m.staff_volunteer_confirm_fixed_card_finished_work_orders_with()}</p>

	<Table>
		{#snippet head()}
			<th>{m.staff_work()}</th>
			<th class="col-support whitespace-nowrap">{m.staff_finished()}</th>
			<th class="col-support cell-num whitespace-nowrap"
				>{m.staff_volunteer_confirm_fixed_card_reports()}</th
			>
			<th class="w-px"><span class="sr-only">{m.staff_actions()}</span></th>
		{/snippet}

		{#each orders as order (order.id)}
			<tr class="hover">
				<td class="cell-primary">
					<a href={resolve(`/staff/volunteer/shifts/${order.id}`)} class="link font-medium">
						{subject(order)}
					</a>
					<div class="truncate text-subtle">{order.roleName ?? NO_ROLE_LABEL}</div>
				</td>
				<td class="col-support whitespace-nowrap">
					{order.endsAt ? formatDateShort(order.endsAt) : '—'}
				</td>
				<td class="col-support cell-num">{order.reports}</td>
				<td class="w-px">
					<Action
						action={resolveWorkOrder.for(order.id)}
						label={m.staff_volunteer_confirm_fixed_card_verify()}
						variant="primary"
						size="xs"
						modalTitle={m.staff_volunteer_confirm_fixed_card_modal_title({
							subject: subject(order)
						})}
						submitLabel={m.staff_volunteer_confirm_fixed_card_verify()}
						successToast={m.staff_volunteer_confirm_fixed_card_success_toast()}
					>
						{#snippet form()}
							<input {...resolveWorkOrder.for(order.id).fields.id.as('hidden', order.id)} />
							<p class="text-sm">
								{m.staff_volunteer_confirm_fixed_card_closes_work_order_its_rep({
									reports: order.reports
								})}
							</p>
							<FormField
								field={resolveWorkOrder.for(order.id).fields.notes}
								label={m.staff_volunteer_confirm_fixed_card_what_was_done()}
								type="textarea"
							/>
						{/snippet}
					</Action>
				</td>
			</tr>
		{/each}
	</Table>
</InfoCard>
