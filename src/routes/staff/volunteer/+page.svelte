<script lang="ts">
	import SearchInput from '$lib/components/shared/Form/SearchInput.svelte';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import PageHeader from '$lib/components/shared/PageHeader.svelte';
	import PageContent from '$lib/components/shared/PageContent.svelte';
	import Button from '$lib/components/shared/Button.svelte';
	import DataList from '$lib/components/shared/DataList.svelte';
	import Table from '$lib/components/shared/Table.svelte';
	import InfoCard from '$lib/components/shared/InfoCard.svelte';
	import FilterBar from '$lib/components/shared/FilterBar.svelte';
	import TabBar from '$lib/components/shared/TabBar.svelte';
	import StatusBadge from '$lib/components/shared/StatusBadge.svelte';
	import { EntityIdentity } from '$lib/components/shared/entity';
	import Action from '$lib/components/shared/Action.svelte';
	import Select from '$lib/components/shared/Form/Select.svelte';
	import FormField from '$lib/components/shared/Form/FormField.svelte';
	import { formatDateShort, relativeDay } from '$lib/utils/format';
	import { formatVolunteerHours, volunteerHourStatuses } from '$lib/config';
	import { IconCheck, IconArrowBackUp, IconAlertTriangle } from '@tabler/icons-svelte';
	import {
		getStaffVolunteerLogs,
		getVolunteerStatusCounts,
		getVolunteerRoles,
		getBlockedVolunteers,
		approveVolunteerSignup,
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
		const href = `${resolve('/staff/volunteer')}${search ? `?${search}` : ''}`;
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

	let result = $derived(getStaffVolunteerLogs(filters));
	let counts = $derived(getVolunteerStatusCounts());
	let blocked = $derived(getBlockedVolunteers());
	let roles = $derived(getVolunteerRoles());

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

<PageHeader title="Volunteering" subtitle="Staff">
	<Button href="/staff/volunteer/shifts" variant="ghost" size="sm">Shifts</Button>
	<Button href="/staff/volunteer/roles" variant="ghost" size="sm">Roles</Button>
	<Button href="/staff/volunteer/report" variant="ghost" size="sm">Report</Button>
</PageHeader>

<PageContent>
	<!--
		Under-18 sign-ups, which are blocked until somebody looks at them. Above the
		tabs and not one of them: the TabBar is keyed to volunteerHourStatuses and
		drives getStaffVolunteerLogs, which returns hour logs — this is a queue of
		people, and putting it in that machinery would break the URL filter mirroring
		and the row shape. Hidden entirely when empty, which is most days.
	-->
	{#await blocked then rows}
		{#if rows.length > 0}
			<InfoCard title="Pending review" class="mb-4 border-l-4 border-warning">
				<p class="text-muted">
					These members told us they're under 18, so they can't pick up shifts or log hours yet.
					Approving lets them do both.
				</p>
				<Table>
					{#snippet head()}
						<th class="w-px"><span class="sr-only">Status</span></th>
						<th>Member</th>
						<th class="col-support">Name given</th>
						<th class="col-extra whitespace-nowrap">Signed up</th>
						<th class="w-px"><span class="sr-only">Actions</span></th>
					{/snippet}

					{#each rows as row (row.userId)}
						<tr>
							<td class="w-px"><StatusBadge status="blocked" /></td>
							<td class="cell-primary">
								<EntityIdentity ref={row.member} />
							</td>
							<td class="col-support">{row.firstName} {row.lastName}</td>
							<td class="col-extra whitespace-nowrap">{relativeDay(row.createdAt)}</td>
							<td class="w-px">
								<div class="flex justify-end">
									<Action
										action={approveVolunteerSignup.for(row.userId)}
										label="Approve"
										variant="primary"
										size="sm"
										modalTitle="Approve {row.firstName} {row.lastName}?"
										submitLabel="Approve"
										successToast="Volunteer approved"
									>
										{#snippet form()}
											<input type="hidden" name="userId" value={row.userId} />
											<p class="text-sm">
												Make sure a guardian's sign-off is on file first — approving lets them claim
												shifts and log hours on their own.
											</p>
										{/snippet}
									</Action>
								</div>
							</td>
						</tr>
					{/each}
				</Table>
			</InfoCard>
		{/if}
	{/await}

	{#await counts then c}
		<TabBar
			class="mb-4"
			collapse
			tabs={[
				{ key: 'pending', label: 'Pending', badge: c.pending },
				{ key: 'approved', label: 'Approved', badge: c.approved },
				{ key: 'rejected', label: 'Returned', badge: c.rejected },
				{ key: 'all', label: 'All', badge: c.all }
			]}
			active={statusView}
			onchange={(key) => {
				statusView = key as StatusView;
				pageNumber = 1;
			}}
		/>
	{/await}

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

		{#await roles then roleOptions}
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
				<!-- Archived roles stay listed: their logs are still in the table. -->
				{#each roleOptions as role (role.id)}
					<option value={role.id}>{role.name}{role.isActive ? '' : ' (archived)'}</option>
				{/each}
			</Select>
		{/await}

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
								<span class="badge badge-ghost badge-xs mt-1" title="Logged from a scheduled shift"
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
