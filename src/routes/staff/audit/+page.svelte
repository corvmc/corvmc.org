<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import { page as appPage } from '$app/state';
	import { goto } from '$app/navigation';
	import { withQuery } from '#lib/utils/with-query.js';
	import SearchInput from '#lib/components/ui/Form/SearchInput.svelte';
	import Select from '#lib/components/ui/Form/Select.svelte';
	import PageHeader from '#lib/components/ui/PageHeader.svelte';
	import PageContent from '#lib/components/ui/PageContent.svelte';
	import DataList from '#lib/components/ui/DataList.svelte';
	import Table from '#lib/components/ui/Table.svelte';
	import FilterBar from '#lib/components/ui/FilterBar.svelte';
	import { EntityChip } from '#lib/components/ui/entity/index.js';
	import { getAuditLog } from '#lib/remote/audit.remote.js';
	import { auditActions, type AuditAction, type AuditSubjectType } from '#lib/types/audit.js';
	import {
		auditActionLabel,
		auditSubjectOptions,
		summarizeAuditEntry
	} from '#lib/utils/audit-display.js';
	import { formatDateTimeShort } from '#lib/utils/format.js';
	import { auditQuerySearch, parseAuditQuery } from './audit-query';

	// Seeded from the URL once, then mirrored back to it, so Back, reload and a
	// shared link keep the view. `goto`, not `replaceState`, which updates neither
	// `page.url` nor the router's entry.
	const path = appPage.url.pathname;
	const initial = parseAuditQuery(appPage.url.searchParams);

	// `searchText`, not `search`: FilterBar's `search` snippet shadows a same-named binding.
	let searchText = $state(initial.search);
	let searchQuery = $state(initial.search);
	let action = $state<AuditAction | ''>(initial.action);
	let subjectType = $state<AuditSubjectType | ''>(initial.subjectType);
	let dateFrom = $state(initial.from);
	let dateTo = $state(initial.to);
	let page = $state(initial.page);

	$effect(() => {
		const href = withQuery(
			path,
			auditQuerySearch({
				search: searchQuery,
				action,
				subjectType,
				from: dateFrom,
				to: dateTo,
				page
			})
		);
		if (location.pathname + location.search !== href) {
			void goto(href, { replace: true, reset: false });
		}
	});

	let result = $derived(
		getAuditLog({
			action: action || undefined,
			search: searchQuery || undefined,
			subjectType: subjectType || undefined,
			from: dateFrom || undefined,
			to: dateTo || undefined,
			page
		})
	);

	const activeFilterCount = $derived(
		(searchQuery ? 1 : 0) +
			(action ? 1 : 0) +
			(subjectType ? 1 : 0) +
			(dateFrom ? 1 : 0) +
			(dateTo ? 1 : 0)
	);

	function clearFilters() {
		searchText = '';
		searchQuery = '';
		action = '';
		subjectType = '';
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
					searchQuery = q;
					page = 1;
				}}
			/>
		{/snippet}
		<Select
			size="sm"
			aria-label={m.staff_audit_action_label()}
			value={action}
			onchange={(e: Event) => {
				action = (e.currentTarget as HTMLSelectElement).value as AuditAction | '';
				page = 1;
			}}
		>
			<option value="">{m.staff_audit_all_actions_label()}</option>
			{#each auditActions as value (value)}
				<option {value}>{auditActionLabel(value)}</option>
			{/each}
		</Select>
		<Select
			size="sm"
			aria-label={m.staff_audit_record_type_label()}
			value={subjectType}
			onchange={(e: Event) => {
				subjectType = (e.currentTarget as HTMLSelectElement).value as AuditSubjectType | '';
				page = 1;
			}}
		>
			<option value="">{m.staff_audit_all_records_label()}</option>
			{#each auditSubjectOptions as option (option.value)}
				<option value={option.value}>{option.label}</option>
			{/each}
		</Select>
		<input
			type="date"
			aria-label={m.staff_from_date_label()}
			class="input input-sm"
			bind:value={dateFrom}
			onchange={() => {
				page = 1;
			}}
		/>
		<input
			type="date"
			aria-label={m.staff_date_2_label()}
			class="input input-sm"
			bind:value={dateTo}
			onchange={() => {
				page = 1;
			}}
		/>
	</FilterBar>

	<DataList {result} empty={m.staff_audit_empty_body()} onpage={(p) => (page = p)}>
		{#snippet children(entries)}
			<Table>
				{#snippet head()}
					<th>{m.staff_audit_action_label()}</th>
					<th>{m.staff_audit_record_label()}</th>
					<th class="col-support">{m.staff_by_2_label()}</th>
				{/snippet}
				{#each entries as entry (entry.id)}
					<tr>
						<td class="cell-primary">
							<div class="truncate">{summarizeAuditEntry(entry)}</div>
							<div class="text-muted whitespace-nowrap">
								{formatDateTimeShort(entry.createdAt)}
							</div>
						</td>
						<td class="min-w-0">
							<div class="flex flex-col items-start gap-1">
								<EntityChip ref={entry.subject} />
								{#if entry.related}<EntityChip ref={entry.related} />{/if}
							</div>
						</td>
						<td class="col-support min-w-0"><EntityChip ref={entry.actor} icon={false} /></td>
					</tr>
				{/each}
			</Table>
		{/snippet}
	</DataList>
</PageContent>
