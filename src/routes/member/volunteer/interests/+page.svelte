<script lang="ts">
	import Button from '$lib/components/ui/Button.svelte';
	/**
	 * Step two: what you'd like to help with.
	 *
	 * Asked once here so the shift board arrives already ordered around it, then
	 * reachable forever after from the Interests button on /member/volunteer. It
	 * is skippable — the profile already exists by this point, so the gate on
	 * /member/volunteer passes either way, and somebody whose thing isn't in the
	 * catalogue must not be stuck on this page.
	 */
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import PageHeader from '$lib/components/ui/PageHeader.svelte';
	import PageContent from '$lib/components/ui/PageContent.svelte';
	import InfoCard from '$lib/components/ui/InfoCard.svelte';
	import Form, { SubmitButton } from '$lib/components/ui/Form';
	import InterestFields from '$lib/components/volunteer/InterestFields.svelte';
	import { getVolunteerInterestsPage, saveVolunteerInterests } from '$lib/remote/volunteer.remote';

	// One query rather than three; the `{#await}` below now waits on a single promise.
	const pageData = $derived(getVolunteerInterestsPage());
</script>

<PageHeader
	title="Select the roles you'd take"
	subtitle="Volunteering"
	backHref="/member/volunteer"
/>

<PageContent width="md">
	{#await pageData then { step: me, roles: roleOptions, interests: myInterests }}
		{@const onboarding = myInterests.length === 0}
		<InfoCard title={onboarding ? 'Pick anything that sounds like you' : 'Your roles'}>
			{#if roleOptions.length === 0}
				<p class="text-muted">
					No volunteer roles are open right now. Get in touch and we'll find you something.
				</p>
				<a href={resolve('/member/volunteer')} class="link text-sm">Go to volunteering</a>
			{:else}
				<!--
					Onboarding sends them on to the board, because that is the next step
					of a flow. Editing stays put: somebody who came here to add a role
					has not asked to leave.
				-->
				<Form
					remote={saveVolunteerInterests}
					onsuccess={onboarding ? () => goto(resolve('/member/volunteer')) : undefined}
					successToast="Saved. Staff see this when they're looking for people."
				>
					<InterestFields
						fields={saveVolunteerInterests.fields}
						{roleOptions}
						selected={myInterests}
						availability={me.availability}
					/>

					<div class="flex items-center justify-between gap-3">
						<Button href={resolve('/member/volunteer')} variant="ghost" size="sm">
							{onboarding ? 'Skip' : 'Back'}
						</Button>
						<!-- Disabled until something changes, and it says "Saved" after —
						     which is what makes a page you can leave open feel settled. -->
						<SubmitButton
							label={onboarding ? 'Finish' : 'Save'}
							successLabel="Saved"
							variant="primary"
						/>
					</div>
				</Form>
			{/if}
		</InfoCard>
	{/await}
</PageContent>
