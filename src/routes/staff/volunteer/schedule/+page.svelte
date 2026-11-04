<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	/**
	 * Every work order a coordinator staffs, in one table by date (#1933). A shift
	 * is a work order with a window, so the ones still waiting for a time are the
	 * last group of the same table rather than another page.
	 *
	 * Three numbers per row, not one: `claimed` counts places taken and `confirmed`
	 * places actually booked, and printing only the first says a shift with three
	 * unconfirmed claims is staffed (docs/reports/volunteer-workflow-findings.md#a3).
	 * Cancelled shifts are a notify list under the divider, not rows to staff.
	 */
	import { page } from '$app/state';
	import { NO_ROLE_LABEL, shiftLabel } from '#lib/utils/shift-label.js';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { withQuery } from '#lib/utils/with-query.js';
	import { Latest } from '#lib/latest.svelte.js';
	import PageHeader from '#lib/components/ui/PageHeader.svelte';
	import PageContent from '#lib/components/ui/PageContent.svelte';
	import Table from '#lib/components/ui/Table.svelte';
	import FilterBar from '#lib/components/ui/FilterBar.svelte';
	import EmptyState from '#lib/components/ui/EmptyState.svelte';
	import Select from '#lib/components/ui/Form/Select.svelte';
	import Action from '#lib/components/ui/Action.svelte';
	import Button from '#lib/components/ui/Button.svelte';
	import Badge from '#lib/components/ui/Badge.svelte';
	import { isOverdue } from '#lib/utils/work-order-due.js';
	import RoleOptions from '#lib/components/volunteer/RoleOptions.svelte';
	import LogHoursForMemberAction from '#lib/components/volunteer/LogHoursForMemberAction.svelte';
	import NewWorkOrderAction from '../NewWorkOrderAction.svelte';
	import ScheduleViews from './ScheduleViews.svelte';
	import ConfirmFixedTable from './ConfirmFixedTable.svelte';
	import UnscheduledActions from './UnscheduledActions.svelte';
	import { NEEDS, parseNeeds, type Needs } from './needs-filter';
	import { PROJECT_FILTERS, matchesProject, parseProjectFilter } from './project-filter';
	import { formatDateShort, relativeDay } from '#lib/utils/format.js';
	import {
		DEFAULT_TIMEZONE,
		contractorJobViews,
		contractorJobViewLabels,
		type ContractorJobView
	} from '#lib/config.js';
	import { getSchedulePage, confirmShiftClaims } from '#lib/remote/volunteer.remote.js';

	/** `'all'` drops both bounds rather than passing a wide one, so it is really everything. */
	const WINDOWS = [7, 14, 30, 'all'] as const;
	type Range = (typeof WINDOWS)[number];
	const DAY_MS = 24 * 60 * 60 * 1000;
	const DEFAULT_WINDOW: Range = 14;
	const windowLabel = (w: Range) => (w === 'all' ? 'Everything' : `Next ${w} days`);

	const KINDS = {
		'': 'All work',
		timed: 'Has a time',
		untimed: 'No time yet',
		recurring: 'Recurring',
		contractor: 'Contractor'
	} as const;
	type Kind = keyof typeof KINDS;

	function parseRange(raw: string | null): Range {
		if (raw === 'all') return 'all';
		const n = Number(raw);
		return (WINDOWS as readonly (number | string)[]).includes(n) ? (n as Range) : DEFAULT_WINDOW;
	}
	const parseKind = (raw: string | null): Kind => (raw && raw in KINDS ? (raw as Kind) : '');
	const parseView = (raw: string | null): ContractorJobView =>
		contractorJobViews.includes(raw as never) ? (raw as ContractorJobView) : 'open';

	const initial = page.url.searchParams;

	let range = $state(parseRange(initial.get('days')));
	let roleFilter = $state(initial.get('role') ?? '');
	let kind = $state<Kind>(parseKind(initial.get('kind')));
	// `short=1` was the checkbox this replaced; old links keep working.
	let needs = $state<Needs>(
		initial.get('short') === '1' ? 'short' : parseNeeds(initial.get('needs'))
	);
	let projectFilter = $state(parseProjectFilter(initial.get('project')));
	let contractorView = $state(parseView(initial.get('contractor')));
	// Contractor work is not staffed by the window, role or headcount.
	const byContractor = $derived(kind === 'contractor');

	// Writes the URL, never state — `goto(..., { replaceState })` rather than
	// `replaceState()`, which updates neither `page.url` nor the router's own entry.
	$effect(() => {
		const pairs: [string, string][] = [];
		if (range !== DEFAULT_WINDOW) pairs.push(['days', String(range)]);
		if (roleFilter) pairs.push(['role', roleFilter]);
		if (kind) pairs.push(['kind', kind]);
		if (needs) pairs.push(['needs', needs]);
		if (projectFilter) pairs.push(['project', projectFilter]);
		if (byContractor && contractorView !== 'open') pairs.push(['contractor', contractorView]);

		const search = pairs.map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
		const href = withQuery(resolve('/staff/volunteer/schedule'), search);
		if (location.pathname + location.search !== href) {
			void goto(href, { replaceState: true, noScroll: true, keepFocus: true });
		}
	});

	// Pinned once rather than derived from the clock: `refresh()` is keyed by argument,
	// so a `from` that ticked would mint a new key and the refresh would miss it.
	const anchor = new Date();

	const args = $derived({
		from: range === 'all' ? undefined : anchor.toISOString(),
		to: range === 'all' ? undefined : new Date(anchor.getTime() + range * DAY_MS).toISOString(),
		volunteerRoleId: roleFilter || undefined,
		includeCancelled: true,
		contractor: byContractor ? contractorView : undefined
	});
	// Not `{#await}`: a refresh would re-pend it and unmount an open row Action.
	const schedule = new Latest(() => getSchedulePage(args));
	$effect(() => {
		if (schedule.error) throw schedule.error.e;
	});

	// Whether to offer the Contractor kind; the query says, and guards it.
	const contractorAccess = $derived(schedule.current?.contractorAccess ?? false);

	type Row = Awaited<ReturnType<typeof getSchedulePage>>['unscheduled'][number];

	const timeFmt = new Intl.DateTimeFormat('en-US', {
		hour: 'numeric',
		minute: '2-digit',
		timeZone: DEFAULT_TIMEZONE
	});
	const dayFmt = new Intl.DateTimeFormat('en-CA', { timeZone: DEFAULT_TIMEZONE });

	/** The group a row sits under: its venue day, or the no-time group at the end. */
	function groupLabel(w: Row): string {
		return w.startsAt
			? `${relativeDay(w.startsAt)} · ${formatDateShort(w.startsAt)}`
			: 'No time yet';
	}
	const groupKey = (w: Row) => (w.startsAt ? dayFmt.format(w.startsAt) : 'none');

	function when(w: Row): string {
		if (w.startsAt && w.endsAt) return `${timeFmt.format(w.startsAt)}–${timeFmt.format(w.endsAt)}`;
		return w.dueAt ? `due ${formatDateShort(w.dueAt)}` : 'no deadline';
	}

	const isShort = (w: Row) => w.confirmed < w.capacity;
	const hasClaims = (w: Row) => w.startsAt !== null && w.claimed > w.confirmed;

	function matchesKind(w: Row): boolean {
		if (kind === 'timed') return w.startsAt !== null;
		if (kind === 'untimed') return w.startsAt === null;
		if (kind === 'recurring') return w.maintenanceScheduleId !== null;
		return true;
	}
	const matchesFilters = (w: Row) => matchesKind(w) && matchesProject(w, projectFilter);

	/** The rows each Needs chip narrows to; staffing ones skip contractor work. */
	function byNeed(live: Row[], staffed: Row[]): Record<Exclude<Needs, '' | 'confirm'>, Row[]> {
		return {
			claims: staffed.filter(hasClaims),
			short: staffed.filter(isShort),
			unscheduled: live.filter((w) => w.startsAt === null)
		};
	}

	const refresh = () => void getSchedulePage(args).refresh();
