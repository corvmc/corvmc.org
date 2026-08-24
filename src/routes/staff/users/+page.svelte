<script lang="ts">
	import SearchInput from '$lib/components/shared/Form/SearchInput.svelte';
	import PageHeader from '$lib/components/shared/PageHeader.svelte';
	import PageContent from '$lib/components/shared/PageContent.svelte';
	import DataList from '$lib/components/shared/DataList.svelte';
	import Table from '$lib/components/shared/Table.svelte';
	import FilterBar from '$lib/components/shared/FilterBar.svelte';
	import Button from '$lib/components/shared/Button.svelte';
	import Action from '$lib/components/shared/Action.svelte';
	import { EntityIdentity } from '$lib/components/shared/entity';
	import Field from '$lib/components/shared/Form/FormField.svelte';
	import { rowLink } from '$lib/actions/row-link';
	import { SvelteSet } from 'svelte/reactivity';
	import { toast } from 'svelte-sonner';
	import { resolve } from '$app/paths';
	import { IconDots, IconEye, IconCopy, IconUserOff } from '@tabler/icons-svelte';
	import { getStaffUsers, bulkDeactivateUsers } from '$lib/remote/users.remote';
	import { formatDateShortYear } from '$lib/utils/format';

	// Named `searchText`, not `search`: FilterBar's slot for the always-visible
	// control is a snippet called `search`, and a snippet shadows a same-named
	// script binding.
	let searchText = $state('');
	let status = $state<'active' | 'deactivated' | 'all'>('active');
	let page = $state(1);

	let searchDebounced = $state('');
	let filters = $derived({
		search: searchDebounced || undefined,
		status,
		page
	});

	let result = $derived(getStaffUsers(filters));

	type User = Awaited<typeof result>['rows'][number];

	const statusOptions = [
		{ value: 'active', label: 'Active' },
		{ value: 'deactivated', label: 'Deactivated' },
		{ value: 'all', label: 'All' }
	];

	const activeFilterCount = $derived((searchDebounced ? 1 : 0) + (status === 'active' ? 0 : 1));

	function clearFilters() {
		searchText = '';
		searchDebounced = '';
		status = 'active';
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

	// `status` is updated by the select's own bind handler before this bubbling
	// change handler fires; reset paging + selection for the new filter.
	function onStatusChange() {
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
	<FilterBar activeCount={activeFilterCount} onclear={clearFilters}>
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
		<div onchange={onStatusChange}>
			<Field type="select" label="" bind:value={status} options={statusOptions} class="w-40" />
		</div>
	</FilterBar>

	{#if selected.size > 0}
		<div class="mb-4 flex items-center gap-3 rounded-box bg-base-200 px-4 py-2">
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
						personal reservations and membership subscriptions will be cancelled, and reactivating
						will not bring them back. Your own account is skipped.
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
					<th>Member</th>
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
							<EntityIdentity ref={row.ref} avatar status />
						</td>
						<td class="col-support whitespace-nowrap">{formatDateShortYear(row.createdAt)}</td>
						<td class="w-px">
							<div class="dropdown dropdown-end">
								<Button
									variant="ghost"
									size="xs"
									shape="square"
									tabindex="0"
									aria-label="Row actions"
								>
									<IconDots size={16} />
								</Button>
								<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
								<ul
									tabindex="0"
									class="dropdown-content menu bg-base-200 rounded-box z-10 w-44 p-2 shadow"
								>
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
