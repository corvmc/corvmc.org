<script lang="ts">
	/**
	 * Who teaches in the practice room. CMC's relationship is with the teacher, not
	 * the student, so there is nothing here about lessons or money between them.
	 * Applications are the Pending filter; they are the only rows waiting on staff.
	 */
	import PageHeader from '$lib/components/ui/PageHeader.svelte';
	import PageContent from '$lib/components/ui/PageContent.svelte';
	import Select from '$lib/components/ui/Form/Select.svelte';
	import StatusBadge from '$lib/components/ui/StatusBadge.svelte';
	import Badge from '$lib/components/ui/Badge.svelte';
	import Roster from '$lib/components/roster/Roster.svelte';
	import { rosterState } from '$lib/components/roster/roster-state.svelte';
	import { oneOf } from '$lib/urlState.svelte';
	import { resolve } from '$app/paths';
	import { formatDateShortYear } from '$lib/utils/format';
	import { getStaffInstructors, getStaffInstructorEmails } from '$lib/remote/instructors.remote';
	import MemberViews from '../MemberViews.svelte';
	import GrantInstructorAction from './GrantInstructorAction.svelte';
	import ReviewApplicationActions from './ReviewApplicationActions.svelte';
	import EndGrantActions from './EndGrantActions.svelte';

	const statusLabels = {
		active: 'Teaching',
		requested: 'Pending',
		paused: 'Paused',
		retired: 'Retired',
		rejected: 'Turned down',
		all: 'All'
	} as const;
	type Status = keyof typeof statusLabels;
	const statuses = Object.keys(statusLabels) as Status[];

	const roster = rosterState(resolve('/staff/members/instructors'), {
		status: oneOf<Status>(statuses, 'active')
	});
	const f = roster.values;

	const list = $derived(
		getStaffInstructors({ q: f.q || undefined, status: f.status, page: f.page })
	);
</script>

<PageHeader title="Members">
	<GrantInstructorAction />
</PageHeader>

<PageContent>
	<MemberViews active="instructors" />
	<Roster
		{roster}
		result={list}
		empty="No instructors here."
		searchPlaceholder="Search instructors..."
		personLabel="Instructor"
		exportPath={resolve('/staff/members/instructors/export')}
		emails={() => getStaffInstructorEmails({ q: f.q || undefined, status: f.status })}
	>
		{#snippet filters()}
			<Select
				size="sm"
				aria-label="Status"
				value={f.status}
				onchange={(e: Event) => {
					f.status = (e.currentTarget as HTMLSelectElement).value as Status;
					f.page = 1;
				}}
			>
				{#each statuses as s (s)}
					<option value={s}>{statusLabels[s]}</option>
				{/each}
			</Select>
		{/snippet}

		{#snippet summary(total)}
			{total}
			{total === 1 ? 'instructor' : 'instructors'}
			{#await list then { pending }}
				{#if pending > 0 && f.status !== 'requested'}
					·
					<button
						type="button"
						class="link"
						onclick={() => {
							f.status = 'requested';
							f.page = 1;
						}}
					>
						{pending} pending
					</button>
				{/if}
			{/await}
		{/snippet}

		{#snippet aside(row)}
			{#if f.status === 'all'}
				<StatusBadge status={row.status} text={statusLabels[row.status]} />
			{/if}
		{/snippet}

		{#snippet detail(row)}
			<!-- Staff-only, and this is the only surface that renders it. -->
			{#if row.status === 'requested' && row.applicationNote}
				<p class="line-clamp-3 text-subtle text-xs whitespace-pre-line">{row.applicationNote}</p>
			{:else if row.reviewNotes ?? row.statusNote}
				<p class="truncate text-subtle text-xs">{row.reviewNotes ?? row.statusNote}</p>
			{/if}
		{/snippet}

		{#snippet columns()}
			<th>Teaches</th>
			<th class="w-px">Students</th>
			<th class="col-support whitespace-nowrap">Since</th>
		{/snippet}

		{#snippet cells(row)}
			<td class="cell-text">{row.headline ?? '—'}</td>
			<td class="w-px">
				<!-- The instructor's own switch: "my book is full" is theirs to set. -->
				{#if row.status === 'active'}
					<Badge variant={row.acceptingStudents ? 'success' : 'ghost'}>
						{row.acceptingStudents ? 'Accepting' : 'Full'}
					</Badge>
				{/if}
			</td>
			<td class="col-support whitespace-nowrap">
				{formatDateShortYear(row.grantedAt ?? row.createdAt)}
			</td>
		{/snippet}

		{#snippet actions(row)}
			{#if row.status === 'requested'}
				<ReviewApplicationActions id={row.id} name={row.member.title} />
			{:else if row.status === 'active'}
				<EndGrantActions id={row.id} name={row.member.title} />
			{/if}
		{/snippet}
	</Roster>
</PageContent>
