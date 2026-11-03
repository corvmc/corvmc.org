<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	import InfoCard from '$lib/components/ui/InfoCard.svelte';
	import { SubscribeAction, UnsubscribeAction } from '$lib/components/actions';
	import { getMyEmailSubscriptions } from '$lib/remote/account.remote';
	import Alert from '$lib/components/ui/Alert.svelte';
	import { retryQuery } from '$lib/utils/retry-query';

	/**
	 * The account page's Email Subscriptions card, owning its own query. See DirectMessagesSection.
	 */
	const lists = $derived(getMyEmailSubscriptions());
</script>

<svelte:boundary>
	<InfoCard title={m.member_account_email_subscriptions_section_title()}>
		<!-- eslint-disable-next-line custom/no-interactive-await -- #2359 -->
		{#await lists}
			<div class="flex justify-center p-4">
				<span class="loading loading-sm loading-spinner"></span>
			</div>
		{:then { subscriptions: subs, available: avail }}
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
		{:catch}
			<p class="text-sm text-error">
				{m.member_account_email_subscriptions_section_failed_load_subsc()}
			</p>
		{/await}
	</InfoCard>

	{#snippet failed(_error, reset)}
		<Alert type="warning" reset={() => retryQuery(lists, reset)}>
			{m.member_account_email_subscriptions_section_email_subscriptio()}
		</Alert>
	{/snippet}
</svelte:boundary>
