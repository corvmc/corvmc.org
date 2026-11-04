<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import { getUserInstructor } from '#lib/remote/instructors.remote.js';
	import { RelatedList } from '#lib/components/ui/entity/index.js';
	import EmptyState from '#lib/components/ui/EmptyState.svelte';
	import StatusBadge from '#lib/components/ui/StatusBadge.svelte';
	import DefinitionList from '#lib/components/ui/DefinitionList/DefinitionList.svelte';
	import Fact from '#lib/components/ui/DefinitionList/Fact.svelte';
	import { formatDateShortYear } from '#lib/utils/format.js';
	import ReviewApplicationActions from '../../instructors/ReviewApplicationActions.svelte';

	/**
	 * This member's teaching status. A pending application is reviewed here as
	 * well as on the Instructors view's rows; pausing and retiring stay there.
	 */
	let { id, name }: { id: string; name: string } = $props();
</script>

<RelatedList
	title={m.staff_members_id_panels_instructor_panel_teaching()}
	result={getUserInstructor(id)}
>
	{#snippet children(instructor)}
		{#if !instructor}
			<EmptyState title={m.staff_members_id_panels_instructor_panel_not_instructor()} />
		{:else}
			<DefinitionList>
				<Fact label={m.staff_status()}><StatusBadge status={instructor.status} /></Fact>
				{#if instructor.headline}
					<Fact label={m.staff_teaches()}>{instructor.headline}</Fact>
				{/if}
				<Fact label={m.staff_members_id_panels_instructor_panel_applied()}
					>{formatDateShortYear(instructor.createdAt)}</Fact
				>
				{#if instructor.status === 'requested' && instructor.applicationNote}
					<Fact label={m.staff_members_id_panels_instructor_panel_application()} wrap>
						<span class="whitespace-pre-line">{instructor.applicationNote}</span>
					</Fact>
				{/if}
				{#if instructor.grantedAt}
					<Fact label={m.staff_members_id_panels_instructor_panel_granted()}
						>{formatDateShortYear(instructor.grantedAt)}</Fact
					>
				{/if}
				{#if instructor.status === 'active'}
					<Fact label={m.staff_students()}>
						{instructor.acceptingStudents
							? m.staff_accepting()
							: m.staff_members_id_panels_instructor_panel_not_accepting()}
					</Fact>
				{/if}
				{#if instructor.reviewNotes}
					<!-- What the member was told, as opposed to statusNote below, which
					     is what staff told each other. -->
					<Fact label={m.staff_rejected()}>{instructor.reviewNotes}</Fact>
				{/if}
				{#if instructor.statusNote}
					<Fact label={m.staff_members_id_panels_instructor_panel_staff_note()}
						>{instructor.statusNote}</Fact
					>
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
