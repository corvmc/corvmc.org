<script lang="ts">
	import Button from '$lib/components/shared/Button.svelte';
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
	import PageHeader from '$lib/components/shared/PageHeader.svelte';
	import PageContent from '$lib/components/shared/PageContent.svelte';
	import InfoCard from '$lib/components/shared/InfoCard.svelte';
	import Form, { SubmitButton } from '$lib/components/shared/Form';
	import InterestFields from '$lib/components/shared/volunteer/InterestFields.svelte';
	import {
		getActiveVolunteerRoles,
		getMyVolunteerInterests,
		getVolunteerInterestsStep,
		saveVolunteerInterests
	} from '$lib/remote/volunteer.remote';

	let step = $derived(getVolunteerInterestsStep());
	let roles = $derived(getActiveVolunteerRoles());
	let interests = $derived(getMyVolunteerInterests());
</script>

<PageHeader title="What would you like to help with?" subtitle="Volunteering" />

<PageContent width="md">
	{#await Promise.all([step, roles, interests]) then [me, roleOptions, myInterests]}
		<InfoCard title="Pick anything that sounds like you">
			{#if roleOptions.length === 0}
				<p class="text-muted">
					No volunteer roles are open right now. Get in touch and we'll find you something.
				</p>
				<a href={resolve('/member/volunteer')} class="link text-sm">Go to volunteering</a>
			{:else}
				<Form
					remote={saveVolunteerInterests}
					onsuccess={() => goto(resolve('/member/volunteer'))}
					successToast="Saved — we'll be in touch"
				>
					<InterestFields
						fields={saveVolunteerInterests.fields}
						{roleOptions}
						selected={myInterests}
						availability={me.availability}
					/>

					<div class="flex items-center justify-between gap-3">
						<Button href={resolve('/member/volunteer')} variant="ghost" size="sm"
							>Skip for now</Button
						>
						<SubmitButton label="Finish" variant="primary" />
					</div>
				</Form>
			{/if}
		</InfoCard>
	{/await}
</PageContent>
