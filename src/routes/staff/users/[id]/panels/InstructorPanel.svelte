<script lang="ts">
	import { getUserInstructor } from '$lib/remote/instructors.remote';
	import { RelatedList } from '$lib/components/ui/entity';
	import EmptyState from '$lib/components/ui/EmptyState.svelte';
	import StatusBadge from '$lib/components/ui/StatusBadge.svelte';
	import DefinitionList from '$lib/components/ui/DefinitionList/DefinitionList.svelte';
	import Fact from '$lib/components/ui/DefinitionList/Fact.svelte';
	import { formatDateShortYear } from '$lib/utils/format';

	/**
	 * This member's teaching status, on the **Space** tab rather than a ninth tab
	 * of its own — `tabs.ts` already says eight "outrun a phone even collapsed",
	 * and the grant is a right in the room, beside the bookings it produces.
	 *
	 * Read-only. Granting, pausing and retiring live at `/staff/instructors`,
	 * which is where the roster is and where the decision has its context; a
	 * second set of the same buttons here would be two places to look for one
	 * thing.
	 */
	let { id }: { id: string } = $props();
</script>

<RelatedList title="Teaching" result={getUserInstructor(id)}>
	{#snippet children(instructor)}
		{#if !instructor}
			<EmptyState
				title="Not an instructor"
				description="Grant teaching status from /staff/instructors if they teach here."
			/>
		{:else}
			<DefinitionList>
				<Fact label="Status"><StatusBadge status={instructor.status} /></Fact>
				{#if instructor.headline}
					<Fact label="Teaches">{instructor.headline}</Fact>
				{/if}
				<Fact label="Applied">{formatDateShortYear(instructor.createdAt)}</Fact>
				{#if instructor.grantedAt}
					<Fact label="Granted">{formatDateShortYear(instructor.grantedAt)}</Fact>
				{/if}
				{#if instructor.status === 'active'}
					<Fact label="Students">
						{instructor.acceptingStudents ? 'Accepting' : 'Not accepting'}
					</Fact>
				{/if}
				{#if instructor.reviewNotes}
					<!-- What the member was told, as opposed to statusNote below, which
					     is what staff told each other. -->
					<Fact label="Sent back">{instructor.reviewNotes}</Fact>
				{/if}
				{#if instructor.statusNote}
					<Fact label="Staff note">{instructor.statusNote}</Fact>
				{/if}
			</DefinitionList>

			{#if instructor.status !== 'active'}
				<p class="mt-3 text-subtle">
					Bookings they already hold are unaffected — ending a grant is a decision about the future,
					and a booked lesson has a student who has been told a time.
				</p>
			{/if}
		{/if}
	{/snippet}
</RelatedList>
