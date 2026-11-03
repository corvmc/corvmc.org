<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	import SearchInput from '$lib/components/ui/Form/SearchInput.svelte';
	import PageHeader from '$lib/components/ui/PageHeader.svelte';
	import PageContent from '$lib/components/ui/PageContent.svelte';
	import DataList from '$lib/components/ui/DataList.svelte';
	import Table from '$lib/components/ui/Table.svelte';
	import FilterBar from '$lib/components/ui/FilterBar.svelte';
	import Select from '$lib/components/ui/Form/Select.svelte';
	import Badge from '$lib/components/ui/Badge.svelte';
	import { EntityIdentity } from '$lib/components/ui/entity';
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

<PageHeader title={m.staff_credits_title()} />
<PageContent>
	<FilterBar activeCount={activeFilterCount} onclear={clearFilters}>
		{#snippet search()}
			<SearchInput
				bind:value={searchText}
				placeholder={m.staff_search_name_email()}
				onsearch={(q) => {
					searchDebounced = q;
					page = 1;
				}}
			/>
		{/snippet}
		<Select
			size="sm"
			aria-label={m.staff_credits_credit_type()}
			value={creditType}
			onchange={(e: Event) => {
				creditType = (e.currentTarget as HTMLSelectElement).value;
				page = 1;
			}}
		>
			<option value="">{m.staff_credits_all_types()}</option>
			<option value="free_hours">{m.staff_credits_free_hours()}</option>
			<option value="equipment_credits">{m.staff_credits_equipment_credits()}</option>
		</Select>
		<Select
			size="sm"
			aria-label={m.staff_source()}
			value={source}
			onchange={(e: Event) => {
				source = (e.currentTarget as HTMLSelectElement).value;
				page = 1;
			}}
		>
			<option value="">{m.staff_credits_all_sources()}</option>
			{#each Object.entries(creditSourceLabels) as [value, label] (value)}
				<option {value}>{label}</option>
			{/each}
		</Select>
		<input
			type="date"
			aria-label={m.staff_from_date()}
			class="input input-sm"
			bind:value={dateFrom}
			onchange={() => {
				page = 1;
			}}
		/>
		<input
			type="date"
			aria-label={m.staff_date_2()}
			class="input input-sm"
			bind:value={dateTo}
			onchange={() => {
				page = 1;
			}}
		/>
	</FilterBar>

	<DataList {result} empty={m.staff_credits_empty()} onpage={(p) => (page = p)}>
		{#snippet children(transactions)}
			<Table>
				{#snippet head()}
					<th>{m.staff_member()}</th>
					<th class="col-extra whitespace-nowrap">{m.staff_type()}</th>
					<th class="cell-num">{m.staff_amount()}</th>
					<th class="col-support cell-num">{m.staff_credits_balance()}</th>
					<th class="col-support">{m.staff_date()}</th>
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
