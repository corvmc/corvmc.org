<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	import InfoCard from '$lib/components/ui/InfoCard.svelte';
	import Alert from '$lib/components/ui/Alert.svelte';
	import StatusBadge from '$lib/components/ui/StatusBadge.svelte';
	import Form from '$lib/components/ui/Form/Form.svelte';
	import FormField from '$lib/components/ui/Form/FormField.svelte';
	import SubmitButton from '$lib/components/ui/Form/SubmitButton.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import { resolve } from '$app/paths';
	import {
		applyToTeach,
		updateInstructorListing,
		withdrawApplication,
		setAcceptingStudents
	} from '$lib/remote/instructors.remote';
	import type { Instructor } from '$lib/server/db/schema/instructor';

	/**
	 * Teaching, on the member's own profile — one card with five states. Only the
	 * first application has a page of its own (`/member/profile/teaching/apply`); after
	 * that the relationship is *book the room* and *keep my listing current*, and
	 * neither is workspace-shaped.
	 *
	 * **Takes plain props and never awaits.** The page resolves the data, because
	 * a top-level await here would mark every later declaration blocked and turn
	 * each `fields` expression in the template into an async derived — the churn
	 * behind the `effect_update_depth_exceeded` crash this page already carries a
	 * comment about.
	 */
	let {
		instructor,
		hasPublicContact,
		hasAnyContact
	}: {
		instructor: Instructor | null;
		hasPublicContact: boolean;
		hasAnyContact: boolean;
	} = $props();

	const applyFields = applyToTeach.fields;
	const editFields = updateInstructorListing.fields;
	const acceptFields = setAcceptingStudents.fields;

	const isApplication = $derived(
		instructor?.status === 'requested' || instructor?.status === 'rejected'
	);
</script>

<InfoCard title={m.member_profile_teaching_card_title()}>
	{#if !instructor}
		<p class="mb-4 text-subtle">
			{m.member_profile_teaching_card_teach_here_can_book_room()}
		</p>

		<!-- A link to its own page, not an embedded form: new members submitted
		     the blank form while working down their profile (#1820). -->
		<Button href={resolve('/member/profile/teaching/apply')} size="sm"
			>{m.member_apply_teach()}</Button
		>
	{:else}
		<div class="mb-4 flex items-center gap-2">
			<StatusBadge status={instructor.status} />
			{#if instructor.status === 'requested'}
				<span class="text-subtle text-sm"
					>{m.member_profile_teaching_card_staff_will_take_look()}</span
				>
			{/if}
		</div>

		{#if instructor.status === 'rejected' && instructor.reviewNotes}
			<!-- Handed back, not refused. Stored rather than only emailed because
			     they cannot fix what they cannot see. -->
			<Alert type="warning" class="mb-4">
				<p class="font-semibold">{m.member_profile_teaching_card_staff_asked_change()}</p>
				<p class="whitespace-pre-line">{instructor.reviewNotes}</p>
				<p class="mt-2 text-sm">{m.member_profile_teaching_card_edit_below_send_back_nothing()}</p>
			</Alert>
		{/if}

		{#if instructor.status === 'active' && !hasPublicContact}
			<!-- An instructor listing nobody can contact is the feature failing at
			     its one job, and the member is the only person who can fix it. We
			     never publish a members-only contact on their behalf. -->
			<Alert type="warning" class="mb-4">
				{#if hasAnyContact}
					{m.member_profile_teaching_card_contact_details_members_only_so()}
				{:else}
					{m.member_profile_teaching_card_have_no_contact_details_so()}
				{/if}
			</Alert>
		{/if}

		{#if instructor.status === 'active' || isApplication}
			<Form remote={isApplication ? applyToTeach : updateInstructorListing}>
				{@const f = isApplication ? applyFields : editFields}
				<FormField
					field={f.headline}
					label={m.member_what_do_teach()}
					value={instructor.headline}
					required={isApplication}
				/>
				<FormField
					field={f.blurb}
					label={m.member_about_teaching()}
					type="textarea"
					value={instructor.blurb}
					required={isApplication}
				/>
				<FormField
					field={f.ratesNote}
					label={m.member_profile_teaching_card_rates()}
					value={instructor.ratesNote}
				/>
				<FormField
					field={f.bookingUrl}
					label={m.member_profile_teaching_card_where_students_book()}
					value={instructor.bookingUrl}
				/>
				{#if isApplication}
					<FormField
						field={applyFields.applicationNote}
						label={m.member_anything_staff_should_know_not()}
						type="textarea"
						value={instructor.applicationNote}
					/>
				{/if}
				<SubmitButton
					>{isApplication
						? m.member_profile_teaching_card_send_review()
						: m.member_profile_teaching_card_save_listing()}</SubmitButton
				>
			</Form>
		{/if}

		{#if instructor.status === 'active'}
			<Form remote={setAcceptingStudents} class="mt-4">
				<input
					{...acceptFields.accepting.as('hidden', instructor.acceptingStudents ? 'false' : 'true')}
				/>
				<SubmitButton variant="ghost">
					{instructor.acceptingStudents
						? m.member_profile_teaching_card_stop_taking_new_students()
						: m.member_profile_teaching_card_take_new_students_again()}
				</SubmitButton>
			</Form>
		{/if}

		{#if isApplication}
			<Form remote={withdrawApplication} class="mt-4">
				<SubmitButton variant="ghost"
					>{m.member_profile_teaching_card_withdraw_application()}</SubmitButton
				>
			</Form>
		{/if}

		{#if instructor.status === 'paused' || instructor.status === 'retired'}
			<p class="text-subtle">
				{m.member_profile_teaching_card_teaching_status_set_by_staff()}
			</p>
		{/if}
	{/if}
</InfoCard>
