<script lang="ts">
	import VolunteerStatusTabs from './VolunteerStatusTabs.svelte';
	import RoleOptions from '$lib/components/volunteer/RoleOptions.svelte';
	import SearchInput from '$lib/components/ui/Form/SearchInput.svelte';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import PageHeader from '$lib/components/ui/PageHeader.svelte';
	import PageContent from '$lib/components/ui/PageContent.svelte';
	import DataList from '$lib/components/ui/DataList.svelte';
	import LogHoursForMemberAction from './LogHoursForMemberAction.svelte';
	import Table from '$lib/components/ui/Table.svelte';
	import FilterBar from '$lib/components/ui/FilterBar.svelte';
	import StatusBadge from '$lib/components/ui/StatusBadge.svelte';
	import { EntityIdentity } from '$lib/components/ui/entity';
	import Action from '$lib/components/ui/Action.svelte';
	import Select from '$lib/components/ui/Form/Select.svelte';
	import FormField from '$lib/components/ui/Form/FormField.svelte';
	import { formatDateShort, relativeDay } from '$lib/utils/format';
	import { formatVolunteerHours, volunteerHourStatuses } from '$lib/config';
	import { IconCheck, IconArrowBackUp, IconAlertTriangle } from '@tabler/icons-svelte';
	import {
		getStaffVolunteerLogs,
		getVolunteerStatusCounts,
		approveVolunteerHours,
		rejectVolunteerHours
	} from '$lib/remote/volunteer.remote';

	type StatusView = (typeof volunteerHourStatuses)[number] | 'all';
	const statusViews: StatusView[] = [...volunteerHourStatuses, 'all'];

	// Filter state is seeded from the query string and mirrored back into it, so
	// a reload lands on the same view. Local state rather than reading `page.url`
	// back out, so a filter change re-renders immediately instead of waiting on
	// the navigation that mirrors it.
	const initial = page.url.searchParams;
	const parseStatus = (raw: string | null): StatusView =>
		statusViews.includes(raw as StatusView) ? (raw as StatusView) : 'pending';

	let statusView = $state(parseStatus(initial.get('status')));
	let roleFilter = $state(initial.get('role') ?? '');
	let fromDate = $state(initial.get('from') ?? '');
	let toDate = $state(initial.get('to') ?? '');
	// `searchText` (not `search`): FilterBar's always-visible slot is a snippet
	// named `search`, and a snippet shadows a same-named script binding.
	let searchText = $state(initial.get('q') ?? '');
	let searchQuery = $state(initial.get('q') ?? '');
	let pageNumber = $state(Number(initial.get('page') ?? '1') || 1);

	// Writes the URL, never state — the filters above stay the source of truth.
	// `goto(..., { replaceState })` rather than `replaceState()`: the latter only
	// rewrites the address bar, and the router overwrites that entry with its own
	// record on the next navigation.
	$effect(() => {
		// Pairs rather than URLSearchParams: the lint rule bans mutable instances
		// of it, and defaults are left out so a clean view has a clean URL.
		const pairs: [string, string][] = [];
		if (statusView !== 'pending') pairs.push(['status', statusView]);
		if (roleFilter) pairs.push(['role', roleFilter]);
		if (fromDate) pairs.push(['from', fromDate]);
		if (toDate) pairs.push(['to', toDate]);
		if (searchQuery) pairs.push(['q', searchQuery]);
		if (pageNumber > 1) pairs.push(['page', String(pageNumber)]);

		const search = pairs.map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
		const href = `${resolve('/staff/volunteer/hours')}${search ? `?${search}` : ''}`;
		if (location.pathname + location.search !== href) {
			void goto(href, { replaceState: true, noScroll: true, keepFocus: true });
		}
	});

	let filters = $derived({
		status: statusView === 'all' ? undefined : statusView,
		volunteerRoleId: roleFilter || undefined,
		from: fromDate || undefined,
		to: toDate || undefined,
		search: searchQuery || undefined,
		page: pageNumber
	});

	// The page's one query. The counts, the pending-review queue and the role filter each own
	// theirs — all three are unparameterized and refreshed by name, so none could join this one.
	const result = $derived(getStaffVolunteerLogs(filters));

	// The status view is a view, not a filter — it always has a value, so counting
	// it would leave "Clear" permanently offered.
	const activeFilterCount = $derived(
		(searchQuery ? 1 : 0) + (roleFilter ? 1 : 0) + (fromDate ? 1 : 0) + (toDate ? 1 : 0)
	);

	// A review has to refresh the list from HERE, not from the remote function:
	// `refresh()` is keyed by argument, and only this component knows the filter
	// object it subscribed with. Refreshing `getStaffVolunteerLogs({})` server-side
	// updated the tab counts but left the approved row sitting in the queue.
	function refreshQueue() {
		void getStaffVolunteerLogs(filters).refresh();
		// VolunteerStatusTabs reads this query directly rather than through a wrapper, so
		// refreshing it here still repaints the badges.
		void getVolunteerStatusCounts().refresh();
	}

	function clearFilters() {
		searchText = '';
		searchQuery = '';
		roleFilter = '';
		fromDate = '';
		toDate = '';
		pageNumber = 1;
	}
</script>

