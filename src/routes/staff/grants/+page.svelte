<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	/** Grant applications and awards, soonest deadline first. */
	import PageHeader from '#lib/components/ui/PageHeader.svelte';
	import PageContent from '#lib/components/ui/PageContent.svelte';
	import Table from '#lib/components/ui/Table.svelte';
	import Pagination from '#lib/components/ui/Pagination.svelte';
	import Badge from '#lib/components/ui/Badge.svelte';
	import Button from '#lib/components/ui/Button.svelte';
	import EmptyState from '#lib/components/ui/EmptyState.svelte';
	import Action from '#lib/components/ui/Action.svelte';
	import GrantFields from '#lib/components/grant/GrantFields.svelte';
	import { getGrants, createGrant } from '#lib/remote/grants.remote.js';
	import { grantStatusLabels, grantStatusBadge, grantDeadlineLabels } from '#lib/config.js';
	import { formatCents } from '#lib/utils/format.js';
	import { formatIsoDay } from '#lib/utils/deadline.js';
	import { rowLink } from '#lib/actions/row-link.js';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';

	const includeClosed = $derived(page.url.searchParams.get('closed') === '1');
	const { grants, funders } = $derived(await getGrants({ includeClosed }));

	function setClosed(on: boolean) {
		const url = new URL(page.url.href);
		if (on) url.searchParams.set('closed', '1');
		else url.searchParams.delete('closed');
		goto(url, { replace: true, reset: false });
	}
</script>

<PageHeader title={m.staff_grants_title()} subtitle={m.staff_money_body()}>
	<Button href={resolve('staff/grants/funders')} variant="ghost" size="sm"
		>{m.staff_funders_label()}</Button
	>
	{#if funders.length > 0}
		<Action
			action={createGrant}
			label={m.staff_grants_label()}
			modalTitle={m.staff_grants_modal_title()}
			submitLabel={m.staff_grants_submit_label()}
			successToast={m.staff_grants_success_toast()}
		>
			{#snippet form()}
				<GrantFields fields={createGrant.fields} {funders} />
			{/snippet}
		</Action>
	{/if}
</PageHeader>

<PageContent>
	<div class="flex justify-end">
		<label class="label cursor-pointer gap-2 text-sm">
			<input
				type="checkbox"
				class="checkbox checkbox-sm"
				checked={includeClosed}
				onchange={(e) => setClosed(e.currentTarget.checked)}
			/>
			{m.staff_grants_show_closed_label()}
		</label>
	</div>

	{#if funders.length === 0}
		<EmptyState
			title={m.staff_no_funders_yet_title()}
			description={m.staff_grants_add_foundation_agency_first_under_body()}
		/>
	{:else if grants.length === 0}
		<EmptyState
			title={m.staff_grants_no_open_applications_title()}
			description={m.staff_grants_add_grant_applying_with_its_body()}
		/>
	{:else}
		<Table>
			{#snippet head()}
				<th class="w-px"><span class="sr-only">{m.staff_status_label()}</span></th>
				<th>{m.staff_grants_application_label()}</th>
				<th>{m.staff_grants_next_deadline_label()}</th>
				<th class="col-support cell-num">{m.staff_amount_label()}</th>
			{/snippet}
			{#each grants as g (g.id)}
				<tr class="hover cursor-pointer" use:rowLink={resolve(`staff/grants/${g.id}`)}>
					<td class="w-px">
						<Badge variant={grantStatusBadge[g.status]} size="sm">
							{grantStatusLabels[g.status]}
						</Badge>
					</td>
					<td class="cell-primary">
						<a class="link font-medium" href={resolve(`staff/grants/${g.id}`)}>{g.funderName}</a>
						<div class="truncate text-muted">{g.title}</div>
					</td>
					<td class="whitespace-nowrap">
						{#if g.deadline}
							<span class:text-error={g.deadline.overdue}>
								{grantDeadlineLabels[g.deadline.kind]}
								{formatIsoDay(g.deadline.on)}
							</span>
						{:else if g.status === 'applied'}
							<span class="text-muted">{m.staff_grants_awaiting_decision_text()}</span>
						{:else}
							—
						{/if}
					</td>
					<td class="col-support cell-num">
						{#if g.amountAwardedCents != null}
							{formatCents(g.amountAwardedCents)}
						{:else if g.amountRequestedCents != null}
							<span class="text-muted"
								>{m.staff_grants_asked_text({
									formatCents: formatCents(g.amountRequestedCents)
								})}</span
							>
						{:else}
							—
						{/if}
					</td>
				</tr>
			{/each}
		</Table>
		<Pagination total={grants.length} unit="applications" />
	{/if}
</PageContent>
