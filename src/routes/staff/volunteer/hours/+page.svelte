<script lang="ts">
	import VolunteerStatusTabs from './VolunteerStatusTabs.svelte';
	import RoleOptions from '$lib/components/volunteer/RoleOptions.svelte';
	import SearchInput from '$lib/components/ui/Form/SearchInput.svelte';
	import Badge from '$lib/components/ui/Badge.svelte';
	import { resolve } from '$app/paths';
	import { urlState, oneOf, text, positiveInt } from '$lib/urlState.svelte';
	import PageHeader from '$lib/components/ui/PageHeader.svelte';
	import PageContent from '$lib/components/ui/PageContent.svelte';
	import DataList from '$lib/components/ui/DataList.svelte';
	import LogHoursForMemberAction from '$lib/components/volunteer/LogHoursForMemberAction.svelte';
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

	// Seeded from the query string and mirrored back into it, so a reload lands
	// on the same view.
	const filters = urlState(resolve('/staff/volunteer/hours'), {
		status: oneOf(statusViews, 'pending' as StatusView),
		role: text(),
		from: text(),
		to: text(),
		q: text(),
		page: positiveInt(1)
	});

	// The live text in the box, which is NOT `filters.q`: `q` only moves when the
	// search input settles, so a half-typed word never reaches the URL or the
	// query. Named `searchText` rather than `search` because FilterBar's
	// always-visible slot is a snippet called `search`, and a snippet shadows a
	// same-named script binding.
	let searchText = $state(filters.q);

	let query = $derived({
		status: filters.status === 'all' ? undefined : filters.status,
		volunteerRoleId: filters.role || undefined,
		from: filters.from || undefined,
		to: filters.to || undefined,
		search: filters.q || undefined,
		page: filters.page
	});

	// The page's one query. The counts, the pending-review queue and the role filter each own
	// theirs — all three are unparameterized and refreshed by name, so none could join this one.
	const result = $derived(getStaffVolunteerLogs(query));

	// The status view is a view, not a filter — it always has a value, so counting
	// it would leave "Clear" permanently offered.
	const activeFilterCount = $derived(
		(filters.q ? 1 : 0) + (filters.role ? 1 : 0) + (filters.from ? 1 : 0) + (filters.to ? 1 : 0)
	);

	// A review has to refresh the list from HERE, not from the remote function:
	// `refresh()` is keyed by argument, and only this component knows the filter
	// object it subscribed with. Refreshing `getStaffVolunteerLogs({})` server-side
	// updated the tab counts but left the approved row sitting in the queue.
	function refreshQueue() {
		void getStaffVolunteerLogs(query).refresh();
		// VolunteerStatusTabs reads this query directly rather than through a wrapper, so
		// refreshing it here still repaints the badges.
		void getVolunteerStatusCounts().refresh();
	}

	function clearFilters() {
		searchText = '';
		filters.q = '';
		filters.role = '';
		filters.from = '';
		filters.to = '';
		filters.page = 1;
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
		bind:view={filters.status}
		onchange={() => {
			filters.page = 1;
		}}
	/>

	<FilterBar activeCount={activeFilterCount} onclear={clearFilters}>
		{#snippet search()}
			<SearchInput
				bind:value={searchText}
				placeholder="Search members..."
				onsearch={(q) => {
					filters.q = q;
					filters.page = 1;
				}}
			/>
		{/snippet}

		<Select
			size="sm"
			aria-label="Role"
			value={filters.role}
			onchange={(e: Event) => {
				filters.role = (e.currentTarget as HTMLSelectElement).value;
				filters.page = 1;
			}}
		>
			<option value="">All roles</option>
			<RoleOptions />
		</Select>

		<input
			type="date"
			class="input input-sm"
			aria-label="Worked on or after"
			value={filters.from}
			onchange={(e) => {
				filters.from = (e.currentTarget as HTMLInputElement).value;
				filters.page = 1;
			}}
		/>
		<input
			type="date"
			class="input input-sm"
			aria-label="Worked on or before"
			value={filters.to}
			onchange={(e) => {
				filters.to = (e.currentTarget as HTMLInputElement).value;
				filters.page = 1;
			}}
		/>
	</FilterBar>

	<DataList
		{result}
		empty={filters.status === 'pending'
			? 'Nothing to review — the queue is clear.'
			: 'No hour logs found'}
		onpage={(p) => (filters.page = p)}
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
								<Badge variant="ghost" size="xs" class="mt-1" title="Logged from a scheduled shift"
									>scheduled</Badge
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
							{log.roleName}{#if !log.roleIsActive}<span class="ml-1 text-subtle">(archived)</span
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
