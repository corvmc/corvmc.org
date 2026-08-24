<script lang="ts">
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import PageHeader from '$lib/components/shared/PageHeader.svelte';
	import PageContent from '$lib/components/shared/PageContent.svelte';
	import Table from '$lib/components/shared/Table.svelte';
	import FilterBar from '$lib/components/shared/FilterBar.svelte';
	import EmptyState from '$lib/components/shared/EmptyState.svelte';
	import Action from '$lib/components/shared/Action.svelte';
	import Select from '$lib/components/shared/Form/Select.svelte';
	import FormField from '$lib/components/shared/Form/FormField.svelte';
	import ShiftFormFields from '$lib/components/shared/volunteer/ShiftFormFields.svelte';
	import { formatDateShort, toLocalDateTime } from '$lib/utils/format';
	import { DEFAULT_TIMEZONE } from '$lib/config';
	import { IconCopy } from '@tabler/icons-svelte';
	import {
		getShifts,
		getVolunteerRoles,
		createShift,
		duplicateShift
	} from '$lib/remote/volunteer.remote';

	const initial = page.url.searchParams;

	let roleFilter = $state(initial.get('role') ?? '');
	let showPast = $state(initial.get('past') === '1');

	$effect(() => {
		const pairs: [string, string][] = [];
		if (roleFilter) pairs.push(['role', roleFilter]);
		if (showPast) pairs.push(['past', '1']);

		const search = pairs.map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
		const href = `${resolve('/staff/volunteer/shifts')}${search ? `?${search}` : ''}`;
		if (location.pathname + location.search !== href) {
			void goto(href, { replaceState: true, noScroll: true, keepFocus: true });
		}
	});

	// Past shifts are off by default — the list is a scheduling tool, and last
	// month's shifts only get in the way of filling next week's.
	let shifts = $derived(
		getShifts({
			volunteerRoleId: roleFilter || undefined,
			from: showPast ? undefined : new Date().toISOString()
		})
	);
	let roles = $derived(getVolunteerRoles());

	function timeRange(start: Date, end: Date): string {
		const fmt = new Intl.DateTimeFormat('en-US', {
			hour: 'numeric',
			minute: '2-digit',
			timeZone: DEFAULT_TIMEZONE
		});
		return `${fmt.format(start)}–${fmt.format(end)}`;
	}

	// Tomorrow, so the form opens on a plausible date rather than one already past.
	const START_MS = Date.now() + 86_400_000;
	const defaultStart = toLocalDateTime(new Date(START_MS));

	// The role carries the shape of its own shift, so the end time and headcount
	// follow whichever role is picked in the modal. Roles that never had defaults
	// set fall back to the four hours and one person this form always assumed.
	const FALLBACK_DURATION_MINUTES = 4 * 60;
	const FALLBACK_CAPACITY = 1;

	let pickedRoleId = $state('');

	// Seeded from the first live role rather than left empty. The select has no
	// placeholder option, so a bound value matching nothing leaves it with nothing
	// selected — which posts an empty role instead of the one on screen. Guarded on
	// `pickedRoleId` so it seeds once and never clobbers an actual choice.
	$effect(() => {
		void roles.then((all) => {
			if (pickedRoleId) return;
			const first = all.find((r) => r.isActive);
			if (first) pickedRoleId = first.id;
		});
	});

	type RoleDefaults = {
		id: string;
		defaultDurationMinutes: number | null;
		defaultCapacity: number | null;
	};

	function defaultsFor(all: RoleDefaults[]) {
		const picked = all.find((r) => r.id === pickedRoleId) ?? all[0];
		const minutes = picked?.defaultDurationMinutes ?? FALLBACK_DURATION_MINUTES;
		return {
			end: toLocalDateTime(new Date(START_MS + minutes * 60_000)),
			capacity: String(picked?.defaultCapacity ?? FALLBACK_CAPACITY)
		};
	}
</script>

