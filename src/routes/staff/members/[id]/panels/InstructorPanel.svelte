<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import { getUserInstructor } from '#lib/remote/instructors.remote.js';
	import { RelatedList } from '#lib/components/ui/entity/index.js';
	import EmptyState from '#lib/components/ui/EmptyState.svelte';
	import StatusBadge from '#lib/components/ui/StatusBadge.svelte';
	import DefinitionList from '#lib/components/ui/DefinitionList/DefinitionList.svelte';
	import Fact from '#lib/components/ui/DefinitionList/Fact.svelte';
	import { formatDateShortYear } from '#lib/utils/format.js';
	import InstructorListingFacts from '../../instructors/InstructorListingFacts.svelte';
	import InstructorActions from '../../instructors/InstructorActions.svelte';

	/**
	 * This member's teaching status and the listing as it would publish, with
	 * the same controls the Teachers view's row offers for that status.
	 */
	let { id, name }: { id: string; name: string } = $props();
</script>

<RelatedList
	title={m.staff_members_id_panels_instructor_panel_teaching_title()}
	result={getUserInstructor(id)}
>
	{#snippet children(instructor)}
		{#if !instructor}
			<EmptyState title={m.staff_members_id_panels_instructor_panel_not_instructor_title()} />
		{:else}
			<DefinitionList>
				<Fact label={m.staff_status_label()}><StatusBadge status={instructor.status} /></Fact>
				<InstructorListingFacts listing={instructor} />
				<Fact label={m.staff_members_id_panels_instructor_panel_applied_label()}
					>{formatDateShortYear(instructor.createdAt)}</Fact
				>
				{#if instructor.status === 'requested' && instructor.applicationNote}
					<Fact label={m.staff_members_id_panels_instructor_panel_application_label()} wrap>
						<span class="whitespace-pre-line">{instructor.applicationNote}</span>
					</Fact>
				{/if}
				{#if instructor.grantedAt}
					<Fact label={m.staff_members_id_panels_instructor_panel_granted_label()}
						>{formatDateShortYear(instructor.grantedAt)}</Fact
					>
				{/if}
				{#if instructor.status === 'active'}
					<Fact label={m.staff_students_label()}>
						{instructor.acceptingStudents
							? m.staff_accepting_text()
							: m.staff_members_id_panels_instructor_panel_not_accepting_text()}
					</Fact>
				{/if}
				{#if instructor.reviewNotes}
					<!-- What the member was told, as opposed to statusNote below, which
					     is what staff told each other. -->
					<Fact label={m.staff_return_reason_label()}>{instructor.reviewNotes}</Fact>
				{/if}
				{#if instructor.statusNote}
					<Fact label={m.staff_members_id_panels_instructor_panel_staff_note_label()}
						>{instructor.statusNote}</Fact
					>
				{/if}
			</DefinitionList>

			<div class="mt-3">
				<InstructorActions record={instructor} {name} />
			</div>
		{/if}
	{/snippet}
</RelatedList>
