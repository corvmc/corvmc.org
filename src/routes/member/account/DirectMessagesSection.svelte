<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	import InfoCard from '$lib/components/ui/InfoCard.svelte';
	import Alert from '$lib/components/ui/Alert.svelte';
	import AppealPanel from '$lib/components/moderation/AppealPanel.svelte';
	import { ADULT_AGE_YEARS } from '$lib/utils/age';
	import Form from '$lib/components/ui/Form/Form.svelte';
	import SubmitButton from '$lib/components/ui/Form/SubmitButton.svelte';
	import {
		getMyMessagingSettings,
		setMyMessaging,
		unblockMember
	} from '$lib/remote/direct-messages.remote';

	/**
	 * The account page's Direct Messages card, owning its own query.
	 *
	 * Two separate things shown together on purpose: the standing is staff's restriction and
	 * read-only, the switch below it is the member's own. Both come from one query now — the page
	 * was reading them as two `{@const await}`s, which is two remote queries in flight there.
	 * Its boundary is on the account page: one inside this file could not catch the `await` above.
	 */
	const settings = $derived(await getMyMessagingSettings());
	const messaging = $derived(settings.standing);
	const blocks = $derived(settings.blocks);
</script>

<InfoCard title={m.member_account_direct_messages_section_title()}>
	<!-- Three separate things, shown together on purpose. Age is a fact and
	     lifts itself; the restriction is staff's and read-only; the switch
	     below is the member's own and always theirs to set. Toggling the
	     switch never lifts either of the others — they are different tables,
	     and one of them is not a table at all. -->
	{#if messaging.ageRestricted}
		<!-- Deliberately not an Alert with a reason and a "contact staff" line.
		     Nobody judged this member and there is nothing for them to appeal;
		     before #556 they were shown a moderation notice about their own
		     date of birth. -->
		<Alert type="info">
			{m.member_account_direct_messages_section_direct_messages_open({ ADULT_AGE_YEARS })}
		</Alert>
	{:else if messaging.standing.status !== 'none'}
		<Alert type="warning">
			{messaging.standing.status === 'disabled'
				? m.member_account_direct_messages_section_direct_messaging_swit()
				: m.member_account_direct_messages_section_cannot_start_new_conv()}
			{#if messaging.standing.reason}
				<span class="mt-1 block opacity-80">{messaging.standing.reason}</span>
			{/if}
			<AppealPanel target={{ kind: 'standing', scope: 'messaging' }}>
				{#snippet fallback()}
					<span class="mt-1 block text-muted">
						{m.member_account_direct_messages_section_contact_staff_if_thin()}
					</span>
				{/snippet}
			</AppealPanel>
		</Alert>
	{/if}
	<p class="mt-3 mb-3 text-muted">
		{m.member_account_direct_messages_section_when_other_members_ca()}
	</p>
	<Form
		remote={setMyMessaging}
		successToast={m.member_saved()}
		class="flex items-center justify-between gap-4"
	>
		<span class="font-medium"
			>{m.member_account_direct_messages_section_allow_direct_messages()}</span
		>
		<input
			{...setMyMessaging.fields.enabled.as(
				'hidden',
				messaging.acceptsDirectMessages ? 'off' : 'on'
			)}
		/>
		<SubmitButton
			label={messaging.acceptsDirectMessages
				? m.member_account_direct_messages_section_turn_off()
				: m.member_account_direct_messages_section_turn()}
			variant={messaging.acceptsDirectMessages ? 'default' : 'primary'}
			outline={messaging.acceptsDirectMessages}
			size="sm"
		/>
	</Form>

	<!--
		Blocking has been reachable from a conversation since DMs shipped, and
		unblocking has not been reachable from anywhere. That matters more than
		it sounds: declining a request blocks the sender too, so this list fills
		up with people the member never consciously chose to block.
	-->
	{#if blocks.length > 0}
		<div class="mt-4 border-t border-base-300 pt-4">
			<h3 class="mb-2 font-medium">{m.member_account_direct_messages_section_blocked_members()}</h3>
			<p class="mb-3 text-muted text-sm">
				{m.member_account_direct_messages_section_neither_can_write_oth()}
			</p>
			<ul class="flex flex-col gap-1">
				{#each blocks as blocked (blocked.userId)}
					<li class="flex items-center justify-between gap-3 py-1">
						<span class="min-w-0">
							<span class="truncate font-medium">{blocked.name}</span>
							{#if blocked.source === 'declined_request'}
								<span class="ml-2 text-subtle text-xs"
									>{m.member_account_direct_messages_section_from_declined_request()}</span
								>
							{:else if blocked.source === 'reported'}
								<span class="ml-2 text-subtle text-xs"
									>{m.member_account_direct_messages_section_from_report()}</span
								>
							{/if}
						</span>
						<Form
							remote={unblockMember}
							successToast={m.member_account_direct_messages_section_unblocked()}
						>
							<input {...unblockMember.fields.userId.as('hidden', blocked.userId)} />
							<SubmitButton
								label={m.member_account_direct_messages_section_unblock()}
								variant="ghost"
								size="sm"
							/>
						</Form>
					</li>
				{/each}
			</ul>
		</div>
	{/if}
</InfoCard>
