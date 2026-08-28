<script lang="ts">
	import PageHeader from '$lib/components/ui/PageHeader.svelte';
	import PageContent from '$lib/components/ui/PageContent.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import DataList from '$lib/components/ui/DataList.svelte';
	import Table from '$lib/components/ui/Table.svelte';
	import FilterBar from '$lib/components/ui/FilterBar.svelte';
	import SearchInput from '$lib/components/ui/Form/SearchInput.svelte';
	import Select from '$lib/components/ui/Form/Select.svelte';
	import StatusBadge from '$lib/components/ui/StatusBadge.svelte';
	import Badge from '$lib/components/ui/Badge.svelte';
	import BadgeList from '$lib/components/ui/BadgeList.svelte';
	import { EntityIdentity } from '$lib/components/ui/entity';
	import RoleOptions from '$lib/components/volunteer/RoleOptions.svelte';
	import { rowLink } from '$lib/actions/row-link';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { formatDateShortYear } from '$lib/utils/format';
	import {
		formatVolunteerHours,
		volunteerProfileStatuses,
		volunteerProfileStatusLabels
	} from '$lib/config';
	import { getStaffVolunteers } from '$lib/remote/volunteer.remote';

	type StatusFilter = (typeof volunteerProfileStatuses)[number] | '';

	// Two fits the column at its narrowest without wrapping, and the overflow
	// count carries the rest. Someone with a dozen interests is a fact about them,
	// not a reason for their row to be four lines tall.
	const VISIBLE_ROLES = 2;

	// Seeded from the query string and mirrored back into it, so a reload lands on
	// the same view. Local state rather than reading `page.url` back out, so a
	// filter change re-renders immediately instead of waiting on the navigation
	// that mirrors it — the same shape /staff/volunteer uses.
	const initial = page.url.searchParams;
	const parseStatus = (raw: string | null): StatusFilter =>
		volunteerProfileStatuses.includes(raw as never) ? (raw as StatusFilter) : '';

	// `searchText` (not `search`): FilterBar's always-visible slot is a snippet
	// named `search`, and a snippet shadows a same-named script binding.
	let searchText = $state(initial.get('q') ?? '');
	let searchQuery = $state(initial.get('q') ?? '');
	let roleFilter = $state(initial.get('role') ?? '');
	let statusFilter = $state<StatusFilter>(parseStatus(initial.get('status')));
	let pageNumber = $state(Number(initial.get('page') ?? '1') || 1);

	// Writes the URL, never state — the filters above stay the source of truth.
	// `goto(..., { replaceState })` rather than `replaceState()`: the latter only
	// rewrites the address bar, and the router overwrites that entry with its own
	// record on the next navigation.
	$effect(() => {
		const pairs: [string, string][] = [];
		if (searchQuery) pairs.push(['q', searchQuery]);
		if (roleFilter) pairs.push(['role', roleFilter]);
		if (statusFilter) pairs.push(['status', statusFilter]);
		if (pageNumber > 1) pairs.push(['page', String(pageNumber)]);

		const search = pairs.map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
		const href = `${resolve('/staff/volunteer/people')}${search ? `?${search}` : ''}`;
		if (location.pathname + location.search !== href) {
			void goto(href, { replaceState: true, noScroll: true, keepFocus: true });
		}
	});

	const filters = $derived({
		search: searchQuery || undefined,
		volunteerRoleId: roleFilter || undefined,
		status: statusFilter || undefined,
		page: pageNumber
	});

	// The page's one query. The role filter's options own theirs — getVolunteerRoles
	// is unparameterized and refreshed by name, so it could not join this one.
	const result = $derived(getStaffVolunteers(filters));

	const activeFilterCount = $derived(
		(searchQuery ? 1 : 0) + (roleFilter ? 1 : 0) + (statusFilter ? 1 : 0)
	);

	function clearFilters() {
		searchText = '';
		searchQuery = '';
		roleFilter = '';
		statusFilter = '';
		pageNumber = 1;
	}
</script>

<PageHeader title="Volunteers" subtitle="Staff">
	<Button href="/staff/volunteer" variant="ghost" size="sm">Hours</Button>
	<Button href="/staff/volunteer/shifts" variant="ghost" size="sm">Shifts</Button>
	<Button href="/staff/volunteer/roles" variant="ghost" size="sm">Roles</Button>
</PageHeader>

<PageContent>
	<FilterBar activeCount={activeFilterCount} onclear={clearFilters}>
		{#snippet search()}
			<SearchInput
				bind:value={searchText}
				placeholder="Search volunteers..."
				onsearch={(q) => {
					searchQuery = q;
					pageNumber = 1;
				}}
			/>
		{/snippet}

		<Select
			size="sm"
			aria-label="Interested in role"
			value={roleFilter}
			onchange={(e: Event) => {
				roleFilter = (e.currentTarget as HTMLSelectElement).value;
				pageNumber = 1;
			}}
		>
			<option value="">Any role</option>
			<RoleOptions />
		</Select>

		<Select
			size="sm"
			aria-label="Status"
			value={statusFilter}
			onchange={(e: Event) => {
				statusFilter = (e.currentTarget as HTMLSelectElement).value as StatusFilter;
				pageNumber = 1;
			}}
		>
			<option value="">Any status</option>
			<!-- Labels come from the vocabulary, not from here: "blocked" reads as a
			     punishment for answering honestly, and the enum's label already says so. -->
			{#each volunteerProfileStatuses as s (s)}
				<option value={s}>{volunteerProfileStatusLabels[s]}</option>
			{/each}
		</Select>
	</FilterBar>

	<DataList
		{result}
		empty="No one has signed up to volunteer yet."
		onpage={(p) => (pageNumber = p)}
	>
		{#snippet children(volunteers)}
			<Table>
				{#snippet head()}
					<th class="w-px"><span class="sr-only">Status</span></th>
					<th>Volunteer</th>
					<th class="col-support">Interested in</th>
					<th class="col-support cell-num">Hours</th>
					<th class="col-extra whitespace-nowrap">Since</th>
				{/snippet}

				{#each volunteers as volunteer (volunteer.userId)}
					<!-- The staff user record's Volunteer panel is the detail view for one of
					     these rows, so this index needs no [id] route of its own. -->
					{@const href = `${resolve(`/staff/users/${volunteer.userId}`)}?tab=volunteer`}
					<tr class="hover cursor-pointer" use:rowLink={href}>
						<td class="w-px">
							<StatusBadge status={volunteer.status} />
							{#if !volunteer.isAdult}
								<!-- Kept after a staff override, so an approved minor still reads
								     as one — the fact that changes how a shift is staffed. -->
								<Badge variant="ghost" size="xs" class="mt-1">minor</Badge>
							{/if}
						</td>

						<td class="cell-primary">
							<EntityIdentity ref={volunteer.member} avatar />
						</td>

						<td class="col-support">
							{#if volunteer.roleNames.length > 0}
								<BadgeList items={volunteer.roleNames} max={VISIBLE_ROLES} />
							{:else}
								<!-- The interests step is skippable, so this is a real answer and
								     not missing data: they signed up without picking anything. -->
								<span class="text-subtle">—</span>
							{/if}
						</td>

						<td class="col-support cell-num">
							{#if volunteer.minutes > 0}
								{formatVolunteerHours(volunteer.minutes)}
							{:else}
								<span class="text-subtle">—</span>
							{/if}
						</td>

						<td class="col-extra whitespace-nowrap">{formatDateShortYear(volunteer.since)}</td>
					</tr>
				{/each}
			</Table>
		{/snippet}
	</DataList>
</PageContent>
