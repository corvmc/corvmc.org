<script lang="ts">
	/** Grants and sponsorships, soonest deadline first. */
	import PageHeader from '$lib/components/ui/PageHeader.svelte';
	import PageContent from '$lib/components/ui/PageContent.svelte';
	import Table from '$lib/components/ui/Table.svelte';
	import Pagination from '$lib/components/ui/Pagination.svelte';
	import Badge from '$lib/components/ui/Badge.svelte';
	import EmptyState from '$lib/components/ui/EmptyState.svelte';
	import Action from '$lib/components/ui/Action.svelte';
	import AgreementFields from '$lib/components/agreement/AgreementFields.svelte';
	import { getAgreements, createAgreement } from '$lib/remote/agreements.remote';
	import {
		agreementKindLabels,
		agreementStatusLabels,
		agreementStatusBadge,
		agreementDeadlineLabels
	} from '$lib/config';
	import { formatCents, formatDateShortYear } from '$lib/utils/format';
	import { rowLink } from '$lib/actions/row-link';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';

	const includeClosed = $derived(page.url.searchParams.get('closed') === '1');
	const agreements = $derived(await getAgreements({ includeClosed }));

	function setClosed(on: boolean) {
		const url = new URL(page.url);
		if (on) url.searchParams.set('closed', '1');
		else url.searchParams.delete('closed');
		goto(url, { replaceState: true, keepFocus: true, noScroll: true });
	}

	/** A `YYYY-MM-DD` read as that calendar day, not as UTC midnight. */
	function day(iso: string): string {
		return formatDateShortYear(new Date(`${iso}T12:00:00`));
	}
</script>

<PageHeader title="Grants & sponsors" subtitle="Money">
	<Action
		action={createAgreement}
		label="New agreement"
		modalTitle="New agreement"
		submitLabel="Add agreement"
		successToast="Agreement added"
	>
		{#snippet form()}
			<AgreementFields fields={createAgreement.fields} />
		{/snippet}
	</Action>
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

	{#if agreements.length === 0}
		<EmptyState
			title="No agreements yet"
			description="Add a grant you are applying for or a business that sponsors the collective, with the dates that come due."
		/>
	{:else}
		<Table>
			{#snippet head()}
				<th class="w-px"><span class="sr-only">Status</span></th>
				<th>Agreement</th>
				<th>Next deadline</th>
				<th class="col-support cell-num">Amount</th>
				<th class="col-extra">Kind</th>
			{/snippet}
			{#each agreements as a (a.id)}
				<tr class="hover cursor-pointer" use:rowLink={resolve(`/staff/agreements/${a.id}`)}>
					<td class="w-px">
						<Badge variant={agreementStatusBadge[a.status]} size="sm">
							{agreementStatusLabels[a.status]}
						</Badge>
					</td>
					<td class="cell-primary">
						<a class="link font-medium" href={resolve(`/staff/agreements/${a.id}`)}>
							{a.counterparty}
						</a>
						<div class="truncate text-muted">{a.title}</div>
					</td>
					<td class="whitespace-nowrap">
						{#if a.deadline}
							<span class:text-error={a.deadline.overdue}>
								{agreementDeadlineLabels[a.deadline.kind]}
								{day(a.deadline.on)}
							</span>
						{:else if a.status === 'applied'}
							<span class="text-muted">Awaiting decision</span>
						{:else}
							—
						{/if}
					</td>
					<td class="col-support cell-num">
						{a.amountCents != null ? formatCents(a.amountCents) : '—'}
					</td>
					<td class="col-extra">{agreementKindLabels[a.kind]}</td>
				</tr>
			{/each}
		</Table>
		<Pagination total={agreements.length} unit="agreements" />
	{/if}
</PageContent>
