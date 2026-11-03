<script lang="ts">
	import { Latest } from '$lib/latest.svelte';
	import { isRedirect } from '@sveltejs/kit';
	import { m } from '$lib/paraglide/messages.js';
	import Button from '$lib/components/ui/Button.svelte';
	/**
	 * Step two: what you'd like to help with.
	 *
	 * Asked once here so the shift board arrives already ordered around it, then
	 * edited from /member/volunteer/profile. It
	 * is skippable — the profile already exists by this point, so the gate on
	 * /member/volunteer passes either way, and somebody whose thing isn't in the
	 * catalogue must not be stuck on this page.
	 */
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import PageHeader from '$lib/components/ui/PageHeader.svelte';
	import PageContent from '$lib/components/ui/PageContent.svelte';
	import Card from '$lib/components/ui/Card/Card.svelte';
	import CardBody from '$lib/components/ui/Card/CardBody.svelte';
	import Form, { SubmitButton } from '$lib/components/ui/Form';
	import InterestFields from '$lib/components/volunteer/InterestFields.svelte';
	import { getVolunteerInterestsPage, saveVolunteerInterests } from '$lib/remote/volunteer.remote';

	// One query rather than three. Not `{#await}`: a refresh would re-pend it and
	// remount the form mid-edit.
	const pageData = new Latest(() => getVolunteerInterestsPage());
	// A gate's redirect has already navigated by the time it rejects; rethrowing
	// it would flash the error boundary on the way out.
	$effect(() => {
		if (pageData.error && !isRedirect(pageData.error.e)) throw pageData.error.e;
	});

	// Latched from the first load: saving refreshes the query, and a recomputed
	// `onboarding` reads false by the time `onsuccess` runs, so it never moved on.
	let latched = $state<boolean>();
	const onboarding = $derived(latched ?? pageData.current?.interests.length === 0);
	$effect(() => {
		if (pageData.current && latched === undefined)
			latched = pageData.current.interests.length === 0;
	});
</script>

<PageHeader width="md" title={m.member_preferred_roles()} subtitle={m.member_volunteering()} />

<PageContent width="md">
	{#if pageData.current}
		{@const { step: me, roles: roleOptions, interests: myInterests } = pageData.current}
		<Card>
			<CardBody>
				{#if roleOptions.length === 0}
					<p class="text-muted">
						{m.member_volunteer_interests_no_volunteer_roles_open_right()}
					</p>
					<a href={resolve('/member/volunteer')} class="link text-sm"
						>{m.member_volunteer_interests_go_volunteering()}</a
					>
				{:else}
					<!--
					Onboarding sends them on to the board, because that is the next step
					of a flow. Editing stays put: somebody who came here to add a role
					has not asked to leave.
				-->
					<Form
						remote={saveVolunteerInterests}
						onsuccess={onboarding ? () => goto(resolve('/member/volunteer')) : undefined}
						successToast={m.member_volunteer_interests_success_toast()}
					>
						<InterestFields
							fields={saveVolunteerInterests.fields}
							{roleOptions}
							selected={myInterests}
							availability={me.availability}
						/>

						<div class="flex items-center justify-between gap-3">
							<Button href={resolve('/member/volunteer')} variant="ghost" size="sm">
								{onboarding
									? m.member_volunteer_interests_skip()
									: m.member_volunteer_interests_back()}
							</Button>
							<!-- Disabled until something changes, and it says "Saved" after —
						     which is what makes a page you can leave open feel settled. -->
							<SubmitButton
								label={onboarding ? m.member_volunteer_interests_finish() : m.member_save()}
								successLabel={m.member_saved()}
								variant="primary"
							/>
						</div>
					</Form>
				{/if}
			</CardBody>
		</Card>
	{/if}
</PageContent>
