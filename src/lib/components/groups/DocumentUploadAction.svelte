<script lang="ts">
	import Action from '$lib/components/ui/Action.svelte';
	import FormField from '$lib/components/ui/Form/FormField.svelte';
	import { invalidateAll } from '$app/navigation';
	import { toast } from 'svelte-sonner';
	import { uploadDocument } from '$lib/remote/files.remote';

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
	label="Add document"
	modalTitle="Add document"
	submitLabel="Upload"
	successToast="Uploaded"
	variant="primary"
	size="sm"
	disabled={atQuota}
	onsuccess={() => invalidateAll()}
	onfailure={() => toast.error('Failed to upload')}
>
	{#snippet form()}
		<div class="space-y-4">
			<input {...fields.groupId.as('hidden', groupId)} />
			<FormField
				field={fields.file}
				type="file"
				label="File"
				accept={ACCEPT}
				emptyLabel="Choose a file"
				replaceLabel="Choose a different file"
				description="PDF, image, text, CSV, Word or Excel. Up to 25MB."
				required
			/>
			<FormField
				field={fields.description}
				type="text"
				label="Description"
				placeholder="July minutes"
				description="Optional. What this is, for people who did not upload it."
			/>
		</div>
	{/snippet}
</Action>
