<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import { ParaglideMessage } from '@inlang/paraglide-js-svelte';
	import Alert from '#lib/components/ui/Alert.svelte';
	import Button from '#lib/components/ui/Button.svelte';

	/**
	 * The owner's note under the roster: they cannot leave until they transfer
	 * ownership. Editing their own row and leaving live on the roster row.
	 */
	let {
		me,
		bandName,
		role,
		ontransfer
	}: {
		/** The viewer's roster row; null for staff viewing a band they are not in. */
		me: object | null;
		bandName: string;
		role: string;
		/** Opens the page's transfer-ownership modal — the owner's way out. */
		ontransfer: () => void;
	} = $props();

	const isOwner = $derived(role === 'owner');
</script>

{#if me && isOwner}
	<!-- An owner can't leave while they own the band. Saying so, with the
	     way out, beats the old behaviour of hiding the button entirely
	     and leaving them to guess. -->
	<Alert type="info">
		<ParaglideMessage
			message={m.band_slug_members_your_membership_as_owner_can_t_leave_body}
			inputs={{ bandName }}
			>{#snippet strong({ children })}<strong>{@render children?.()}</strong
				>{/snippet}</ParaglideMessage
		>
		{#snippet action()}
			<Button variant="ghost" size="sm" onclick={ontransfer}
				>{m.band_slug_members_your_membership_transfer_ownership_label()}</Button
			>
		{/snippet}
	</Alert>
{/if}
