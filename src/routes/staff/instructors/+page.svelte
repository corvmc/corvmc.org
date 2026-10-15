<script lang="ts">
	import PageHeader from '$lib/components/ui/PageHeader.svelte';
	import PageContent from '$lib/components/ui/PageContent.svelte';
	import InfoCard from '$lib/components/ui/InfoCard.svelte';
	import Table from '$lib/components/ui/Table.svelte';
	import Pagination from '$lib/components/ui/Pagination.svelte';
	import EmptyState from '$lib/components/ui/EmptyState.svelte';
	import Alert from '$lib/components/ui/Alert.svelte';
	import { errorMessage } from '$lib/error-message';
	import { retryQuery } from '$lib/utils/retry-query';
	import StatusBadge from '$lib/components/ui/StatusBadge.svelte';
	import Badge from '$lib/components/ui/Badge.svelte';
	import { EntityIdentity } from '$lib/components/ui/entity';
	import { formatDateShortYear } from '$lib/utils/format';
	import { getStaffInstructors } from '$lib/remote/instructors.remote';
	import GrantInstructorAction from './GrantInstructorAction.svelte';
	import ReviewApplicationActions from './ReviewApplicationActions.svelte';
	import EndGrantActions from './EndGrantActions.svelte';
	import FilterBar from '$lib/components/ui/FilterBar.svelte';
	import Select from '$lib/components/ui/Form/Select.svelte';

	/**
	 * Who teaches in the practice room.
	 *
	 * CMC's relationship here is with the teacher and not the student, so there is
	 * nothing on this page about lessons, students or money between them. What
	 * teaching status grants is the room at the member rate with the monthly cap
	 * lifted, plus a listing — and that is all this page administers.
	 *
	 * One load-bearing query, per `custom/no-concurrent-remote-queries`.
	 */
	const instructors = getStaffInstructors();

	// One roster, filtered by status; the default is who is teaching now.
	type RosterStatus = 'active' | 'paused' | 'retired' | 'rejected' | 'all';
	let status = $state<RosterStatus>('active');
	const rosterLabels: Record<Exclude<RosterStatus, 'all'>, string> = {
		active: 'Teaching',
		paused: 'Paused',
		retired: 'Retired',
		rejected: 'Turned down'
	};
	const unitFor: Record<RosterStatus, string> = {
		active: 'instructors',
		paused: 'paused instructors',
		retired: 'retired instructors',
		rejected: 'turned-down applications',
		all: 'instructors'
	};
	const emptyFor: Record<RosterStatus, string> = {
		active:
			'Nobody has teaching status yet. Grant it to a member you know, or wait for an application.',
		paused: 'Nobody is paused.',
		retired: 'Nobody has retired.',
		rejected: 'No application has been turned down.',
		all: 'No instructors yet.'
	};
</script>

<PageHeader title="Instructors">
	<GrantInstructorAction />
</PageHeader>

<PageContent>
	<svelte:boundary>
		{#await instructors then { awaitingReview, active, resolved }}
			{#if awaitingReview.length > 0}
				<!--
					Applications lead, because they are the only rows on this page waiting
					on staff. Everything below is either settled or waiting on the member.
				-->
				<InfoCard title="Applications">
					<Table>
						{#snippet head()}
							<th>Member</th>
							<th>Teaches</th>
							<th class="col-support whitespace-nowrap">Applied</th>
							<th class="w-px"><span class="sr-only">Review</span></th>
						{/snippet}
						{#each awaitingReview as row (row.id)}
							<tr>
								<td><EntityIdentity ref={row.member} /></td>
								<td class="cell-primary">
									{row.headline ?? '—'}
									{#if row.applicationNote}
										<!--
											Staff-only, and this is the only surface that renders it.
											It never reaches a listing DTO.
										-->
										<p class="mt-1 text-subtle whitespace-pre-line">{row.applicationNote}</p>
									{/if}
								</td>
								<td class="col-support whitespace-nowrap">
									{formatDateShortYear(row.createdAt)}
								</td>
								<td class="w-px">
									<ReviewApplicationActions id={row.id} name={row.member.title} />
								</td>
							</tr>
						{/each}
					</Table>
				</InfoCard>
			{/if}

			{@const roster = [...active, ...resolved].filter(
				(r) => status === 'all' || r.status === status
			)}
			<InfoCard title="Instructors">
				<FilterBar activeCount={status === 'active' ? 0 : 1} onclear={() => (status = 'active')}>
					<Select size="sm" aria-label="Status" bind:value={status}>
						{#each Object.entries(rosterLabels) as [value, label] (value)}
							<option {value}>{label}</option>
						{/each}
						<option value="all">All statuses</option>
					</Select>
				</FilterBar>
				{#if roster.length === 0}
					<EmptyState description={emptyFor[status]} />
				{:else}
					<Table>
						{#snippet head()}
							<th class="w-px"><span class="sr-only">Status</span></th>
							<th>Member</th>
							<th>Teaches</th>
							<th class="w-px">Students</th>
							<th class="col-support">Why</th>
							<th class="col-support whitespace-nowrap">Since</th>
							<th class="w-px"><span class="sr-only">Actions</span></th>
						{/snippet}
						{#each roster as row (row.id)}
							<tr>
								<td class="w-px">
									<StatusBadge
										status={row.status}
										text={rosterLabels[row.status as keyof typeof rosterLabels]}
									/>
								</td>
								<td><EntityIdentity ref={row.member} /></td>
								<td class="cell-primary">{row.headline ?? '—'}</td>
								<td class="w-px">
									<!--
										The instructor's own switch, not a staff one: "my book is
										full this term" and "CMC has suspended my terms" are opposite
										facts, and only the second is staff's to set.
									-->
									{#if row.status === 'active'}
										<Badge variant={row.acceptingStudents ? 'success' : 'ghost'}>
											{row.acceptingStudents ? 'Accepting' : 'Full'}
										</Badge>
									{/if}
								</td>
								<!-- `reviewNotes` is what the member was told; `statusNote` is what
								     staff told each other. Which one is set says which happened. -->
								<td class="col-support text-subtle">{row.reviewNotes ?? row.statusNote ?? ''}</td>
								<td class="col-support whitespace-nowrap">
									{formatDateShortYear(row.grantedAt ?? row.createdAt)}
								</td>
								<td class="w-px">
									{#if row.status === 'active'}
										<EndGrantActions id={row.id} name={row.member.title} />
									{/if}
								</td>
							</tr>
						{/each}
					</Table>
					<Pagination total={roster.length} unit={unitFor[status]} />
				{/if}
			</InfoCard>
		{/await}

		{#snippet failed(error, reset)}
			<Alert type="warning" reset={() => retryQuery(instructors, reset)}>
				Could not load instructors: {errorMessage(error)}
			</Alert>
		{/snippet}
	</svelte:boundary>
</PageContent>
