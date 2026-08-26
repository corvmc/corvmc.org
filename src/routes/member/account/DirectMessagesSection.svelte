<script lang="ts">
	import InfoCard from '$lib/components/shared/InfoCard.svelte';
	import Alert from '$lib/components/shared/Alert.svelte';
	import Form from '$lib/components/shared/Form/Form.svelte';
	import SubmitButton from '$lib/components/shared/Form/SubmitButton.svelte';
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
	 * It keeps its own boundary, which is why this is a component and not a composed page query.
	 */
	const settings = $derived(await getMyMessagingSettings());
</script>

<svelte:boundary>
	{@const messaging = settings.standing}
	<InfoCard title="Direct Messages">
		<!-- Two separate things, shown together on purpose. The restriction is
		     staff's and read-only; the switch below it is the member's own and
		     always theirs to set. Toggling it never lifts the restriction —
		     they write different tables. -->
		{#if messaging.standing.status !== 'none'}
			<Alert type="warning">
				{messaging.standing.status === 'disabled'
					? 'Direct messaging is switched off for your account by staff.'
					: 'You cannot start new conversations at the moment. You can still reply to conversations you are already in.'}
				{#if messaging.standing.reason}
					<span class="mt-1 block opacity-80">{messaging.standing.reason}</span>
				{/if}
				<span class="mt-1 block text-muted"> Contact staff if you think this is a mistake. </span>
			</Alert>
		{/if}
		<p class="mt-3 mb-3 text-muted">
			When this is on, other members can send you a message request from the directory. You decide
			whether to accept each one, and you can block anyone at any time.
		</p>
		<Form
			remote={setMyMessaging}
			successToast="Saved"
			class="flex items-center justify-between gap-4"
		>
			<span class="font-medium">Allow direct messages</span>
			<input
				{...setMyMessaging.fields.enabled.as(
					'hidden',
					messaging.acceptsDirectMessages ? 'off' : 'on'
				)}
			/>
			<SubmitButton
				label={messaging.acceptsDirectMessages ? 'Turn off' : 'Turn on'}
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
		{@const blocks = settings.blocks}
		{#if blocks.length > 0}
			<div class="mt-4 border-t border-base-300 pt-4">
				<h3 class="mb-2 font-medium">Blocked members</h3>
				<p class="mb-3 text-muted text-sm">
					Neither of you can write to the other. Conversations you already had stay readable.
				</p>
				<ul class="flex flex-col gap-1">
					{#each blocks as blocked (blocked.userId)}
						<li class="flex items-center justify-between gap-3 py-1">
							<span class="min-w-0">
								<span class="truncate font-medium">{blocked.name}</span>
								{#if blocked.source === 'declined_request'}
									<span class="ml-2 text-subtle text-xs">from a declined request</span>
								{:else if blocked.source === 'reported'}
									<span class="ml-2 text-subtle text-xs">from a report</span>
								{/if}
							</span>
							<Form remote={unblockMember} successToast="Unblocked">
								<input {...unblockMember.fields.userId.as('hidden', blocked.userId)} />
								<SubmitButton label="Unblock" variant="ghost" size="sm" />
							</Form>
						</li>
					{/each}
				</ul>
			</div>
		{/if}
	</InfoCard>
</svelte:boundary>
