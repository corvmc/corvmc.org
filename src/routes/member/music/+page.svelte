<script lang="ts">
	import PageHeader from '$lib/components/ui/PageHeader.svelte';
	import PageContent from '$lib/components/ui/PageContent.svelte';
	import Card from '$lib/components/ui/Card/Card.svelte';
	import CardBody from '$lib/components/ui/Card/CardBody.svelte';
	import EmptyState from '$lib/components/ui/EmptyState.svelte';
	import { getMyMusic } from '$lib/remote/music.remote';
	import { formatDate, formatCents } from '$lib/utils/format';
	import Button from '$lib/components/ui/Button.svelte';
	import { resolve } from '$app/paths';

	const purchases = $derived(await getMyMusic());
</script>

<PageHeader title="Music" subtitle="What you've bought" />

<PageContent width="2xl">
	{#if purchases.length === 0}
		<EmptyState
			title="Nothing yet"
			description="Records you buy from bands at the collective show up here, with their download links."
		/>
	{:else}
		<div class="space-y-3">
			{#each purchases as purchase (purchase.purchaseId)}
				<Card>
					<CardBody row class="items-center gap-4">
						<div class="min-w-0 flex-1">
							<p class="truncate font-medium">{purchase.releaseTitle}</p>
							<p class="truncate text-muted">
								<a class="link" href={resolve(`/directory/bands/${purchase.bandSlug}`)}>
									{purchase.bandName}
								</a>
								{#if purchase.paidAt}
									· {formatDate(purchase.paidAt)}
								{/if}
								· {purchase.amountPaidCents === 0 ? 'Free' : formatCents(purchase.amountPaidCents)}
							</p>
						</div>
						<Button size="sm" href={resolve(`/music/download/${purchase.downloadToken}`)}>
							Download
						</Button>
					</CardBody>
				</Card>
			{/each}
		</div>
	{/if}
</PageContent>
