<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import PageHeader from '#lib/components/ui/PageHeader.svelte';
	import PageContent from '#lib/components/ui/PageContent.svelte';
	import Table from '#lib/components/ui/Table.svelte';
	import EmptyState from '#lib/components/ui/EmptyState.svelte';
	import { EntityIdentity } from '#lib/components/ui/entity/index.js';
	import SectionLabel from '#lib/components/ui/SectionLabel.svelte';
	import StatusBadge from '#lib/components/ui/StatusBadge.svelte';
	import Alert from '#lib/components/ui/Alert.svelte';
	import Badge from '#lib/components/ui/Badge.svelte';
	import Button from '#lib/components/ui/Button.svelte';
	import DayTimeline from '#lib/components/reservations/DayTimeline.svelte';
	import { rowLink } from '#lib/actions/row-link.js';
	import { getStaffDashboard } from '#lib/remote/staff-dashboard.remote.js';
	import {
		allStaffNavItems,
		filterNavItems,
		type StaffNavBadgeKey,
		type StaffNavItem
	} from './nav-items';
	import { resolve } from '$app/paths';
	import { withQuery } from '#lib/utils/with-query.js';
	import { hasCapability } from '#lib/config.js';
	import { formatDateShort, formatDateShortYear, formatTimeRange } from '#lib/utils/format.js';
	import { formatEventTimeRange } from '#lib/utils/event-time.js';
	import { formatIsoDay } from '#lib/utils/deadline.js';

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
			? resolve('/staff/projects/productions')
			: resolve('/staff/events')
	);
</script>

<PageHeader title={m.staff_dashboard()} />
<PageContent>
	{#if data.room}
		{#if doorCodes > 0}
			<Alert type="warning">
				{doorCodes === 1
					? m.staff_one_door_code_session_happening()
					: m.staff_door_codes_sessions_happening_now({ doorCodes })}
			</Alert>
		{/if}
		{#each data.room as day, i (day.date)}
			<SectionLabel label={dayLabels[i]} count={day.reservations.length} />
			{#if day.reservations.length === 0}
				<EmptyState
					description={i === 0 ? m.staff_room_free_today() : m.staff_room_free_tomorrow()}
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
						<th class="whitespace-nowrap">{m.staff_when()}</th>
						<th>{m.staff_booked()}</th>
						<th class="w-px">{m.staff_status()}</th>
					{/snippet}
					{#each day.reservations as r (r.id)}
						<tr class="hover cursor-pointer" use:rowLink={resolve(`/staff/reservations/${r.id}`)}>
							<td class="whitespace-nowrap">{formatTimeRange(r.startsAt, r.endsAt)}</td>
							<td class="cell-primary">
								<EntityIdentity ref={r.booker} />
								{#if r.doorCodeUnconfirmed}
									<Badge variant="warning" size="xs">{m.staff_code_unconfirmed()}</Badge>
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
				{m.staff_open_reservations()}
			</Button>
		</div>
	{/if}

	{#if data.shows}
		<SectionLabel label={m.staff_upcoming_shows()} count={data.shows.length} />
		{#if data.shows.length === 0}
			<EmptyState description={m.staff_no_shows_next_seven_days()} />
		{:else}
			<Table>
				{#snippet head()}
					<th class="whitespace-nowrap">{m.staff_when()}</th>
					<th>{m.staff_show()}</th>
					<th class="w-px">{m.staff_status()}</th>
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
								<div class="text-sm text-warning">
									{m.staff_still_open({ join: show.blockers.join('; ') })}
								</div>
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
			<Button variant="ghost" size="sm" href={showsHref}>{m.staff_open_shows_list()}</Button>
		</div>
	{/if}

	<SectionLabel label={m.staff_pending_queues()} />
	{#if nothingPending}
		<EmptyState description={m.staff_nothing_waiting_staff_right_now()} />
	{/if}
	{#if queues.length > 0}
		<Table>
			{#snippet head()}
				<th>{m.staff_queue()}</th>
				<th class="cell-num">{m.staff_waiting()}</th>
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
		<SectionLabel label={m.staff_short_staffed_shifts()} count={data.shortShifts.total} />
		<Table>
			{#snippet head()}
				<th class="whitespace-nowrap">{m.staff_when()}</th>
				<th>{m.staff_role()}</th>
				<th class="col-support">{m.staff_event()}</th>
				<th class="cell-num whitespace-nowrap">{m.staff_still_need()}</th>
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
					? m.staff_see_all_short_shifts({ total: data.shortShifts.total })
					: m.staff_open_volunteering_worklist()}
			</Button>
		</div>
	{/if}

	{#if data.deadlines?.total}
		<SectionLabel label={m.staff_upcoming_deadlines()} count={data.deadlines.total} />
		<Table>
			{#snippet head()}
				<th class="whitespace-nowrap">{m.staff_due()}</th>
				<th>{m.staff_what()}</th>
				<th class="col-support">{m.staff_funder_sponsor()}</th>
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
				{m.staff_more_grants_sponsors({ value: data.deadlines.total - data.deadlines.rows.length })}
			</p>
		{/if}
	{/if}

	{#if data.lowStock?.total}
		<SectionLabel label={m.staff_low_stock_items()} count={data.lowStock.total} />
		<Table>
			{#snippet head()}
				<th>{m.staff_item()}</th>
				<th class="col-support">{m.staff_category()}</th>
				<th class="cell-num">{m.staff_hand()}</th>
				<th class="col-support cell-num">{m.staff_buy()}</th>
			{/snippet}
			{#each data.lowStock.rows as item (item.id)}
				<tr class="hover cursor-pointer" use:rowLink={resolve(`/staff/inventory/${item.id}`)}>
					<td class="cell-primary">
						{item.name}
						{#if item.isOut}
							<Badge variant="error" size="xs">{m.staff_out()}</Badge>
						{/if}
					</td>
					<td class="col-support">{item.category.name}</td>
					<td class="cell-num" class:text-error={item.isOut}>{item.onHand}</td>
					<td class="col-support cell-num">{item.suggestedOrder}</td>
				</tr>
			{/each}
		</Table>
		<div class="mt-2">
			<Button
				variant="ghost"
				size="sm"
				href={withQuery(resolve('/staff/inventory'), 'show=restock')}
			>
				{data.lowStock.total > data.lowStock.rows.length
					? m.staff_see_all_restock({ total: data.lowStock.total })
					: m.staff_open_restock_list()}
			</Button>
		</div>
	{/if}

	{#if data.members}
		<SectionLabel label={m.staff_recent_members()} />
		<p class="mb-2 text-muted">
			{data.members.newThisMonth === 1
				? m.staff_one_member_joined_month()
				: m.staff_members_joined_month({ newThisMonth: data.members.newThisMonth })}
		</p>
		{#if data.members.recent.length === 0}
			<EmptyState description={m.staff_no_members_yet()} />
		{:else}
			<Table>
				{#snippet head()}
					<th>{m.staff_member()}</th>
					<th class="col-support whitespace-nowrap">{m.staff_joined()}</th>
				{/snippet}
				{#each data.members.recent as u (u.id)}
					<tr class="hover cursor-pointer" use:rowLink={resolve(`/staff/members/${u.id}`)}>
						<td class="cell-primary"><EntityIdentity ref={u.ref} /></td>
						<td class="col-support whitespace-nowrap">{formatDateShortYear(u.createdAt)}</td>
					</tr>
				{/each}
			</Table>
		{/if}
	{/if}
</PageContent>
