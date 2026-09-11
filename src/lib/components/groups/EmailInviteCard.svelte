<script lang="ts">
	/**
	 * An invitation addressed to an email rather than to an account.
	 *
	 * There is no accept button: a `group_invite` is redeemed by its tokened link
	 * or at signup, and neither is reachable from here. The card exists so the
	 * member can learn the invitation happened at all — before it lapsed there was
	 * no surface anywhere that said so, expired or not (#906).
	 */
	import Card from '$lib/components/ui/Card/Card.svelte';
	import CardBody from '$lib/components/ui/Card/CardBody.svelte';
	import Badge from '$lib/components/ui/Badge.svelte';
	import { formatDate } from '$lib/utils/format';

	let {
		invite,
		kindLabel
	}: {
		invite: {
			name: string;
			role: string;
			invitedByName: string | null;
			expiresAt: Date;
			expired: boolean;
		};
		/** "Club" or "Committee" — omitted where the page is already one kind. */
		kindLabel?: string;
	} = $props();
</script>

<Card class={invite.expired ? 'opacity-70' : ''}>
	<CardBody row class="py-4">
		<div class="min-w-0">
			<span class="font-semibold">{invite.name}</span>
			<p class="text-subtle">
				{#if kindLabel}{kindLabel} ·
				{/if}{invite.invitedByName ?? 'Someone'} invited you as
				{invite.role}
			</p>
			<p class="text-muted text-sm">
				{#if invite.expired}
					This invitation expired on {formatDate(invite.expiresAt)}. Ask them to send a new one.
				{:else}
					The link is in your email, and works until {formatDate(invite.expiresAt)}.
				{/if}
			</p>
		</div>
		<Badge variant={invite.expired ? 'ghost' : 'warning'}>
			{invite.expired ? 'Expired' : 'Invited'}
		</Badge>
	</CardBody>
</Card>
