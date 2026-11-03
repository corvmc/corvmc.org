<script lang="ts">
	import { m } from '$lib/paraglide/messages.js';
	import Card from '$lib/components/ui/Card/Card.svelte';
	import CardBody from '$lib/components/ui/Card/CardBody.svelte';
	import CardTitle from '$lib/components/ui/Card/CardTitle.svelte';
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
			<h2 class="text-3xl font-bold">
				{m.member_membership_benefits_grid_sustaining_member_benefits()}
			</h2>
			<p class="mt-2 opacity-70">
				{m.member_membership_benefits_grid_everything_get_with_monthly()}
			</p>
		</div>

		<div class="grid gap-6 md:grid-cols-3">
			<Card>
				<CardBody>
					<div class="mb-2 flex size-12 items-center justify-center rounded-xl bg-primary/10">
						<IconMusic size={24} class="text-primary" />
					</div>
					<CardTitle>{m.member_membership_benefits_grid_practice_time()}</CardTitle>
					<p class="opacity-70">
						{m.member_membership_benefits_grid_every_5_put_each_month()}
					</p>
				</CardBody>
			</Card>

			<Card>
				<CardBody>
					<div class="mb-2 flex size-12 items-center justify-center rounded-xl bg-secondary/10">
						<IconTool size={24} class="text-secondary" />
					</div>
					<CardTitle>{m.member_membership_benefits_grid_gear_library()}</CardTitle>
					<p class="opacity-70">
						{m.member_membership_benefits_grid_collective_has_whole_library()}
					</p>
				</CardBody>
			</Card>

			<Card>
				<CardBody>
					<div class="mb-2 flex size-12 items-center justify-center rounded-xl bg-accent/10">
						<IconUsers size={24} class="text-accent" />
					</div>
					<CardTitle>{m.member_membership_benefits_grid_shows_community()}</CardTitle>
					<p class="opacity-70">
						{m.member_membership_benefits_grid_first_dibs_workshops_member()}
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
				<CardTitle>{m.member_membership_benefits_grid_gear_library()}</CardTitle>
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
				<CardTitle>{m.member_membership_benefits_grid_shows_community()}</CardTitle>
				<ul class="mt-2 space-y-2">
					{@render benefitItem(
						'<strong>Show tickets on a sliding scale</strong> — for everyone, because of you'
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
