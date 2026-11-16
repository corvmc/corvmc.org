<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import { untrack } from 'svelte';
	import { resolve } from '$app/paths';
	import { toast } from 'svelte-sonner';
	import Form from '#lib/components/ui/Form/Form.svelte';
	import FormField from '#lib/components/ui/Form/FormField.svelte';
	import SubmitButton from '#lib/components/ui/Form/SubmitButton.svelte';
	import InfoCard from '#lib/components/ui/InfoCard.svelte';
	import RichTextEditor from '#lib/components/ui/Form/RichTextEditor.svelte';
	import { getGroupEditor, updateGroupProfileForm } from '#lib/remote/groups.remote.js';

	// Plain resolved props, never an awaited query — see the page's comment.
	let { group }: { group: Awaited<ReturnType<typeof getGroupEditor>> } = $props();

	const fields = updateGroupProfileForm.fields;
	const kindLabel = $derived(
		group.kind === 'committee'
			? m.member_groups_slug_edit_group_profile_form_committee_label()
			: m.member_groups_slug_edit_group_profile_form_club_label()
	);

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

<Form remote={updateGroupProfileForm} guard onsuccess={() => toast.success(m.member_saved_toast())}>
	<input {...fields.slug.as('hidden', group.slug)} />

	<InfoCard title={m.member_groups_slug_edit_group_profile_form_basics_title()}>
		<div class="flex flex-col gap-4 sm:flex-row sm:items-start">
			<div class="flex-1 space-y-4">
				<FormField
					field={fields.name}
					type="text"
					label={m.member_name_label()}
					value={group.name}
					required
				/>

				<FormField
					label={m.member_address_label()}
					readonly
					display={`/member/groups/${group.slug}`}
				>
					{#snippet description()}
						{m.member_groups_slug_edit_group_profile_form_renaming_doesn_t_body({ kindLabel })}
					{/snippet}
				</FormField>
			</div>

			<FormField
				label={m.member_groups_slug_edit_group_profile_form_photo_label()}
				type="file"
				upload={uploadAvatar}
				accept="image/jpeg,image/png,image/webp"
				src={group.avatarUrl ?? undefined}
				orientation="col"
				class="shrink-0"
			/>
		</div>

		<div class="mt-4">
			<FormField field={fields.bio} label={m.member_about_label()}>
				<input {...fields.bio.as('hidden', bioHtml)} />
				<RichTextEditor
					bind:value={bioHtml}
					placeholder={m.member_groups_slug_edit_group_profile_form_placeholder({ kindLabel })}
				/>
			</FormField>
		</div>
	</InfoCard>

	<InfoCard title={m.member_groups_slug_edit_group_profile_form_joining_title()}>
		<!-- Read-only, and it says who to ask. The join policy decides who may
		     walk in, and the case for free room time rests on staff being
		     the ones who settle that — so a leader sees it rather than sets it. -->
		<FormField
			label={m.member_groups_slug_edit_group_profile_form_who_can_join_label()}
			readonly
			display={policyLabel[group.joinPolicy]}
		>
			{#snippet description()}
				{m.member_groups_slug_edit_group_profile_form_staff_set_ask_the_body()}
			{/snippet}
		</FormField>

		<FormField
			field={fields.joinInstructions}
			type="textarea"
			label={m.member_how_works_label()}
			value={group.joinInstructions ?? ''}
			description={m.member_groups_slug_edit_group_profile_form_description_body({ kindLabel })}
		/>
	</InfoCard>

	<div class="flex justify-end gap-2">
		<a class="btn btn-ghost" href={resolve(`member/groups/${group.slug}`)}
			>{m.member_cancel_text()}</a
		>
		<SubmitButton label={m.member_save_label()} />
	</div>
</Form>
