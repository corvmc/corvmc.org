<script lang="ts">
	import FileUpload from './FileUpload.svelte';
	import EntityAvatar from '../entity/EntityAvatar.svelte';

	/**
	 * The one avatar picker every profile form uses: the picked or saved image
	 * previewed as the avatar it becomes, initials when there is none.
	 * `scripts/avatar-field.spec.ts` keeps the forms on it.
	 */
	let {
		upload,
		src,
		name,
		shape,
		disabled = false
	}: {
		/** Persists the file and returns its key; the avatar routes do both. */
		upload: (file: File) => Promise<string>;
		src?: string | null;
		/** Whose avatar, for the initials shown with no image. */
		name: string;
		/** Round for a person, square for a band or group. */
		shape: 'round' | 'square';
		disabled?: boolean;
	} = $props();
</script>

<div class="shrink-0">
	<FileUpload
		{upload}
		{disabled}
		accept="image/jpeg,image/png,image/webp"
		src={src ?? undefined}
		orientation="col"
	>
		{#snippet preview({ src: previewSrc })}
			<EntityAvatar {shape} {name} image={previewSrc} class="size-24" />
		{/snippet}
	</FileUpload>
</div>
