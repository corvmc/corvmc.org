<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	/**
	 * Volunteer shifts by date (#2625): signing people up, confirming them, and
	 * closing shifts out. Work with no shift and contractor work are on Tasks.
	 * A row shows booked places, not claimed ones: three unconfirmed claims do
	 * not staff a shift (docs/reports/volunteer-workflow-findings.md#a3).
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
	import RoleOptions from '#lib/components/volunteer/RoleOptions.svelte';
	import CandidateColumn from '#lib/components/volunteer/CandidateColumn.svelte';
	import LogHoursForMemberAction from '#lib/components/volunteer/LogHoursForMemberAction.svelte';
	import { hasClaimsToConfirm, isShortStaffed } from '#lib/utils/shift-staffing.js';
	import NewWorkOrderAction from './NewWorkOrderAction.svelte';
	import EndedShiftsTable from './EndedShiftsTable.svelte';
	import { NEEDS, parseNeeds, type Needs } from './needs-filter';
	import { formatDateShort, relativeDay } from '#lib/utils/format.js';
	import { DEFAULT_TIMEZONE } from '#lib/config.js';
	import { getVolunteeringPage, confirmShiftClaims } from '#lib/remote/volunteer.remote.js';

	/** `'all'` drops both bounds rather than passing a wide one, so it is really everything. */
	const WINDOWS = [7, 14, 30, 'all'] as const;
	type Range = (typeof WINDOWS)[number];
	const DAY_MS = 24 * 60 * 60 * 1000;
	const DEFAULT_WINDOW: Range = 14;

	function parseRange(raw: string | null): Range {
		if (raw === 'all') return 'all';
		const n = Number(raw);
		return (WINDOWS as readonly (number | string)[]).includes(n) ? (n as Range) : DEFAULT_WINDOW;
	}

	const initial = page.url.searchParams;

	let range = $state(parseRange(initial.get('days')));
	let roleFilter = $state(initial.get('role') ?? '');
	// `short=1` was the checkbox this replaced; old links keep working.
	let needs = $state<Needs>(
		initial.get('short') === '1' ? 'short' : parseNeeds(initial.get('needs'))
	);
	// The short-staffed shift whose candidates are open beneath it.
	let matching = $state<string | null>(null);

	// Writes the URL, never state — `goto(..., { replace: true })` rather than
	// a shallow `goto`, which updates neither `page.url` nor the router's own entry.
	$effect(() => {
		const pairs: [string, string][] = [];
		if (range !== DEFAULT_WINDOW) pairs.push(['days', String(range)]);
		if (roleFilter) pairs.push(['role', roleFilter]);
		if (needs) pairs.push(['needs', needs]);

		const search = pairs.map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
		const href = withQuery(resolve('staff/volunteering'), search);
		if (location.pathname + location.search !== href) {
			void goto(href, { replace: true, reset: false });
		}
	});

	// Pinned once rather than derived from the clock: `refresh()` is keyed by argument,
	// so a `from` that ticked would mint a new key and the refresh would miss it.
	const anchor = new Date();

	const args = $derived({
		from: range === 'all' ? undefined : anchor.toISOString(),
		to: range === 'all' ? undefined : new Date(anchor.getTime() + range * DAY_MS).toISOString(),
		volunteerRoleId: roleFilter || undefined,
		includeCancelled: true
	});
	// Not `{#await}`: a refresh would re-pend it and unmount an open row Action.
	const shifts = new Latest(() => getVolunteeringPage(args));
	$effect(() => {
		if (shifts.error) throw shifts.error.e;
	});

	type Row = Awaited<ReturnType<typeof getVolunteeringPage>>['shifts'][number];

	const timeFmt = new Intl.DateTimeFormat('en-US', {
		hour: 'numeric',
		minute: '2-digit',
		timeZone: DEFAULT_TIMEZONE
	});
	const dayFmt = new Intl.DateTimeFormat('en-CA', { timeZone: DEFAULT_TIMEZONE });

	const groupLabel = (w: Row) => `${relativeDay(w.startsAt)} · ${formatDateShort(w.startsAt)}`;
	const groupKey = (w: Row) => dayFmt.format(w.startsAt);
	const when = (w: Row) => `${timeFmt.format(w.startsAt)}–${timeFmt.format(w.endsAt)}`;

	const refresh = () => void getVolunteeringPage(args).refresh();
