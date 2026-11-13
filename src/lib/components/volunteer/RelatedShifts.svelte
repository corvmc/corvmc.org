<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import type { Snippet } from 'svelte';
	import { resolve } from '$app/paths';
	import { withQuery } from '#lib/utils/with-query.js';
	import { Latest } from '#lib/latest.svelte.js';
	import InfoCard from '#lib/components/ui/InfoCard.svelte';
	import CardTitle from '#lib/components/ui/Card/CardTitle.svelte';
	import Table from '#lib/components/ui/Table.svelte';
	import Button from '#lib/components/ui/Button.svelte';
	import Badge from '#lib/components/ui/Badge.svelte';
	import Action from '#lib/components/ui/Action.svelte';
	import { Field } from '#lib/components/ui/Form/index.js';
	import { toLocalDateTime } from '#lib/utils/format.js';
	import { hasClaimsToConfirm, isShortStaffed } from '#lib/utils/shift-staffing.js';
	import { addRelatedShift, getRelatedShifts } from '#lib/remote/tasks.remote.js';
	import { getMemberRelatedShifts } from '#lib/remote/member-related.remote.js';
	import type { RelatedSubjectType } from '#lib/utils/related-tasks.js';
	import { RELATION_LABELS } from '#lib/components/task/relation-labels.js';
	import ShiftRow from './ShiftRow.svelte';

	/**
	 * The volunteer shifts related to one record (#2630): the shifts of its
	 * related tasks, under the same relations, that have not ended. Rows are
	 * Volunteering's; the summary counts booked places, as its chips do.
	 * `member` reads the member remote: the board's open shifts, with Sign up
	 * in place of confirm, and no staff chips, links or Add shift.
	 */
	let {
		subject,
		actions,
		member = false
	}: {
		subject: { type: RelatedSubjectType; id: string };
		/** A member page; only a group or an event resolves there. */
		member?: boolean;
		/** Controls a page adds beside Add shift, such as applying a template. */
		actions?: Snippet<[refresh: () => void]>;
	} = $props();

	type Chip = 'claims' | 'short';
	let chip = $state<Chip | ''>('');
	// The short-staffed shift whose candidates are open beneath it.
	let matching = $state<string | null>(null);
	let taskId = $state('');
	let roleId = $state('');

	const args = $derived({ type: subject.type, id: subject.id });
	const memberArgs = $derived({ ...args, type: args.type as 'group' | 'event' });
	type Staff = NonNullable<Awaited<ReturnType<typeof getRelatedShifts>>>;
	type Own = Awaited<ReturnType<typeof getMemberRelatedShifts>>['groups'][number]['shifts'][number];
	type Row = Staff['groups'][number]['shifts'][number] | Own;
	type View = {
		groups: { key: Staff['groups'][number]['key']; shifts: Row[] }[];
		ended: number;
		addShift: Staff['addShift'];
	};
	// `.then` inside the getter, not `await`: the query is read in Latest's effect.
	const related = new Latest<View | null>(() =>
		member
			? getMemberRelatedShifts(memberArgs).then((own) => ({
					groups: own.groups,
					ended: 0,
					addShift: null
				}))
			: getRelatedShifts(args)
	);
	$effect(() => {
		if (related.error) throw related.error.e;
	});
	const refresh = () =>
		void (member ? getMemberRelatedShifts(memberArgs) : getRelatedShifts(args)).refresh();
	const signupOf = (s: Row) => ('signup' in s ? s.signup : undefined);

	// Volunteering's chips, under its names.
	const CHIP_LABELS: Record<Chip, () => string> = {
		claims: m.staff_volunteer_needs_confirming_card_title_label,
		short: m.staff_volunteer_short_staffed_card_title_label
	};
	const CHIP_TESTS: Record<
		Chip,
		(s: { capacity: number; claimed: number; confirmed: number }) => boolean
	> = {
		claims: hasClaimsToConfirm,
		short: isShortStaffed
	};

	const volunteering = (extra: Record<string, string> = {}) =>
		withQuery(
			resolve('/staff/volunteering'),
			new URLSearchParams({ about: `${subject.type}:${subject.id}`, days: 'all', ...extra })
		);

	// Add shift's task: the new-task row first where the record can make one.
	const add = $derived(related.current?.addShift ?? null);
	const taskOptions = $derived(
		add
			? [
					...(add.newTask ? [{ value: '', label: m.staff_tasks_new_task_label() }] : []),
					...add.tasks.map((t) => ({ value: t.id, label: t.label }))
				]
			: []
	);
	$effect(() => {
		if (!taskOptions.some((o) => o.value === taskId)) taskId = taskOptions[0]?.value ?? '';
	});

	// The times start where the server says (an event's doors), else a day from
	// now as on a task's own Open shift; length and places follow the role.
	const dayFromNow = new Date(Date.now() + 86_400_000);
	const from = $derived(add?.startsAt ?? dayFromNow);
	const chosen = $derived.by(() => {
		if (!add) return null;
		if (taskId) return add.tasks.find((t) => t.id === taskId) ?? null;
		const id = add.newTask?.roleId ?? roleId;
		return add.roles.find((r) => r.id === id) ?? null;
	});
	const until = $derived(new Date(from.getTime() + (chosen?.minutes ?? 120) * 60_000));
	const { fields } = addRelatedShift;
