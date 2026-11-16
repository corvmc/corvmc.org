<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	/**
	 * Who teaches in the practice room. CMC's relationship is with the teacher, not
	 * the student, so there is nothing here about lessons or money between them.
	 * Applications are the Pending filter; they are the only rows waiting on staff.
	 */
	import Select from '#lib/components/ui/Form/Select.svelte';
	import StatusBadge from '#lib/components/ui/StatusBadge.svelte';
	import Badge from '#lib/components/ui/Badge.svelte';
	import Roster from '#lib/components/roster/Roster.svelte';
	import { rosterState } from '#lib/components/roster/roster-state.svelte.js';
	import { oneOf } from '#lib/urlState.svelte.js';
	import { resolve } from '$app/paths';
	import { formatDateShortYear } from '#lib/utils/format.js';
	import { getStaffInstructors, getStaffInstructorEmails } from '#lib/remote/instructors.remote.js';
	import MemberRoleFilter from './MemberRoleFilter.svelte';
	import { memberViewQuery } from './views';
	import { withQuery } from '#lib/utils/with-query.js';
	import GrantInstructorAction from './instructors/GrantInstructorAction.svelte';
	import TeachingTermsAction from './instructors/TeachingTermsAction.svelte';
	import InstructorActions from './instructors/InstructorActions.svelte';
	import MemberRecordPanel from './[id]/MemberRecordPanel.svelte';

	const statusLabels = {
		active: m.staff_members_instructors_status_teaching_label,
		requested: m.staff_pending_label,
		paused: m.staff_members_instructors_status_paused_label,
		retired: m.staff_retired_label,
		rejected: m.staff_returned_label,
		all: m.staff_all_label
	};
	type Status = keyof typeof statusLabels;
	const statuses = Object.keys(statusLabels) as Status[];

	const roster = rosterState(withQuery(resolve('staff/members'), memberViewQuery('teacher')), {
		status: oneOf<Status>(statuses, 'active')
	});
	const f = roster.values;

	const list = $derived(
		getStaffInstructors({ q: f.q || undefined, status: f.status, page: f.page })
	);
</script>

<Roster
	{roster}
	result={list}
	empty={m.staff_members_instructors_empty_body()}
	searchPlaceholder={m.staff_members_instructors_search_placeholder()}
	personLabel={m.staff_members_instructors_person_label()}
	exportPath={resolve('staff/members/instructors/export')}
	emails={() => getStaffInstructorEmails({ q: f.q || undefined, status: f.status })}
>
	{#snippet toolbar()}
		<GrantInstructorAction />
		<TeachingTermsAction />
	{/snippet}

	{#snippet filters()}
		<MemberRoleFilter view="teacher" />
		<Select
			size="sm"
			aria-label={m.staff_status_label()}
			value={f.status}
			onchange={(e: Event) => {
				f.status = (e.currentTarget as HTMLSelectElement).value as Status;
				f.page = 1;
			}}
		>
			{#each statuses as s (s)}
				<option value={s}>{statusLabels[s]()}</option>
			{/each}
		</Select>
	{/snippet}

	{#snippet summary(total)}
		{total}
		{m.term_instructor({ count: total })}
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
					{m.staff_members_instructors_pending_label({ pending })}
				</button>
			{/if}
		{:catch}
			<!-- Roster's DataList takes this rejection to the boundary. -->
		{/await}
	{/snippet}

	{#snippet aside(row)}
		{#if f.status === 'all'}
			<StatusBadge status={row.status} text={statusLabels[row.status]()} />
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
		<th>{m.staff_teaches_label()}</th>
		<th class="w-px">{m.staff_students_label()}</th>
		<th class="col-support whitespace-nowrap">{m.staff_since_label()}</th>
	{/snippet}

	{#snippet cells(row)}
		<td class="cell-text">{row.headline ?? '—'}</td>
		<td class="w-px">
			<!-- The instructor's own switch: "my book is full" is theirs to set. -->
			{#if row.status === 'active'}
				<Badge variant={row.acceptingStudents ? 'success' : 'ghost'}>
					{row.acceptingStudents
						? m.staff_accepting_label()
						: m.staff_members_instructors_full_label()}
				</Badge>
			{/if}
		</td>
		<td class="col-support whitespace-nowrap">
			{formatDateShortYear(row.grantedAt ?? row.createdAt)}
		</td>
	{/snippet}

	{#snippet actions(row)}
		<InstructorActions record={row} name={row.member.title} />
	{/snippet}

	{#snippet panel(row, ctl)}
		<MemberRecordPanel
			id={row.personId}
			name={row.member.title}
			tab="instructor"
			bind:open={ctl.open}
		/>
	{/snippet}
</Roster>
