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
	import { ActivityFeed, type ActivityRow } from '#lib/components/ui/ActivityFeed/index.js';
	import { getEntityViewer } from '#lib/components/ui/entity/context.js';
	import { entityHref } from '#lib/utils/entity-href.js';
	import { FEED_MAX, FEED_PAGE } from '#lib/types/activity.js';
	import { isReviewKind, reviewKinds, type ReviewKind } from '#lib/types/review.js';
	import type { ResolvedPathname } from '$app/types';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { withQuery } from '#lib/utils/with-query.js';
	import { hasCapability } from '#lib/config.js';
	import {
		formatDateShort,
		formatDateShortYear,
		formatSpan,
		formatTimeRange
	} from '#lib/utils/format.js';
	import { formatEventTimeRange } from '#lib/utils/event-time.js';
	import { formatIsoDay } from '#lib/utils/deadline.js';

	// Typed by the kinds, so a new review kind cannot reach this page unnamed.
	const kindLabels: Record<ReviewKind, () => string> = {
		suggestion_moderation: m.staff_review_kind_suggestion_moderation_label,
		suggestion_answer: m.staff_review_kind_suggestion_answer_label,
		suggestion_edit: m.staff_review_kind_suggestion_edit_label,
		listing: m.staff_review_kind_listing_label,
		resource_tip: m.staff_review_kind_resource_tip_label,
		appeal: m.staff_review_kind_appeal_label,
		hour_log: m.staff_review_kind_hour_log_label,
		shift_claim: m.staff_review_kind_shift_claim_label
	};
	const dayLabels = [m.staff_room_today_label(), m.staff_room_tomorrow_label()];
	const viewer = getEntityViewer();

	// The review filter lives in the URL; Show more raises the one query's limit.
	const initialKind = page.url.searchParams.get('review');
	let kind = $state<ReviewKind | undefined>(isReviewKind(initialKind) ? initialKind : undefined);
	let limit = $state(FEED_PAGE);

	$effect(() => {
		const href = withQuery(resolve('staff'), kind ? `review=${kind}` : '');
		if (location.pathname + location.search !== href) {
			void goto(href, { replace: true, reset: false });
		}
	});

	function filter(next: ReviewKind | undefined) {
		kind = next;
		limit = FEED_PAGE;
	}

	let data = $derived(await getStaffDashboard({ kind, limit }));

	// Chips only for kinds with something waiting, plus the selected one.
	let chips = $derived(
		reviewKinds
			.filter((k) => data.review.counts.byKind[k] || k === kind)
			.map((k) => ({ kind: k, count: data.review.counts.byKind[k] ?? 0 }))
	);
	let reviewRows = $derived(
		data.review.items.map((item): ActivityRow => ({
			id: item.id,
			at: item.at,
			actor: item.actorName ? { name: item.actorName } : null,
			summary: item.summary || kindLabels[item.kind](),
			// entityHref resolves its routes; the cast only restores the type it widened.
			href: entityHref(item.ref, viewer) as ResolvedPathname | null,
			context: { label: kindLabels[item.kind]() }
		}))
	);
	let doorCodes = $derived(
		data.room?.[0].reservations.filter((r) => r.doorCodeUnconfirmed).length ?? 0
	);
	let showsHref = $derived(
		hasCapability(data.capabilities, 'event.manage')
			? resolve('staff/tasks/productions')
			: resolve('staff/events')
	);
</script>

