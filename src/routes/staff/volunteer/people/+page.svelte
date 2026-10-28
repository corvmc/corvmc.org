<script lang="ts">
	/**
	 * Everybody who signed up, as one roster (#1934). The under-18 queue is the
	 * "Awaiting sign-off" status and "who holds this clearance" is a filter: both
	 * were tabs once, over what is the same list of people. Each grant's own
	 * history, and revoking it, is on the person's record.
	 *
	 * Each row carries exactly one action, resolved by what is outstanding — a row
	 * offering Confirm, Chase and Log Hours at once has not decided what it is for.
	 */
	import PageHeader from '$lib/components/ui/PageHeader.svelte';
	import PageContent from '$lib/components/ui/PageContent.svelte';
	import DataList from '$lib/components/ui/DataList.svelte';
	import Table from '$lib/components/ui/Table.svelte';
	import FilterBar from '$lib/components/ui/FilterBar.svelte';
	import SearchInput from '$lib/components/ui/Form/SearchInput.svelte';
	import Select from '$lib/components/ui/Form/Select.svelte';
	import StatusBadge from '$lib/components/ui/StatusBadge.svelte';
	import Badge from '$lib/components/ui/Badge.svelte';
	import BadgeList from '$lib/components/ui/BadgeList.svelte';
	import Action from '$lib/components/ui/Action.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import { EntityIdentity } from '$lib/components/ui/entity';
	import RoleOptions from '$lib/components/volunteer/RoleOptions.svelte';
	import LogHoursForMemberAction from '$lib/components/volunteer/LogHoursForMemberAction.svelte';
	import CertificationOptions from '$lib/components/volunteer/CertificationOptions.svelte';
	import VolunteerPanel from './VolunteerPanel.svelte';
	import { subline, type RosterRow } from './subline';
	import { rowLink } from '$lib/actions/row-link';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { withQuery } from '$lib/utils/with-query';
	import { formatDateShort } from '$lib/utils/format';
	import {
		formatVolunteerHours,
		volunteerProfileStatuses,
		volunteerProfileStatusLabels
	} from '$lib/config';
	import {
		getStaffVolunteers,
		confirmSignup,
		approveVolunteerSignup
	} from '$lib/remote/volunteer.remote';

	type StatusFilter = (typeof volunteerProfileStatuses)[number] | '';

	// Two fits the column at its narrowest without wrapping, and the overflow
	// count carries the rest. Someone with a dozen interests is a fact about them,
	// not a reason for their row to be four lines tall.
	const VISIBLE_ROLES = 2;

	// Seeded from the query string and mirrored back into it, so a reload lands on
	// the same view. Local state rather than reading `page.url` back out, so a
	// filter change re-renders immediately instead of waiting on the navigation
	// that mirrors it.
	const initial = page.url.searchParams;
	const parseStatus = (raw: string | null): StatusFilter =>
		volunteerProfileStatuses.includes(raw as never) ? (raw as StatusFilter) : '';
	// `searchText` (not `search`): FilterBar's always-visible slot is a snippet
	// named `search`, and a snippet shadows a same-named script binding.
	let searchText = $state(initial.get('q') ?? '');
	let searchQuery = $state(initial.get('q') ?? '');
	let roleFilter = $state(initial.get('role') ?? '');
	// `?tab=signoff` is the retired tab's address for the same rows.
	let statusFilter = $state<StatusFilter>(
		initial.get('tab') === 'signoff' ? 'blocked' : parseStatus(initial.get('status'))
	);
	let certFilter = $state(initial.get('cert') ?? '');
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
		if (certFilter) pairs.push(['cert', certFilter]);
		if (pageNumber > 1) pairs.push(['page', String(pageNumber)]);

		const search = pairs.map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
		const href = withQuery(resolve('/staff/volunteer/people'), search);
		if (location.pathname + location.search !== href) {
			void goto(href, { replaceState: true, noScroll: true, keepFocus: true });
		}
	});

	const roster = $derived(
		getStaffVolunteers({
			search: searchQuery || undefined,
			volunteerRoleId: roleFilter || undefined,
			status: statusFilter || undefined,
			certificationId: certFilter || undefined,
			page: pageNumber
		})
	);
	const recordHref = (row: RosterRow) =>
		withQuery(resolve(`/staff/users/${row.userId}`), 'tab=volunteer');

	const activeFilterCount = $derived(
		(searchQuery ? 1 : 0) + (roleFilter ? 1 : 0) + (statusFilter ? 1 : 0) + (certFilter ? 1 : 0)
	);

	function clearFilters() {
		searchText = '';
		searchQuery = '';
		roleFilter = '';
		statusFilter = '';
		certFilter = '';
		pageNumber = 1;
	}

	// An id, not the row: the panel re-reads it from the refreshed list, so an
	// approval made from inside the panel shows there at once.
	let selectedId = $state<string | null>(null);
	let panelOpen = $state(false);

	function openPanel(row: RosterRow) {
		selectedId = row.userId;
		panelOpen = true;
	}
</script>

