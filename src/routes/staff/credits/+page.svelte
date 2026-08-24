<script lang="ts">
	import SearchInput from '$lib/components/shared/Form/SearchInput.svelte';
	import PageHeader from '$lib/components/shared/PageHeader.svelte';
	import PageContent from '$lib/components/shared/PageContent.svelte';
	import DataList from '$lib/components/shared/DataList.svelte';
	import Table from '$lib/components/shared/Table.svelte';
	import FilterBar from '$lib/components/shared/FilterBar.svelte';
	import Select from '$lib/components/shared/Form/Select.svelte';
	import Badge from '$lib/components/shared/Badge.svelte';
	import { EntityIdentity } from '$lib/components/shared/entity';
	import { getStaffCredits } from '$lib/remote/users.remote';
	import { formatDateTimeShort, titleCase } from '$lib/utils/format';
	import { creditSourceLabels } from '$lib/config';

	function sourceLabel(source: string): string {
		return creditSourceLabels[source] ?? titleCase(source);
	}

	// `searchText`, not `search`: FilterBar's always-visible slot is a snippet
	// named `search`, and a snippet shadows a same-named script binding.
	let searchText = $state('');
	let creditType = $state('');
	let source = $state('');
	let dateFrom = $state('');
	let dateTo = $state('');
	let page = $state(1);

	let searchDebounced = $state('');
	let filters = $derived({
		search: searchDebounced || undefined,
		creditType: creditType || undefined,
		source: source || undefined,
		from: dateFrom || undefined,
		to: dateTo || undefined,
		page
	});

	let result = $derived(getStaffCredits(filters));

	const activeFilterCount = $derived(
		(searchDebounced ? 1 : 0) +
			(creditType ? 1 : 0) +
			(source ? 1 : 0) +
			(dateFrom ? 1 : 0) +
			(dateTo ? 1 : 0)
	);

	function clearFilters() {
		searchText = '';
		searchDebounced = '';
		creditType = '';
		source = '';
		dateFrom = '';
		dateTo = '';
		page = 1;
	}
</script>

<PageHeader title="Credit Transactions" />
<PageContent>
	<FilterBar activeCount={activeFilterCount} onclear={clearFilters}>
		{#snippet search()}
			<SearchInput
				bind:value={searchText}
				placeholder="Search name or email..."
				onsearch={(q) => {
					searchDebounced = q;
					page = 1;
				}}
			/>
		{/snippet}
		<Select
			size="sm"
			aria-label="Credit type"
			value={creditType}
			onchange={(e: Event) => {
				creditType = (e.currentTarget as HTMLSelectElement).value;
				page = 1;
			}}
		>
			<option value="">All types</option>
			<option value="free_hours">Free Hours</option>
			<option value="equipment_credits">Equipment Credits</option>
		</Select>
		<Select
			size="sm"
			aria-label="Source"
			value={source}
			onchange={(e: Event) => {
				source = (e.currentTarget as HTMLSelectElement).value;
				page = 1;
			}}
		>
			<option value="">All sources</option>
			{#each Object.entries(creditSourceLabels) as [value, label] (value)}
				<option {value}>{label}</option>
			{/each}
		</Select>
		<input
			type="date"
			aria-label="From date"
			class="input input-sm"
			bind:value={dateFrom}
			onchange={() => {
				page = 1;
			}}
		/>
		<input
			type="date"
			aria-label="To date"
			class="input input-sm"
			bind:value={dateTo}
			onchange={() => {
				page = 1;
			}}
		/>
	</FilterBar>

	<DataList {result} empty="No credit transactions found" onpage={(p) => (page = p)}>
		{#snippet children(transactions)}
			<Table>
				{#snippet head()}
					<th>Member</th>
					<th class="col-extra whitespace-nowrap">Type</th>
					<th class="cell-num">Amount</th>
					<th class="col-support cell-num">Balance</th>
					<th class="col-support">Date</th>
				{/snippet}

				{#each transactions as t (t.id)}
					<tr class="hover">
						<!--
							Primary cell. The Source column is gone: `description` is the
							human-readable form of the same fact ("Applied to reservation" vs
							`reservation`), so it becomes the subline and the raw enum never
							reaches the page. Source remains a filter.
						-->
						<td class="cell-primary">
							<EntityIdentity ref={t.member}>
								{#snippet subtitle()}
									{t.description || sourceLabel(t.source)}
								{/snippet}
							</EntityIdentity>
						</td>
						<td class="col-extra whitespace-nowrap">
							<Badge size="sm" variant="ghost">
								{t.creditType === 'free_hours' ? 'Free hours' : 'Equipment'}
							</Badge>
						</td>
						<td class="cell-num">
							<span class={t.amount > 0 ? 'font-medium text-success' : 'font-medium text-error'}>
								{t.amount > 0 ? '+' : ''}{t.amount}
							</span>
						</td>
						<td class="col-support cell-num">{t.balanceAfter}</td>
						<td class="col-support whitespace-nowrap">
							{formatDateTimeShort(new Date(t.createdAt))}
						</td>
					</tr>
				{/each}
			</Table>
		{/snippet}
	</DataList>
</PageContent>
