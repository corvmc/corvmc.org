<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import Button from '#lib/components/ui/Button.svelte';
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
	import PageHeader from '#lib/components/ui/PageHeader.svelte';
	import PageContent from '#lib/components/ui/PageContent.svelte';
	import InfoCard from '#lib/components/ui/InfoCard.svelte';
	import { getVolunteerBlockedNotice } from '#lib/remote/volunteer.remote.js';

	let notice = $derived(getVolunteerBlockedNotice());
</script>

<PageHeader
	width="md"
	title={m.member_volunteer_blocked_almost_there()}
	subtitle={m.member_volunteering()}
	documentTitle={m.member_volunteer_sign_up()}
/>

<PageContent width="md">
	{#await notice then me}
		<InfoCard
			title={m.member_volunteer_blocked_thanks_signing_up_one_thing({ firstName: me.firstName })}
		>
			<p class="text-sm">
				{m.member_volunteer_blocked_we_d_love_have_because()}
			</p>
			<p class="text-sm">
				{m.member_volunteer_blocked_nothing_chase_end_once_s()}
			</p>
			<div class="flex flex-wrap gap-2 pt-2">
				<Button href={resolve('/contact')} variant="primary" size="sm"
					>{m.member_volunteer_blocked_contact_staff()}</Button
				>
				<Button href={resolve('/member')} variant="ghost" size="sm"
					>{m.member_volunteer_blocked_back_dashboard()}</Button
				>
			</div>
		</InfoCard>
	{/await}
</PageContent>
