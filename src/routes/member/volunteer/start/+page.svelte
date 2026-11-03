<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	/**
	 * Step one of volunteer onboarding: who you are, and whether you're 18.
	 *
	 * The age question is why this is a gate rather than a nudge — the collective
	 * owes minors a different process, so the answer has to be on file before
	 * anybody claims a shift. Answering "no" ends here and hands off to staff.
	 *
	 * Reaching this page with a profile already saved redirects back out; the
	 * check lives in getVolunteerStartStep, not here.
	 */
	import PageHeader from '$lib/components/ui/PageHeader.svelte';
	import PageContent from '$lib/components/ui/PageContent.svelte';
	import InfoCard from '$lib/components/ui/InfoCard.svelte';
	import Form, { SubmitButton } from '$lib/components/ui/Form';
	import FormField from '$lib/components/ui/Form/FormField.svelte';
	import ProfileFields from '$lib/components/volunteer/ProfileFields.svelte';
	import { getVolunteerStartStep, startVolunteerOnboarding } from '$lib/remote/volunteer.remote';

	let step = $derived(getVolunteerStartStep());
</script>

<PageHeader
	width="md"
	title={m.member_volunteer_start_volunteer_with_cmc()}
	subtitle={m.member_volunteering()}
	documentTitle={m.member_volunteer_sign_up()}
/>

<PageContent width="md">
	{#await step then me}
		<InfoCard title={m.member_volunteer_start_about()}>
			<p class="text-sm text-base-content/70">{m.member_volunteer_start_asked_once()}</p>

			<Form remote={startVolunteerOnboarding}>
				<ProfileFields
					fields={startVolunteerOnboarding.fields}
					firstName={me.firstName}
					lastName={me.lastName}
					pronouns={me.pronouns}
					phone={me.phone}
					email={me.email}
				/>

				<!--
					A select, not a checkbox. An unticked checkbox submits nothing, so
					"I'm under 18" and "I skipped this" would arrive identically — and
					either default is wrong for somebody.
				-->
				<FormField
					field={startVolunteerOnboarding.fields.isAdult}
					type="select"
					label={m.member_volunteer_start_18_older()}
					placeholder={m.member_volunteer_start_placeholder()}
					options={[
						{ value: 'yes', label: m.member_volunteer_start_yes_i_am_18_older() },
						{ value: 'no', label: m.member_volunteer_start_no_i_am_under_18() }
					]}
					description={m.member_volunteer_start_description()}
				/>

				<SubmitButton label={m.member_volunteer_start_continue()} variant="primary" />
			</Form>
		</InfoCard>
	{/await}
</PageContent>
