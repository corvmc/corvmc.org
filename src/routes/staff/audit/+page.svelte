<script lang="ts">
	import SearchInput from '$lib/components/ui/Form/SearchInput.svelte';
	import Select from '$lib/components/ui/Form/Select.svelte';
	import PageHeader from '$lib/components/ui/PageHeader.svelte';
	import PageContent from '$lib/components/ui/PageContent.svelte';
	import DataList from '$lib/components/ui/DataList.svelte';
	import Table from '$lib/components/ui/Table.svelte';
	import FilterBar from '$lib/components/ui/FilterBar.svelte';
	import { EntityChip } from '$lib/components/ui/entity';
	import { getAuditLog } from '$lib/remote/audit.remote';
	import { auditActions, type AuditAction } from '$lib/types/audit';
	import { auditActionLabel, summarizeAuditEntry } from '$lib/utils/audit-display';
	import { formatDateTimeShort } from '$lib/utils/format';

	// `searchText`, not `search`: FilterBar's `search` snippet shadows a same-named binding.
	let searchText = $state('');
	let actor = $state('');
	let action = $state<AuditAction | ''>('');
	let dateFrom = $state('');
	let dateTo = $state('');
	let page = $state(1);

	let result = $derived(
		getAuditLog({
			action: action || undefined,
			actor: actor || undefined,
			from: dateFrom || undefined,
			to: dateTo || undefined,
			page
		})
	);

	const activeFilterCount = $derived(
		(actor ? 1 : 0) + (action ? 1 : 0) + (dateFrom ? 1 : 0) + (dateTo ? 1 : 0)
	);

	function clearFilters() {
		searchText = '';
		actor = '';
		action = '';
		dateFrom = '';
		dateTo = '';
		page = 1;
	}
</script>

<PageHeader title="Audit Log" />
<PageContent>
	<FilterBar activeCount={activeFilterCount} onclear={clearFilters}>
		{#snippet search()}
			<SearchInput
				bind:value={searchText}
				placeholder="Search by who acted..."
				onsearch={(q) => {
					actor = q;
					page = 1;
				}}
			/>
		{/snippet}
		<Select
			size="sm"
			aria-label="Action"
			value={action}
			onchange={(e: Event) => {
				action = (e.currentTarget as HTMLSelectElement).value as AuditAction | '';
				page = 1;
			}}
		>
			<option value="">All actions</option>
			{#each auditActions as value (value)}
				<option {value}>{auditActionLabel(value)}</option>
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

	<DataList {result} empty="No audit entries found" onpage={(p) => (page = p)}>
		{#snippet children(entries)}
			<Table>
				{#snippet head()}
					<th>What happened</th>
					<th>Account</th>
					<th class="col-support">By</th>
				{/snippet}
				{#each entries as entry (entry.id)}
					<tr>
						<td class="cell-primary">
							<div class="truncate">{summarizeAuditEntry(entry)}</div>
							<div class="text-muted whitespace-nowrap">
								{formatDateTimeShort(entry.createdAt)}
							</div>
						</td>
						<td class="min-w-0"><EntityChip ref={entry.subject} /></td>
						<td class="col-support min-w-0"><EntityChip ref={entry.actor} icon={false} /></td>
					</tr>
				{/each}
			</Table>
		{/snippet}
	</DataList>
</PageContent>
