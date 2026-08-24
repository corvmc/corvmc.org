<script lang="ts">
	import type { RemoteForm } from '@sveltejs/kit';
	import { IconCamera } from '@tabler/icons-svelte';
	import { toast } from 'svelte-sonner';
	import EntityAvatar from '$lib/components/shared/directory/EntityAvatar.svelte';
	import Form from '$lib/components/shared/Form/Form.svelte';
	import SubmitButton from '$lib/components/shared/Form/SubmitButton.svelte';

	let {
		uploadForm,
		removeForm,
		currentUrl,
		name,
		shape = 'round',
		accept = 'image/jpeg,image/png,image/webp'
	}: {
		uploadForm: RemoteForm<any, any>;
		removeForm: RemoteForm<any, any>;
		currentUrl: string | null;
		name: string;
		/** member = round, band = square — the directory-wide convention */
		shape?: 'round' | 'square';
		accept?: string;
	} = $props();

	const shapeClass = $derived(shape === 'round' ? 'rounded-full' : 'rounded-lg');
</script>

<div class="flex items-start gap-4">
	<Form
		remote={uploadForm}
		enctype="multipart/form-data"
		onsuccess={() => toast.success('Photo updated')}
		onfailure={() => toast.error('Upload failed')}
	>
		<label
			class="group relative block size-24 cursor-pointer {shapeClass}"
			aria-label={currentUrl ? 'Replace photo' : 'Add photo'}
		>
			<EntityAvatar {shape} {name} image={currentUrl} class="size-24" />
			<span
				class="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-black/50 text-white opacity-0 transition-opacity group-hover:opacity-100 {shapeClass}"
			>
				<IconCamera size={22} />
				<span class="text-xs font-semibold">{currentUrl ? 'Replace' : 'Add'}</span>
			</span>
			<input
				{...uploadForm.fields.file.as('file')}
				{accept}
				class="hidden"
				onchange={(e) => e.currentTarget.form?.requestSubmit()}
			/>
		</label>
	</Form>

	{#if currentUrl}
		<Form
			remote={removeForm}
			onsuccess={() => toast.success('Photo removed')}
			onfailure={() => toast.error('Failed to remove')}
		>
			<SubmitButton label="Remove" variant="ghost" size="xs" class="text-error" />
		</Form>
	{/if}
</div>
