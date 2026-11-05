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
		ConfirmReservationAction,
		CompleteReservationAction,
		CreateClosureAction,
		UpdateClosureAction,
		DeleteClosureAction
	} from '#lib/components/actions/index.js';
	import ResolveModal from './ResolveModal.svelte';
	import CreateReservation from './CreateModal.svelte';
	import RecurringSeriesModal from './RecurringSeriesModal.svelte';
	import { page as appPage } from '$app/state';
	import { EntityChip } from '#lib/components/ui/entity/index.js';
	import TabBar from '#lib/components/ui/TabBar.svelte';
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
		IconTrash
	} from '@tabler/icons-svelte';
	import {
		formatDate,
		formatTimeRange,
		formatPaymentBreakdown,
		formatSpan
	} from '#lib/utils/format.js';
	import { DEFAULT_TIMEZONE } from '#lib/config.js';
	import { visibleActions, reservationPaymentState } from '#lib/utils/reservation-actions.js';
	import Badge from '#lib/components/ui/Badge.svelte';
	import { getStaffReservationsPage } from '#lib/remote/reservations.remote.js';
	import { Latest } from '#lib/latest.svelte.js';

	type Row = Awaited<ReturnType<typeof getStaffReservationsPage>>['list']['rows'][number];
	type Closure = Extract<Row, { kind: 'closure' }>;

	let tab = $state<'upcoming' | 'all'>('upcoming');
	// Closures interleave with bookings (#1833); `?show=closures` is where the
	// old `/staff/closures` redirects.
	const shows = ['everything', 'reservations', 'closures'] as const;
	const initialShow = appPage.url.searchParams.get('show');
	let show = $state<(typeof shows)[number]>(shows.find((s) => s === initialShow) ?? 'everything');
	// `searchText`, not `search`: FilterBar's always-visible slot is a snippet
	// named `search`, and a snippet shadows a same-named script binding.
	let searchText = $state('');
	let dateFrom = $state('');
	let dateTo = $state('');
	let bookerType = $state<'user' | 'group' | 'production' | 'event_listing' | ''>('');
	let page = $state(1);

	let searchDebounced = $state('');
	let filters = $derived({
		tab,
		search: searchDebounced || undefined,
		dateFrom: dateFrom || undefined,
		dateTo: dateTo || undefined,
		bookerType: bookerType || undefined,
		show: show === 'everything' ? undefined : show,
		page
	});

	// One query, four `.then()` views off it. Four separate promises here were recreated on every
	// filter keystroke, and a superseded one that rejects has no consumer left — that is where
	// JAVASCRIPT-SVELTEKIT-3's unhandled rejections came from. Not awaited, because awaiting would
	// suspend the page into the layout boundary's pending snippet on every keystroke.
	const pageData = $derived(getStaffReservationsPage(filters));
	const latestPage = new Latest(() => pageData);

	const result = $derived(pageData.then((d) => d.list));
	const counts = $derived(pageData.then((d) => d.counts));
	const hourlyRates = $derived(pageData.then((d) => d.hourlyRates));
	// Latched, not `{#await}`ed: every refresh hands `.then()` a fresh promise, the
	// `{#await}` re-pends, and its subtree unmounts — an open dialog and what was
	// typed in it with it (#2350, #2352). A notification's `invalidateAll()` is enough.
	const settled = $derived(latestPage.current);
	const canManageClosures = $derived(settled?.canManageClosures ?? false);
	const unresolvedCount = $derived(settled?.unresolved.length ?? 0);

	let resolveOpen = $state(false);

	function paymentStatus(state: ReturnType<typeof reservationPaymentState>): {
		label: string;
		color: string;
		icon: typeof IconCheck;
	} {
		switch (state) {
			case 'no_show':
				return { label: m.staff_no_show(), color: 'text-error', icon: IconUserX };
			case 'refunded':
				return { label: m.staff_refunded(), color: 'text-error', icon: IconArrowBackUp };
			case 'cancelled':
				return { label: m.staff_cancelled(), color: 'text-base-content', icon: IconCircleX };
			case 'paid':
				return { label: m.staff_paid(), color: 'text-success', icon: IconCheck };
			case 'cash_due':
				return { label: m.staff_reservations_cash_due(), color: 'text-warning', icon: IconClock };
			case 'unpaid':
				return { label: m.staff_unpaid(), color: 'text-warning', icon: IconClock };
			case 'credits':
				return { label: m.staff_paid_with_credits(), color: 'text-info', icon: IconCoin };
			case 'comped':
				return { label: m.staff_comped(), color: 'text-info', icon: IconGift };
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

	const menuFilterCount = $derived(
		(dateFrom ? 1 : 0) + (dateTo ? 1 : 0) + (bookerType ? 1 : 0) + (show !== 'everything' ? 1 : 0)
	);
	const activeFilterCount = $derived((searchDebounced ? 1 : 0) + menuFilterCount);

	function clearFilters() {
		searchText = '';
		searchDebounced = '';
		dateFrom = '';
		dateTo = '';
		bookerType = '';
		show = 'everything';
		page = 1;
	}
</script>

<PageHeader title={m.staff_reservations_title()}>
	{#await counts}
		<TabBar
			tabs={[
				{ key: 'upcoming', label: m.staff_reservations_upcoming() },
				{ key: 'all', label: m.staff_all() }
			]}
			active={tab}
			onchange={(key) => {
				tab = key as 'upcoming' | 'all';
				page = 1;
			}}
		/>
	{:then c}
		<TabBar
			tabs={[
				{ key: 'upcoming', label: m.staff_reservations_upcoming(), badge: c.upcoming },
				{ key: 'all', label: m.staff_all(), badge: c.all }
			]}
			active={tab}
			onchange={(key) => {
				tab = key as 'upcoming' | 'all';
				page = 1;
			}}
		/>
	{/await}
	<div class="flex gap-2">
		<Button
			variant={unresolvedCount > 0 ? 'warning' : 'ghost'}
			size="sm"
			onclick={() => (resolveOpen = true)}
		>
			{m.staff_resolve()}
			{#if unresolvedCount > 0}
				<Badge>{unresolvedCount}</Badge>
			{/if}
		</Button>
		<RecurringSeriesModal />
		{#if canManageClosures}<CreateClosureAction data-testid="new-closure" />{/if}
		<CreateReservation />
	</div>
</PageHeader>
<PageContent>
	<FilterBar activeCount={activeFilterCount} menuCount={menuFilterCount} onclear={clearFilters}>
		{#snippet search()}
			<SearchInput
				bind:value={searchText}
				placeholder={m.staff_reservations_placeholder()}
				onsearch={(q) => {
					searchDebounced = q;
					page = 1;
				}}
			/>
		{/snippet}
		{#snippet menu()}
			<label class="flex flex-col gap-1">
				<span class="text-muted text-xs">{m.staff_from_date()}</span>
				<input
					type="date"
					class="input input-sm"
					bind:value={dateFrom}
					onchange={() => {
						page = 1;
					}}
				/>
			</label>
			<label class="flex flex-col gap-1">
				<span class="text-muted text-xs">{m.staff_date_2()}</span>
				<input
					type="date"
					class="input input-sm"
					bind:value={dateTo}
					onchange={() => {
						page = 1;
					}}
				/>
			</label>
			<label class="flex flex-col gap-1">
				<span class="text-muted text-xs">{m.staff_booked_by()}</span>
				<Select
					size="sm"
					value={bookerType}
					onchange={(e: Event) => {
						bookerType = (e.currentTarget as HTMLSelectElement).value as typeof bookerType;
						page = 1;
					}}
				>
					<option value="">{m.staff_anyone()}</option>
					<option value="user">{m.staff_members()}</option>
					<!-- A programme's session books as its group too, so this is no longer
					     bands alone; a production's hold is only ever a show. -->
					<option value="group">{m.staff_reservations_bands_programs()}</option>
					<option value="production">{m.staff_reservations_shows()}</option>
					<!-- A listing with no production holds the room in its own name. -->
					<option value="event_listing">{m.staff_listings()}</option>
				</Select>
			</label>
			<label class="flex flex-col gap-1">
				<span class="text-muted text-xs">{m.staff_show()}</span>
				<Select
					size="sm"
					value={show}
					onchange={(e: Event) => {
						show = (e.currentTarget as HTMLSelectElement).value as typeof show;
						page = 1;
					}}
				>
					<option value="everything">{m.staff_reservations_reservations_closures()}</option>
					<option value="reservations">{m.staff_reservations_title()}</option>
					<option value="closures">{m.staff_reservations_closures()}</option>
				</Select>
			</label>
		{/snippet}
	</FilterBar>

	<DataList
		{result}
		empty={show === 'closures'
			? m.staff_reservations_no_closures_found()
			: m.staff_reservations_no_reservations_found()}
		onpage={(p) => (page = p)}
	>
		{#snippet children(reservations)}
			<!-- No zebra: the bg-base-200 day-group rows are the striping here.
			     `wide-only` hides it below 32rem, where the cards below take over. -->
			<Table zebra={false} class="wide-only">
				{#snippet head()}
					<th class="w-px"><span class="sr-only">{m.staff_status()}</span></th>
					<th>{m.staff_booker()}</th>
					<th>{m.staff_time()}</th>
					<th class="col-support cell-num">{m.staff_payment()}</th>
					<th class="w-px"><span class="sr-only">{m.staff_actions()}</span></th>
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
								><Badge size="sm" variant="error">{m.staff_reservations_closed()}</Badge></td
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
										<span class="tooltip" data-tip={m.staff_recurring()}>
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
										<span class="tooltip" data-tip={m.staff_reservations_teaching()}>
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
											data-tip={m.staff_first_reservation()}
											role="img"
											aria-label={m.staff_first_reservation()}
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
											data-tip={m.staff_reservations_member_left_note()}
											role="img"
											aria-label={m.staff_reservations_member_left_note()}
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
								{/await}
							</td>

							<td class="w-px">
								<div class="flex w-max items-center justify-end gap-1">
									{#if actions.has('confirm')}
										<ConfirmReservationAction
											reservation={r}
											staff
											iconOnly
											variant="ghost"
											size="sm"
											shape="square"
											class="latched"
										>
											{#snippet icon()}<IconCheck size={16} />{/snippet}
										</ConfirmReservationAction>
									{/if}
									{#if actions.has('complete')}
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
								<Badge size="sm" variant="error">{m.staff_reservations_closed()}</Badge>
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
													<IconRepeat size={14} />{m.staff_recurring()}
												</li>
											{/if}
											{#if r.bookerType === 'instructor'}
												<li class="flex items-center gap-1">
													<BookerTypeIcon
														type={r.bookerType}
														size={14}
													/>{m.staff_reservations_teaching()}
												</li>
											{/if}
											{#if r.isFirstReservation}
												<li class="flex items-center gap-1">
													<IconUserPlus
														size={14}
														class="text-success"
													/>{m.staff_first_reservation()}
												</li>
											{/if}
											{#if r.notes}
												<li class="flex items-center gap-1">
													<IconNote
														size={14}
														class="text-info"
													/>{m.staff_reservations_member_left_note()}
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
											<span class="font-medium">{owed ? m.staff_due() : ps.label}</span>
											<span class="text-muted" class:line-through={state === 'comped'}>
												{formatPaymentBreakdown(
													r.startsAt,
													r.endsAt,
													rates[r.bookerType],
													r.creditsUsed
												)}
											</span>
										</p>
									{/await}
								{/if}
								{#if actions.has('confirm')}
									<ConfirmReservationAction reservation={r} staff size="sm" />
								{/if}
								{#if actions.has('complete')}
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

{#if settled}
	<ResolveModal
		bind:open={resolveOpen}
		unresolved={settled.unresolved}
		hourlyRates={settled.hourlyRates}
	/>
{/if}
