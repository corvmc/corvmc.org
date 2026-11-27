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
		disabled = false,
		class: className = ''
	}: {
		/** Persist the picked image and return its key. */
		upload: (file: File) => Promise<string | void>;
		src?: string | null;
		/** Seeds the initials and pattern shown before there is an image. */
		name: string;
		/** A member is round, a band or group square: see `entity/registry.ts`. */
		shape: 'round' | 'square';
		disabled?: boolean;
		class?: string;
	} = $props();
</script>

<div class="shrink-0 {className}">
	<FileUpload
		{upload}
		{disabled}
		accept="image/jpeg,image/png,image/webp"
		src={src ?? undefined}
		orientation="col"
	>
		{#snippet preview({ src: picked })}
			<EntityAvatar {shape} {name} image={picked} class="size-24" />
		{/snippet}
	</FileUpload>
</div>
