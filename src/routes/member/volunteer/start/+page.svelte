<script lang="ts">
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
	import PageHeader from '$lib/components/shared/PageHeader.svelte';
	import PageContent from '$lib/components/shared/PageContent.svelte';
	import InfoCard from '$lib/components/shared/InfoCard.svelte';
	import Form, { SubmitButton } from '$lib/components/shared/Form';
	import FormField from '$lib/components/shared/Form/FormField.svelte';
	import ProfileFields from '$lib/components/shared/volunteer/ProfileFields.svelte';
	import { getVolunteerStartStep, startVolunteerOnboarding } from '$lib/remote/volunteer.remote';

	let step = $derived(getVolunteerStartStep());
</script>

<PageHeader title="Volunteer with CMC" subtitle="Volunteering" documentTitle="Volunteer sign-up" />

<PageContent width="md">
	{#await step then me}
		<InfoCard title="About you">
			<p class="text-sm text-base-content/70">
				A few details so we know who's on a shift and how to reach you. This is a one-time thing.
			</p>

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
					label="Are you 18 or older?"
					placeholder="Select one"
					options={[
						{ value: 'yes', label: 'Yes, I am 18 or older' },
						{ value: 'no', label: 'No, I am under 18' }
					]}
					description="Under-18 volunteers are welcome — we just need to set things up with you first."
				/>

				<SubmitButton label="Continue" variant="primary" />
			</Form>
		</InfoCard>
	{/await}
</PageContent>
