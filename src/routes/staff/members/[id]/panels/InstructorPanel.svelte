<script lang="ts">
	import { getUserInstructor } from '$lib/remote/instructors.remote';
	import { RelatedList } from '$lib/components/ui/entity';
	import EmptyState from '$lib/components/ui/EmptyState.svelte';
	import StatusBadge from '$lib/components/ui/StatusBadge.svelte';
	import DefinitionList from '$lib/components/ui/DefinitionList/DefinitionList.svelte';
	import Fact from '$lib/components/ui/DefinitionList/Fact.svelte';
	import { formatDateShortYear } from '$lib/utils/format';
	import ReviewApplicationActions from '../../instructors/ReviewApplicationActions.svelte';

	/**
	 * This member's teaching status. A pending application is reviewed here as
	 * well as on the Instructors view's rows; pausing and retiring stay there.
	 */
	let { id, name }: { id: string; name: string } = $props();
</script>

<RelatedList title="Teaching" result={getUserInstructor(id)}>
	{#snippet children(instructor)}
		{#if !instructor}
			<EmptyState title="Not an instructor" />
		{:else}
			<DefinitionList>
				<Fact label="Status"><StatusBadge status={instructor.status} /></Fact>
				{#if instructor.headline}
					<Fact label="Teaches">{instructor.headline}</Fact>
				{/if}
				<Fact label="Applied">{formatDateShortYear(instructor.createdAt)}</Fact>
				{#if instructor.status === 'requested' && instructor.applicationNote}
					<Fact label="Application" wrap>
						<span class="whitespace-pre-line">{instructor.applicationNote}</span>
					</Fact>
				{/if}
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
					<Fact label="Rejected">{instructor.reviewNotes}</Fact>
				{/if}
				{#if instructor.statusNote}
					<Fact label="Staff note">{instructor.statusNote}</Fact>
				{/if}
			</DefinitionList>

			{#if instructor.status === 'requested'}
				<div class="mt-3">
					<ReviewApplicationActions id={instructor.id} {name} />
				</div>
			{/if}
		{/if}
	{/snippet}
</RelatedList>