</script>

<PageHeader title={m.staff_schedule()} subtitle={m.staff_planning()}>
	<!-- Not a sidebar row: roles are set up now and then, not worked daily (#1791). -->
	<Button variant="ghost" size="sm" href={resolve('/staff/volunteer/roles')}
		>{m.staff_roles()}</Button
	>
	<LogHoursForMemberAction />
	<NewWorkOrderAction onsuccess={refresh} />
</PageHeader>

<PageContent>
	<ScheduleViews active="orders" />

	<FilterBar
		activeCount={(projectFilter ? 1 : 0) +
			(byContractor
				? 1 + (contractorView !== 'open' ? 1 : 0)
				: (roleFilter ? 1 : 0) +
					(range !== DEFAULT_WINDOW ? 1 : 0) +
					(kind ? 1 : 0) +
					(needs ? 1 : 0))}
		onclear={() => {
			roleFilter = '';
			range = DEFAULT_WINDOW;
			kind = '';
			needs = '';
			contractorView = 'open';
			projectFilter = '';
		}}
	>
		{#if !byContractor}
			<Select
				size="sm"
				aria-label={m.staff_volunteer_schedule_how_far_ahead()}
				value={String(range)}
				onchange={(e: Event) => {
					range = parseRange((e.currentTarget as HTMLSelectElement).value);
				}}
			>
				{#each WINDOWS as w (w)}
					<option value={String(w)}>{windowLabel(w)}</option>
				{/each}
			</Select>
		{/if}

		<Select
			size="sm"
			aria-label={m.staff_kind()}
			value={kind}
			onchange={(e: Event) => {
				kind = parseKind((e.currentTarget as HTMLSelectElement).value);
				if (kind === 'contractor') {
					range = DEFAULT_WINDOW;
					roleFilter = '';
					needs = '';
				}
			}}
		>
			{#each Object.entries(KINDS) as [value, label] (value)}
				{#if value !== 'contractor' || contractorAccess || byContractor}
					<option {value}>{label}</option>
				{/if}
			{/each}
		</Select>

		<Select
			size="sm"
			aria-label={m.staff_project()}
			value={projectFilter}
			onchange={(e: Event) => {
				projectFilter = parseProjectFilter((e.currentTarget as HTMLSelectElement).value);
			}}
		>
			{#each Object.entries(PROJECT_FILTERS) as [value, label] (value)}
				<option {value}>{label}</option>
			{/each}
		</Select>

		{#if byContractor}
			<Select
				size="sm"
				aria-label={m.staff_volunteer_schedule_contractor_work()}
				value={contractorView}
				onchange={(e: Event) => {
					contractorView = parseView((e.currentTarget as HTMLSelectElement).value);
				}}
			>
				{#each contractorJobViews as v (v)}
					<option value={v}>{contractorJobViewLabels[v]}</option>
				{/each}
			</Select>
		{:else}
			<Select
				size="sm"
				aria-label={m.staff_role()}
				value={roleFilter}
				onchange={(e: Event) => {
					roleFilter = (e.currentTarget as HTMLSelectElement).value;
				}}
			>
				<option value="">{m.staff_all_roles()}</option>
				<RoleOptions />
			</Select>
		{/if}
	</FilterBar>

	{#if schedule.current}
		{@const data = schedule.current}
		{@const cancelled = data.shifts.filter(
			(s) => s.cancelledAt && matchesProject(s, projectFilter)
		)}
		{@const live = [...data.shifts.filter((s) => !s.cancelledAt), ...data.unscheduled].filter(
			matchesFilters
		)}
		{@const staffed = live.filter((w) => !data.contractors[w.id]?.length)}
		{@const need = byNeed(live, staffed)}
		{@const counts = { ...need, confirm: data.waiting.toConfirm }}
		{@const shown = needs && needs !== 'confirm' ? need[needs] : live}

		<!-- What the dashboard's cards counted (#2379): four narrow this table, and the
		     two about people link to the queue that holds them. Hidden at zero. -->
		<div class="flex flex-wrap gap-2" data-testid="schedule-needs">
			{#if !byContractor}
				{#each Object.entries(NEEDS) as [key, label] (key)}
					{@const n = counts[key as Exclude<Needs, ''>].length}
					{#if n > 0 || needs === key}
						<Button
							size="sm"
							variant={needs === key ? 'primary' : 'ghost'}
							aria-pressed={needs === key}
							data-needs={key}
							onclick={() => (needs = needs === key ? '' : (key as Needs))}
						>
							{label()}
							<Badge size="sm">{n}</Badge>
						</Button>
					{/if}
				{/each}
			{/if}
			{#if data.waiting.pendingHours > 0}
				<Button size="sm" variant="ghost" href={resolve('/staff/members/volunteers/hours')}>
					{m.staff_volunteer_hours_to_review_card_title()}
					<Badge size="sm">{data.waiting.pendingHours}</Badge>
				</Button>
			{/if}
			{#if data.waiting.lapsingPeople > 0}
				<Button
					size="sm"
					variant="ghost"
					href={withQuery(resolve('/staff/members/volunteers'), 'lapsing=1')}
				>
					{m.staff_volunteer_lapsing_card_title()}
					<Badge size="sm">{data.waiting.lapsingPeople}</Badge>
				</Button>
			{/if}
		</div>

		{#if needs === 'confirm'}
			<ConfirmFixedTable orders={data.waiting.toConfirm} onsuccess={refresh} />
		{:else if shown.length === 0}
			<EmptyState
				title={m.staff_volunteer_schedule_no_work_orders_match()}
				description={m.staff_volunteer_schedule_description()}
			/>
		{:else}
			<!-- No zebra: the day-group rows are the striping, as on Reservations. -->
			<Table zebra={false}>
				{#snippet head()}
					<th class="whitespace-nowrap">{m.staff_when()}</th>
					<th>{m.staff_work()}</th>
					<th class="cell-num whitespace-nowrap">{m.staff_volunteer_schedule_staffing()}</th>
					<th class="w-px"><span class="sr-only">{m.staff_actions()}</span></th>
				{/snippet}

				{#each shown as w, idx (w.id)}
					{@const href = resolve('/staff/volunteer/shifts/[id]', { id: w.id })}
					{@const unconfirmed = w.claimed - w.confirmed}
					{@const full = w.confirmed >= w.capacity}
					{@const engaged = data.contractors[w.id] ?? []}
					{@const byVolunteers = engaged.length === 0}
					{@const empty = byVolunteers && w.claimed === 0}
					{#if idx === 0 || groupKey(shown[idx - 1]) !== groupKey(w)}
						<tr>
							<td colspan="4" class="cell-group">{groupLabel(w)}</td>
						</tr>
					{/if}
					<!-- Nobody on it at all is the state worth seeing from across the room;
					     a contractor's work is not staffed by volunteers. -->
					<tr class="hover {empty ? 'border-l-4 border-l-warning bg-warning/5' : ''}">
						<td class="whitespace-nowrap">
							<a {href} class:text-subtle={!w.startsAt} class="link font-medium">{when(w)}</a>
							{#if !w.startsAt && isOverdue(w, anchor)}
								<Badge variant="warning" size="sm">{m.staff_overdue()}</Badge>
							{/if}
						</td>

						<td class="cell-primary">
							<a {href} class="link truncate font-medium">{shiftLabel(w)}</a>
							<!-- One subline: the role under a name, else the show, else the
							     briefing. A blank one says it is not tied to a show. -->
							{#if w.title && (w.roleName || byVolunteers)}
								<div class="truncate text-subtle text-xs">
									{w.roleName ?? NO_ROLE_LABEL}{#if w.eventTitle}
										· {w.eventTitle}{/if}
								</div>
							{:else if w.eventTitle}
								<div class="truncate text-xs">
									<a href={resolve(`/staff/events/${w.eventId}`)} class="link text-info">
										{w.eventTitle}
									</a>
								</div>
							{:else if w.notes}
								<div class="truncate text-subtle text-xs" title={w.notes}>{w.notes}</div>
							{/if}
							{#if w.maintenanceScheduleId}
								<a
									class="link text-xs"
									href={withQuery(
										resolve('/staff/volunteer/schedule/recurring'),
										`id=${w.maintenanceScheduleId}`
									)}>{m.staff_recurring()}</a
								>
							{/if}
							{#each engaged as c, i (i)}
								<div class="truncate text-xs">
									{c.name}
									{#if c.late}<Badge variant="error" size="sm">{m.staff_late()}</Badge>{/if}
									{#if c.awaitingInvoice}<Badge variant="warning" size="sm"
											>{m.staff_volunteer_schedule_awaiting_invoice()}</Badge
										>{/if}
								</div>
							{/each}
						</td>

						<td class="cell-num whitespace-nowrap">
							{#if byVolunteers}
								<span
									class:text-success={full}
									class:text-error={!full && w.confirmed === 0}
									class:text-warning={!full && w.confirmed > 0 && unconfirmed > 0}
								>
									{m.staff_volunteer_schedule_text({
										confirmed: w.confirmed,
										capacity: w.capacity
									})}
								</span>
								{#if unconfirmed > 0}
									<span class="text-xs text-warning"
										>{m.staff_volunteer_schedule_unconfirmed({ unconfirmed })}</span
									>
								{/if}
							{/if}
						</td>

						<td class="w-px">
							<div class="flex w-max justify-end gap-1">
								{#if unconfirmed > 0 && w.startsAt}
									<Action
										label={m.staff_volunteer_schedule_label({ unconfirmed })}
										variant="ghost"
										size="xs"
										class="text-success"
										action={confirmShiftClaims.for(w.id)}
										modalTitle={m.staff_confirm_everyone_shift()}
										submitLabel={m.staff_confirm_all()}
										successToast={m.staff_volunteer_schedule_success_toast()}
										onsuccess={refresh}
									>
										{#snippet form()}
											<input type="hidden" name="shiftId" value={w.id} />
											<p class="text-sm">
												{m.staff_volunteer_schedule_people_have_put_hand_up({
													unconfirmed,
													shiftLabel: shiftLabel(w),
													formatDateShort: formatDateShort(w.startsAt!)
												})}
											</p>
										{/snippet}
									</Action>
								{/if}
								{#if !w.startsAt && !byContractor}
									<UnscheduledActions order={w} label={shiftLabel(w)} onsuccess={refresh} />
								{/if}
								{#if byVolunteers && !full}
									<!-- Opens the work order, whose candidate column is the picker
									     and also shows who is already on it. -->
									<Button {href} variant={empty ? 'primary' : 'ghost'} size="xs">
										{m.staff_volunteer_schedule_add({ value: w.capacity - w.claimed })}
									</Button>
								{/if}
							</div>
						</td>
					</tr>
				{/each}
			</Table>
		{/if}

		{#if cancelled.length > 0 && kind !== 'untimed' && !needs}
			<!-- Below the divider: a called-off shift is people to ring, not work to staff. -->
			<div class="divider"></div>
			<ul class="space-y-1 text-sm">
				{#each cancelled as shift (shift.id)}
					<li>
						<a href={resolve('/staff/volunteer/shifts/[id]', { id: shift.id })} class="link">
							{m.staff_volunteer_schedule_cancelled({
								formatDateShort: formatDateShort(shift.startsAt),
								shiftLabel: shiftLabel(shift)
							})}
						</a>
						<span class:text-warning={shift.unnotified > 0} class="text-subtle">
							· {shift.unnotified > 0
								? m.staff_volunteer_schedule_notify({ unnotified: shift.unnotified })
								: m.staff_volunteer_schedule_everybody_notified()}
						</span>
					</li>
				{/each}
			</ul>
		{/if}
	{/if}
</PageContent>
