<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import Button from '#lib/components/ui/Button.svelte';
	/**
	 * Where an under-18 sign-up lands.
	 *
	 * Deliberately terminal: no form, no retry, no way to re-answer the age
	 * question. Volunteering with minors involves paperwork and a conversation
	 * that doesn't belong in a web form, so this hands off to a person — and
	 * staff clear them from Members → Volunteers, which is the only route back.
	 *
	 * The tone matters. They answered honestly and the app is telling them to
	 * wait; nothing here should read as a rejection.
	 */
	import { resolve } from '$app/paths';
	import PageHeader from '#lib/components/ui/PageHeader.svelte';
	import PageContent from '#lib/components/ui/PageContent.svelte';
	import InfoCard from '#lib/components/ui/InfoCard.svelte';
	import { getVolunteerBlockedNotice } from '#lib/remote/volunteer.remote.js';

	const me = $derived(await getVolunteerBlockedNotice());
</script>

<PageHeader
	width="md"
	title={m.member_volunteer_blocked_almost_there_title()}
	subtitle={m.member_volunteering_body()}
	documentTitle={m.member_volunteer_sign_up_title()}
/>

<PageContent width="md">
	<InfoCard
		title={m.member_volunteer_blocked_thanks_signing_up_one_thing_title({
			firstName: me.firstName
		})}
	>
		<p class="text-sm">
			{m.member_volunteer_blocked_we_d_love_have_because_text()}
		</p>
		<p class="text-sm">
			{m.member_volunteer_blocked_nothing_chase_end_once_s_text()}
		</p>
		<div class="flex flex-wrap gap-2 pt-2">
			<Button href={resolve('contact')} variant="primary" size="sm"
				>{m.member_volunteer_blocked_contact_staff_label()}</Button
			>
			<Button href={resolve('member')} variant="ghost" size="sm"
				>{m.member_volunteer_blocked_back_dashboard_label()}</Button
			>
		</div>
	</InfoCard>
</PageContent>
