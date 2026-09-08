<script lang="ts">
	/**
	 * One receipt list for everything the collective sells.
	 *
	 * A record and a ticket are different objects — one has a file behind it, the
	 * other a code at a door — but from the buyer's side they are the same
	 * question: what did I pay for, and how do I get to it. Splitting that across
	 * a page per product makes a member hunt for the page before they can look
	 * for the purchase.
	 *
	 * So the type is a column rather than a route. What a row can *do* still comes
	 * from its kind, which is why the query returns a discriminated union instead
	 * of a flattened row: only a music row has a download.
	 */
	import PageHeader from '$lib/components/ui/PageHeader.svelte';
	import PageContent from '$lib/components/ui/PageContent.svelte';
	import Card from '$lib/components/ui/Card/Card.svelte';
	import CardBody from '$lib/components/ui/Card/CardBody.svelte';
	import Table from '$lib/components/ui/Table.svelte';
	import Badge from '$lib/components/ui/Badge.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import EmptyState from '$lib/components/ui/EmptyState.svelte';
	import { getMyPurchases } from '$lib/remote/purchases.remote';
	import { formatDate, formatCents } from '$lib/utils/format';
	import { resolve } from '$app/paths';

	const purchases = $derived(await getMyPurchases());
</script>

<PageHeader title="Purchases" subtitle="What you've bought" />

<PageContent width="3xl">
	{#if purchases.length === 0}
		<EmptyState
			title="Nothing yet"
			description="Records and tickets you buy from the collective show up here, with the links to get to them."
		/>
	{:else}
		<Card>
			<CardBody>
				<Table>
					{#snippet head()}
						<th>Type</th>
						<th>Item</th>
						<th class="col-support">When</th>
						<th>Amount</th>
						<th></th>
					{/snippet}

					{#each purchases as purchase (purchase.kind + purchase.id)}
						<tr>
							<td>
								<Badge variant={purchase.kind === 'music' ? 'secondary' : 'primary'}>
									{purchase.kind === 'music' ? 'Music' : 'Ticket'}
								</Badge>
							</td>
							<td>
								{#if purchase.kind === 'music'}
									<span class="font-medium">{purchase.releaseTitle}</span>
									<span class="text-muted">
										— <a class="link" href={resolve(`/directory/bands/${purchase.bandSlug}`)}>
											{purchase.bandName}
										</a>
									</span>
								{:else}
									<span class="font-medium">{purchase.eventTitle}</span>
									<span class="text-muted">
										— {formatDate(purchase.eventStartsAt)}
										{#if purchase.quantity > 1}
											· {purchase.quantity} tickets
										{/if}
									</span>
								{/if}
							</td>
							<td class="col-support">
								{purchase.purchasedAt ? formatDate(purchase.purchasedAt) : '—'}
							</td>
							<!-- Free is a real outcome here, not a missing number: a band can
							     price a record at nothing and still want the sale recorded. -->
							<td>{purchase.amountCents === 0 ? 'Free' : formatCents(purchase.amountCents)}</td>
							<td class="text-right">
								{#if purchase.kind === 'music'}
									<Button size="sm" href={resolve(`/music/download/${purchase.downloadToken}`)}>
										Download
									</Button>
								{:else}
									<Button
										size="sm"
										variant="ghost"
										href={resolve(`/member/events/${purchase.eventId}`)}
									>
										View
									</Button>
								{/if}
							</td>
						</tr>
					{/each}
				</Table>
			</CardBody>
		</Card>
	{/if}
</PageContent>
