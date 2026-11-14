<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import Action from '#lib/components/ui/Action.svelte';
	import FormField from '#lib/components/ui/Form/FormField.svelte';
	import Alert from '#lib/components/ui/Alert.svelte';
	import DefinitionList from '#lib/components/ui/DefinitionList/DefinitionList.svelte';
	import InstructorListingFacts from './InstructorListingFacts.svelte';
	import type { InstructorListingView } from './listing';
	import { approveInstructor, sendBackInstructor } from '#lib/remote/instructors.remote.js';
	import { refreshAll } from '$app/navigation';

	/**
	 * The two ways an application leaves the queue.
	 *
	 * "Return" sends it back; it is not final and not an appealable decision: the
	 * member edits their listing and resubmits, and `reviewNotes` is stored rather
	 * than only emailed because they cannot fix what they cannot see.
	 */
	let { id, name, listing }: { id: string; name: string; listing: InstructorListingView } =
		$props();

	// Approving publishes the listing, so the modal shows it and says where it
	// will not appear (#2805, #2806).
	const reachWarning = $derived(
		{
			public: null,
			members: m.staff_members_instructors_reach_members_body(),
			hidden: m.staff_members_instructors_reach_hidden_body(),
			missing: m.staff_members_instructors_reach_missing_body()
		}[listing.directoryReach]
	);

	const sendBackFields = sendBackInstructor.fields;
	const approveFields = approveInstructor.fields;
</script>

<div class="flex w-max gap-2">
	<Action
		action={sendBackInstructor}
		label={m.staff_return_label()}
		modalTitle={m.staff_members_instructors_review_application_actions_return_title({ name })}
		submitLabel={m.staff_return_label()}
		successToast={m.staff_returned_toast()}
		variant="ghost"
		size="sm"
		onsuccess={() => refreshAll()}
	>
		{#snippet form()}
			<div class="space-y-4">
				<input {...sendBackFields.id.as('hidden', id)} />
				<FormField
					field={sendBackFields.note}
					label={m.staff_members_instructors_review_application_actions_what_ne_label()}
					type="textarea"
					required
				/>
				<p class="text-subtle">
					{m.staff_members_instructors_review_application_actions_they_se_text()}
				</p>
			</div>
		{/snippet}
	</Action>

	<Action
		action={approveInstructor}
		label={m.staff_approve_label()}
		modalTitle={m.staff_members_instructors_review_application_actions_approve_title({ name })}
		data-testid="approve-instructor"
		submitLabel={m.staff_approve_label()}
		successToast={m.staff_approved_toast()}
		variant="primary"
		size="sm"
		onsuccess={() => refreshAll()}
	>
		{#snippet form()}
			<div class="space-y-4">
				<input {...approveFields.id.as('hidden', id)} />
				<DefinitionList>
					<InstructorListingFacts {listing} />
				</DefinitionList>
				{#if reachWarning}
					<Alert type="warning">{reachWarning}</Alert>
				{/if}
				<p class="text-subtle">
					{m.staff_members_instructors_review_application_actions_their_l_text()}
				</p>
			</div>
		{/snippet}
	</Action>
</div>
