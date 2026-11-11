<script lang="ts">
	import { Latest } from '#lib/latest.svelte.js';
	import { isRedirect } from '@sveltejs/kit';
	import { m } from '#lib/paraglide/messages.js';
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
	import PageHeader from '#lib/components/ui/PageHeader.svelte';
	import PageContent from '#lib/components/ui/PageContent.svelte';
	import InfoCard from '#lib/components/ui/InfoCard.svelte';
	import Form, { SubmitButton } from '#lib/components/ui/Form/index.js';
	import FormField from '#lib/components/ui/Form/FormField.svelte';
	import ProfileFields from '#lib/components/volunteer/ProfileFields.svelte';
	import { getVolunteerStartStep, startVolunteerOnboarding } from '#lib/remote/volunteer.remote.js';

	// Not `{#await}`: a refresh would re-pend it and remount the form mid-entry.
	const step = new Latest(() => getVolunteerStartStep());
	// A gate's redirect has already navigated by the time it rejects; rethrowing
	// it would flash the error boundary on the way out.
	$effect(() => {
		if (step.error && !isRedirect(step.error.e)) throw step.error.e;
	});
</script>

<PageHeader
	width="md"
	title={m.member_volunteer_start_volunteer_with_cmc_title()}
	subtitle={m.member_volunteering_body()}
	documentTitle={m.member_volunteer_sign_up_title()}
/>

<PageContent width="md">
	{#if step.current}
		{@const me = step.current}
		<InfoCard title={m.member_volunteer_start_about_title()}>
			<p class="text-sm text-base-content/70">{m.member_volunteer_start_asked_once_text()}</p>

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
					label={m.member_volunteer_start_18_older_label()}
					placeholder={m.member_volunteer_start_placeholder()}
					options={[
						{ value: 'yes', label: m.member_volunteer_start_yes_i_am_18_older_label() },
						{ value: 'no', label: m.member_volunteer_start_no_i_am_under_18_label() }
					]}
					description={m.member_volunteer_start_description_body()}
				/>

				<SubmitButton label={m.member_volunteer_start_continue_label()} variant="primary" />
			</Form>
		</InfoCard>
	{/if}
</PageContent>
