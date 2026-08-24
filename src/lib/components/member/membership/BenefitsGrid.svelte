<script lang="ts">
	import Card from '$lib/components/shared/Card/Card.svelte';
	import CardBody from '$lib/components/shared/Card/CardBody.svelte';
	import CardTitle from '$lib/components/shared/Card/CardTitle.svelte';
	import { IconCircleCheck, IconMusic, IconTool, IconUsers } from '@tabler/icons-svelte';

	let { variant = 'full' }: { variant?: 'full' | 'compact' } = $props();
</script>

{#snippet benefitItem(text: string)}
	<li class="flex items-start gap-2">
		<IconCircleCheck size={20} class="mt-0.5 shrink-0 text-success" />
		<!-- eslint-disable-next-line svelte/no-at-html-tags -- trusted/sanitized HTML (hardcoded benefit text) -->
		<span>{@html text}</span>
	</li>
{/snippet}

{#if variant === 'full'}
	<!-- Non-member: three columns -->
	<div>
		<div class="mb-6 text-center">
			<h2 class="text-3xl font-bold">Sustaining Member Benefits</h2>
			<p class="mt-2 opacity-70">Everything you get with a monthly contribution</p>
		</div>

		<div class="grid gap-6 md:grid-cols-3">
			<Card>
				<CardBody>
					<div class="mb-2 flex size-12 items-center justify-center rounded-xl bg-primary/10">
						<IconMusic size={24} class="text-primary" />
					</div>
					<CardTitle>Practice Time</CardTitle>
					<p class="opacity-70">
						For every $5 you put in each month, you get an hour of free practice time. Set up
						recurring reservations so your favorite slot is always waiting, and jump the line when
						last-minute openings pop up.
					</p>
				</CardBody>
			</Card>

			<Card>
				<CardBody>
					<div class="mb-2 flex size-12 items-center justify-center rounded-xl bg-secondary/10">
						<IconTool size={24} class="text-secondary" />
					</div>
					<CardTitle>Gear Library</CardTitle>
					<p class="opacity-70">
						The Collective has a whole library of gear you can borrow. Sustaining members get free
						accessory rentals (cables, stands, the stuff you always forget), monthly equipment
						credits that match your contribution, and better rates on the bigger stuff.
					</p>
				</CardBody>
			</Card>

			<Card>
				<CardBody>
					<div class="mb-2 flex size-12 items-center justify-center rounded-xl bg-accent/10">
						<IconUsers size={24} class="text-accent" />
					</div>
					<CardTitle>Shows & Community</CardTitle>
					<p class="opacity-70">
						Half-price tickets to every Collective event and show, first dibs on workshops, and the
						satisfaction of knowing you're helping keep independent music going in Corvallis.
					</p>
				</CardBody>
			</Card>
		</div>
	</div>
{:else}
	<!-- Active member: two columns, compact -->
	<div class="grid gap-6 md:grid-cols-2">
		<Card>
			<CardBody>
				<CardTitle>Gear Library</CardTitle>
				<ul class="mt-2 space-y-2">
					{@render benefitItem(
						'<strong>Free accessory rentals</strong> — cables, stands, mic clips, all the essentials'
					)}
					{@render benefitItem(
						'<strong>Monthly equipment credits</strong> that match your contribution'
					)}
					{@render benefitItem('<strong>Better rates</strong> on premium gear')}
				</ul>
			</CardBody>
		</Card>

		<Card>
			<CardBody>
				<CardTitle>Shows & Community</CardTitle>
				<ul class="mt-2 space-y-2">
					{@render benefitItem(
						'<strong>Half-price tickets</strong> to every Collective event and show'
					)}
					{@render benefitItem('<strong>First dibs</strong> on workshops and special events')}
					{@render benefitItem(
						"You're directly <strong>keeping music happening</strong> in Corvallis"
					)}
				</ul>
			</CardBody>
		</Card>
	</div>
{/if}
