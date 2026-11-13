<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import { resolve } from '$app/paths';
	import { getKitLoanDetail, checkInKit } from '#lib/remote/kit-loans.remote.js';
	import PageHeader from '#lib/components/ui/PageHeader.svelte';
	import PageContent from '#lib/components/ui/PageContent.svelte';
	import InfoCard from '#lib/components/ui/InfoCard.svelte';
	import StatusBadge from '#lib/components/ui/StatusBadge.svelte';
	import Badge from '#lib/components/ui/Badge.svelte';
	import Table from '#lib/components/ui/Table.svelte';
	import Form, { SubmitButton } from '#lib/components/ui/Form/index.js';
	import CheckboxGroup from '#lib/components/ui/Form/CheckboxGroup.svelte';
	import { EntityChip } from '#lib/components/ui/entity/index.js';
	import DefinitionList from '#lib/components/ui/DefinitionList/DefinitionList.svelte';
	import Fact from '#lib/components/ui/DefinitionList/Fact.svelte';
	import { formatDate } from '#lib/utils/format.js';
	import { routeParams } from '#lib/route-params.svelte.js';

	const params = routeParams('id');
	const { fields } = checkInKit;

	let id = $derived(params.id);
	const kit = $derived(await getKitLoanDetail(id));
	const out = $derived(kit.lines.filter((l) => l.out));
	const unitName = (l: { itemName: string | null; assetTag: string | null }) =>
		l.assetTag ? `${l.itemName ?? '—'} · ${l.assetTag}` : (l.itemName ?? '—');
</script>

<PageHeader width="3xl" title={kit.locationName}>
	<StatusBadge status={kit.returnedAt ? 'returned' : 'checked_out'} />
	{#if kit.isOverdue}
		<Badge variant="error" size="md">{m.staff_overdue_label()}</Badge>
	{/if}
</PageHeader>
<PageContent width="3xl">
	<div class="mb-6 grid gap-6 lg:grid-cols-2">
		<InfoCard title={m.staff_details_title()}>
			<DefinitionList>
				<Fact label={m.staff_member_label()}><EntityChip ref={kit.member} /></Fact>
				<Fact label={m.staff_inventory_loans_id_checked_out_label()}>
					{formatDate(kit.checkedOutAt)}
				</Fact>
				{#if kit.dueDate}
					<Fact
						label={m.staff_inventory_loans_id_due_date_label()}
						class={kit.isOverdue ? 'text-error' : ''}>{formatDate(kit.dueDate)}</Fact
					>
				{/if}
				{#if kit.returnedAt}
					<Fact label={m.staff_returned_label()}>{formatDate(kit.returnedAt)}</Fact>
				{/if}
				{#if kit.notes}
					<Fact label={m.staff_notes_label()}>{kit.notes}</Fact>
				{/if}
			</DefinitionList>
		</InfoCard>

		{#if out.length > 0}
			<InfoCard title={m.staff_inventory_kits_check_in_title()}>
				<Form remote={checkInKit} successToast={m.staff_inventory_kits_success_toast()}>
					<input {...fields.kitLoanId.as('hidden', kit.id)} />
					<!-- Unticked units stay on loan to the same member; the kit stays open. -->
					<CheckboxGroup
						field={fields.returnedLoanIds}
						legend={m.staff_inventory_kits_returned_units_title()}
						options={out.map((l) => ({ value: l.loanId, label: unitName(l) }))}
						selected={out.map((l) => l.loanId)}
					/>
					<div class="mt-3">
						<SubmitButton label={m.staff_inventory_kits_check_in_label()} />
					</div>
				</Form>
			</InfoCard>
		{/if}
	</div>

	<InfoCard title={m.staff_inventory_kits_lent_units_title()}>
		<Table>
			{#snippet head()}
				<th class="w-px"><span class="sr-only">{m.staff_status_label()}</span></th>
				<th>{m.staff_unit_label()}</th>
			{/snippet}
			{#each kit.lines as l (l.loanId)}
				<tr>
					<td class="w-px"><StatusBadge status={l.status} label /></td>
					<td class="cell-primary">
						<a href={resolve('/staff/inventory/loans/[id]', { id: l.loanId })} class="link"
							>{unitName(l)}</a
						>
					</td>
				</tr>
			{/each}
		</Table>
	</InfoCard>
</PageContent>
