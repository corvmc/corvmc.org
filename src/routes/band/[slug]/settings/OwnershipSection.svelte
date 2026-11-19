<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import { ParaglideMessage } from '@inlang/paraglide-js-svelte';
	import { refreshAll } from '$app/navigation';
	import Button from '#lib/components/ui/Button.svelte';
	import InfoCard from '#lib/components/ui/InfoCard.svelte';
	import TransferOwnershipModal from '#lib/components/band/TransferOwnershipModal.svelte';
	import { getBandMembersPage } from '#lib/remote/bands.remote.js';

	// Owner-only: `transferOwner` is owner-guarded, so the page mounts this for
	// the owner alone. The roster is this component's one query.
	let { bandId, bandName, ownerId }: { bandId: string; bandName: string; ownerId: string } =
		$props();

	const data = $derived(await getBandMembersPage(bandId));
	const candidates = $derived(
		data.members.active
			.filter((member) => member.userId !== ownerId && member.role !== 'owner')
			.map((member) => ({ userId: member.userId, name: member.member.title }))
	);

	let showTransfer = $state(false);
</script>

<InfoCard title={m.band_slug_settings_ownership_title()}>
	<p class="text-sm">
		<ParaglideMessage
			message={m.band_slug_settings_ownership_can_t_leave_text}
			inputs={{ bandName }}
			>{#snippet strong({ children })}<strong>{@render children?.()}</strong
				>{/snippet}</ParaglideMessage
		>
	</p>
	{#if candidates.length === 0}
		<p class="mt-2 text-subtle">{m.band_slug_settings_ownership_nobody_to_transfer_text()}</p>
	{:else}
		<div class="mt-2 card-actions justify-end">
			<Button variant="default" size="sm" outline onclick={() => (showTransfer = true)}
				>{m.band_slug_settings_ownership_transfer_label()}</Button
			>
		</div>
	{/if}
</InfoCard>

<TransferOwnershipModal
	bind:open={showTransfer}
	{bandId}
	{bandName}
	{candidates}
	selectedId={null}
	onsuccess={() => refreshAll()}
/>
