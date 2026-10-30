<script lang="ts">
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
	import { NO_ROLE_LABEL, shiftLabel } from '$lib/utils/shift-label';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { withQuery } from '$lib/utils/with-query';
	import PageHeader from '$lib/components/ui/PageHeader.svelte';
	import PageContent from '$lib/components/ui/PageContent.svelte';
	import Table from '$lib/components/ui/Table.svelte';
	import FilterBar from '$lib/components/ui/FilterBar.svelte';
	import EmptyState from '$lib/components/ui/EmptyState.svelte';
	import Select from '$lib/components/ui/Form/Select.svelte';
	import Action from '$lib/components/ui/Action.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import Badge from '$lib/components/ui/Badge.svelte';
	import { isOverdue } from '$lib/utils/work-order-due';
	import RoleOptions from '$lib/components/volunteer/RoleOptions.svelte';
	import NewWorkOrderAction from '../NewWorkOrderAction.svelte';
	import ScheduleViews from './ScheduleViews.svelte';
	import { PROJECT_FILTERS, matchesProject, parseProjectFilter } from './project-filter';
	import { formatDateShort, relativeDay } from '$lib/utils/format';
	import {
		DEFAULT_TIMEZONE,
		contractorJobViews,
		contractorJobViewLabels,
		type ContractorJobView
	} from '$lib/config';
	import { getSchedulePage, confirmShiftClaims } from '$lib/remote/volunteer.remote';

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
	let shortOnly = $state(initial.get('short') === '1');
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
		if (shortOnly) pairs.push(['short', '1']);
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
	const schedule = $derived(getSchedulePage(args));

	// Whether to offer the Contractor kind; the query says, and guards it.
	let contractorAccess = $state(false);
	$effect(() => {
		void schedule.then((d) => (contractorAccess = d.contractorAccess));
	});

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

	function matchesKind(w: Row): boolean {
		if (kind === 'timed') return w.startsAt !== null;
		if (kind === 'untimed') return w.startsAt === null;
		if (kind === 'recurring') return w.maintenanceScheduleId !== null;
		return true;
	}
	const matchesFilters = (w: Row) => matchesKind(w) && matchesProject(w, projectFilter);

	/** "3 work orders · 2 short-staffed · 4 claims to confirm", minus the zeroes. */
	function summarize(rows: Row[], staffed: Row[]): string {
		const short = staffed.filter(isShort).length;
		const claims = staffed.reduce((n, w) => n + (w.claimed - w.confirmed), 0);
		const parts = [`${rows.length} ${rows.length === 1 ? 'work order' : 'work orders'}`];
		if (short > 0) parts.push(`${short} short-staffed`);
		if (claims > 0) parts.push(`${claims} ${claims === 1 ? 'claim' : 'claims'} to confirm`);
		return parts.join(' · ');
	}
</script>

