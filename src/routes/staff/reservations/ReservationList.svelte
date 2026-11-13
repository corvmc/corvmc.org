<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import { isEventHold } from '#lib/config.js';
	import Button from '#lib/components/ui/Button.svelte';
	import PageHeader from '#lib/components/ui/PageHeader.svelte';
	import PageContent from '#lib/components/ui/PageContent.svelte';
	import StatusBadge from '#lib/components/ui/StatusBadge.svelte';
	import BookerTypeIcon from '#lib/components/reservations/BookerTypeIcon.svelte';
	import DataList from '#lib/components/ui/DataList.svelte';
	import Table from '#lib/components/ui/Table.svelte';
	import { rowLink } from '#lib/actions/row-link.js';
	import { withQuery } from '#lib/utils/with-query.js';
	import { resolve } from '$app/paths';
	import {
		CashReceivedAction,
		NoShowReservationAction,
		CompleteReservationAction,
		CreateClosureAction,
		UpdateClosureAction,
		DeleteClosureAction
	} from '#lib/components/actions/index.js';
	import {
		statuses,
		urlFilterQuery,
		adjacentId,
		type Booker,
		type ReservationFilters,
		type Status
	} from './filters.svelte';
	import ListFilters from '#lib/components/ui/ListFilters.svelte';
	import OverflowMenu from '#lib/components/ui/OverflowMenu.svelte';
	import CreateReservation from './CreateModal.svelte';
	import RecurringSeriesModal from './RecurringSeriesModal.svelte';
	import BuildingAccess from './BuildingAccess.svelte';
	import ReservationCard from './ReservationCard.svelte';
	import { paymentStatus } from './payment-status';
	import { page as appPage, navigating } from '$app/state';
	import { EntityChip } from '#lib/components/ui/entity/index.js';
	import { goto } from '$app/navigation';
	import {
		IconCircleCheck,
		IconRepeat,
		IconUserPlus,
		IconNote,
		IconPencil,
		IconTrash,
		IconChevronDown
	} from '@tabler/icons-svelte';
	import {
		formatDate,
		formatTimeRange,
		formatPaymentBreakdown,
		formatSpan
	} from '#lib/utils/format.js';
	import { DEFAULT_TIMEZONE } from '#lib/config.js';
	import {
		visibleActions,
		reservationPaymentState,
		owedAfterSession
	} from '#lib/utils/reservation-actions.js';
	import Badge from '#lib/components/ui/Badge.svelte';
	import { getStaffReservationsPage } from '#lib/remote/reservations.remote.js';
	import { Latest } from '#lib/latest.svelte.js';

	type Row = Awaited<ReturnType<typeof getStaffReservationsPage>>['list']['rows'][number];
	type Closure = Extract<Row, { kind: 'closure' }>;
	type Reservation = Extract<Row, { kind: 'reservation' }>;

	let {
		filters,
		openId
	}: {
		filters: ReservationFilters;
		/** The reservation open beside the list, if any. */
		openId: string | null;
	} = $props();

	const params = appPage.url.searchParams;
	// `?access` opens Building access: where the lock-offline email and the U-tec sign-in land.
	let accessOpen = $state(params.has('access') || params.has('utec'));
	const utecParam = params.get('utec');

	// Mirrored onto the current pathname, so the view survives a reload or a link
	// copied while a reservation is open.
	$effect(() => {
		const query = filters.urlQuery;
		// Only the filters' own keys decide whether the address is stale, so a link's
		// `?recurring` or `?access` is not rewritten away on arrival.
		if (urlFilterQuery(new URL(location.href)) === query) return;
		// A search landing just after a row was clicked must not replace the
		// navigation that click started.
		if (navigating.to) return;
		// Shallow: a full navigation re-ran the layout under a click that had just
		// opened a row's dialog, and the dialog never showed.
		void goto(`${location.pathname}${query ? `?${query}` : ''}`, {
			replace: true,
			shallow: true
		});
	});

	// Escape closes the open reservation; Up and Down open the one above or below it
	// in this list. Left to anything focused that takes the key itself.
	function onkeydown(event: KeyboardEvent) {
		if (!openId || event.defaultPrevented) return;
		if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
		const target = event.target as Element | null;
		if (
			target?.closest('input, textarea, select, [contenteditable], [role="menu"], [role="listbox"]')
		)
			return;
		if (document.querySelector('dialog[open], [role="dialog"], [role="alertdialog"]')) return;
		if (event.key === 'Escape') {
			event.preventDefault();
			void goto(withQuery(resolve('staff/reservations'), filters.urlQuery));
			return;
		}
		if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
		const ids = (settled?.list.rows ?? []).flatMap((r) => (r.kind === 'reservation' ? [r.id] : []));
		const next = adjacentId(ids, openId, event.key === 'ArrowDown' ? 1 : -1);
		if (!next) return;
		event.preventDefault();
		void goto(withQuery(resolve(`staff/reservations/${next}`), filters.urlQuery));
	}

	// Keeps the open row in view as Up and Down walk past the pane's edge.
	let listEl = $state<HTMLElement>();
	$effect(() => {
		if (!openId || !listEl) return;
		for (const el of listEl.querySelectorAll('[aria-current="page"]')) {
			if (el.checkVisibility()) el.scrollIntoView({ block: 'nearest' });
		}
	});

	// One query, `.then()` views off it. Not awaited: awaiting would suspend the page
	// into the layout boundary's pending snippet on every keystroke.
	const pageData = $derived(getStaffReservationsPage(filters.query));
	const latestPage = new Latest(() => pageData);

	const result = $derived(pageData.then((d) => d.list));
	const hourlyRates = $derived(pageData.then((d) => d.hourlyRates));
	// Latched, not `{#await}`ed: every refresh hands `.then()` a fresh promise, and a
	// re-pending `{#await}` unmounts an open dialog with it (#2350, #2352).
	const settled = $derived(latestPage.current);
	const canManageClosures = $derived(settled?.canManageClosures ?? false);
	const statusCounts = $derived(settled?.statusCounts);
	const owedDot = $derived(
		(settled?.owedAfterSession ?? 0) > 0 && filters.status !== 'payment_due'
	);

	const statusLabel: Record<Status, (count: number) => string> = {
		confirmed: (count) => m.staff_reservations_status_confirmed_label({ count }),
		payment_due: (count) => m.staff_reservations_status_payment_due_label({ count }),
		waitlisted: (count) => m.staff_reservations_status_waitlisted_label({ count }),
		cancelled: (count) => m.staff_reservations_status_cancelled_label({ count })
	};

	// Money owed is not bound to a date, so Payment due shows every date.
	function onstatus(next: Status | '') {
		if (next === 'payment_due') {
			filters.range = 'any';
			filters.from = '';
			filters.to = '';
		}
	}

	function dayLabel(r: { startsAt: Date }): string {
		const localDate = new Date(r.startsAt).toLocaleDateString('en-CA', {
			timeZone: DEFAULT_TIMEZONE
		});
		const now = new Date();
		const today = now.toLocaleDateString('en-CA', { timeZone: DEFAULT_TIMEZONE });
		const tomorrow = new Date(now.getTime() + 86400000).toLocaleDateString('en-CA', {
			timeZone: DEFAULT_TIMEZONE
		});
		const label = formatDate(r.startsAt);
		if (localDate === today) return `${label} (Today)`;
		if (localDate === tomorrow) return `${label} (Tomorrow)`;
		return label;
	}
