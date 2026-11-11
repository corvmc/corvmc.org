<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import { IconX } from '@tabler/icons-svelte';
	import { Latest } from '#lib/latest.svelte.js';
	import {
		getInboxThreadContext,
		addInboxThreadTag,
		removeInboxThreadTag
	} from '#lib/remote/inbox.remote.js';

	/**
	 * The details strip's tag editor. Through `Latest` rather than `{#await}`:
	 * adding a tag refreshes the context, and a re-pend would remount the input
	 * mid-typing (#2357).
	 */
	let { threadId }: { threadId: string } = $props();

	const context = new Latest(() => getInboxThreadContext(threadId));
	$effect(() => {
		if (context.error) throw context.error.e;
	});

	let newTag = $state('');
</script>

{#if context.current}
	<div
		aria-busy={context.loading}
		class={['flex flex-wrap items-center gap-1', context.loading && 'opacity-60']}
	>
		{#each context.current.tags as tag (tag)}
			<span class="badge gap-1 badge-ghost badge-sm">
				{tag}
				<button
					type="button"
					class="cursor-pointer opacity-50 hover:opacity-100"
					aria-label={m.staff_inbox_id_details_panel_remove_tag_label({ tag })}
					onclick={() => removeInboxThreadTag({ threadId, tag })}
				>
					<IconX size={11} />
				</button>
			</span>
		{/each}
		<!-- A bare input rather than FormField: this is not a form submission, it
		     is a command fired on Enter, and there is no validation state to show. -->
		<input
			class="input w-24 input-xs"
			placeholder={m.staff_inbox_id_details_panel_placeholder()}
			aria-label={m.staff_inbox_id_details_panel_add_tag_label()}
			bind:value={newTag}
			onkeydown={(e) => {
				if (e.key !== 'Enter' || !newTag.trim()) return;
				e.preventDefault();
				void addInboxThreadTag({ threadId, tag: newTag.trim() });
				newTag = '';
			}}
		/>
	</div>
{/if}
