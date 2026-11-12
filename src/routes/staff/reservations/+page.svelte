<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import { isEventHold } from '#lib/config.js';
	import SearchInput from '#lib/components/ui/Form/SearchInput.svelte';
	import Button from '#lib/components/ui/Button.svelte';
	import PageHeader from '#lib/components/ui/PageHeader.svelte';
	import PageContent from '#lib/components/ui/PageContent.svelte';
	import StatusBadge from '#lib/components/ui/StatusBadge.svelte';
	import BookerTypeIcon from '#lib/components/reservations/BookerTypeIcon.svelte';
	import DataList from '#lib/components/ui/DataList.svelte';
	import Table from '#lib/components/ui/Table.svelte';
	import FilterBar from '#lib/components/ui/FilterBar.svelte';
	import Select from '#lib/components/ui/Form/Select.svelte';
	import { rowLink } from '#lib/actions/row-link.js';
	import { resolve } from '$app/paths';
	import {
		CashReceivedAction,
		NoShowReservationAction,
		CompleteReservationAction,
		CreateClosureAction,
		UpdateClosureAction,
		DeleteClosureAction
	} from '#lib/components/actions/index.js';
	import DateFilter, { datePresets, type DateRange } from './DateFilter.svelte';
	import OverflowMenu from '#lib/components/ui/OverflowMenu.svelte';
	import CreateReservation from './CreateModal.svelte';
	import RecurringSeriesModal from './RecurringSeriesModal.svelte';
	import BuildingAccess from './BuildingAccess.svelte';
	import { page as appPage, navigating } from '$app/state';
	import { EntityChip } from '#lib/components/ui/entity/index.js';
	import { goto } from '$app/navigation';
	import {
		IconCheck,
		IconCircleCheck,
		IconClock,
		IconGift,
		IconCoin,
		IconArrowBackUp,
		IconUserX,
		IconCircleX,
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

	type Status = 'confirmed' | 'payment_due' | 'waitlisted' | 'cancelled';
	type Booker = 'user' | 'group' | 'production' | 'event_listing';
	const statuses: Status[] = ['confirmed', 'payment_due', 'waitlisted', 'cancelled'];
	const bookers: Booker[] = ['user', 'group', 'production', 'event_listing'];
	const ranges: DateRange[] = [...datePresets, 'custom'];
	const FILTER_KEYS = ['q', 'booker', 'date', 'from', 'to', 'status', 'page'];

	// Seeded once from the URL and mirrored back below, so a round trip through a
	// reservation lands on the same view.
	const params = appPage.url.searchParams;
	const pick = <T extends string>(list: readonly T[], key: string) =>
		list.find((v) => v === params.get(key));
	// `searchText`, not `search`: FilterBar's `search` snippet shadows a same-named binding.
	let searchText = $state(params.get('q') ?? '');
	let searchDebounced = $state(params.get('q') ?? '');
	let bookerType = $state<Booker | ''>(pick(bookers, 'booker') ?? '');
	let range = $state<DateRange>(pick(ranges, 'date') ?? 'from_today');
	let dateFrom = $state(params.get('from') ?? '');
	let dateTo = $state(params.get('to') ?? '');
	let status = $state<Status | ''>(pick(statuses, 'status') ?? '');
	let page = $state(Number(params.get('page')) || 1);
	// `?access` opens Building access: where the lock-offline email and the U-tec sign-in land.
	let accessOpen = $state(params.has('access') || params.has('utec'));
	const utecParam = params.get('utec');

	let filters = $derived({
		search: searchDebounced || undefined,
		bookerType: bookerType || undefined,
		range,
		dateFrom: range === 'custom' && dateFrom ? dateFrom : undefined,
		dateTo: range === 'custom' && dateTo ? dateTo : undefined,
		status: status || undefined,
		page
	});

	$effect(() => {
		const pairs: [string, string][] = [];
		if (searchDebounced) pairs.push(['q', searchDebounced]);
		if (bookerType) pairs.push(['booker', bookerType]);
		if (range !== 'from_today') pairs.push(['date', range]);
		if (filters.dateFrom) pairs.push(['from', filters.dateFrom]);
		if (filters.dateTo) pairs.push(['to', filters.dateTo]);
		if (status) pairs.push(['status', status]);
		if (page > 1) pairs.push(['page', String(page)]);
		const encode = (list: [string, string][]) =>
			list.map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
		// Only the filters' own keys decide whether the address is stale, so a link's
		// `?recurring` or `?access` is not rewritten away on arrival.
		const current = [...new URL(location.href).searchParams].filter(([k]) =>
			FILTER_KEYS.includes(k)
		);
		if (encode(current) === encode(pairs)) return;
		// A search landing just after a row was clicked must not replace the
		// navigation that click started.
		if (navigating.to) return;
		const query = encode(pairs);
		// Shallow: a full navigation re-ran the layout under a click that had just
		// opened a row's dialog, and the dialog never showed.
		void goto(`${location.pathname}${query ? `?${query}` : ''}`, {
			replace: true,
			shallow: true
		});
	});

	// One query, `.then()` views off it. Not awaited: awaiting would suspend the page
	// into the layout boundary's pending snippet on every keystroke.
	const pageData = $derived(getStaffReservationsPage(filters));
	const latestPage = new Latest(() => pageData);

	const result = $derived(pageData.then((d) => d.list));
	const hourlyRates = $derived(pageData.then((d) => d.hourlyRates));
	// Latched, not `{#await}`ed: every refresh hands `.then()` a fresh promise, and a
	// re-pending `{#await}` unmounts an open dialog with it (#2350, #2352).
	const settled = $derived(latestPage.current);
	const canManageClosures = $derived(settled?.canManageClosures ?? false);
	const statusCounts = $derived(settled?.statusCounts);
	const owedDot = $derived((settled?.owedAfterSession ?? 0) > 0 && status !== 'payment_due');

	const statusLabel: Record<Status, (count: number) => string> = {
		confirmed: (count) => m.staff_reservations_status_confirmed_label({ count }),
		payment_due: (count) => m.staff_reservations_status_payment_due_label({ count }),
		waitlisted: (count) => m.staff_reservations_status_waitlisted_label({ count }),
		cancelled: (count) => m.staff_reservations_status_cancelled_label({ count })
	};

	function setStatus(next: Status | '') {
		status = next;
		// Money owed is not bound to a date, so Payment due shows every date.
		if (next === 'payment_due') {
			range = 'any';
			dateFrom = '';
			dateTo = '';
		}
		page = 1;
	}

	function paymentStatus(state: ReturnType<typeof reservationPaymentState>): {
		label: string;
		color: string;
		icon: typeof IconCheck;
	} {
		switch (state) {
			case 'no_show':
				return { label: m.staff_no_show_label(), color: 'text-error', icon: IconUserX };
			case 'refunded':
				return { label: m.staff_refunded_label(), color: 'text-error', icon: IconArrowBackUp };
			case 'cancelled':
				return { label: m.staff_cancelled_label(), color: 'text-base-content', icon: IconCircleX };
			case 'paid':
				return { label: m.staff_paid_label(), color: 'text-success', icon: IconCheck };
			case 'cash_due':
				return {
					label: m.staff_reservations_cash_due_label(),
					color: 'text-warning',
					icon: IconClock
				};
			case 'unpaid':
				return { label: m.staff_unpaid_label(), color: 'text-warning', icon: IconClock };
			case 'credits':
				return { label: m.staff_paid_with_credits_label(), color: 'text-info', icon: IconCoin };
			case 'comped':
				return { label: m.staff_comped_label(), color: 'text-info', icon: IconGift };
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

	const activeFilterCount = $derived(
		(searchDebounced ? 1 : 0) +
			(bookerType ? 1 : 0) +
			(range !== 'from_today' ? 1 : 0) +
			(status ? 1 : 0)
	);

	function clearFilters() {
		searchText = '';
		searchDebounced = '';
		bookerType = '';
		range = 'from_today';
		dateFrom = '';
		dateTo = '';
		status = '';
		page = 1;
	}
</script>

<PageHeader title={m.staff_reservations_practice_space_title()}>
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
	<FilterBar activeCount={activeFilterCount} onclear={clearFilters} searchWidth="wide">
		{#snippet search()}
			<div class="join w-full">
				<Select
					size="sm"
					class="join-item w-auto shrink-0"
					aria-label={m.staff_reservations_booker_type_label()}
					data-testid="booker-filter"
					value={bookerType}
					onchange={(e: Event) => {
						bookerType = (e.currentTarget as HTMLSelectElement).value as typeof bookerType;
						page = 1;
					}}
				>
					<option value="">{m.staff_reservations_all_bookers_label()}</option>
					<option value="user">{m.staff_members_label()}</option>
					<!-- A programme's session books as its group too. -->
					<option value="group">{m.staff_reservations_groups_label()}</option>
					<option value="production">{m.staff_reservations_productions_label()}</option>
					<option value="event_listing">{m.staff_reservations_events_label()}</option>
				</Select>
				<SearchInput
					class="input join-item w-full input-sm"
					bind:value={searchText}
					placeholder={m.staff_reservations_placeholder()}
					onsearch={(q) => {
						searchDebounced = q;
						page = 1;
					}}
				/>
			</div>
		{/snippet}
		<DateFilter bind:range bind:from={dateFrom} bind:to={dateTo} onchange={() => (page = 1)} />
		<div class="indicator">
			{#if owedDot}
				<span class="indicator-item status status-error" data-testid="payment-due-dot">
					<span class="sr-only">{m.staff_reservations_payment_overdue_text()}</span>
				</span>
			{/if}
			<Select
				size="sm"
				aria-label={m.staff_status_label()}
				data-testid="status-filter"
				value={status}
				onchange={(e: Event) =>
					setStatus((e.currentTarget as HTMLSelectElement).value as Status | '')}
			>
				<option value="">{m.staff_reservations_all_statuses_label()}</option>
				{#each statuses as s (s)}
					<option value={s}>{statusLabel[s](statusCounts?.[s] ?? 0)}</option>
				{/each}
			</Select>
		</div>
	</FilterBar>

	<DataList
		{result}
		empty={m.staff_reservations_no_reservations_found_body()}
		onpage={(p) => (page = p)}
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
								><Badge size="sm" variant="error">{m.staff_reservations_closed_label()}</Badge></td
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
						{@const href = resolve(`staff/reservations/${r.id}`)}
						<tr class="group/row hover cursor-pointer" use:rowLink={href}>
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
				ui-patterns' card test 4. So no hover-only tooltips here — each flag
				and the payment state say their word — and the actions are full-size.
			-->
			<ul class="narrow-only">
				{#each reservations as r, idx (`${r.kind}:${r.id}`)}
					{@const label = dayLabel(r)}
					{#if label !== (idx > 0 ? dayLabel(reservations[idx - 1]) : null)}
						<li class="rounded-sm cell-group">{label}</li>
					{/if}
					{#if r.kind === 'closure'}
						<li class="flex items-start justify-between gap-3 border-b border-base-300 py-3">
							<div class="min-w-0 space-y-1">
								<p class="text-lg font-medium">{formatSpan(r.startsAt, r.endsAt)}</p>
								<p>{r.reason}</p>
							</div>
							<div class="flex shrink-0 flex-col items-end gap-2">
								<Badge size="sm" variant="error">{m.staff_reservations_closed_label()}</Badge>
								{@render closureActions(r, false)}
							</div>
						</li>
					{:else}
						{@const actions = visibleActions(
							r.status,
							r.startsAt,
							r.endsAt,
							r.stripePaymentRecordId
						)}
						<li class="flex items-start justify-between gap-3 border-b border-base-300 py-3">
							<div class="min-w-0 space-y-2">
								<a
									href={resolve(`staff/reservations/${r.id}`)}
									class="text-lg font-medium hover:underline"
								>
									{formatTimeRange(r.startsAt, r.endsAt)}
								</a>
								<div class="flex flex-wrap items-center gap-x-3 gap-y-1">
									<EntityChip ref={r.booker} />
									{#if r.recurringSeriesId || r.bookerType === 'instructor' || r.isFirstReservation || r.notes}
										<ul class="flex flex-wrap items-center gap-x-3 gap-y-1 text-muted text-sm">
											{#if r.recurringSeriesId}
												<li class="flex items-center gap-1">
													<IconRepeat size={14} />{m.staff_recurring_text()}
												</li>
											{/if}
											{#if r.bookerType === 'instructor'}
												<li class="flex items-center gap-1">
													<BookerTypeIcon
														type={r.bookerType}
														size={14}
													/>{m.staff_reservations_teaching_text()}
												</li>
											{/if}
											{#if r.isFirstReservation}
												<li class="flex items-center gap-1">
													<IconUserPlus
														size={14}
														class="text-success"
													/>{m.staff_first_reservation_text()}
												</li>
											{/if}
											{#if r.notes}
												<li class="flex items-center gap-1">
													<IconNote
														size={14}
														class="text-info"
													/>{m.staff_reservations_member_left_note_text()}
												</li>
											{/if}
										</ul>
									{/if}
								</div>
							</div>
							<div class="flex shrink-0 flex-col items-end gap-2">
								<StatusBadge status={r.status} label />
								{#if !isEventHold(r.bookerType)}
									{#await hourlyRates then rates}
										{@const state = reservationPaymentState(r)}
										{@const ps = paymentStatus(state)}
										{@const owed = state === 'cash_due' || state === 'unpaid'}
										<p class="flex flex-wrap items-center gap-1 text-sm">
											<ps.icon size={16} class={ps.color} />
											<span class="font-medium">{owed ? m.staff_due_text() : ps.label}</span>
											<span class="text-muted" class:line-through={state === 'comped'}>
												{formatPaymentBreakdown(
													r.startsAt,
													r.endsAt,
													rates[r.bookerType],
													r.creditsUsed
												)}
											</span>
										</p>
									{:catch}
										<!-- DataList takes this rejection to the boundary. -->
									{/await}
								{/if}
								{#if owedAfterSession(r)}
									<div class="flex gap-2">{@render settleActions(r)}</div>
								{:else if actions.has('complete')}
									<CompleteReservationAction reservation={r} size="sm" />
								{/if}
							</div>
						</li>
					{/if}
				{/each}
			</ul>
		{/snippet}
	</DataList>
</PageContent>

<!-- Only a closure that has not started can change; the server refuses the rest. -->
{#snippet closureActions(c: Closure, compact: boolean)}
	{#if canManageClosures && c.startsAt > new Date()}
		<div class="flex w-max items-center justify-end gap-1">
			{#if compact}
				<UpdateClosureAction closure={c} iconOnly shape="square" data-testid="edit-closure">
					{#snippet icon()}<IconPencil size={16} />{/snippet}
				</UpdateClosureAction>
				<DeleteClosureAction closureId={c.id} iconOnly shape="square">
					{#snippet icon()}<IconTrash size={16} />{/snippet}
				</DeleteClosureAction>
			{:else}
				<UpdateClosureAction closure={c} />
				<DeleteClosureAction closureId={c.id} />
			{/if}
		</div>
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
