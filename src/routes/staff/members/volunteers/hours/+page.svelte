<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import VolunteerStatusTabs from './VolunteerStatusTabs.svelte';
	import MemberViews from '../../MemberViews.svelte';
	import RoleOptions from '#lib/components/volunteer/RoleOptions.svelte';
	import SearchInput from '#lib/components/ui/Form/SearchInput.svelte';
	import Badge from '#lib/components/ui/Badge.svelte';
	import { resolve } from '$app/paths';
	import { urlState, oneOf, text, positiveInt } from '#lib/urlState.svelte.js';
	import PageHeader from '#lib/components/ui/PageHeader.svelte';
	import PageContent from '#lib/components/ui/PageContent.svelte';
	import DataList from '#lib/components/ui/DataList.svelte';
	import LogHoursForMemberAction from '#lib/components/volunteer/LogHoursForMemberAction.svelte';
	import Table from '#lib/components/ui/Table.svelte';
	import FilterBar from '#lib/components/ui/FilterBar.svelte';
	import StatusBadge from '#lib/components/ui/StatusBadge.svelte';
	import { EntityIdentity } from '#lib/components/ui/entity/index.js';
	import Action from '#lib/components/ui/Action.svelte';
	import Select from '#lib/components/ui/Form/Select.svelte';
	import FormField from '#lib/components/ui/Form/FormField.svelte';
	import { formatDateShort, relativeDay } from '#lib/utils/format.js';
	import { formatVolunteerHours, volunteerHourStatuses } from '#lib/config.js';
	import HourLogExceptions from '#lib/components/volunteer/HourLogExceptions.svelte';
	import { IconCheck, IconArrowBackUp } from '@tabler/icons-svelte';
	import { SvelteSet } from 'svelte/reactivity';
	import { toast } from 'svelte-sonner';
	import {
		getStaffVolunteerLogs,
		getVolunteerStatusCounts,
		approveVolunteerHours,
		approveVolunteerHoursBulk,
		rejectVolunteerHours
	} from '#lib/remote/volunteer.remote.js';

	type StatusView = (typeof volunteerHourStatuses)[number] | 'all';
	const statusViews: StatusView[] = [...volunteerHourStatuses, 'all'];

	// Seeded from the query string and mirrored back into it, so a reload lands
	// on the same view.
	const filters = urlState(resolve('staff/members/volunteers/hours'), {
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
		selected.clear();
		void getStaffVolunteerLogs(query).refresh();
		// VolunteerStatusTabs reads this query directly rather than through a wrapper, so
		// refreshing it here still repaints the badges.
		void getVolunteerStatusCounts().refresh();
	}

	// Ticked rows, by id. Client state, so it survives a filter change no more
	// than the rows themselves do — clearing it on every repaint is the point.
	const selected = new SvelteSet<string>();

	function toggle(id: string, on: boolean) {
		if (on) selected.add(id);
		else selected.delete(id);
	}

	// Read off the page's own rows, so the confirmation names a total rather than
	// a count and nobody approves forty hours thinking they clicked four.
	const selectedMinutes = $derived(
		(result.current?.rows ?? [])
			.filter((log) => selected.has(log.id))
			.reduce((sum, log) => sum + log.minutes, 0)
	);

	/**
	 * A partial approval is the normal case, not a failure: another staffer may
	 * have reviewed a row between this page loading and the click, and the
	 * service skips those rather than refusing the batch.
	 */
	function handleBulkApproved(result?: unknown) {
		const { approved = 0, skipped = 0 } = (result ?? {}) as { approved?: number; skipped?: number };
		if (skipped > 0) {
			toast.warning(
				m.staff_members_volunteers_hours_approved_were_already_reviewe({ approved, skipped })
			);
		} else {
			toast.success(
				m.staff_members_volunteers_hours_approved({
					approved,
					value: approved === 1 ? 'entry' : 'entries'
				})
			);
		}
		refreshQueue();
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

<!-- A view on Members → Volunteers (#2075), so it wears that page's frame. -->
<PageHeader title={m.staff_members()}>
	<MemberViews active="volunteers" />
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
				placeholder={m.staff_members_volunteers_hours_placeholder()}
				onsearch={(q) => {
					filters.q = q;
					filters.page = 1;
				}}
			/>
		{/snippet}

		<Select
			size="sm"
			aria-label={m.staff_role()}
			value={filters.role}
			onchange={(e: Event) => {
				filters.role = (e.currentTarget as HTMLSelectElement).value;
				filters.page = 1;
			}}
		>
			<option value="">{m.staff_all_roles()}</option>
			<RoleOptions />
		</Select>

		<input
			type="date"
			class="input input-sm"
			aria-label={m.staff_members_volunteers_hours_worked_after()}
			value={filters.from}
			onchange={(e) => {
				filters.from = (e.currentTarget as HTMLInputElement).value;
				filters.page = 1;
			}}
		/>
		<input
			type="date"
			class="input input-sm"
			aria-label={m.staff_members_volunteers_hours_worked_before()}
			value={filters.to}
			onchange={(e) => {
				filters.to = (e.currentTarget as HTMLInputElement).value;
				filters.page = 1;
			}}
		/>

		{#snippet actions()}
			<LogHoursForMemberAction />
		{/snippet}
	</FilterBar>

	{#if selected.size > 0}
		<!--
			Only on the pending view, because only a pending log can be approved and
			a checkbox that does nothing on four of the five tabs is worse than none.
		-->
		<div class="flex items-center justify-between gap-3 rounded-box bg-base-200 px-4 py-2">
			<span class="text-sm"
				>{m.staff_members_volunteers_hours_entries_selected({ size: selected.size })}</span
			>
			<Action
				action={approveVolunteerHoursBulk}
				label={m.staff_members_volunteers_hours_approve_selected()}
				icon={checkIcon}
				variant="primary"
				size="sm"
				modalTitle={m.staff_approve_these_hours()}
				submitLabel={m.staff_approve()}
				onsuccess={handleBulkApproved}
			>
				{#snippet form()}
					<input
						{...approveVolunteerHoursBulk.fields.ids.as('hidden', JSON.stringify([...selected]))}
					/>
					<p class="text-sm">
						{m.staff_members_volunteers_hours_entries_total({
							size: selected.size,
							formatVolunteerHours: formatVolunteerHours(selectedMinutes)
						})}
					</p>
					<FormField
						field={approveVolunteerHoursBulk.fields.notes}
						label={m.staff_note_optional()}
						type="textarea"
						description={m.staff_members_volunteers_hours_shared_with_every_member_sele()}
					/>
				{/snippet}
			</Action>
		</div>
	{/if}

	<DataList
		{result}
		empty={filters.status === 'pending'
			? m.staff_members_volunteers_hours_nothing_review_queue_clear()
			: m.staff_members_volunteers_hours_no_hour_logs_found()}
		onpage={(p) => (filters.page = p)}
	>
		{#snippet children(logs)}
			<Table>
				{#snippet head()}
					{#if filters.status === 'pending'}
						<th class="w-px">
							<input
								type="checkbox"
								class="checkbox checkbox-sm"
								aria-label={m.staff_members_volunteers_hours_select_every_row_page()}
								checked={logs.length > 0 && logs.every((l) => selected.has(l.id))}
								onchange={(e) => {
									const on = e.currentTarget.checked;
									for (const log of logs) toggle(log.id, on);
								}}
							/>
						</th>
					{/if}
					<th class="w-px"><span class="sr-only">{m.staff_status()}</span></th>
					<th>{m.staff_member()}</th>
					<th class="col-support">{m.staff_role()}</th>
					<th class="col-support whitespace-nowrap">{m.staff_worked()}</th>
					<th class="col-support cell-num">{m.staff_hours()}</th>
					<th class="w-px"><span class="sr-only">{m.staff_actions()}</span></th>
				{/snippet}

				{#each logs as log (log.id)}
					<tr class="hover">
						{#if filters.status === 'pending'}
							<td class="w-px">
								<input
									type="checkbox"
									class="checkbox checkbox-sm"
									aria-label={m.staff_members_volunteers_hours_select_these_hours()}
									checked={selected.has(log.id)}
									onchange={(e) => toggle(log.id, e.currentTarget.checked)}
								/>
							</td>
						{/if}
						<td class="w-px">
							<StatusBadge status={log.status} />
							{#if log.shiftId}
								<!-- Filed against a shift staff scheduled — the person was
								     rostered, so this can be approved with less scrutiny. -->
								<Badge
									variant="ghost"
									size="xs"
									class="mt-1"
									title={m.staff_members_volunteers_hours_logged_from_scheduled_shift()}
									>{m.staff_members_volunteers_hours_scheduled()}</Badge
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
									{log.reviewedByName ?? m.staff_staff()}: {log.reviewNotes}
								</div>
							{/if}
						</td>

						<td class="col-support">
							{log.roleName}{#if !log.roleIsActive}<span class="ml-1 text-subtle"
									>{m.staff_members_volunteers_hours_archived()}</span
								>{/if}
							<HourLogExceptions exceptions={log.exceptions} />
						</td>
						<td class="col-support whitespace-nowrap" title={relativeDay(log.createdAt)}>
							{formatDateShort(log.workedOn)}
						</td>
						<td class="col-support cell-num">{formatVolunteerHours(log.minutes)}</td>

						<td class="w-px">
							<!-- Most logs count on entry, so a return is offered on approved ones too. -->
							<div class="flex w-max justify-end gap-1">
								{#if log.status === 'pending'}
									<Action
										action={approveVolunteerHours.for(log.id)}
										label={m.staff_approve()}
										iconOnly
										icon={checkIcon}
										variant="ghost"
										size="sm"
										class="text-success"
										modalTitle={m.staff_approve_these_hours()}
										submitLabel={m.staff_approve()}
										successToast={m.staff_hours_approved()}
										onsuccess={refreshQueue}
									>
										{#snippet form()}
											<input
												{...approveVolunteerHours.for(log.id).fields.id.as('hidden', log.id)}
											/>
											<p class="text-sm">
												{m.staff_by({
													formatVolunteerHours: formatVolunteerHours(log.minutes),
													roleName: log.roleName,
													title: log.member.title,
													formatDateShort: formatDateShort(log.workedOn)
												})}
											</p>
											<p class="text-muted">{log.description}</p>
											<FormField
												field={approveVolunteerHours.for(log.id).fields.notes}
												label={m.staff_note_optional()}
												type="textarea"
												description={m.staff_shared_with_member()}
											/>
										{/snippet}
									</Action>
								{:else if log.status === 'rejected'}
									<!-- Warn, record, allow (#2233): the reason goes to the audit log. -->
									<Action
										action={approveVolunteerHours.for(log.id)}
										label={m.staff_members_volunteers_hours_approve_anyway()}
										iconOnly
										icon={checkIcon}
										variant="ghost"
										size="sm"
										modalTitle={m.staff_members_volunteers_hours_approve_returned_hours()}
										submitLabel={m.staff_members_volunteers_hours_approve_anyway()}
										successToast={m.staff_hours_approved()}
										onsuccess={refreshQueue}
									>
										{#snippet form()}
											<input
												{...approveVolunteerHours.for(log.id).fields.id.as('hidden', log.id)}
											/>
											<p class="text-sm">
												{m.staff_members_volunteers_hours_by_were_returned_member({
													formatVolunteerHours: formatVolunteerHours(log.minutes),
													roleName: log.roleName,
													title: log.member.title,
													formatDateShort: formatDateShort(log.workedOn)
												})}
											</p>
											<FormField
												field={approveVolunteerHours.for(log.id).fields.reason}
												label={m.staff_members_volunteers_hours_why_approve_them_now()}
												type="textarea"
												description={m.staff_members_volunteers_hours_recorded_audit_log()}
											/>
										{/snippet}
									</Action>
								{/if}

								{#if log.status !== 'rejected'}
									<Action
										action={rejectVolunteerHours.for(log.id)}
										label={m.staff_return()}
										iconOnly
										icon={returnIcon}
										variant="ghost"
										size="sm"
										class="text-error"
										modalTitle={m.staff_return_these_hours()}
										submitLabel={m.staff_return()}
										submitVariant="error"
										successToast={m.staff_hours_returned()}
										onsuccess={refreshQueue}
									>
										{#snippet form()}
											<input {...rejectVolunteerHours.for(log.id).fields.id.as('hidden', log.id)} />
											<p class="text-sm">
												{m.staff_by({
													formatVolunteerHours: formatVolunteerHours(log.minutes),
													roleName: log.roleName,
													title: log.member.title,
													formatDateShort: formatDateShort(log.workedOn)
												})}
											</p>
											<p class="text-muted">{log.description}</p>
											<FormField
												field={rejectVolunteerHours.for(log.id).fields.notes}
												label={m.staff_reason()}
												type="textarea"
												description={m.staff_required_member_needs_correct_resubmit()}
											/>
										{/snippet}
									</Action>
								{/if}
							</div>
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
