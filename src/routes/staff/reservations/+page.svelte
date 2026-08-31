<script lang="ts">
	import SearchInput from '$lib/components/ui/Form/SearchInput.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import PageHeader from '$lib/components/ui/PageHeader.svelte';
	import PageContent from '$lib/components/ui/PageContent.svelte';
	import StatusBadge from '$lib/components/ui/StatusBadge.svelte';
	import BookerTypeIcon from '$lib/components/reservations/BookerTypeIcon.svelte';
	import DataList from '$lib/components/ui/DataList.svelte';
	import Table from '$lib/components/ui/Table.svelte';
	import FilterBar from '$lib/components/ui/FilterBar.svelte';
	import Select from '$lib/components/ui/Form/Select.svelte';
	import { rowLink } from '$lib/actions/row-link';
	import { resolve } from '$app/paths';
	import { ConfirmReservationAction, CompleteReservationAction } from '$lib/components/actions';
	import ResolveModal from './ResolveModal.svelte';
	import CreateReservation from './CreateModal.svelte';
	import { EntityChip } from '$lib/components/ui/entity';
	import TabBar from '$lib/components/ui/TabBar.svelte';
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
		IconNote
	} from '@tabler/icons-svelte';
	import { formatDate, formatTimeRange, formatPaymentBreakdown } from '$lib/utils/format';
	import { DEFAULT_TIMEZONE } from '$lib/config';
	import { visibleActions, reservationPaymentState } from '$lib/utils/reservation-actions';
	import Badge from '$lib/components/ui/Badge.svelte';
	import { getStaffReservationsPage } from '$lib/remote/reservations.remote';

	type Reservation = Awaited<ReturnType<typeof getStaffReservationsPage>>['list']['rows'][number];

	let tab = $state<'upcoming' | 'all'>('upcoming');
	// `searchText`, not `search`: FilterBar's always-visible slot is a snippet
	// named `search`, and a snippet shadows a same-named script binding.
	let searchText = $state('');
	let dateFrom = $state('');
	let dateTo = $state('');
	let bookerType = $state<'user' | 'group' | 'event' | ''>('');
	let page = $state(1);

	let searchDebounced = $state('');
	let filters = $derived({
		tab,
		search: searchDebounced || undefined,
		dateFrom: dateFrom || undefined,
		dateTo: dateTo || undefined,
		bookerType: bookerType || undefined,
		page
	});

	// One query, four `.then()` views off it. Four separate promises here were recreated on every
	// filter keystroke, and a superseded one that rejects has no consumer left — that is where
	// JAVASCRIPT-SVELTEKIT-3's unhandled rejections came from. Not awaited, because awaiting would
	// suspend the page into the layout boundary's pending snippet on every keystroke.
	const pageData = $derived(getStaffReservationsPage(filters));

	const result = $derived(pageData.then((d) => d.list));
	const counts = $derived(pageData.then((d) => d.counts));
	const unresolved = $derived(pageData.then((d) => d.unresolved));
	const hourlyRate = $derived(pageData.then((d) => d.hourlyRate));

	let resolveOpen = $state(false);

	function paymentStatus(state: ReturnType<typeof reservationPaymentState>): {
		label: string;
		color: string;
		icon: typeof IconCheck;
	} {
		switch (state) {
			case 'no_show':
				return { label: 'No-show', color: 'text-error', icon: IconUserX };
			case 'refunded':
				return { label: 'Refunded', color: 'text-error', icon: IconArrowBackUp };
			case 'cancelled':
				return { label: 'Cancelled', color: 'text-base-content', icon: IconCircleX };
			case 'paid':
				return { label: 'Paid', color: 'text-success', icon: IconCheck };
			case 'cash_due':
				return { label: 'Cash due', color: 'text-warning', icon: IconClock };
			case 'unpaid':
				return { label: 'Unpaid', color: 'text-warning', icon: IconClock };
			case 'credits':
				return { label: 'Paid with credits', color: 'text-info', icon: IconCoin };
			case 'comped':
				return { label: 'Comped', color: 'text-info', icon: IconGift };
		}
	}

	function dayLabel(r: Reservation): string {
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
		(searchDebounced ? 1 : 0) + (dateFrom ? 1 : 0) + (dateTo ? 1 : 0) + (bookerType ? 1 : 0)
	);

	function clearFilters() {
		searchText = '';
		searchDebounced = '';
		dateFrom = '';
		dateTo = '';
		bookerType = '';
		page = 1;
	}
</script>

