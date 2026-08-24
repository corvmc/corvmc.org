<script lang="ts">
	import Button from '$lib/components/shared/Button.svelte';
	/**
	 * Where an under-18 sign-up lands.
	 *
	 * Deliberately terminal: no form, no retry, no way to re-answer the age
	 * question. Volunteering with minors involves paperwork and a conversation
	 * that doesn't belong in a web form, so this hands off to a person — and
	 * staff clear them from /staff/volunteer, which is the only route back.
	 *
	 * The tone matters. They answered honestly and the app is telling them to
	 * wait; nothing here should read as a rejection.
	 */
	import { resolve } from '$app/paths';
	import PageHeader from '$lib/components/shared/PageHeader.svelte';
	import PageContent from '$lib/components/shared/PageContent.svelte';
	import InfoCard from '$lib/components/shared/InfoCard.svelte';
	import { getVolunteerBlockedNotice } from '$lib/remote/volunteer.remote';

	let notice = $derived(getVolunteerBlockedNotice());
</script>

<PageHeader title="Almost there" subtitle="Volunteering" documentTitle="Volunteer sign-up" />

<PageContent width="md">
	{#await notice then me}
		<InfoCard title="We'll be in touch, {me.firstName}">
			<p class="text-sm">
				Thanks for signing up — we'd love to have you. Because you're under 18 there's a bit of
				paperwork to sort out first, including a guardian's sign-off, so a staff member will get in
				touch to set it up.
			</p>
			<p class="text-sm">
				Nothing else is needed from you right now. Once that's done, volunteering opens up here
				automatically.
			</p>
			<div class="flex flex-wrap gap-2 pt-2">
				<Button href={resolve('/contact')} variant="primary" size="sm">Get in touch</Button>
				<Button href={resolve('/member')} variant="ghost" size="sm">Back to dashboard</Button>
			</div>
		</InfoCard>
	{/await}
</PageContent>
