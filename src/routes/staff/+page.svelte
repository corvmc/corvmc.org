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
	import { getStaffLayout } from '#lib/remote/layout.remote.js';
	import ReviewRowDecisions from './ReviewRowDecisions.svelte';
	import ShortShiftsTable from './ShortShiftsTable.svelte';
	import { ActivityFeed, type ActivityRow } from '#lib/components/ui/ActivityFeed/index.js';
	import { getEntityViewer } from '#lib/components/ui/entity/context.js';
	import { entityHref } from '#lib/utils/entity-href.js';
	import { FEED_MAX, FEED_PAGE } from '#lib/types/activity.js';
	import {
		isReviewKind,
		reviewKinds,
		type ReviewItem,
		type ReviewKind
	} from '#lib/types/review.js';
	import type { ResolvedPathname } from '$app/types';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { withHash, withQuery } from '#lib/utils/with-query.js';
	import { hasCapability, type EntityType } from '#lib/config.js';
	import type { EntityRef } from '#lib/types/entity.js';
	import {
		formatDateShort,
		formatDateShortYear,
		formatSpan,
		formatTimeRange
	} from '#lib/utils/format.js';
	import { formatEventTimeRange } from '#lib/utils/event-time.js';
	import { formatIsoDay } from '#lib/utils/deadline.js';
	import { shiftLabel } from '#lib/utils/shift-label.js';
	import { isOverdue } from '#lib/utils/work-order-due.js';
	import { whenOf } from '#lib/utils/task-facts.js';

	// Typed by the kinds, so a new review kind cannot reach this page unnamed.
	const kindLabels: Record<ReviewKind, () => string> = {
		suggestion_moderation: m.staff_review_kind_suggestion_moderation_label,
		suggestion_answer: m.staff_review_kind_suggestion_answer_label,
		suggestion_edit: m.staff_review_kind_suggestion_edit_label,
		listing: m.staff_review_kind_listing_label,
		classified: m.staff_review_kind_classified_label,
		resource_tip: m.staff_review_kind_resource_tip_label,
		flag: m.staff_review_kind_flag_label,
		appeal: m.staff_review_kind_appeal_label,
		problem: m.staff_review_kind_problem_label,
		group_application: m.staff_review_kind_group_application_label,
		market_vendor: m.staff_review_kind_market_vendor_label,
		hour_log: m.staff_review_kind_hour_log_label,
		shift_claim: m.staff_review_kind_shift_claim_label,
		minor_volunteer: m.staff_review_kind_minor_volunteer_label
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
		data.review.items.map((item): ActivityRow & { item: ReviewItem } => ({
			item,
			id: item.id,
			at: item.at,
			actor: item.actorName ? { name: item.actorName } : null,
			summary: item.summary || kindLabels[item.kind](),
			// entityHref resolves its routes; the cast only restores the type it widened.
			href: entityHref(item.ref, viewer) as ResolvedPathname | null,
			context: { label: kindLabels[item.kind]() }
		}))
	);
	// A decided row leaves the feed, and the nav badge counts one fewer.
	function refreshReview() {
		void getStaffDashboard({ kind, limit }).refresh();
		void getStaffLayout().refresh();
	}
	let doorCodes = $derived(
		data.room?.[0].reservations.filter((r) => r.doorCodeUnconfirmed).length ?? 0
	);
	const now = new Date();
	// A task about a record opens that record, where its work is done.
	function taskHref(t: { id: string; about: { type: EntityType; id: string } | null }) {
		const about = t.about && entityHref({ ...t.about, title: '' } as EntityRef, viewer);
		return about ?? resolve(`staff/tasks/${t.id}`);
	}
	let showsHref = $derived(
		hasCapability(data.capabilities, 'event.manage')
			? withQuery(resolve('staff/events'), 'view=productions')
			: resolve('staff/events')
	);
</script>

<PageHeader title={m.staff_dashboard_title()} />
<PageContent>
	{#if data.myWork?.total}
		<SectionLabel label={m.staff_your_tasks_label()} count={data.myWork.total} />
		<Table>
			{#snippet head()}
				<th class="whitespace-nowrap">{m.staff_when_label()}</th>
				<th>{m.staff_task_label()}</th>
			{/snippet}
			{#each data.myWork.rows as t (t.id)}
				{@const when = whenOf(t)}
				{@const late = isOverdue(t, now)}
				<tr class="hover cursor-pointer" data-task={t.id} use:rowLink={taskHref(t)}>
					<td class="whitespace-nowrap" class:text-error={late}>
						{when ? formatDateShort(when) : ''}
					</td>
					<td class="cell-primary">
						{shiftLabel(t)}
						{#if late}
							<Badge variant="error" size="xs">{m.staff_overdue_label()}</Badge>
						{/if}
						{#if t.projectName}
							<div class="text-muted">{t.projectName}</div>
						{/if}
					</td>
				</tr>
			{/each}
		</Table>
		{#if data.myWork.total > data.myWork.rows.length}
			<p class="mt-2 text-muted">
				{m.staff_more_your_tasks_text({ count: data.myWork.total - data.myWork.rows.length })}
			</p>
		{/if}
		{#if hasCapability(data.capabilities, 'project.read')}
			<div class="mt-2">
				<Button variant="ghost" size="sm" href={resolve('staff/tasks')}>
					{m.staff_open_tasks_list_label()}
				</Button>
			</div>
		{/if}
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
	>
		{#snippet trailing(row)}
			<ReviewRowDecisions
				item={row.item}
				kindLabel={kindLabels[row.item.kind]()}
				ondecided={refreshReview}
			/>
		{/snippet}
	</ActivityFeed>

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
								<td class="w-px"><StatusBadge status={r.track} label /></td>
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

	{#if data.shortShifts?.total}
		<!-- A show that goes out a person short cannot be fixed next week. -->
		<SectionLabel label={m.staff_short_staffed_shifts_label()} count={data.shortShifts.total} />
		<ShortShiftsTable rows={data.shortShifts.rows} />
		<div class="mt-2">
			<Button
				variant="ghost"
				size="sm"
				href={withQuery(resolve('staff/volunteering'), 'needs=short')}
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
						: withHash(resolve(`staff/contacts/${d.parentId}`), 'sponsorships')}
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