<PageHeader title="Schedule" subtitle="Planning">
	<NewWorkOrderAction onsuccess={() => void getSchedulePage(args).refresh()} />
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
					(shortOnly ? 1 : 0))}
		onclear={() => {
			roleFilter = '';
			range = DEFAULT_WINDOW;
			kind = '';
			shortOnly = false;
			contractorView = 'open';
			projectFilter = '';
		}}
	>
		{#if !byContractor}
			<Select
				size="sm"
				aria-label="How far ahead"
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
			aria-label="Kind"
			value={kind}
			onchange={(e: Event) => {
				kind = parseKind((e.currentTarget as HTMLSelectElement).value);
				if (kind === 'contractor') {
					range = DEFAULT_WINDOW;
					roleFilter = '';
					shortOnly = false;
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
			aria-label="Project"
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
				aria-label="Contractor work"
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
				aria-label="Role"
				value={roleFilter}
				onchange={(e: Event) => {
					roleFilter = (e.currentTarget as HTMLSelectElement).value;
				}}
			>
				<option value="">All roles</option>
				<RoleOptions />
			</Select>

			<label class="label cursor-pointer gap-2 text-sm">
				<input
					type="checkbox"
					class="checkbox checkbox-sm"
					checked={shortOnly}
					onchange={(e) => (shortOnly = e.currentTarget.checked)}
				/>
				Short-staffed only
			</label>
		{/if}
	</FilterBar>

	{#await schedule then data}
		{@const cancelled = data.shifts.filter(
			(s) => s.cancelledAt && matchesProject(s, projectFilter)
		)}
		{@const live = [...data.shifts.filter((s) => !s.cancelledAt), ...data.unscheduled].filter(
			matchesFilters
		)}
		{@const staffed = live.filter((w) => !data.contractors[w.id]?.length)}
		{@const shown = shortOnly ? staffed.filter(isShort) : live}

		{#if live.length > 0}
			<p class="text-subtle text-sm">{summarize(live, staffed)}</p>
		{/if}

		{#if shown.length === 0}
			<EmptyState
				title="No work orders match that"
				description="Widen the window, or clear the filters."
			/>
		{:else}
			<!-- No zebra: the day-group rows are the striping, as on Reservations. -->
			<Table zebra={false}>
				{#snippet head()}
					<th class="whitespace-nowrap">When</th>
					<th>Work</th>
					<th class="cell-num whitespace-nowrap">Staffing</th>
					<th class="w-px"><span class="sr-only">Actions</span></th>
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
								<Badge variant="warning" size="sm">Overdue</Badge>
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
									)}>Recurring</a
								>
							{/if}
							{#each engaged as c, i (i)}
								<div class="truncate text-xs">
									{c.name}
									{#if c.late}<Badge variant="error" size="sm">Late</Badge>{/if}
									{#if c.awaitingInvoice}<Badge variant="warning" size="sm">Awaiting invoice</Badge
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
									{w.confirmed} of {w.capacity}
								</span>
								{#if unconfirmed > 0}
									<span class="text-xs text-warning">· {unconfirmed} unconfirmed</span>
								{/if}
							{/if}
						</td>

						<td class="w-px">
							<div class="flex w-max justify-end gap-1">
								{#if unconfirmed > 0 && w.startsAt}
									<Action
										label="Confirm {unconfirmed}"
										variant="ghost"
										size="xs"
										class="text-success"
										action={confirmShiftClaims.for(w.id)}
										modalTitle="Confirm everyone on this shift?"
										submitLabel="Confirm all"
										successToast="Confirmed. They're booked."
									>
										{#snippet form()}
											<input type="hidden" name="shiftId" value={w.id} />
											<p class="text-sm">
												{unconfirmed}
												{unconfirmed === 1 ? 'person has' : 'people have'} put a hand up for
												{shiftLabel(w)} on {formatDateShort(w.startsAt!)}. Confirming books them:
												each gets the reminder the day before, and the shift completes afterwards
												with hours to log.
											</p>
										{/snippet}
									</Action>
								{/if}
								{#if byVolunteers && !full}
									<!-- Opens the work order, whose candidate column is the picker
									     and also shows who is already on it. -->
									<Button {href} variant={empty ? 'primary' : 'ghost'} size="xs">
										Add {w.capacity - w.claimed}
									</Button>
								{/if}
							</div>
						</td>
					</tr>
				{/each}
			</Table>
		{/if}

		{#if cancelled.length > 0 && kind !== 'untimed'}
			<!-- Below the divider: a called-off shift is people to ring, not work to staff. -->
			<div class="divider"></div>
			<ul class="space-y-1 text-sm">
				{#each cancelled as shift (shift.id)}
					<li>
						<a href={resolve('/staff/volunteer/shifts/[id]', { id: shift.id })} class="link">
							{formatDateShort(shift.startsAt)}
							{shiftLabel(shift)} cancelled
						</a>
						<span class:text-warning={shift.unnotified > 0} class="text-subtle">
							· {shift.unnotified > 0 ? `${shift.unnotified} to notify` : 'everybody notified'}
						</span>
					</li>
				{/each}
			</ul>
		{/if}
	{/await}
</PageContent>