</script>

<!-- Null is a viewer who may read the record but not its shifts. A member's
     card with no shifts is left off: it has nothing to sign up for. -->
{#if related.current && (!member || related.current.groups.length > 0)}
	{@const data = related.current}
	{@const all = data.groups.flatMap((g) => g.shifts)}
	<InfoCard title={m.staff_related_shifts_title()} testid="related-shifts">
		{#snippet header(title)}
			<div class="flex flex-wrap items-center justify-between gap-2">
				<CardTitle>{title}</CardTitle>
				<div class="flex items-center gap-1">
					{@render actions?.(refresh)}
					{#if !member && (all.length > 0 || data.ended > 0)}
						<Button variant="ghost" size="sm" href={volunteering()}>
							{m.staff_related_tasks_view_all_label()}
						</Button>
					{/if}
					{#if add && taskOptions.length > 0}
						<Action
							action={addRelatedShift}
							label={m.staff_related_shifts_add_label()}
							modalTitle={m.staff_related_shifts_add_title()}
							successToast={m.volunteer_open_shift_toast()}
							variant="ghost"
							size="sm"
							data-testid="related-add-shift"
							onsuccess={refresh}
						>
							{#snippet form()}
								<input {...fields.subjectType.as('hidden', subject.type)} />
								<input {...fields.subjectId.as('hidden', subject.id)} />
								<Field
									field={fields.taskId}
									label={m.staff_task_label()}
									type="select"
									bind:value={taskId}
									options={taskOptions}
								/>
								{#if taskId === '' && add.newTask}
									{#if !add.newTask.roleId}
										<Field
											field={fields.volunteerRoleId}
											label={m.staff_role_label()}
											type="select"
											bind:value={roleId}
											placeholder={m.staff_related_shifts_pick_role_placeholder()}
											options={add.roles.map((r) => ({ value: r.id, label: r.name }))}
										/>
									{/if}
									<Field field={fields.title} type="text" label={m.staff_title_label()} />
								{/if}
								<Field
									field={fields.startsAt}
									label={m.volunteer_shift_form_fields_starts_label()}
									type="datetime-local"
									value={toLocalDateTime(from)}
								/>
								<Field
									field={fields.endsAt}
									label={m.volunteer_shift_form_fields_ends_label()}
									type="datetime-local"
									value={toLocalDateTime(until)}
								/>
								<Field
									field={fields.capacity}
									submitAs="text"
									label={m.volunteer_shift_form_fields_people_needed_label()}
									type="number"
									min="1"
									value={String(chosen?.capacity ?? 1)}
								/>
							{/snippet}
						</Action>
					{/if}
				</div>
			</div>
		{/snippet}

		{#if all.length > 0 || data.ended > 0}
			{@const capacity = all.reduce((n, s) => n + s.capacity, 0)}
			{@const filled = all.reduce((n, s) => n + Math.min(s.confirmed, s.capacity), 0)}
			{#if all.length > 0}
				<p class="text-muted text-sm" data-testid="related-shifts-summary">
					{m.staff_related_shifts_summary_text({ filled, capacity, shifts: all.length })}
				</p>
			{/if}

			{#if !member}
				<div class="flex flex-wrap gap-2" data-testid="related-shift-chips">
					{#each Object.entries(CHIP_TESTS) as [key, test] (key)}
						{@const n = all.filter(test).length}
						{#if n > 0 || chip === key}
							<Button
								size="sm"
								variant={chip === key ? 'primary' : 'ghost'}
								aria-pressed={chip === key}
								data-chip={key}
								onclick={() => (chip = chip === key ? '' : (key as Chip))}
							>
								{CHIP_LABELS[key as Chip]()}
								<Badge size="sm">{n}</Badge>
							</Button>
						{/if}
					{/each}
					<!-- Ended shifts are past this card's window; the chip opens them on Volunteering. -->
					{#if data.ended > 0}
						<Button
							size="sm"
							variant="ghost"
							data-chip="ended"
							href={volunteering({ needs: 'ended' })}
						>
							{m.staff_volunteer_ended_shifts_label()}
							<Badge size="sm">{data.ended}</Badge>
						</Button>
					{/if}
				</div>
			{/if}

			{#if all.length > 0}
				<Table zebra={false} packed={false}>
					{#each data.groups as group (group.key)}
						{@const rows = group.shifts.filter((s) => !chip || CHIP_TESTS[chip](s))}
						{#if data.groups.length > 1 && rows.length > 0}
							<tr data-testid="related-shift-group" data-relation={group.key}>
								<td colspan="4" class="cell-group">{RELATION_LABELS[group.key]()}</td>
							</tr>
						{/if}
						{#each rows as s (s.shiftId)}
							<ShiftRow
								shift={s}
								compact
								open={matching === s.shiftId}
								ontoggle={() => (matching = matching === s.shiftId ? null : s.shiftId)}
								onsuccess={refresh}
								signup={signupOf(s)}
							/>
						{/each}
					{/each}
				</Table>
			{/if}
		{/if}
	</InfoCard>
{/if}
