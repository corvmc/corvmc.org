<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import { ParaglideMessage } from '@inlang/paraglide-js-svelte';
	import { refreshAll } from '$app/navigation';
	import Card from '#lib/components/ui/Card/Card.svelte';
	import CardBody from '#lib/components/ui/Card/CardBody.svelte';
	import Button from '#lib/components/ui/Button.svelte';
	import { getBandMembersPage } from '#lib/remote/bands.remote.js';
	import TransferOwnershipModal from './TransferOwnershipModal.svelte';

	/**
	 * The owner's way out of the band: an owner cannot leave until someone else
	 * owns it (#3226). Rendered for the owner only; `transferOwner` is the guard.
	 */
	let { bandId, bandName }: { bandId: string; bandName: string } = $props();

	let open = $state(false);

	const members = $derived((await getBandMembersPage(bandId)).members);
	const candidates = $derived(
		members.active
			.filter((member) => member.role !== 'owner')
			.map((member) => ({ userId: member.userId, name: member.member.title }))
	);
</script>

<section class="space-y-4">
	<h2 class="text-lg font-semibold">{m.band_slug_settings_ownership_title()}</h2>
	<Card>
		<CardBody>
			<p class="text-sm">
				<ParaglideMessage
					message={m.band_slug_members_your_membership_as_owner_can_t_leave_body}
					inputs={{ bandName }}
					>{#snippet strong({ children })}<strong>{@render children?.()}</strong
						>{/snippet}</ParaglideMessage
				>
			</p>
			{#if candidates.length > 0}
				<div class="mt-2 card-actions justify-end">
					<Button
						variant="default"
						size="sm"
						outline
						data-testid="transfer-ownership"
						onclick={() => (open = true)}>{m.band_slug_members_transfer_ownership_label()}</Button
					>
				</div>
			{:else}
				<p class="mt-2 text-subtle">
					{m.band_slug_members_there_nobody_else_band_transfer_toast()}
				</p>
			{/if}
		</CardBody>
	</Card>
</section>

<!-- The viewer is an admin once it lands, so the layout's role has to reload. -->
<TransferOwnershipModal bind:open {bandId} {bandName} {candidates} onsuccess={() => refreshAll()} />
