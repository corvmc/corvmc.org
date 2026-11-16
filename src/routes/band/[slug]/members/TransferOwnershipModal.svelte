<script lang="ts">
	import { m as msg } from '#lib/paraglide/messages.js';
	import { ParaglideMessage } from '@inlang/paraglide-js-svelte';
	import Form from '#lib/components/ui/Form/index.js';
	import FormField from '#lib/components/ui/Form/FormField.svelte';
	import SubmitButton from '#lib/components/ui/Form/SubmitButton.svelte';
	import Modal from '#lib/components/ui/Modal.svelte';
	import Alert from '#lib/components/ui/Alert.svelte';
	import { toast } from 'svelte-sonner';
	import { transferOwner } from '#lib/remote/bands.remote.js';

	const { fields } = transferOwner;

	let {
		open = $bindable(false),
		bandId,
		bandName,
		candidates,
		selectedId,
		onsuccess
	}: {
		open?: boolean;
		bandId: string;
		bandName: string;
		/** Active members who are not the owner. */
		candidates: { userId: string; name: string }[];
		/** The row the owner clicked Transfer on; null from the membership panel. */
		selectedId: string | null;
		onsuccess: () => void;
	} = $props();

	// The owner names the new owner; nothing is chosen for them (#3087).
	let newOwnerId = $state('');
	$effect.pre(() => {
		if (open) newOwnerId = selectedId ?? '';
	});
	const chosen = $derived(candidates.find((c) => c.userId === newOwnerId) ?? null);
	const options = $derived(candidates.map((c) => ({ value: c.userId, label: c.name })));
</script>

<Modal title={msg.band_slug_members_transfer_ownership_title()} bind:open>
	{#if candidates.length > 0}
		<Form
			remote={transferOwner}
			onsuccess={() => {
				toast.success(msg.band_slug_members_ownership_transferred_toast());
				open = false;
				onsuccess();
			}}
		>
			<div class="space-y-4">
				<FormField
					field={fields.newOwnerId}
					type="select"
					label={msg.band_slug_members_new_owner_label()}
					placeholder={msg.band_slug_members_choose_member_placeholder()}
					{options}
					bind:value={newOwnerId}
					required
				/>
				{#if chosen}
					<Alert type="warning">
						<ParaglideMessage
							message={msg.band_slug_members_about_transfer_ownership_will_demoted_body}
							inputs={{ name: bandName, name2: chosen.name }}
							>{#snippet strong({ children })}<strong>{@render children?.()}</strong
								>{/snippet}</ParaglideMessage
						>
					</Alert>
				{/if}
				<input {...fields.bandId.as('hidden', bandId)} />
				<div class="flex justify-end pt-2">
					<SubmitButton
						label={msg.band_slug_members_transfer_ownership_label()}
						successLabel={msg.band_slug_members_transferred_label()}
						variant="warning"
					/>
				</div>
			</div>
		</Form>
	{/if}
</Modal>
