<script lang="ts">
	/**
	 * Everybody, in three tabs.
	 *
	 * Volunteers, the under-18 queue and the clearances table used to be three
	 * places. They are one question — who are these people and what do I owe them
	 * — asked at three scopes, and splitting them meant the minor waiting on a
	 * guardian was filed under Hours and the lapsing card was a tab you had to
	 * remember to open (docs/reports/volunteer-workflow-findings.md#c1, #c2).
	 *
	 * Each tab owns one query and fetches when it opens. The roster's rows carry
	 * exactly one action, resolved by what is actually outstanding — a row
	 * offering Confirm, Chase and Log Hours at once has not decided what it is
	 * for.
	 */
	import PageHeader from '$lib/components/ui/PageHeader.svelte';
	import PageContent from '$lib/components/ui/PageContent.svelte';
	import DataList from '$lib/components/ui/DataList.svelte';
	import Table from '$lib/components/ui/Table.svelte';
	import TabBar from '$lib/components/ui/TabBar.svelte';
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
	import SignoffTab from './SignoffTab.svelte';
	import ClearedTab from './ClearedTab.svelte';
	import { rowLink } from '$lib/actions/row-link';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { formatDateShort } from '$lib/utils/format';
	import {
		formatVolunteerHours,
		volunteerProfileStatuses,
		volunteerProfileStatusLabels
	} from '$lib/config';
	import { getStaffVolunteers, confirmSignup } from '$lib/remote/volunteer.remote';

	type Tab = 'roster' | 'signoff' | 'cleared';
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
	const parseTab = (raw: string | null): Tab =>
		raw === 'signoff' || raw === 'cleared' ? raw : 'roster';

	let tab = $state<Tab>(parseTab(initial.get('tab')));
	// `searchText` (not `search`): FilterBar's always-visible slot is a snippet
	// named `search`, and a snippet shadows a same-named script binding.
	let searchText = $state(initial.get('q') ?? '');
	let searchQuery = $state(initial.get('q') ?? '');
	let roleFilter = $state(initial.get('role') ?? '');
	let statusFilter = $state<StatusFilter>(parseStatus(initial.get('status')));
	let certFilter = $state(initial.get('cert') ?? '');
	let pageNumber = $state(Number(initial.get('page') ?? '1') || 1);

	// Writes the URL, never state — the filters above stay the source of truth.
	// `goto(..., { replaceState })` rather than `replaceState()`: the latter only
	// rewrites the address bar, and the router overwrites that entry with its own
	// record on the next navigation.
	$effect(() => {
		const pairs: [string, string][] = [];
		if (tab !== 'roster') pairs.push(['tab', tab]);
		if (searchQuery) pairs.push(['q', searchQuery]);
		if (roleFilter) pairs.push(['role', roleFilter]);
		if (statusFilter) pairs.push(['status', statusFilter]);
		if (certFilter) pairs.push(['cert', certFilter]);
		if (pageNumber > 1) pairs.push(['page', String(pageNumber)]);

		const search = pairs.map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
		const href = `${resolve('/staff/volunteer/people')}${search ? `?${search}` : ''}`;
		if (location.pathname + location.search !== href) {
			void goto(href, { replaceState: true, noScroll: true, keepFocus: true });
		}
	});

	const roster = $derived(
		getStaffVolunteers({
			search: searchQuery || undefined,
			volunteerRoleId: roleFilter || undefined,
			status: statusFilter || undefined,
			page: pageNumber
		})
	);
	const activeFilterCount = $derived(
		tab === 'cleared'
			? certFilter
				? 1
				: 0
			: (searchQuery ? 1 : 0) + (roleFilter ? 1 : 0) + (statusFilter ? 1 : 0)
	);

	function clearFilters() {
		searchText = '';
		searchQuery = '';
		roleFilter = '';
		statusFilter = '';
		certFilter = '';
		pageNumber = 1;
	}

	type RosterRow = Awaited<ReturnType<typeof getStaffVolunteers>>['rows'][number];

	/**
	 * The one extra line under a name: something about to lapse, else a claim of
	 * theirs waiting on staff, else nothing — `EntityIdentity` already carries
	 * the email, and repeating it here just made every ordinary row say its own
	 * address twice.
	 */
	function subline(row: RosterRow): { tone: string; text: string } | null {
		if (row.lapse) {
			return {
				tone: 'text-warning',
				text: `${row.lapse.certificationName} expires ${formatDateShort(row.lapse.expiresAt!)}`
			};
		}
		if (row.claim) {
			return {
				tone: 'text-info',
				text: `awaiting your confirm · ${row.claim.roleName} ${formatDateShort(row.claim.startsAt)}`
			};
		}
		return null;
	}
