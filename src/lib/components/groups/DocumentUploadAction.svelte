<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import Action from '#lib/components/ui/Action.svelte';
	import FormField from '#lib/components/ui/Form/FormField.svelte';
	import { refreshAll } from '$app/navigation';
	import { uploadDocument } from '#lib/remote/files.remote.js';

	/**
	 * Add a document to a group's shared folder.
	 *
	 * Mount-agnostic, like the composer beside it: it takes its group as a prop
	 * and knows nothing about the route it is on.
	 *
	 * `FormField type="file"` rather than a hand-rolled `<input type="file">` —
	 * besides the repo's rule about raw form elements, `FileUpload` underneath it
	 * sets `enctype="multipart/form-data"` on the enclosing form, and SvelteKit
	 * *throws* rather than warns without that. The symptom of getting it wrong is
	 * a Save that silently does nothing.
	 */
	let { groupId, atQuota = false }: { groupId: string; atQuota?: boolean } = $props();

	const fields = uploadDocument.fields;

	/**
	 * A browser hint, not the rule. `PRIVATE_ALLOWED_TYPES` in
	 * `src/lib/server/private-storage.ts` is what actually decides, and it is a
	 * server module a component cannot import. Any drift here shows up as a
	 * file the picker offered and the server refused, with the reason on the
	 * field — annoying, never unsafe.
	 */
	const ACCEPT = [
		'application/pdf',
		'image/jpeg',
		'image/png',
		'image/webp',
		'text/plain',
		'text/csv',
		'.docx',
		'.xlsx'
	].join(',');
</script>

<Action
	action={uploadDocument}
	label={m.groups_document_upload_add_document_label()}
	modalTitle={m.groups_document_upload_add_document_title()}
	submitLabel={m.groups_document_upload_submit_label()}
	successToast={m.groups_document_upload_success_toast()}
	variant="primary"
	size="sm"
	disabled={atQuota}
	onsuccess={() => refreshAll()}
>
	{#snippet form()}
		<div class="space-y-4">
			<input {...fields.groupId.as('hidden', groupId)} />
			<FormField
				field={fields.file}
				type="file"
				label={m.groups_file_label()}
				accept={ACCEPT}
				emptyLabel={m.groups_document_upload_empty_label_title()}
				replaceLabel={m.groups_document_upload_replace_label()}
				description={m.groups_document_upload_pdf_image_text_csv_word_body()}
				required
			/>
			<FormField
				field={fields.description}
				type="text"
				label={m.groups_document_upload_description_label()}
				placeholder={m.groups_document_upload_placeholder()}
				description={m.groups_document_upload_optional_what_people_who_did_body()}
			/>
		</div>
	{/snippet}
</Action>