<PageHeader title="Reservations">
	<div class="flex gap-2">
		{#await Promise.all([unresolved, counts])}
			<Button variant="ghost" size="sm" onclick={() => (resolveOpen = true)}>Resolve</Button>
		{:then [unresolvedData]}
			<Button
				variant={unresolvedData.length > 0 ? 'warning' : 'ghost'}
				size="sm"
				onclick={() => (resolveOpen = true)}
			>
				Resolve
				{#if unresolvedData.length > 0}
					<Badge>{unresolvedData.length}</Badge>
				{/if}
			</Button>
		{/await}
		<CreateReservation />
	</div>
</PageHeader>
<PageContent>
	{#await counts}
		<TabBar
			tabs={[
				{ key: 'upcoming', label: 'Upcoming' },
				{ key: 'all', label: 'All' }
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
				{ key: 'upcoming', label: 'Upcoming', badge: c.upcoming },
				{ key: 'all', label: 'All', badge: c.all }
			]}
			active={tab}
			onchange={(key) => {
				tab = key as 'upcoming' | 'all';
				page = 1;
			}}
		/>
	{/await}

	<FilterBar activeCount={activeFilterCount} onclear={clearFilters}>
		{#snippet search()}
			<SearchInput
				bind:value={searchText}
				placeholder="Search member, band, or event..."
				onsearch={(q) => {
					searchDebounced = q;
					page = 1;
				}}
			/>
		{/snippet}
		<input
			type="date"
			aria-label="From date"
			class="input input-sm"
			bind:value={dateFrom}
			onchange={() => {
				page = 1;
			}}
		/>
		<input
			type="date"
			aria-label="To date"
			class="input input-sm"
			bind:value={dateTo}
			onchange={() => {
				page = 1;
			}}
		/>
		<Select
			size="sm"
			aria-label="Booked by"
			value={bookerType}
			onchange={(e: Event) => {
				bookerType = (e.currentTarget as HTMLSelectElement).value as typeof bookerType;
				page = 1;
			}}
		>
			<option value="">Anyone</option>
			<option value="user">Members</option>
			<option value="group">Bands</option>
			<option value="event">Events</option>
		</Select>
	</FilterBar>

	<DataList {result} empty="No reservations found" onpage={(p) => (page = p)}>
		{#snippet children(reservations)}
			<!-- No zebra: the bg-base-200 day-group rows are the striping here. -->
			<Table zebra={false}>
				{#snippet head()}
					<th class="w-px"><span class="sr-only">Status</span></th>
					<th>Booker</th>
					<th>Time</th>
					<th class="col-support cell-num">Payment</th>
					<th class="w-px"><span class="sr-only">Actions</span></th>
				{/snippet}

				{#each reservations as r, idx (r.id)}
					{@const label = dayLabel(r)}
					{@const prevLabel = idx > 0 ? dayLabel(reservations[idx - 1]) : null}
					{#if label !== prevLabel}
						<tr>
							<td
								colspan="5"
								class="bg-base-200 px-4 py-2 text-subtle font-semibold tracking-wide uppercase"
							>
								{label}
							</td>
						</tr>
					{/if}
					{@const actions = visibleActions(r.status, r.startsAt, r.endsAt, r.stripePaymentRecordId)}
					{@const href = resolve(`/staff/reservations/${r.id}`)}
					<tr class="hover cursor-pointer" use:rowLink={href}>
						<td class="w-px">
							<StatusBadge status={r.status} class="size-6" />
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
							<div class="flex items-center gap-1">
								<a {href} class="font-medium whitespace-nowrap hover:underline">
									{formatTimeRange(r.startsAt, r.endsAt)}
								</a>
								{#if r.recurringSeriesId}
									<span class="tooltip" data-tip="Recurring">
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
									<span class="tooltip" data-tip="Teaching">
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
										data-tip="First reservation"
										role="img"
										aria-label="First reservation"
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
										data-tip="Member left a note"
										role="img"
										aria-label="Member left a note"
									>
										<IconNote size={14} class="text-info" />
									</span>
								{/if}
							</div>
						</td>

						<td class="col-support cell-num">
							{#await hourlyRate then rate}
								{#if r.bookerType === 'event'}
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
											{formatPaymentBreakdown(r.startsAt, r.endsAt, rate, r.creditsUsed)}
										</span>
										<span class="tooltip" data-tip={ps.label}>
											<ps.icon size={16} class={ps.color} />
										</span>
									</span>
								{/if}
							{/await}
						</td>

						<td class="w-px">
							<div class="flex items-center justify-end gap-1">
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
				{/each}
			</Table>
		{/snippet}
	</DataList>
</PageContent>

{#await Promise.all([unresolved, hourlyRate]) then [unresolvedData, rate]}
	<ResolveModal bind:open={resolveOpen} unresolved={unresolvedData} hourlyRateCents={rate} />
{/await}
