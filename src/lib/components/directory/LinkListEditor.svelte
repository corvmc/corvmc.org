<script lang="ts">
	import type { RemoteFormFieldValue, RemoteFormField } from '@sveltejs/kit';
	import { IconPlus, IconTrash } from '@tabler/icons-svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import type { ProfileLink } from '$lib/server/db/schema/authentication';

	let {
		value = $bindable<ProfileLink[]>([]),
		field
	}: {
		value?: ProfileLink[];
		field?: RemoteFormField<RemoteFormFieldValue>;
	} = $props();

	function addLink() {
		value = [...value, { label: '', url: '' }];
	}

	function removeLink(index: number) {
		value = value.filter((_, i) => i !== index);
	}

	function updateLink(index: number, key: 'label' | 'url', v: string) {
		value = value.map((l, i) => (i === index ? { ...l, [key]: v } : l));
	}
</script>

{#if field}
	<input {...field.as('hidden', JSON.stringify(value))} />
{/if}

<div class="space-y-3">
	{#each value as link, i (i)}
		<div class="flex items-start gap-2">
			<div class="flex-1 space-y-1">
				<input
					type="text"
					value={link.label}
					oninput={(e) => updateLink(i, 'label', e.currentTarget.value)}
					placeholder="Label (e.g. My SoundCloud)"
					class="input w-full input-sm"
				/>
				<input
					type="url"
					value={link.url}
					oninput={(e) => updateLink(i, 'url', e.currentTarget.value)}
					placeholder="https://..."
					class="input w-full input-sm"
				/>
			</div>
			<Button
				type="button"
				variant="ghost"
				size="sm"
				shape="square"
				class="mt-1 text-error"
				aria-label="Remove link"
				onclick={() => removeLink(i)}
			>
				<IconTrash size={16} />
			</Button>
		</div>
	{/each}
	<Button type="button" variant="default" size="sm" outline class="gap-1" onclick={addLink}>
		<IconPlus size={16} /> Add link
	</Button>
</div>