<PageHeader title="Shifts" subtitle="Staff" backHref="/staff/volunteer">
	{#await roles then roleOptions}
		{@const live = roleOptions.filter((r) => r.isActive)}
		{#if live.length > 0}
			<Action
				action={createShift}
				label="New Shift"
				modalTitle="Schedule a shift"
				submitLabel="Create"
				successToast="Shift scheduled"
			>
				{#snippet form()}
					{@const defaults = defaultsFor(live)}
					<ShiftFormFields
						form={createShift}
						roles={live}
						bind:roleId={pickedRoleId}
						startsAt={defaultStart}
						endsAt={defaults.end}
						capacity={defaults.capacity}
					/>
				{/snippet}
			</Action>
		{/if}
	{/await}
</PageHeader>

<PageContent>
	<FilterBar
		activeCount={(roleFilter ? 1 : 0) + (showPast ? 1 : 0)}
		onclear={() => {
			roleFilter = '';
			showPast = false;
		}}
	>
		{#await roles then roleOptions}
			<Select
				size="sm"
				aria-label="Role"
				value={roleFilter}
				onchange={(e: Event) => {
					roleFilter = (e.currentTarget as HTMLSelectElement).value;
				}}
			>
				<option value="">All roles</option>
				{#each roleOptions as role (role.id)}
					<option value={role.id}>{role.name}</option>
				{/each}
			</Select>
		{/await}

		<label class="label cursor-pointer gap-2 text-sm">
			<input
				type="checkbox"
				class="checkbox checkbox-sm"
				checked={showPast}
				onchange={(e) => (showPast = e.currentTarget.checked)}
			/>
			Include past
		</label>
	</FilterBar>

	{#await shifts then rows}
		{#if rows.length === 0}
			<EmptyState
				title="No shifts scheduled"
				description="Post one and members interested in that role see it first."
			/>
		{:else}
			<Table>
				{#snippet head()}
					<th class="whitespace-nowrap">When</th>
					<th>Role</th>
					<th class="col-support cell-num">Filled</th>
					<th class="col-extra">Notes</th>
					<th class="w-px"><span class="sr-only">Actions</span></th>
				{/snippet}

				{#each rows as shift (shift.id)}
					<tr class="hover" class:opacity-50={shift.cancelledAt}>
						<td class="whitespace-nowrap">
							<a href={resolve(`/staff/volunteer/shifts/${shift.id}`)} class="link font-medium">
								{formatDateShort(shift.startsAt)}
							</a>
							<div class="text-subtle">{timeRange(shift.startsAt, shift.endsAt)}</div>
						</td>

						<td class="cell-primary">
							<div class="truncate font-medium">{shift.roleName}</div>
							{#if shift.eventTitle}
								<div class="truncate">
									<a href={resolve(`/staff/events/${shift.eventId}`)} class="link text-subtle">
										{shift.eventTitle}
									</a>
								</div>
							{/if}
							{#if shift.cancelledAt}
								<div class="text-xs text-error">Cancelled</div>
							{/if}
						</td>

						<td class="col-support cell-num">
							<span class:text-warning={shift.claimed < shift.capacity}>
								{shift.claimed}/{shift.capacity}
							</span>
						</td>

						<td class="col-extra">
							<div class="truncate text-subtle" title={shift.notes ?? ''}>
								{shift.notes ?? ''}
							</div>
						</td>

						<td class="w-px">
							<!--
								Duplicate is how a standing weekly slot gets made — there is no
								recurrence, so next week's shift is last week's copied forward.
							-->
							<Action
								action={duplicateShift.for(shift.id)}
								label="Duplicate"
								iconOnly
								icon={copyIcon}
								variant="ghost"
								size="sm"
								modalTitle="Copy this shift forward"
								submitLabel="Copy"
								successToast="Shift copied"
							>
								{#snippet form()}
									<input type="hidden" name="id" value={shift.id} />
									<p class="text-sm">
										{shift.roleName}, {timeRange(shift.startsAt, shift.endsAt)}, with the same notes
										and headcount. Claims aren't copied.
									</p>
									<FormField
										name="offsetDays"
										label="How many days ahead"
										type="number"
										min="1"
										value="7"
										description="7 makes it the same time next week."
									/>
								{/snippet}
							</Action>
						</td>
					</tr>
				{/each}
			</Table>
		{/if}
	{/await}
</PageContent>

{#snippet copyIcon()}
	<IconCopy size={16} />
{/snippet}