<!--
	No hand-rolled sibling links. Every page in this section used to build its own row and no
	two agreed (docs/reports/volunteer-workflow-findings.md#d2); the sidebar carries all six
	as children of Volunteering, and the back link goes to the dashboard that summarises this
	queue.
-->
<PageHeader title="Hours to review" subtitle="Volunteering" backHref="/staff/volunteer">
	<LogHoursForMemberAction />
</PageHeader>

<PageContent>
	<VolunteerStatusTabs
		bind:view={statusView}
		onchange={() => {
			pageNumber = 1;
		}}
	/>

	<FilterBar activeCount={activeFilterCount} onclear={clearFilters}>
		{#snippet search()}
			<SearchInput
				bind:value={searchText}
				placeholder="Search members..."
				onsearch={(q) => {
					searchQuery = q;
					pageNumber = 1;
				}}
			/>
		{/snippet}

		<Select
			size="sm"
			aria-label="Role"
			value={roleFilter}
			onchange={(e: Event) => {
				roleFilter = (e.currentTarget as HTMLSelectElement).value;
				pageNumber = 1;
			}}
		>
			<option value="">All roles</option>
			<RoleOptions />
		</Select>

		<input
			type="date"
			class="input input-sm"
			aria-label="Worked on or after"
			value={fromDate}
			onchange={(e) => {
				fromDate = (e.currentTarget as HTMLInputElement).value;
				pageNumber = 1;
			}}
		/>
		<input
			type="date"
			class="input input-sm"
			aria-label="Worked on or before"
			value={toDate}
			onchange={(e) => {
				toDate = (e.currentTarget as HTMLInputElement).value;
				pageNumber = 1;
			}}
		/>
	</FilterBar>

	<DataList
		{result}
		empty={statusView === 'pending'
			? 'Nothing to review — the queue is clear.'
			: 'No hour logs found'}
		onpage={(p) => (pageNumber = p)}
	>
		{#snippet children(logs)}
			<Table>
				{#snippet head()}
					<th class="w-px"><span class="sr-only">Status</span></th>
					<th>Member</th>
					<th class="col-support">Role</th>
					<th class="col-support whitespace-nowrap">Worked</th>
					<th class="col-support cell-num">Hours</th>
					<th class="w-px"><span class="sr-only">Actions</span></th>
				{/snippet}

				{#each logs as log (log.id)}
					<tr class="hover">
						<td class="w-px">
							<StatusBadge status={log.status} />
							{#if log.uncleared}
								<!--
									The member didn't hold a clearance their role requires, on the
									day they worked. Advisory: a prompt to have a conversation, not
									a reason to refuse hours somebody already put in.
								-->
								<span
									class="mt-1 block text-warning"
									title="Missing a required clearance on the date worked"
								>
									<IconAlertTriangle size={14} />
								</span>
							{/if}
							{#if log.shiftId}
								<!-- Filed against a shift staff scheduled — the person was
								     rostered, so this can be approved with less scrutiny. -->
								<span class="mt-1 badge badge-ghost badge-xs" title="Logged from a scheduled shift"
									>scheduled</span
								>
							{/if}
						</td>

						<!--
							The description rides as the subline rather than taking the
							seventh column the budget doesn't have. The email drops with it:
							it is one click away on the member's own page.
						-->
						<td class="cell-primary">
							<EntityIdentity ref={log.member}>
								{#snippet subtitle()}
									<span title={log.description}>{log.description}</span>
								{/snippet}
							</EntityIdentity>
							{#if log.reviewNotes}
								<div class="truncate text-subtle">
									{log.reviewedByName ?? 'Staff'}: {log.reviewNotes}
								</div>
							{/if}
						</td>

						<td class="col-support">
							{log.roleName}{#if !log.roleIsActive}<span class="ml-1 text-xs opacity-50"
									>(archived)</span
								>{/if}
						</td>
						<td class="col-support whitespace-nowrap" title={relativeDay(log.createdAt)}>
							{formatDateShort(log.workedOn)}
						</td>
						<td class="col-support cell-num">{formatVolunteerHours(log.minutes)}</td>

						<td class="w-px">
							{#if log.status === 'pending'}
								<div class="flex justify-end gap-1">
									<Action
										action={approveVolunteerHours.for(log.id)}
										label="Approve"
										iconOnly
										icon={checkIcon}
										variant="ghost"
										size="sm"
										class="text-success"
										modalTitle="Approve these hours?"
										submitLabel="Approve"
										successToast="Hours approved"
										onsuccess={refreshQueue}
									>
										{#snippet form()}
											<input type="hidden" name="id" value={log.id} />
											<p class="text-sm">
												{formatVolunteerHours(log.minutes)} of {log.roleName} by {log.member.title} on
												{formatDateShort(log.workedOn)}.
											</p>
											<p class="text-muted">{log.description}</p>
											<FormField
												name="notes"
												label="Note (optional)"
												type="textarea"
												description="Shared with the member."
											/>
										{/snippet}
									</Action>

									<Action
										action={rejectVolunteerHours.for(log.id)}
										label="Return"
										iconOnly
										icon={returnIcon}
										variant="ghost"
										size="sm"
										class="text-error"
										modalTitle="Return these hours?"
										submitLabel="Return"
										submitVariant="error"
										successToast="Hours returned"
										onsuccess={refreshQueue}
									>
										{#snippet form()}
											<input type="hidden" name="id" value={log.id} />
											<p class="text-sm">
												{formatVolunteerHours(log.minutes)} of {log.roleName} by {log.member.title} on
												{formatDateShort(log.workedOn)}.
											</p>
											<p class="text-muted">{log.description}</p>
											<FormField
												name="notes"
												label="Reason"
												type="textarea"
												description="Required — the member needs this to correct and resubmit."
											/>
										{/snippet}
									</Action>
								</div>
							{/if}
						</td>
					</tr>
				{/each}
			</Table>
		{/snippet}
	</DataList>
</PageContent>

{#snippet checkIcon()}
	<IconCheck size={16} />
{/snippet}

{#snippet returnIcon()}
	<IconArrowBackUp size={16} />
{/snippet}
