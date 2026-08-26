<script lang="ts">
	import InfoCard from '$lib/components/shared/InfoCard.svelte';
	import { SubscribeAction, UnsubscribeAction } from '$lib/components/shared/actions';
	import { getMyEmailSubscriptions } from '$lib/remote/account.remote';

	/**
	 * The account page's Email Subscriptions card, owning its own query. See DirectMessagesSection.
	 */
	const lists = $derived(getMyEmailSubscriptions());
</script>

<svelte:boundary>
	<InfoCard title="Email Subscriptions">
		{#await lists}
			<div class="flex justify-center p-4">
				<span class="loading loading-spinner loading-sm"></span>
			</div>
		{:then { subscriptions: subs, available: avail }}
			{#if subs.length === 0 && avail.length === 0}
				<p class="text-muted">No mailing lists available.</p>
			{:else}
				{#if subs.length > 0}
					<p class="mb-2 text-subtle font-medium">Your subscriptions</p>
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
					<p class="mb-2 text-subtle font-medium">Available lists</p>
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
			<p class="text-sm text-error">Failed to load subscriptions.</p>
		{/await}
	</InfoCard>
</svelte:boundary>
