<script lang="ts">
	import SearchInput from '$lib/components/ui/Form/SearchInput.svelte';
	import PageHeader from '$lib/components/ui/PageHeader.svelte';
	import PageContent from '$lib/components/ui/PageContent.svelte';
	import DataList from '$lib/components/ui/DataList.svelte';
	import Table from '$lib/components/ui/Table.svelte';
	import FilterBar from '$lib/components/ui/FilterBar.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import Action from '$lib/components/ui/Action.svelte';
	import Avatar from '$lib/components/ui/Avatar.svelte';
	import StatusBadge from '$lib/components/ui/StatusBadge.svelte';
	import Select from '$lib/components/ui/Form/Select.svelte';
	import { rowLink } from '$lib/actions/row-link';
	import { SvelteSet } from 'svelte/reactivity';
	import { toast } from 'svelte-sonner';
	import { resolve } from '$app/paths';
	import { IconDots, IconEye, IconCopy, IconUserOff } from '@tabler/icons-svelte';
	import { getStaffUsers, getStaffUserTotals, bulkDeactivateUsers } from '$lib/remote/users.remote';
	import { formatDateShortYear } from '$lib/utils/format';
	import Alert from '$lib/components/ui/Alert.svelte';
	import { retryQuery } from '$lib/utils/retry-query';
	import UserTotals from './UserTotals.svelte';

	// Named `searchText`, not `search`: FilterBar's slot for the always-visible
	// control is a snippet called `search`, and a snippet shadows a same-named
	// script binding.
	let searchText = $state('');
	let status = $state<'active' | 'deactivated' | 'all'>('active');
	type YesNo = '' | 'yes' | 'no';
	// Secondary yes/no filters, all in the Filters menu. '' is "either".
	let flags = $state<Record<'sustaining' | 'inBand' | 'staff' | 'instructor', YesNo>>({
		sustaining: '',
		inBand: '',
		staff: '',
		instructor: ''
	});
	let page = $state(1);

	const asBool = (v: YesNo) => (v === '' ? undefined : v === 'yes');

	let searchDebounced = $state('');
	let filters = $derived({
		search: searchDebounced || undefined,
		status,
		sustaining: asBool(flags.sustaining),
		inBand: asBool(flags.inBand),
		staff: asBool(flags.staff),
		instructor: asBool(flags.instructor),
		page
	});

	let result = $derived(getStaffUsers(filters));

	type User = Awaited<typeof result>['rows'][number];

	const flagFilters = [
		{ key: 'sustaining', label: 'Sustaining member' },
		{ key: 'inBand', label: 'In a band' },
		{ key: 'staff', label: 'Staff position' },
		{ key: 'instructor', label: 'Teaching instructor' }
	] as const;

	const menuFilterCount = $derived(Object.values(flags).filter(Boolean).length);
	const activeFilterCount = $derived(
		(searchDebounced ? 1 : 0) + (status === 'active' ? 0 : 1) + menuFilterCount
	);

	function clearFilters() {
		searchText = '';
		searchDebounced = '';
		status = 'active';
		flags = { sustaining: '', inBand: '', staff: '', instructor: '' };
		page = 1;
		selected.clear();
	}

	// Selection (active users only — deactivated rows can't be deactivated again).
	//
	// Scoped to the rows currently on screen: every navigation that changes which
	// rows are visible (paging, searching, switching status filter) clears it.
	// Selection used to survive paging, so "select all" on page 1 then paging to
	// page 2 left the bar reading "20 selected" over rows the operator could not
	// see — and Deactivate acted on all of them. Keeping the count equal to what
	// is on screen makes the bulk action verifiable before it is confirmed.
	let selected = new SvelteSet<string>();
	const { fields: bulkFields } = bulkDeactivateUsers;

	function toggle(id: string, checked: boolean) {
		if (checked) selected.add(id);
		else selected.delete(id);
	}

	function selectablePageIds(users: User[]): string[] {
		return users.filter((u) => !u.deletedAt).map((u) => u.id);
	}

	function toggleAll(users: User[], checked: boolean) {
		const ids = selectablePageIds(users);
		if (checked) ids.forEach((id) => selected.add(id));
		else ids.forEach((id) => selected.delete(id));
	}

	async function copyEmail(email: string) {
		await navigator.clipboard.writeText(email);
	}

	// Every filter change resets paging and the on-screen selection.
	function onFilterChange() {
		page = 1;
		selected.clear();
	}

	function goToPage(p: number) {
		if (p === page) return;
		page = p;
		selected.clear();
	}
</script>

