<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import PageHeader from '#lib/components/ui/PageHeader.svelte';
	import PageContent from '#lib/components/ui/PageContent.svelte';
	import InfoCard from '#lib/components/ui/InfoCard.svelte';
	import Form from '#lib/components/ui/Form/Form.svelte';
	import FormField from '#lib/components/ui/Form/FormField.svelte';
	import SubmitButton from '#lib/components/ui/Form/SubmitButton.svelte';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { applyToTeach } from '#lib/remote/instructors.remote.js';

	// Its own page, not a card on the profile, so applying is a step a member
	// takes on purpose (#1820). Nothing here awaits: a top-level await would
	// async-gate every `fields` expression below.
	const fields = applyToTeach.fields;
</script>

<PageHeader
	width="3xl"
	subtitle={m.member_profile_teaching_apply_subtitle_body()}
	title={m.member_apply_teach_title()}
/>
<PageContent width="3xl">
	<InfoCard title={m.member_profile_teaching_apply_application_title()}>
		<p class="mb-4 text-subtle">
			{m.member_profile_teaching_apply_teachers_book_room_at_member_text()}
		</p>

		<Form
			remote={applyToTeach}
			successToast={m.member_application_sent_toast()}
			onsuccess={() => goto(resolve('member/profile'))}
		>
			<FormField field={fields.headline} label={m.member_what_do_teach_label()} required />
			<FormField
				field={fields.blurb}
				label={m.member_about_teaching_label()}
				type="textarea"
				required
			/>
			<FormField
				field={fields.ratesNote}
				label={m.member_profile_teaching_apply_rates_shown_as_written_label()}
			/>
			<FormField
				field={fields.bookingUrl}
				label={m.member_profile_teaching_apply_where_students_book_optional_label()}
			/>
			<FormField
				field={fields.applicationNote}
				label={m.member_anything_staff_should_know_not_label()}
				type="textarea"
			/>
			<SubmitButton>{m.member_send_application_label()}</SubmitButton>
		</Form>
	</InfoCard>
</PageContent>
