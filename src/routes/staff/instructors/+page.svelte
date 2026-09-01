<script lang="ts">
	import PageHeader from '$lib/components/ui/PageHeader.svelte';
	import PageContent from '$lib/components/ui/PageContent.svelte';
	import InfoCard from '$lib/components/ui/InfoCard.svelte';
	import Table from '$lib/components/ui/Table.svelte';
	import EmptyState from '$lib/components/ui/EmptyState.svelte';
	import StatusBadge from '$lib/components/ui/StatusBadge.svelte';
	import Badge from '$lib/components/ui/Badge.svelte';
	import { EntityIdentity } from '$lib/components/ui/entity';
	import { formatDateShortYear } from '$lib/utils/format';
	import { getStaffInstructors } from '$lib/remote/instructors.remote';
	import GrantInstructorAction from './GrantInstructorAction.svelte';
	import ReviewApplicationActions from './ReviewApplicationActions.svelte';
	import EndGrantActions from './EndGrantActions.svelte';

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
</script>

<PageHeader title="Instructors" subtitle="Who teaches in the practice room">
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
								<td class="cell-primary"><EntityIdentity ref={row.member} /></td>
								<td>
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

			<InfoCard title="Teaching here">
				{#if active.length === 0}
					<EmptyState
						description="Nobody has teaching status yet. Grant it to a member you know, or wait for an application."
					/>
				{:else}
					<Table>
						{#snippet head()}
							<th>Member</th>
							<th>Teaches</th>
							<th class="w-px">Students</th>
							<th class="col-support whitespace-nowrap">Since</th>
							<th class="w-px"><span class="sr-only">Actions</span></th>
						{/snippet}
						{#each active as row (row.id)}
							<tr>
								<td class="cell-primary"><EntityIdentity ref={row.member} /></td>
								<td>{row.headline ?? '—'}</td>
								<td class="w-px">
									<!--
										The instructor's own switch, not a staff one: "my book is
										full this term" and "CMC has suspended my terms" are opposite
										facts, and only the second is staff's to set.
									-->
									<Badge variant={row.acceptingStudents ? 'success' : 'ghost'}>
										{row.acceptingStudents ? 'Accepting' : 'Full'}
									</Badge>
								</td>
								<td class="col-support whitespace-nowrap">
									{row.grantedAt ? formatDateShortYear(row.grantedAt) : '—'}
								</td>
								<td class="w-px"><EndGrantActions id={row.id} name={row.member.title} /></td>
							</tr>
						{/each}
					</Table>
				{/if}
			</InfoCard>

			{#if resolved.length > 0}
				<InfoCard title="Not currently teaching">
					<Table>
						{#snippet head()}
							<th class="w-px"><span class="sr-only">Status</span></th>
							<th>Member</th>
							<th>Why</th>
							<th class="col-support whitespace-nowrap">Applied</th>
						{/snippet}
						{#each resolved as row (row.id)}
							<tr>
								<td class="w-px"><StatusBadge status={row.status} /></td>
								<td class="cell-primary"><EntityIdentity ref={row.member} /></td>
								<!--
									`reviewNotes` is what the member was told; `statusNote` is what
									staff told each other. Both end up here, and which one is set
									says which happened.
								-->
								<td class="text-subtle">{row.reviewNotes ?? row.statusNote ?? '—'}</td>
								<td class="col-support whitespace-nowrap">
									{formatDateShortYear(row.createdAt)}
								</td>
							</tr>
						{/each}
					</Table>
				</InfoCard>
			{/if}
		{/await}
	</svelte:boundary>
</PageContent>