<PageHeader title="Users" />
<PageContent>
	<svelte:boundary>
		<UserTotals />
		{#snippet failed(_error, reset)}
			<Alert type="warning" reset={() => retryQuery(getStaffUserTotals(), reset)}>
				The user totals didn't load. The table below is unaffected.
			</Alert>
		{/snippet}
	</svelte:boundary>

	<FilterBar activeCount={activeFilterCount} menuCount={menuFilterCount} onclear={clearFilters}>
		{#snippet search()}
			<SearchInput
				bind:value={searchText}
				placeholder="Search by name or email..."
				onsearch={(q) => {
					searchDebounced = q;
					page = 1;
					selected.clear();
				}}
			/>
		{/snippet}
		<Select size="sm" aria-label="Status" bind:value={status} onchange={onFilterChange}>
			<option value="active">Active</option>
			<option value="deactivated">Deactivated</option>
			<option value="all">All statuses</option>
		</Select>
		{#snippet menu()}
			{#each flagFilters as f (f.key)}
				<label class="flex flex-col gap-1">
					<span class="text-muted text-xs">{f.label}</span>
					<Select size="sm" bind:value={flags[f.key]} onchange={onFilterChange}>
						<option value="">Either</option>
						<option value="yes">Yes</option>
						<option value="no">No</option>
					</Select>
				</label>
			{/each}
		{/snippet}
	</FilterBar>

	{#if selected.size > 0}
		<div class="mb-4 flex items-center gap-3 inset px-4 py-2">
			<span class="text-sm">{selected.size} selected</span>
			<Action
				action={bulkDeactivateUsers}
				label="Deactivate"
				variant="error"
				size="sm"
				modalTitle="Deactivate users"
				submitLabel="Deactivate"
				submitVariant="error"
				onsuccess={(result) => {
					const r = result as { deactivated: string[]; skipped: string[] };
					selected.clear();
					void getStaffUsers(filters).refresh();
					const skipped = r.skipped.length ? `, ${r.skipped.length} skipped` : '';
					toast.success(`${r.deactivated.length} deactivated${skipped}`);
				}}
			>
				{#snippet icon()}
					<IconUserOff size={16} />
				{/snippet}
				{#snippet form()}
					<input {...bulkFields.ids.as('hidden', JSON.stringify([...selected]))} />
					<p class="py-2">
						Deactivate {selected.size} selected user{selected.size === 1 ? '' : 's'}? Their future
						personal reservations will be cancelled, and reactivating will not bring them back.
						Membership subscriptions end with their current period unless reactivated first. Your
						own account is skipped.
					</p>
				{/snippet}
			</Action>
			<Button variant="ghost" size="sm" onclick={() => selected.clear()}>Clear</Button>
		</div>
	{/if}

	<!-- `goToPage`, not a bare page setter: paging must clear the selection, or
	     the bulk bar counts rows that are no longer on screen. -->
	<DataList {result} empty="No users found" onpage={goToPage}>
		{#snippet children(users)}
			{@const pageIds = selectablePageIds(users)}
			<Table>
				{#snippet head()}
					<th class="col-support w-px">
						<input
							type="checkbox"
							class="checkbox checkbox-sm"
							aria-label="Select all on this page"
							disabled={pageIds.length === 0}
							checked={pageIds.length > 0 && pageIds.every((id) => selected.has(id))}
							onchange={(e) => toggleAll(users, e.currentTarget.checked)}
						/>
					</th>
					<th>Name</th>
					<th>Email</th>
					<th class="col-support">Joined</th>
					<th class="w-px"><span class="sr-only">Actions</span></th>
				{/snippet}

				{#each users as row (row.id)}
					<tr class="hover cursor-pointer" use:rowLink={resolve(`/staff/users/${row.id}`)}>
						<td class="col-support w-px">
							<input
								type="checkbox"
								class="checkbox checkbox-sm"
								aria-label="Select {row.ref.title}"
								disabled={!!row.deletedAt}
								checked={selected.has(row.id)}
								onchange={(e) => toggle(row.id, e.currentTarget.checked)}
							/>
						</td>
						<td class="cell-primary">
							<span class="flex items-center gap-2">
								<Avatar
									src={row.ref.image ?? undefined}
									name={row.ref.title}
									size="avatar-sm"
									class="size-6 shrink-0"
								/>
								<span class="truncate">{row.ref.title}</span>
								{#if row.deletedAt}<StatusBadge status="deactivated" label />{/if}
							</span>
						</td>
						<td class="min-w-0 truncate">{row.email}</td>
						<td class="col-support whitespace-nowrap">{formatDateShortYear(row.createdAt)}</td>
						<td class="w-px">
							<div class="dropdown dropdown-end">
								<Button
									variant="ghost"
									size="xs"
									shape="square"
									tabindex={0}
									aria-label="Row actions"
								>
									<IconDots size={16} />
								</Button>
								<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
								<ul tabindex={0} class="menu dropdown-content dropdown-panel w-44 bg-base-200">
									<li>
										<a href={resolve(`/staff/users/${row.id}`)}><IconEye size={16} />View</a>
									</li>
									<li>
										<button onclick={() => copyEmail(row.email)}>
											<IconCopy size={16} />Copy email
										</button>
									</li>
									<!-- No Impersonate item: `/staff/users/[id]/impersonate` does not exist
									     (404). Impersonation is deferred — see docs/specs/shipped/staff-bands-spec.md.
									     Re-add this only alongside the route. -->
								</ul>
							</div>
						</td>
					</tr>
				{/each}
			</Table>
		{/snippet}
	</DataList>
</PageContent>
