<script lang="ts">
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

<InfoCard title="Unverified Repairs" state={total}>
	<p class="text-muted">Finished work orders with open problem reports.</p>

	<Table>
		{#snippet head()}
			<th>Work</th>
			<th class="col-support whitespace-nowrap">Finished</th>
			<th class="col-support cell-num whitespace-nowrap">Reports</th>
			<th class="w-px"><span class="sr-only">Actions</span></th>
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
						label="Verify"
						variant="primary"
						size="xs"
						modalTitle="Verify {subject(order)} is fixed?"
						submitLabel="Verify"
						successToast="Verified"
					>
						{#snippet form()}
							<input type="hidden" name="id" value={order.id} />
							<p class="text-sm">
								Closes the work order and its {order.reports}
								{order.reports === 1 ? 'report' : 'reports'}, and tells each reporter it was fixed.
							</p>
							<FormField name="notes" label="What was done" type="textarea" />
						{/snippet}
					</Action>
				</td>
			</tr>
		{/each}
	</Table>
</InfoCard>