</script>

<svelte:window {onkeydown} />

<!-- With a reservation open, its own header names the tab. -->
<PageHeader
	title={m.staff_reservations_practice_space_title()}
	documentTitle={openId ? null : undefined}
>
	<div class="flex flex-wrap justify-end gap-2">
		{#if settled?.lock}
			<BuildingAccess
				bind:open={accessOpen}
				offline={settled.lock.offline}
				canReadSettings={settled.canSettings}
				utec={utecParam}
			/>
		{/if}
		<RecurringSeriesModal />
		{#if settled?.canSettings}
			<Button variant="ghost" size="sm" href={resolve('staff/reservations/settings')}>
				{m.staff_reservations_settings_label()}
			</Button>
		{/if}
		<div class="join">
			<CreateReservation class="join-item" />
			{#if canManageClosures}
				<OverflowMenu triggerClass="btn-primary join-item" class="join-item">
					{#snippet icon()}<IconChevronDown size={16} />{/snippet}
					<CreateClosureAction data-testid="new-closure" />
				</OverflowMenu>
			{/if}
		</div>
	</div>
</PageHeader>
<PageContent>
	<div class="contents" bind:this={listEl}>
		<ListFilters
			types={[
				{ value: 'user', label: m.staff_members_label() },
				// A programme's session books as its group too.
				{ value: 'group', label: m.staff_reservations_groups_label() },
				{ value: 'production', label: m.staff_reservations_productions_label() },
				{ value: 'event_listing', label: m.staff_reservations_events_label() }
			] satisfies { value: Booker; label: string }[]}
			typeAllLabel={m.staff_reservations_all_bookers_label()}
			typeLabel={m.staff_reservations_booker_type_label()}
			bind:type={filters.booker}
			searchPlaceholder={m.staff_reservations_placeholder()}
			bind:search={filters.search}
			bind:range={filters.range}
			bind:from={filters.from}
			bind:to={filters.to}
			statuses={statuses.map((s) => ({ value: s, label: statusLabel[s](statusCounts?.[s] ?? 0) }))}
			bind:status={filters.status}
			statusDot={owedDot ? m.staff_reservations_payment_overdue_text() : undefined}
			{onstatus}
			bind:page={filters.page}
		/>

		<DataList
			{result}
			empty={m.staff_reservations_no_reservations_found_body()}
			onpage={(p) => (filters.page = p)}
		>
			{#snippet children(reservations)}
				<!-- No zebra: the bg-base-200 day-group rows are the striping here.
			     `wide-only` hides it below 32rem, where the cards below take over. -->
				<Table zebra={false} class="wide-only">
					{#snippet head()}
						<th class="w-px"><span class="sr-only">{m.staff_status_label()}</span></th>
						<th>{m.staff_booker_label()}</th>
						<th>{m.staff_time_label()}</th>
						<th class="col-support cell-num">{m.staff_payment_label()}</th>
						<th class="w-px"><span class="sr-only">{m.staff_actions_label()}</span></th>
					{/snippet}

					{#each reservations as r, idx (`${r.kind}:${r.id}`)}
						{@const label = dayLabel(r)}
						{@const prevLabel = idx > 0 ? dayLabel(reservations[idx - 1]) : null}
						{#if label !== prevLabel}
							<tr>
								<td colspan="5" class="cell-group">
									{label}
								</td>
							</tr>
						{/if}
						{#if r.kind === 'closure'}
							<tr>
								<td class="w-px"
									><Badge size="sm" variant="error">{m.staff_reservations_closed_label()}</Badge
									></td
								>
								<td class="min-w-0 font-medium">{r.reason}</td>
								<td class="cell-primary whitespace-nowrap">{formatSpan(r.startsAt, r.endsAt)}</td>
								<td class="col-support cell-num"><span class="opacity-40">—</span></td>
								<td class="w-px">
									{@render closureActions(r, true)}
								</td>
							</tr>
						{:else}
							{@const actions = visibleActions(
								r.status,
								r.startsAt,
								r.endsAt,
								r.stripePaymentRecordId
							)}
							{@const href = withQuery(resolve(`staff/reservations/${r.id}`), filters.urlQuery)}
							{@const current = r.id === openId}
							<tr
								class="group/row hover cursor-pointer {current ? 'bg-base-200' : ''}"
								aria-current={current ? 'page' : undefined}
								use:rowLink={href}
							>
								<!-- Labelled from 48rem, the glyph below it (#1834). A hover-only
						     tooltip left keyboard users nothing (#896), so `group/row` opens
						     it while a link in the row holds focus. -->
								<td class="w-px">
									<StatusBadge status={r.status} label responsive />
								</td>

								<!-- Member, band or event — the chip's glyph is what says which. -->
								<td class="min-w-0"><EntityChip ref={r.booker} /></td>

								<!--
							The time, and the flags that decide how the desk staffs the hour.
							`cell-primary` stays here rather than on the booker: it is what
							absorbs the table's slack, and moving it would let a long band
							name push the actions column off the edge. The day is not
							repeated — the group header above carries it.
						-->
								<td class="cell-primary">
									<!-- `flex-wrap`: the icons give way, not the time. As one unwrapping
							     row they overflowed into the Payment and action cells (#1835). -->
									<div class="flex flex-wrap items-center gap-1">
										<a {href} class="font-medium whitespace-nowrap hover:underline">
											{formatTimeRange(r.startsAt, r.endsAt)}
										</a>
										{#if r.recurringSeriesId}
											<span class="tooltip" data-tip={m.staff_recurring_label()}>
												<IconRepeat size={14} class="text-base-content" />
											</span>
										{/if}
										{#if r.bookerType === 'instructor'}
											<!--
										Retargeted from `lesson`, which held this slot for the same
										reason and was removed once production confirmed no rows
										carried it. A teaching booking's Booker ref resolves to the
										member — the capacity is not the party — so without this the
										row could not say it is teaching rather than rehearsal.
									-->
											<span class="tooltip" data-tip={m.staff_reservations_teaching_label()}>
												<BookerTypeIcon type={r.bookerType} size={14} />
											</span>
										{/if}
										{#if r.isFirstReservation}
											<!--
										The collective likes a volunteer on the desk for a member's
										first visit, which is a fact about the booking nothing else
										in the row carries.
									-->
											<span
												class="tooltip"
												data-tip={m.staff_first_reservation_label()}
												role="img"
												aria-label={m.staff_first_reservation_label()}
											>
												<IconUserPlus size={14} class="text-success" />
											</span>
										{/if}
										{#if r.notes}
											<!-- `data-tip` draws through ::before and is invisible to a
									     screen reader, so the name goes on the span — the same
									     thing StatusBadge does. -->
											<span
												class="tooltip"
												data-tip={m.staff_reservations_member_left_note_label()}
												role="img"
												aria-label={m.staff_reservations_member_left_note_label()}
											>
												<IconNote size={14} class="text-info" />
											</span>
										{/if}
									</div>
								</td>

								<td class="col-support cell-num">
									{#await hourlyRates then rates}
										{#if isEventHold(r.bookerType)}
											<span class="opacity-40">—</span>
										{:else}
											{@const state = reservationPaymentState(r)}
											{@const ps = paymentStatus(state)}
											<span class="inline-flex items-center justify-end gap-1">
												<!-- Comped keeps its cash value on screen but strikes it, so the row
										     still says what the room time was worth while reading as waived.
										     A comped booking never carries credits: once credits are
										     committed the row reports as `credits`, not `comped`. -->
												<span class:line-through={state === 'comped'}>
													{formatPaymentBreakdown(
														r.startsAt,
														r.endsAt,
														rates[r.bookerType],
														r.creditsUsed
													)}
												</span>
												<span class="tooltip" data-tip={ps.label}>
													<ps.icon size={16} class={ps.color} />
												</span>
											</span>
										{/if}
									{:catch}
										<!-- DataList takes this rejection to the boundary. -->
									{/await}
								</td>

								<td class="w-px">
									<div class="flex w-max items-center justify-end gap-1">
										{#if owedAfterSession(r)}
											{@render settleActions(r)}
										{:else if actions.has('complete')}
											<CompleteReservationAction
												reservation={r}
												iconOnly
												variant="ghost"
												size="sm"
												shape="square"
											>
												{#snippet icon()}<IconCircleCheck size={16} />{/snippet}
											</CompleteReservationAction>
										{/if}
									</div>
								</td>
							</tr>
						{/if}
					{/each}
				</Table>

				<!--
				Phone widths: the desk checks the room standing at the door, which is
				ui-patterns' card test 4. The rows fold into the card grammar there:
				no hover-only tooltips, labelled facts, actions full width at 44px.
			-->
				<ul class="narrow-only">
					{#each reservations as r, idx (`${r.kind}:${r.id}`)}
						{@const label = dayLabel(r)}
						{#if label !== (idx > 0 ? dayLabel(reservations[idx - 1]) : null)}
							<li class="rounded-sm cell-group">{label}</li>
						{/if}
						{#if r.kind === 'closure'}
							<li class="space-y-2 border-b border-base-300 py-3">
								<div class="flex min-h-11 flex-wrap items-center gap-2">
									<Badge size="sm" variant="error">{m.staff_reservations_closed_label()}</Badge>
									<span class="text-lg font-medium">{formatSpan(r.startsAt, r.endsAt)}</span>
								</div>
								<p>{r.reason}</p>
								{@render closureActions(r, false)}
							</li>
						{:else}
							<ReservationCard
								reservation={r}
								query={filters.urlQuery}
								current={r.id === openId}
								rates={hourlyRates}
							/>
						{/if}
					{/each}
				</ul>
			{/snippet}
		</DataList>
	</div>
</PageContent>

<!-- Only a closure that has not started can change; the server refuses the rest. -->
{#snippet closureActions(c: Closure, compact: boolean)}
	{#if canManageClosures && c.startsAt > new Date()}
		{#if compact}
			<div class="flex w-max items-center justify-end gap-1">
				<UpdateClosureAction closure={c} iconOnly shape="square" data-testid="edit-closure">
					{#snippet icon()}<IconPencil size={16} />{/snippet}
				</UpdateClosureAction>
				<DeleteClosureAction closureId={c.id} iconOnly shape="square">
					{#snippet icon()}<IconTrash size={16} />{/snippet}
				</DeleteClosureAction>
			</div>
		{:else}
			<div class="grid grid-cols-2 gap-2">
				<UpdateClosureAction closure={c} size="md" shape="block" class="min-h-11" />
				<DeleteClosureAction closureId={c.id} size="md" shape="block" class="min-h-11 text-error" />
			</div>
		{/if}
	{/if}
{/snippet}

<!-- A session that ended owing money is settled from its row. -->
{#snippet settleActions(r: Reservation)}
	<CashReceivedAction reservation={r} data-testid="cash-received" />
	<NoShowReservationAction
		reservation={r}
		variant="error"
		size="sm"
		outline
		data-testid="no-show"
	/>
{/snippet}
