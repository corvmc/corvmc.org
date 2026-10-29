<script lang="ts">
	import PageHeader from '$lib/components/ui/PageHeader.svelte';
	import PageContent from '$lib/components/ui/PageContent.svelte';
	import Table from '$lib/components/ui/Table.svelte';
	import EmptyState from '$lib/components/ui/EmptyState.svelte';
	import { EntityIdentity } from '$lib/components/ui/entity';
	import SectionLabel from '$lib/components/ui/SectionLabel.svelte';
	import StatusBadge from '$lib/components/ui/StatusBadge.svelte';
	import Alert from '$lib/components/ui/Alert.svelte';
	import Badge from '$lib/components/ui/Badge.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import DayTimeline from '$lib/components/reservations/DayTimeline.svelte';
	import { rowLink } from '$lib/actions/row-link';
	import { getStaffDashboard } from '$lib/remote/staff-dashboard.remote';
	import {
		allStaffNavItems,
		filterNavItems,
		type StaffNavBadgeKey,
		type StaffNavItem
	} from './nav-items';
	import { resolve } from '$app/paths';
	import { hasCapability } from '$lib/config';
	import { formatDateShort, formatDateShortYear, formatTimeRange } from '$lib/utils/format';
	import { formatEventTimeRange } from '$lib/utils/event-time';
	import { formatIsoDay } from '$lib/utils/deadline';

	// Typed by the badge keys, so a new sidebar count cannot reach this page unnamed.
	const queueLabels: Record<StaffNavBadgeKey, string> = {
		inboxUnread: 'Unresolved Inbox Threads',
		volunteerPending: 'Waiting Volunteer Work',
		listingsPending: 'Listings Awaiting Review',
		suggestionsAwaiting: 'Suggestions Awaiting Staff',
		appealsPending: 'Pending Appeals',
		resourceTipsPending: 'Pending Resource Tips'
	};
	const dayLabels = ["Today's Reservations", "Tomorrow's Reservations"];

	let data = $derived(await getStaffDashboard());

	// The sidebar's own rows and filter, so a queue links where its badge does and
	// only for a viewer who could open it. A badge on parent and child keeps the child.
	let queues = $derived.by(() => {
		const byKey: Partial<Record<StaffNavBadgeKey, StaffNavItem>> = {};
		for (const item of filterNavItems(allStaffNavItems(), data.capabilities)) {
			if (item.badgeKey) byKey[item.badgeKey] = item;
		}
		return (Object.entries(byKey) as [StaffNavBadgeKey, StaffNavItem][])
			.map(([key, item]) => ({
				key,
				href: item.href,
				label: queueLabels[key],
				count: data.queues[key]
			}))
			.filter((q) => q.count > 0);
	});
	let doorCodes = $derived(
		data.room?.[0].reservations.filter((r) => r.doorCodeUnconfirmed).length ?? 0
	);
	let nothingPending = $derived(
		queues.length === 0 &&
			!data.shortShifts?.total &&
			!data.deadlines?.total &&
			!data.lowStock?.total
	);
	let showsHref = $derived(
		hasCapability(data.capabilities, 'event.manage')
			? resolve('/staff/productions')
			: resolve('/staff/events')
	);
</script>