<PageHeader title={m.staff_dashboard_title()} />
<PageContent>
	{#if data.room}
		{#if doorCodes > 0}
			<Alert type="warning">
				{doorCodes === 1
					? m.staff_one_door_code_session_happening_body()
					: m.staff_door_codes_sessions_happening_now_body({ doorCodes })}
			</Alert>
		{/if}
		{#each data.room as day, i (day.date)}
			<SectionLabel label={dayLabels[i]} count={day.uses.length} />
			{#if day.uses.length === 0}
				<EmptyState
					description={i === 0 ? m.staff_room_free_today_body() : m.staff_room_free_tomorrow_body()}
				/>
			{:else}
				<div class="mt-4 mb-2">
					<DayTimeline
						day={day.date}
						closures={day.closures}
						others={day.reservations.map((r) => ({
							id: r.id,
							startsAt: r.startsAt,
							endsAt: r.endsAt,
							bookerType: r.bookerType,
							label: r.booker.title,
							href: resolve(`staff/reservations/${r.id}`)
						}))}
					/>
				</div>
				<Table>
					{#snippet head()}
						<th class="whitespace-nowrap">{m.staff_when_label()}</th>
						<th>{m.staff_room_use_label()}</th>
						<th class="w-px">{m.staff_status_label()}</th>
					{/snippet}
					{#each day.uses as r (r.id)}
						{#if r.kind === 'closure'}
							<tr>
								<td class="whitespace-nowrap">{formatSpan(r.startsAt, r.endsAt)}</td>
								<td class="cell-primary">{r.reason}</td>
								<td class="w-px"
									><Badge size="sm" variant="error">{m.staff_reservations_closed_label()}</Badge
									></td
								>
							</tr>
						{:else}
							<tr class="hover cursor-pointer" use:rowLink={resolve(`staff/reservations/${r.id}`)}>
								<td class="whitespace-nowrap">{formatTimeRange(r.startsAt, r.endsAt)}</td>
								<td class="cell-primary">
									<EntityIdentity ref={r.booker} />
									{#if r.doorCodeUnconfirmed}
										<Badge variant="warning" size="xs">{m.staff_code_unconfirmed_label()}</Badge>
									{/if}
								</td>
								<td class="w-px"><StatusBadge status={r.status} label /></td>
							</tr>
						{/if}
					{/each}
				</Table>
			{/if}
		{/each}
		<div class="mt-2">
			<Button variant="ghost" size="sm" href={resolve('staff/reservations')}>
				{m.staff_open_reservations_label()}
			</Button>
		</div>
	{/if}

	{#if data.shows}
		<SectionLabel label={m.staff_upcoming_shows_label()} count={data.shows.length} />
		{#if data.shows.length === 0}
			<EmptyState description={m.staff_no_shows_next_seven_days_body()} />
		{:else}
			<Table>
				{#snippet head()}
					<th class="whitespace-nowrap">{m.staff_when_label()}</th>
					<th>{m.staff_event_label()}</th>
					<th class="w-px">{m.staff_status_label()}</th>
				{/snippet}
				{#each data.shows as show (show.id)}
					<tr class="hover cursor-pointer" use:rowLink={resolve(`staff/events/${show.id}`)}>
						<td class="whitespace-nowrap">
							{formatDateShort(show.startsAt)}
							<div class="text-muted">{formatEventTimeRange(show.startsAt, show.endsAt)}</div>
						</td>
						<td class="cell-primary">
							<EntityIdentity ref={show.ref} />
							{#if show.blockers.length > 0}
								<div class="text-sm text-warning">
									{m.staff_still_open_text({ join: show.blockers.join('; ') })}
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
			<Button variant="ghost" size="sm" href={showsHref}>{m.staff_open_shows_list_label()}</Button>
		</div>
	{/if}

	<SectionLabel label={m.staff_review_waiting_label()} count={data.review.counts.total} />
	{#if chips.length > 0}
		<div class="mb-2 flex flex-wrap gap-2" data-testid="review-filter">
			<Button
				size="sm"
				variant={kind ? 'ghost' : 'primary'}
				aria-pressed={!kind}
				onclick={() => filter(undefined)}
			>
				{m.staff_review_all_label()}
				<Badge size="sm">{data.review.counts.total}</Badge>
			</Button>
			{#each chips as chip (chip.kind)}
				<Button
					size="sm"
					variant={kind === chip.kind ? 'primary' : 'ghost'}
					aria-pressed={kind === chip.kind}
					data-review-kind={chip.kind}
					onclick={() => filter(kind === chip.kind ? undefined : chip.kind)}
				>
					{kindLabels[chip.kind]()}
					<Badge size="sm">{chip.count}</Badge>
				</Button>
			{/each}
		</div>
	{/if}
	<ActivityFeed
		rows={reviewRows}
		label={m.staff_review_waiting_label()}
		hasMore={data.review.hasMore && limit < FEED_MAX}
		moreLabel={m.staff_review_show_more_label()}
		onmore={() => (limit = Math.min(limit + FEED_PAGE, FEED_MAX))}
		empty={{ description: m.staff_review_empty_body() }}
	/>

	{#if data.shortShifts?.total}
		<!-- A show that goes out a person short cannot be fixed next week. -->
		<SectionLabel label={m.staff_short_staffed_shifts_label()} count={data.shortShifts.total} />
		<Table>
			{#snippet head()}
				<th class="whitespace-nowrap">{m.staff_when_label()}</th>
				<th>{m.staff_role_label()}</th>
				<th class="col-support">{m.staff_event_label()}</th>
				<th class="cell-num whitespace-nowrap">{m.staff_still_need_label()}</th>
			{/snippet}
			{#each data.shortShifts.rows as shift (shift.id)}
				<tr class="hover cursor-pointer" use:rowLink={resolve(`staff/tasks/${shift.id}`)}>
					<td class="whitespace-nowrap">{formatDateShort(shift.startsAt)}</td>
					<td class="cell-primary">{shift.roleName}</td>
					<td class="col-support cell-text truncate">{shift.eventTitle ?? ''}</td>
					<td class="cell-num text-warning">{shift.capacity - shift.claimed}</td>
				</tr>
			{/each}
		</Table>
		<div class="mt-2">
			<Button
				variant="ghost"
				size="sm"
				href={withQuery(resolve('staff/volunteer/schedule'), 'needs=short')}
			>
				{data.shortShifts.total > data.shortShifts.rows.length
					? m.staff_see_all_short_shifts_label({ total: data.shortShifts.total })
					: m.staff_open_volunteering_worklist_label()}
			</Button>
		</div>
	{/if}

	{#if data.deadlines?.total}
		<SectionLabel label={m.staff_upcoming_deadlines_label()} count={data.deadlines.total} />
		<Table>
			{#snippet head()}
				<th class="whitespace-nowrap">{m.staff_due_label()}</th>
				<th>{m.staff_deadline_label()}</th>
				<th class="col-support">{m.staff_funder_sponsor_label()}</th>
			{/snippet}
			{#each data.deadlines.rows as d (d.module + d.subjectId)}
				<tr
					class="hover cursor-pointer"
					use:rowLink={d.module === 'grant'
						? resolve(`staff/grants/${d.parentId}`)
						: resolve(`staff/sponsors/${d.parentId}`)}
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
				{m.staff_more_grants_sponsors_text({
					value: data.deadlines.total - data.deadlines.rows.length
				})}
			</p>
		{/if}
	{/if}

	{#if data.lowStock?.total}
		<SectionLabel label={m.staff_low_stock_items_label()} count={data.lowStock.total} />
		<Table>
			{#snippet head()}
				<th>{m.staff_item_label()}</th>
				<th class="col-support">{m.staff_category_label()}</th>
				<th class="cell-num">{m.staff_hand_label()}</th>
				<th class="col-support cell-num">{m.staff_buy_label()}</th>
			{/snippet}
			{#each data.lowStock.rows as item (item.id)}
				<tr class="hover cursor-pointer" use:rowLink={resolve(`staff/inventory/${item.id}`)}>
					<td class="cell-primary">
						{item.name}
						{#if item.isOut}
							<Badge variant="error" size="xs">{m.staff_out_label()}</Badge>
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
				href={withQuery(resolve('staff/inventory/supplies'), 'show=restock')}
			>
				{data.lowStock.total > data.lowStock.rows.length
					? m.staff_see_all_restock_label({ total: data.lowStock.total })
					: m.staff_open_restock_list_label()}
			</Button>
		</div>
	{/if}

	{#if data.members}
		<SectionLabel label={m.staff_recent_members_label()} />
		<p class="mb-2 text-muted">
			{data.members.newThisMonth === 1
				? m.staff_one_member_joined_month_text()
				: m.staff_members_joined_month_text({ newThisMonth: data.members.newThisMonth })}
		</p>
		{#if data.members.recent.length === 0}
			<EmptyState description={m.staff_no_members_yet_body()} />
		{:else}
			<Table>
				{#snippet head()}
					<th>{m.staff_member_label()}</th>
					<th class="col-support whitespace-nowrap">{m.staff_joined_label()}</th>
				{/snippet}
				{#each data.members.recent as u (u.id)}
					<tr class="hover cursor-pointer" use:rowLink={resolve(`staff/members/${u.id}`)}>
						<td class="cell-primary"><EntityIdentity ref={u.ref} /></td>
						<td class="col-support whitespace-nowrap">{formatDateShortYear(u.createdAt)}</td>
					</tr>
				{/each}
			</Table>
		{/if}
	{/if}
</PageContent>