</script>

<PageHeader title={m.staff_volunteering_title()} subtitle={m.staff_planning_body()} />

<PageContent>
	<FilterBar
		activeCount={(roleFilter ? 1 : 0) + (range !== DEFAULT_WINDOW ? 1 : 0) + (needs ? 1 : 0)}
		onclear={() => {
			roleFilter = '';
			range = DEFAULT_WINDOW;
			needs = '';
		}}
	>
		<Select
			size="sm"
			aria-label={m.staff_volunteer_schedule_date_range_label()}
			value={String(range)}
			onchange={(e: Event) => {
				range = parseRange((e.currentTarget as HTMLSelectElement).value);
			}}
		>
			{#each WINDOWS as w (w)}
				<option value={String(w)}
					>{w === 'all'
						? m.staff_tasks_any_date_label()
						: m.staff_tasks_within_days_label({ days: w })}</option
				>
			{/each}
		</Select>

		<Select
			size="sm"
			aria-label={m.staff_role_label()}
			value={roleFilter}
			onchange={(e: Event) => {
				roleFilter = (e.currentTarget as HTMLSelectElement).value;
			}}
		>
			<option value="">{m.staff_all_roles_label()}</option>
			<RoleOptions />
		</Select>

		{#snippet actions()}
			<!-- Not a sidebar row: roles are set up now and then, not worked daily (#1791). -->
			<Button variant="ghost" href={resolve('staff/volunteer/roles')}
				>{m.staff_roles_label()}</Button
			>
			<LogHoursForMemberAction />
			<NewWorkOrderAction onsuccess={refresh} />
		{/snippet}
	</FilterBar>

	{#if shifts.current}
		{@const data = shifts.current}
		{@const cancelled = data.shifts.filter((s) => s.cancelledAt)}
		{@const live = data.shifts.filter((s) => !s.cancelledAt)}
		{@const need = { claims: live.filter(hasClaimsToConfirm), short: live.filter(isShortStaffed) }}
		{@const counts = { ...need, ended: data.ended }}
		{@const shown = needs && needs !== 'ended' ? need[needs] : live}

		<!-- Each narrows the table, and the clearances queue links to Members. Hidden at zero. -->
		<div class="flex flex-wrap gap-2" data-testid="volunteering-needs">
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
			{#if data.lapsingPeople > 0}
				<Button
					size="sm"
					variant="ghost"
					href={withQuery(resolve('staff/members/volunteers'), 'lapsing=1')}
				>
					{m.staff_volunteer_lapsing_card_title_label()}
					<Badge size="sm">{data.lapsingPeople}</Badge>
				</Button>
			{/if}
		</div>

		{#if needs === 'ended'}
			<EndedShiftsTable tasks={data.ended} onsuccess={refresh} />
		{:else if shown.length === 0}
			<EmptyState
				title={m.staff_volunteering_no_shifts_title()}
				description={m.staff_volunteer_schedule_description_body()}
			/>
		{:else}
			<!-- No zebra: the day-group rows are the striping, as on Reservations. -->
			<Table zebra={false}>
				{#snippet head()}
					<th class="whitespace-nowrap">{m.staff_when_label()}</th>
					<th>{m.staff_work_label()}</th>
					<th class="cell-num whitespace-nowrap">{m.staff_volunteer_schedule_staffing_label()}</th>
					<th class="w-px"><span class="sr-only">{m.staff_actions_label()}</span></th>
				{/snippet}

				{#each shown as w, idx (w.shiftId ?? w.id)}
					{@const href = resolve('/staff/tasks/[id]', { id: w.id })}
					{@const unconfirmed = w.claimed - w.confirmed}
					{@const full = !isShortStaffed(w)}
					{@const empty = w.claimed === 0}
					{@const open = matching === w.shiftId}
					{#if idx === 0 || groupKey(shown[idx - 1]) !== groupKey(w)}
						<tr>
							<td colspan="4" class="cell-group">{groupLabel(w)}</td>
						</tr>
					{/if}
					<!-- Nobody on it at all is the state worth seeing from across the room. -->
					<tr
						class="hover {empty ? 'border-l-4 border-l-warning bg-warning/5' : ''}"
						data-shift={w.shiftId}
					>
						<td class="whitespace-nowrap">
							<a {href} class="link font-medium">{when(w)}</a>
						</td>

						<td class="cell-primary">
							<a {href} class="link truncate font-medium">{shiftLabel(w)}</a>
							<!-- One subline: the role under a name, else the show, else the briefing. -->
							{#if w.title}
								<div class="truncate text-subtle text-xs">
									{w.roleName ?? NO_ROLE_LABEL}{#if w.eventTitle}
										· {w.eventTitle}{/if}
								</div>
							{:else if w.eventTitle}
								<div class="truncate text-xs">
									<a href={resolve(`staff/events/${w.eventId}`)} class="link text-info">
										{w.eventTitle}
									</a>
								</div>
							{:else if w.notes}
								<div class="truncate text-subtle text-xs" title={w.notes}>{w.notes}</div>
							{/if}
						</td>

						<td class="cell-num whitespace-nowrap">
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
									>{m.staff_volunteer_schedule_unconfirmed_text({ unconfirmed })}</span
								>
							{/if}
						</td>

						<td class="w-px">
							<div class="flex w-max justify-end gap-1">
								{#if unconfirmed > 0 && w.shiftId}
									<Action
										label={m.staff_volunteer_schedule_label({ unconfirmed })}
										variant="ghost"
										size="xs"
										class="text-success"
										action={confirmShiftClaims.for(w.id)}
										modalTitle={m.staff_confirm_all_volunteers_title()}
										submitLabel={m.staff_confirm_all_label()}
										successToast={m.staff_volunteer_schedule_success_toast()}
										onsuccess={refresh}
									>
										{#snippet form()}
											<input
												{...confirmShiftClaims
													.for(w.id)
													.fields.shiftId.as('hidden', w.shiftId ?? '')}
											/>
											<p class="text-sm">
												{m.staff_volunteer_schedule_people_have_put_hand_up_text({
													unconfirmed,
													shiftLabel: shiftLabel(w),
													formatDateShort: formatDateShort(w.startsAt)
												})}
											</p>
										{/snippet}
									</Action>
								{/if}
								{#if !full && w.shiftId}
									<!-- Roster matching: the people interested in its role, to invite. -->
									<Button
										variant={empty ? 'primary' : 'ghost'}
										size="xs"
										aria-expanded={open}
										data-testid="find-volunteers"
										onclick={() => (matching = open ? null : w.shiftId)}
									>
										{m.staff_volunteering_find_volunteers_label()}
									</Button>
								{/if}
							</div>
						</td>
					</tr>
					{#if open && w.shiftId}
						<tr data-testid="roster-match">
							<td colspan="4">
								<CandidateColumn workOrderId={w.id} shiftId={w.shiftId} startsAt={w.startsAt} />
							</td>
						</tr>
					{/if}
				{/each}
			</Table>
		{/if}

		{#if cancelled.length > 0 && !needs}
			<!-- Below the divider: a called-off shift is people to ring, not work to staff. -->
			<div class="divider"></div>
			<ul class="space-y-1 text-sm">
				{#each cancelled as shift (shift.shiftId ?? shift.id)}
					<li>
						<a href={resolve('/staff/tasks/[id]', { id: shift.id })} class="link">
							{m.staff_volunteer_schedule_cancelled_text({
								formatDateShort: formatDateShort(shift.startsAt),
								shiftLabel: shiftLabel(shift)
							})}
						</a>
						<span class:text-warning={shift.unnotified > 0} class="text-subtle">
							· {shift.unnotified > 0
								? m.staff_volunteer_schedule_notify_text({ unnotified: shift.unnotified })
								: m.staff_volunteer_schedule_everybody_notified_text()}
						</span>
					</li>
				{/each}
			</ul>
		{/if}
	{/if}
</PageContent>
