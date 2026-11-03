<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import SearchInput from '#lib/components/ui/Form/SearchInput.svelte';
	import Select from '#lib/components/ui/Form/Select.svelte';
	import PageHeader from '#lib/components/ui/PageHeader.svelte';
	import PageContent from '#lib/components/ui/PageContent.svelte';
	import DataList from '#lib/components/ui/DataList.svelte';
	import Table from '#lib/components/ui/Table.svelte';
	import FilterBar from '#lib/components/ui/FilterBar.svelte';
	import { EntityChip } from '#lib/components/ui/entity/index.js';
	import { getAuditLog } from '#lib/remote/audit.remote.js';
	import { auditActions, type AuditAction } from '#lib/types/audit.js';
	import { auditActionLabel, summarizeAuditEntry } from '#lib/utils/audit-display.js';
	import { formatDateTimeShort } from '#lib/utils/format.js';

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

<PageHeader title={m.staff_audit_title()} />
<PageContent>
	<FilterBar activeCount={activeFilterCount} onclear={clearFilters}>
		{#snippet search()}
			<SearchInput
				bind:value={searchText}
				placeholder={m.staff_audit_placeholder()}
				onsearch={(q) => {
					actor = q;
					page = 1;
				}}
			/>
		{/snippet}
		<Select
			size="sm"
			aria-label={m.staff_audit_action()}
			value={action}
			onchange={(e: Event) => {
				action = (e.currentTarget as HTMLSelectElement).value as AuditAction | '';
				page = 1;
			}}
		>
			<option value="">{m.staff_audit_all_actions()}</option>
			{#each auditActions as value (value)}
				<option {value}>{auditActionLabel(value)}</option>
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

	<DataList {result} empty={m.staff_audit_empty()} onpage={(p) => (page = p)}>
		{#snippet children(entries)}
			<Table>
				{#snippet head()}
					<th>{m.staff_what_happened()}</th>
					<th>{m.staff_audit_account()}</th>
					<th class="col-support">{m.staff_by_2()}</th>
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