{#snippet rowAction(volunteer: RosterRow)}
	<!-- Exactly one, resolved the same way the subline is. A minor awaiting
	     sign-off can do nothing else until it is given. -->
	{#if volunteer.status === 'blocked'}
		<Action
			action={approveVolunteerSignup.for(volunteer.userId)}
			label="Approve"
			variant="ghost"
			size="xs"
			class="text-success"
			modalTitle="Let {volunteer.member.title} volunteer?"
			submitLabel="Approve"
			successToast="{volunteer.member.title} can volunteer now"
			onsuccess={() => void roster.refresh()}
		>
			{#snippet form()}
				<input type="hidden" name="userId" value={volunteer.userId} />
				<p class="text-sm">
					Confirms a guardian has signed off. They can claim shifts and log hours from then on, and
					their record still says they are under 18 — which is what changes how a shift is staffed.
				</p>
			{/snippet}
		</Action>
	{:else if volunteer.claim}
		<Action
			action={confirmSignup.for(volunteer.claim.signupId)}
			label="Confirm"
			variant="ghost"
			size="xs"
			class="text-success"
			modalTitle="Confirm {volunteer.member.title}?"
			submitLabel="Confirm"
			successToast="Confirmed"
		>
			{#snippet form()}
				<input type="hidden" name="signupId" value={volunteer.claim!.signupId} />
				<input type="hidden" name="shiftId" value={volunteer.claim!.shiftId} />
				<p class="text-sm">
					{volunteer.claim!.roleName} on {formatDateShort(volunteer.claim!.startsAt)}. Confirming
					books them: they get the reminder the day before, and the shift completes afterwards with
					hours to log.
				</p>
			{/snippet}
		</Action>
	{:else if volunteer.lapse}
		<Button href={recordHref(volunteer)} variant="ghost" size="xs" class="text-warning">
			Chase
		</Button>
	{:else}
		<LogHoursForMemberAction
			presetUser={{ id: volunteer.userId, name: volunteer.member.title }}
			label="Log Hours"
			size="xs"
		/>
	{/if}
{/snippet}

<!--
	No hand-rolled sibling links: every page in this section used to build its own row and no
	two agreed (docs/reports/volunteer-workflow-findings.md#d2). The sidebar carries them.
-->
<PageHeader title="Volunteers">
	<LogHoursForMemberAction />
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

		<Select
			size="sm"
			aria-label="Clearance"
			value={certFilter}
			onchange={(e: Event) => {
				certFilter = (e.currentTarget as HTMLSelectElement).value;
				pageNumber = 1;
			}}
		>
			<option value="">Any clearance</option>
			<CertificationOptions />
		</Select>
	</FilterBar>

	<!-- The count is a shortcut to the filter: the queue a tab used to hold. -->
	{#await roster then list}
		<p class="text-subtle text-sm">
			{list.pagination.total}
			{list.pagination.total === 1 ? 'volunteer' : 'volunteers'}
			{#if list.minorsWaiting > 0 && statusFilter !== 'blocked'}
				·
				<button
					type="button"
					class="link"
					onclick={() => {
						statusFilter = 'blocked';
						pageNumber = 1;
					}}
				>
					{list.minorsWaiting} awaiting sign-off
				</button>
			{/if}
		</p>
	{/await}

	<DataList
		result={roster}
		empty="No one has signed up to volunteer yet."
		onpage={(p) => (pageNumber = p)}
	>
		{#snippet children(volunteers)}
			<Table>
				{#snippet head()}
					<th class="w-px"><span class="sr-only">Status</span></th>
					<th>Volunteer</th>
					<th class="col-support">Followed Roles</th>
					<th class="col-support cell-num">Hours</th>
					<th class="w-px"><span class="sr-only">Actions</span></th>
				{/snippet}

				{#each volunteers as volunteer (volunteer.userId)}
					<!-- A row opens its preview; the user record is one link further, in it. -->
					{@const line = subline(volunteer)}
					<tr class="hover cursor-pointer" use:rowLink={() => openPanel(volunteer)}>
						<td class="w-px">
							<StatusBadge status={volunteer.status} />
							{#if !volunteer.isAdult}
								<!-- Kept after a staff override, so an approved minor still reads
									     as one — the fact that changes how a shift is staffed. -->
								<Badge variant="ghost" size="xs" class="mt-1">minor</Badge>
							{/if}
						</td>

						<!-- `min-w-48`: `cell-primary` takes only what is left over, and a
							     long free-text answer elsewhere could leave it two letters. -->
						<td class="cell-primary min-w-48">
							<!-- The keyboard path to the preview, which a row cannot be. -->
							<button
								type="button"
								class="block w-full text-left"
								onclick={() => openPanel(volunteer)}
							>
								<EntityIdentity ref={volunteer.member} avatar link={false} />
							</button>
							{#if line}
								<div class="{line.tone} truncate text-xs">{line.text}</div>
							{/if}
						</td>

						<td class="col-support">
							{#if volunteer.roleNames.length > 0}
								<BadgeList items={volunteer.roleNames} max={VISIBLE_ROLES} />
							{:else}
								<!-- The interests step is skippable, so this is an answer, not
									     missing data: they signed up without picking anything. -->
								<span class="text-subtle">None picked</span>
							{/if}
						</td>

						<td class="col-support cell-num">
							{#if volunteer.minutes > 0}
								{formatVolunteerHours(volunteer.minutes)}
							{:else}
								<span class="text-subtle">—</span>
							{/if}
						</td>

						<td class="w-px">
							{@render rowAction(volunteer)}
						</td>
					</tr>
				{/each}
			</Table>

			{@const chosen = volunteers.find((v) => v.userId === selectedId)}
			{#if chosen}
				<VolunteerPanel volunteer={chosen} bind:open={panelOpen}>
					{#snippet action()}{@render rowAction(chosen)}{/snippet}
				</VolunteerPanel>
			{/if}
		{/snippet}
	</DataList>
</PageContent>
