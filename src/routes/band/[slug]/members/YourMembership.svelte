<script lang="ts">
	import InfoCard from '$lib/components/shared/InfoCard.svelte';
	import { EntityIdentity } from '$lib/components/shared/entity';
	import type { MemberRef } from '$lib/types/entity';
	import StatusBadge from '$lib/components/shared/StatusBadge.svelte';
	import Alert from '$lib/components/shared/Alert.svelte';
	import Button from '$lib/components/shared/Button.svelte';
	import Form from '$lib/components/shared/Form/Form.svelte';
	import FormField from '$lib/components/shared/Form/FormField.svelte';
	import SubmitButton from '$lib/components/shared/Form/SubmitButton.svelte';
	import Action from '$lib/components/shared/Action.svelte';
	import { leave, updateMyBandMembership } from '$lib/remote/bands.remote';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { toast } from 'svelte-sonner';

	/**
	 * The viewer's own membership, at the top of the members page.
	 *
	 * The page used to open with everyone else and bury Leave Band as a bare
	 * button at the very bottom — and an owner, who cannot leave, simply saw
	 * nothing there with no explanation of why.
	 *
	 * Synchronous script: `fields` is read at module scope and the awaited
	 * queries live in the parent, which passes resolved props.
	 */
	const fields = updateMyBandMembership.fields;

	let {
		me,
		bandName,
		role,
		onchanged,
		ontransfer
	}: {
		me: {
			/** The presentation ref `getMembers` builds — alias-aware. */
			member: MemberRef;
			alias: string | null;
			position: string | null;
		} | null;
		bandName: string;
		role: string;
		onchanged: () => void;
		/** Opens the page's transfer-ownership modal — the owner's way out. */
		ontransfer: () => void;
	} = $props();

	const isOwner = $derived(role === 'owner');
</script>

{#if me}
	<InfoCard title="Your membership">
		<div class="space-y-4">
			<div class="flex items-center gap-3">
				<EntityIdentity ref={me.member} size="md" />
				<div class="ml-auto"><StatusBadge status={role} /></div>
			</div>

			<Form
				remote={updateMyBandMembership}
				guard
				successToast="Saved"
				onsuccess={onchanged}
				class="space-y-4"
			>
				<div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
					<FormField
						field={fields.alias}
						type="text"
						label="Stage name"
						value={me.alias ?? ''}
						maxlength="100"
						placeholder={me.member.title}
						description="How you're credited on this band's roster and site. Leave blank to use your account name."
					/>
					<FormField
						field={fields.position}
						type="text"
						label="Instrument / role"
						value={me.position ?? ''}
						maxlength="100"
						placeholder="e.g. Bass"
						description="What you play in this band. Admins can change this too."
					/>
				</div>
				<div class="flex justify-end">
					<SubmitButton label="Save" />
				</div>
			</Form>

			<div class="border-t pt-4">
				{#if isOwner}
					<!-- An owner can't leave while they own the band. Saying so, with the
					     way out, beats the old behaviour of hiding the button entirely
					     and leaving them to guess. -->
					<Alert type="info">
						As the owner you can't leave <strong>{bandName}</strong> until you transfer ownership to
						another active member.
						<Button variant="ghost" size="sm" class="ml-2" onclick={ontransfer}>
							Transfer ownership
						</Button>
					</Alert>
				{:else}
					<Action
						action={leave}
						label="Leave band"
						variant="error"
						size="sm"
						outline
						confirm="Leave {bandName}? You'll need to be re-invited to rejoin."
						successToast="You have left the band"
						onsuccess={() => goto(resolve('/member/bands'))}
						onfailure={() => toast.error('Failed to leave')}
					/>
				{/if}
			</div>
		</div>
	</InfoCard>
{/if}
