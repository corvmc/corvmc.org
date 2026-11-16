<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import { resolve } from '$app/paths';
	import InfoCard from '#lib/components/ui/InfoCard.svelte';
	import Button from '#lib/components/ui/Button.svelte';

	// Only while nobody else is on the roster (#3050): a band of one has not
	// started, and inviting is what the owner or an admin can do about it.
	let { slug, memberCount, canManage }: { slug: string; memberCount: number; canManage: boolean } =
		$props();
</script>

{#if canManage && memberCount <= 1}
	<InfoCard title={m.band_slug_next_steps_title()}>
		<div class="flex flex-wrap gap-3">
			<Button href={resolve(`band/${slug}/members`)} size="sm"
				>{m.band_slug_next_steps_invite_member_label()}</Button
			>
			<Button href={resolve(`band/${slug}/reservations`)} size="sm" outline
				>{m.band_slug_next_steps_reserve_label()}</Button
			>
		</div>
	</InfoCard>
{/if}
