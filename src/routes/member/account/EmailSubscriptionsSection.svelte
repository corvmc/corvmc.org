<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import InfoCard from '#lib/components/ui/InfoCard.svelte';
	import { SubscribeAction, UnsubscribeAction } from '#lib/components/actions/index.js';
	import { getMyEmailSubscriptions } from '#lib/remote/account.remote.js';
	import Alert from '#lib/components/ui/Alert.svelte';
	import { retryQuery } from '#lib/utils/retry-query.js';
	import { Latest } from '#lib/latest.svelte.js';

	/**
	 * The account page's Email Subscriptions card, owning its own query. See DirectMessagesSection.
	 */
	const lists = $derived(getMyEmailSubscriptions());
	// Not `{#await}`: a refresh would re-pend it and unmount an open Unsubscribe.
	const latest = new Latest(() => lists);
</script>

<svelte:boundary>
	<InfoCard title={m.member_account_email_subscriptions_section_title()}>
		{#if latest.current}
			{@const { subscriptions: subs, available: avail } = latest.current}
			{#if subs.length === 0 && avail.length === 0}
				<p class="text-muted">{m.member_account_email_subscriptions_section_no_mailing_lists()}</p>
			{:else}
				{#if subs.length > 0}
					<p class="mb-2 text-subtle font-medium">
						{m.member_account_email_subscriptions_section_subscriptions()}
					</p>
					<div class="mb-4 space-y-2">
						{#each subs as sub (sub.audienceId)}
							<div class="flex items-center justify-between rounded-lg border px-4 py-2">
								<div>
									<p class="text-sm font-medium">{sub.audienceName}</p>
									{#if sub.audienceDescription}
										<p class="text-subtle">{sub.audienceDescription}</p>
									{/if}
								</div>
								<UnsubscribeAction audienceId={sub.audienceId} name={sub.audienceName} />
							</div>
						{/each}
					</div>
				{/if}

				{#if avail.length > 0}
					<p class="mb-2 text-subtle font-medium">
						{m.member_account_email_subscriptions_section_available_lists()}
					</p>
					<div class="space-y-2">
						{#each avail as a (a.id)}
							<div class="flex items-center justify-between rounded-lg border px-4 py-2">
								<div>
									<p class="text-sm font-medium">{a.name}</p>
									{#if a.description}
										<p class="text-subtle">{a.description}</p>
									{/if}
								</div>
								<SubscribeAction audienceId={a.id} name={a.name} />
							</div>
						{/each}
					</div>
				{/if}
			{/if}
		{:else if latest.error}
			<p class="text-sm text-error">
				{m.member_account_email_subscriptions_section_failed_load_subsc()}
			</p>
		{:else}
			<div class="flex justify-center p-4">
				<span class="loading loading-sm loading-spinner"></span>
			</div>
		{/if}
	</InfoCard>

	{#snippet failed(_error, reset)}
		<Alert type="warning" reset={() => retryQuery(lists, reset)}>
			{m.member_account_email_subscriptions_section_email_subscriptio()}
		</Alert>
	{/snippet}
</svelte:boundary>
