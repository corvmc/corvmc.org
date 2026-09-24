<script lang="ts">
	/** Grant applications and awards, soonest deadline first. */
	import PageHeader from '$lib/components/ui/PageHeader.svelte';
	import PageContent from '$lib/components/ui/PageContent.svelte';
	import Table from '$lib/components/ui/Table.svelte';
	import Pagination from '$lib/components/ui/Pagination.svelte';
	import Badge from '$lib/components/ui/Badge.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import EmptyState from '$lib/components/ui/EmptyState.svelte';
	import Action from '$lib/components/ui/Action.svelte';
	import GrantFields from '$lib/components/grant/GrantFields.svelte';
	import { getGrants, createGrant } from '$lib/remote/grants.remote';
	import { grantStatusLabels, grantStatusBadge, grantDeadlineLabels } from '$lib/config';
	import { formatCents } from '$lib/utils/format';
	import { formatIsoDay } from '$lib/utils/deadline';
	import { rowLink } from '$lib/actions/row-link';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';

	const includeClosed = $derived(page.url.searchParams.get('closed') === '1');
	const { grants, funders } = $derived(await getGrants({ includeClosed }));

	function setClosed(on: boolean) {
		const url = new URL(page.url);
		if (on) url.searchParams.set('closed', '1');
		else url.searchParams.delete('closed');
		goto(url, { replaceState: true, keepFocus: true, noScroll: true });
	}
</script>

<PageHeader title="Grants" subtitle="Money">
	<Button href={resolve('/staff/grants/funders')} variant="ghost" size="sm">Funders</Button>
	{#if funders.length > 0}
		<Action
			action={createGrant}
			label="New application"
			modalTitle="New grant application"
			submitLabel="Add application"
			successToast="Application added"
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
			Show closed
		</label>
	</div>

	{#if funders.length === 0}
		<EmptyState
			title="No funders yet"
			description="Add the foundation or agency first under Funders, then the application to it."
		/>
	{:else if grants.length === 0}
		<EmptyState
			title="No open applications"
			description="Add a grant you are applying for, with its deadline."
		/>
	{:else}
		<Table>
			{#snippet head()}
				<th class="w-px"><span class="sr-only">Status</span></th>
				<th>Application</th>
				<th>Next deadline</th>
				<th class="col-support cell-num">Amount</th>
			{/snippet}
			{#each grants as g (g.id)}
				<tr class="hover cursor-pointer" use:rowLink={resolve(`/staff/grants/${g.id}`)}>
					<td class="w-px">
						<Badge variant={grantStatusBadge[g.status]} size="sm">
							{grantStatusLabels[g.status]}
						</Badge>
					</td>
					<td class="cell-primary">
						<a class="link font-medium" href={resolve(`/staff/grants/${g.id}`)}>{g.funderName}</a>
						<div class="truncate text-muted">{g.title}</div>
					</td>
					<td class="whitespace-nowrap">
						{#if g.deadline}
							<span class:text-error={g.deadline.overdue}>
								{grantDeadlineLabels[g.deadline.kind]}
								{formatIsoDay(g.deadline.on)}
							</span>
						{:else if g.status === 'applied'}
							<span class="text-muted">Awaiting decision</span>
						{:else}
							—
						{/if}
					</td>
					<td class="col-support cell-num">
						{#if g.amountAwardedCents != null}
							{formatCents(g.amountAwardedCents)}
						{:else if g.amountRequestedCents != null}
							<span class="text-muted">{formatCents(g.amountRequestedCents)} asked</span>
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
