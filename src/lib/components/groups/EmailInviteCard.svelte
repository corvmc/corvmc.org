<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	/**
	 * An invitation addressed to an email rather than to an account.
	 *
	 * There is no accept button: a `group_invite` is redeemed by its tokened link
	 * or at signup, and neither is reachable from here. The card exists so the
	 * member can learn the invitation happened at all — before it lapsed there was
	 * no surface anywhere that said so, expired or not (#906).
	 */
	import Card from '#lib/components/ui/Card/Card.svelte';
	import CardBody from '#lib/components/ui/Card/CardBody.svelte';
	import Badge from '#lib/components/ui/Badge.svelte';
	import { formatDate } from '#lib/utils/format.js';

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
				{/if}{m.groups_email_invite_card_invited_as({
					invitedByName: invite.invitedByName ?? m.groups_email_invite_card_someone(),
					role: invite.role
				})}
			</p>
			<p class="text-muted text-sm">
				{#if invite.expired}{m.groups_email_invite_card_invitation_expired_ask_them_send({
						formatDate: formatDate(invite.expiresAt)
					})}{:else}{m.groups_email_invite_card_link_email_works_until({
						formatDate: formatDate(invite.expiresAt)
					})}{/if}
			</p>
		</div>
		<Badge variant={invite.expired ? 'ghost' : 'warning'}>
			{invite.expired ? m.groups_email_invite_card_expired() : m.groups_email_invite_card_invited()}
		</Badge>
	</CardBody>
</Card>