<PageHeader title="Dashboard" />
<PageContent>
	{#if data.room}
		{#if doorCodes > 0}
			<Alert type="warning">
				{doorCodes === 1
					? 'One door code for a session happening now is not confirmed on the lock yet.'
					: `${doorCodes} door codes for sessions happening now are not confirmed on the lock yet.`}
			</Alert>
		{/if}
		{#each data.room as day, i (day.date)}
			<SectionLabel label={dayLabels[i]} count={day.reservations.length} />
			{#if day.reservations.length === 0}
				<EmptyState
					description={i === 0 ? 'The room is free today.' : 'The room is free tomorrow.'}
				/>
			{:else}
				<div class="mt-4 mb-2">
					<DayTimeline
						others={day.reservations.map((r) => ({
							id: r.id,
							startsAt: r.startsAt,
							endsAt: r.endsAt,
							bookerType: r.bookerType,
							label: r.booker.title,
							href: resolve(`/staff/reservations/${r.id}`)
						}))}
					/>
				</div>
				<Table>
					{#snippet head()}
						<th class="whitespace-nowrap">When</th>
						<th>Booked for</th>
						<th class="w-px">Status</th>
					{/snippet}
					{#each day.reservations as r (r.id)}
						<tr class="hover cursor-pointer" use:rowLink={resolve(`/staff/reservations/${r.id}`)}>
							<td class="whitespace-nowrap">{formatTimeRange(r.startsAt, r.endsAt)}</td>
							<td class="cell-primary">
								<EntityIdentity ref={r.booker} />
								{#if r.doorCodeUnconfirmed}
									<Badge variant="warning" size="xs">Code unconfirmed</Badge>
								{/if}
							</td>
							<td class="w-px"><StatusBadge status={r.status} label /></td>
						</tr>
					{/each}
				</Table>
			{/if}
		{/each}
		<div class="mt-2">
			<Button variant="ghost" size="sm" href={resolve('/staff/reservations')}>
				Open reservations
			</Button>
		</div>
	{/if}

	{#if data.shows}
		<SectionLabel label="Upcoming Shows" count={data.shows.length} />
		{#if data.shows.length === 0}
			<EmptyState description="No shows in the next seven days." />
		{:else}
			<Table>
				{#snippet head()}
					<th class="whitespace-nowrap">When</th>
					<th>Show</th>
					<th class="w-px">Status</th>
				{/snippet}
				{#each data.shows as show (show.id)}
					<tr class="hover cursor-pointer" use:rowLink={resolve(`/staff/events/${show.id}`)}>
						<td class="whitespace-nowrap">
							{formatDateShort(show.startsAt)}
							<div class="text-muted">{formatEventTimeRange(show.startsAt, show.endsAt)}</div>
						</td>
						<td class="cell-primary">
							<EntityIdentity ref={show.ref} />
							{#if show.blockers.length > 0}
								<div class="text-sm text-warning">Still open: {show.blockers.join('; ')}</div>
							{/if}
						</td>
						<td class="w-px">
							<StatusBadge status={show.productionStatus ?? show.status} label />
						</td>
					</tr>
				{/each}
			</Table>
		{/if}
		<div class="mt-2">
			<Button variant="ghost" size="sm" href={showsHref}>Open the shows list</Button>
		</div>
	{/if}

	<SectionLabel label="Pending Queues" />
	{#if nothingPending}
		<EmptyState description="Nothing is waiting on staff right now." />
	{/if}
	{#if queues.length > 0}
		<Table>
			{#snippet head()}
				<th>Queue</th>
				<th class="cell-num">Waiting</th>
			{/snippet}
			{#each queues as q (q.key)}
				<tr class="hover cursor-pointer" use:rowLink={q.href}>
					<td class="cell-primary">{q.label}</td>
					<td class="cell-num">{q.count}</td>
				</tr>
			{/each}
		</Table>
	{/if}

	{#if data.shortShifts?.total}
		<!-- A show that goes out a person short cannot be fixed next week. -->
		<SectionLabel label="Short-Staffed Shifts" count={data.shortShifts.total} />
		<Table>
			{#snippet head()}
				<th class="whitespace-nowrap">When</th>
				<th>Role</th>
				<th class="col-support">Event</th>
				<th class="cell-num whitespace-nowrap">Still need</th>
			{/snippet}
			{#each data.shortShifts.rows as shift (shift.id)}
				<tr
					class="hover cursor-pointer"
					use:rowLink={resolve(`/staff/volunteer/shifts/${shift.id}`)}
				>
					<td class="whitespace-nowrap">{formatDateShort(shift.startsAt)}</td>
					<td class="cell-primary">{shift.roleName}</td>
					<td class="col-support cell-text truncate">{shift.eventTitle ?? ''}</td>
					<td class="cell-num text-warning">{shift.capacity - shift.claimed}</td>
				</tr>
			{/each}
		</Table>
		<div class="mt-2">
			<Button variant="ghost" size="sm" href={resolve('/staff/volunteer')}>
				{data.shortShifts.total > data.shortShifts.rows.length
					? `See all ${data.shortShifts.total} short shifts`
					: 'Open the volunteering worklist'}
			</Button>
		</div>
	{/if}

	{#if data.deadlines?.total}
		<SectionLabel label="Upcoming Deadlines" count={data.deadlines.total} />
		<Table>
			{#snippet head()}
				<th class="whitespace-nowrap">Due</th>
				<th>What</th>
				<th class="col-support">Funder or sponsor</th>
			{/snippet}
			{#each data.deadlines.rows as d (d.module + d.subjectId)}
				<tr
					class="hover cursor-pointer"
					use:rowLink={d.module === 'grant'
						? resolve(`/staff/grants/${d.parentId}`)
						: resolve(`/staff/sponsors/${d.parentId}`)}
				>
					<td class="whitespace-nowrap" class:text-error={d.overdue}>{formatIsoDay(d.on)}</td>
					<td class="cell-primary">
						{d.title}
						<div class="text-muted">{d.parentTitle}</div>
					</td>
					<td class="col-support cell-text truncate">{d.counterparty}</td>
				</tr>
			{/each}
		</Table>
		{#if data.deadlines.total > data.deadlines.rows.length}
			<p class="mt-2 text-muted">
				{data.deadlines.total - data.deadlines.rows.length} more in Grants and Sponsors.
			</p>
		{/if}
	{/if}

	{#if data.lowStock?.total}
		<SectionLabel label="Low-Stock Items" count={data.lowStock.total} />
		<Table>
			{#snippet head()}
				<th>Item</th>
				<th class="col-support">Category</th>
				<th class="cell-num">On hand</th>
				<th class="col-support cell-num">Buy</th>
			{/snippet}
			{#each data.lowStock.rows as item (item.id)}
				<tr class="hover cursor-pointer" use:rowLink={resolve(`/staff/inventory/${item.id}`)}>
					<td class="cell-primary">
						{item.name}
						{#if item.isOut}
							<Badge variant="error" size="xs">Out</Badge>
						{/if}
					</td>
					<td class="col-support">{item.category.name}</td>
					<td class="cell-num" class:text-error={item.isOut}>{item.onHand}</td>
					<td class="col-support cell-num">{item.suggestedOrder}</td>
				</tr>
			{/each}
		</Table>
		<div class="mt-2">
			<Button variant="ghost" size="sm" href={resolve('/staff/inventory/restock')}>
				{data.lowStock.total > data.lowStock.rows.length
					? `See all ${data.lowStock.total} to restock`
					: 'Open the restock list'}
			</Button>
		</div>
	{/if}

	{#if data.members}
		<SectionLabel label="Recent Members" />
		<p class="mb-2 text-muted">
			{data.members.newThisMonth === 1
				? 'One member joined this month.'
				: `${data.members.newThisMonth} members joined this month.`}
		</p>
		{#if data.members.recent.length === 0}
			<EmptyState description="No members yet" />
		{:else}
			<Table>
				{#snippet head()}
					<th>Member</th>
					<th class="col-support whitespace-nowrap">Joined</th>
				{/snippet}
				{#each data.members.recent as u (u.id)}
					<tr class="hover cursor-pointer" use:rowLink={resolve(`/staff/users/${u.id}`)}>
						<td class="cell-primary"><EntityIdentity ref={u.ref} /></td>
						<td class="col-support whitespace-nowrap">{formatDateShortYear(u.createdAt)}</td>
					</tr>
				{/each}
			</Table>
		{/if}
	{/if}
</PageContent>
