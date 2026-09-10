<script lang="ts">
	import { untrack } from 'svelte';
	import { resolve } from '$app/paths';
	import { toast } from 'svelte-sonner';
	import Form from '$lib/components/ui/Form/Form.svelte';
	import FormField from '$lib/components/ui/Form/FormField.svelte';
	import SubmitButton from '$lib/components/ui/Form/SubmitButton.svelte';
	import InfoCard from '$lib/components/ui/InfoCard.svelte';
	import RichTextEditor from '$lib/components/ui/Form/RichTextEditor.svelte';
	import { getGroupEditor, updateGroupProfileForm } from '$lib/remote/groups.remote';

	// Plain resolved props, never an awaited query — see the page's comment.
	let { group }: { group: Awaited<ReturnType<typeof getGroupEditor>> } = $props();

	const fields = updateGroupProfileForm.fields;
	const kindLabel = $derived(group.kind === 'committee' ? 'committee' : 'club');

	let bioHtml = $state(untrack(() => group.bio) ?? '');

	const policyLabel: Record<string, string> = {
		open: 'Anyone can join',
		by_application: 'People apply and you approve',
		invite_only: 'Invitation only'
	};

	// Uploads the moment a file is picked, through the same endpoint the band
	// avatar uses — it guards on the group role and is kind-agnostic, so a
	// program leader already reaches it. The field previews locally.
	async function uploadAvatar(file: File): Promise<string> {
		const fd = new FormData();
		fd.set('file', file);
		const res = await fetch(`/api/bands/${group.id}/avatar`, { method: 'POST', body: fd });
		if (!res.ok) {
			const err = (await res.json().catch(() => ({}))) as { message?: string };
			throw new Error(err.message || 'Upload failed');
		}
		const data = (await res.json()) as { avatarKey: string };
		return data.avatarKey;
	}
</script>

<Form remote={updateGroupProfileForm} guard onsuccess={() => toast.success('Saved')}>
	<input {...fields.slug.as('hidden', group.slug)} />

	<InfoCard title="Basics">
		<div class="flex flex-col gap-4 sm:flex-row sm:items-start">
			<div class="flex-1 space-y-4">
				<FormField field={fields.name} type="text" label="Name" value={group.name} required />

				<FormField label="Address" readonly display={`/member/groups/${group.slug}`}>
					{#snippet description()}
						Renaming the {kindLabel} doesn't move its address.
					{/snippet}
				</FormField>
			</div>

			<FormField
				label="Photo"
				name="avatarKey"
				type="file"
				upload={uploadAvatar}
				accept="image/jpeg,image/png,image/webp"
				src={group.avatarUrl ?? undefined}
				orientation="col"
				class="shrink-0"
			/>
		</div>

		<div class="mt-4">
			<FormField field={fields.bio} label="About">
				<input {...fields.bio.as('hidden', bioHtml)} />
				<RichTextEditor bind:value={bioHtml} placeholder="What is this {kindLabel} for?" />
			</FormField>
		</div>
	</InfoCard>

	<InfoCard title="Joining">
		<!-- Read-only, and it says who to ask. The join policy decides who may
		     walk in, and the spec's case for free room time rests on staff being
		     the ones who settle that — so a leader sees it rather than sets it. -->
		<FormField label="Who can join" readonly display={policyLabel[group.joinPolicy]}>
			{#snippet description()}
				Staff set this. Ask them if it needs to change.
			{/snippet}
		</FormField>

		<FormField
			field={fields.joinInstructions}
			type="textarea"
			label="How it works"
			value={group.joinInstructions ?? ''}
			description="Shown beside the Join button and on the {kindLabel}'s Overview tab."
		/>
	</InfoCard>

	<div class="flex justify-end gap-2">
		<a class="btn btn-ghost" href={resolve(`/member/groups/${group.slug}`)}>Cancel</a>
		<SubmitButton label="Save" />
	</div>
</Form>