</script>

<!--
	No hand-rolled sibling links: every page in this section used to build its own row and no
	two agreed (docs/reports/volunteer-workflow-findings.md#d2). The sidebar carries them.
-->
<PageHeader title="People" subtitle="Volunteering" backHref="/staff/volunteer">
	<LogHoursForMemberAction />
</PageHeader>

<PageContent>
	{#await roster then list}
		<TabBar
			collapse
			tabs={[
				{ key: 'roster', label: 'Roster', badge: list.pagination.total },
				{ key: 'signoff', label: 'Awaiting sign-off', badge: list.minorsWaiting },
				{ key: 'cleared', label: 'Cleared' }
			]}
			active={tab}
			onchange={(key) => {
				tab = key as Tab;
				pageNumber = 1;
			}}
		/>
	{/await}

	{#if tab === 'roster'}
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
			result={roster}
			empty="No one has signed up to volunteer yet."
			onpage={(p) => (pageNumber = p)}
		>
			{#snippet children(volunteers)}
				<Table>
					{#snippet head()}
						<th class="w-px"><span class="sr-only">Status</span></th>
						<th>Volunteer</th>
						<th class="col-support">Would do</th>
						<!--
							The column this list existed to have and never did. Availability is what
							the member typed to answer "when can you help", and it was written to the
							profile and shown to nobody
							(docs/reports/volunteer-workflow-findings.md#a6).
						-->
						<th class="col-support">When they can help</th>
						<th class="col-support cell-num">Hours</th>
						<th class="w-px"><span class="sr-only">Actions</span></th>
					{/snippet}

					{#each volunteers as volunteer (volunteer.userId)}
						<!-- The staff user record's Volunteer panel is the detail view for one of
						     these rows, so this index needs no [id] route of its own. -->
						{@const href = `${resolve(`/staff/users/${volunteer.userId}`)}?tab=volunteer`}
						{@const line = subline(volunteer)}
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
								{#if line}
									<div class="{line.tone} truncate text-xs">{line.text}</div>
								{/if}
							</td>

							<td class="col-support">
								{#if volunteer.roleNames.length > 0}
									<BadgeList items={volunteer.roleNames} max={VISIBLE_ROLES} />
								{:else}
									<!-- The interests step is skippable, so this is a real answer and
									     not missing data: they signed up without picking anything. A
									     link, because "ask them" is the thing to do about it. -->
									<span class="link">Ask them →</span>
								{/if}
							</td>

							<td class="col-support">
								{#if volunteer.availability}
									<div class="truncate" title={volunteer.availability}>
										{volunteer.availability}
									</div>
								{:else}
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

							<td class="w-px">
								<!-- Exactly one, resolved the same way the subline is. -->
								{#if volunteer.claim}
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
												{volunteer.claim!.roleName} on {formatDateShort(volunteer.claim!.startsAt)}.
												Confirming books them: they get the reminder the day before, and the shift
												completes afterwards with hours to log.
											</p>
										{/snippet}
									</Action>
								{:else if volunteer.lapse}
									<Button href={`${href}`} variant="ghost" size="xs" class="text-warning">
										Chase
									</Button>
								{:else}
									<LogHoursForMemberAction
										presetUser={{ id: volunteer.userId, name: volunteer.member.title }}
										label="Log Hours"
										size="xs"
									/>
								{/if}
							</td>
						</tr>
					{/each}
				</Table>
			{/snippet}
		</DataList>
	{:else if tab === 'signoff'}
		<SignoffTab />
	{:else}
		<ClearedTab bind:certFilter />
	{/if}
</PageContent>
