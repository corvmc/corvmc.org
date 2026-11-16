<script lang="ts">
	/**
	 * A message body: markdown on the in-app channels, plain text on the rest.
	 * The only component that renders a message body as HTML, and only through
	 * `renderMessageMarkdown` (`message-body.spec.ts`).
	 */
	import type { inboxChannels } from '#lib/config.js';
	import { messageBodyIsMarkdown, renderMessageMarkdown } from '#lib/utils/markdown.js';

	let { body, channel }: { body: string; channel: (typeof inboxChannels)[number] } = $props();
</script>

{#if messageBodyIsMarkdown(channel)}
	<div class="message-body">
		<!-- eslint-disable-next-line svelte/no-at-html-tags -- sanitized by renderMessageMarkdown (markdown.spec.ts) -->
		{@html renderMessageMarkdown(body)}
	</div>
{:else}
	<!-- Email and SMS bodies are plain text; without pre-wrap every
	     multi-paragraph email collapses into one run-on block. -->
	<div class="whitespace-pre-wrap">{body}</div>
{/if}

<style>
	.message-body :global(:where(p, ul, ol, pre, blockquote, h1, h2, h3, h4, h5, h6)) {
		margin-block: 0.25rem;
	}
	.message-body :global(:where(:first-child)) {
		margin-block-start: 0;
	}
	.message-body :global(:where(:last-child)) {
		margin-block-end: 0;
	}
	.message-body :global(:where(ul)) {
		list-style: disc;
		padding-inline-start: 1.25rem;
	}
	.message-body :global(:where(ol)) {
		list-style: decimal;
		padding-inline-start: 1.25rem;
	}
	.message-body :global(:where(h1, h2, h3, h4, h5, h6)) {
		font-weight: 600;
	}
	.message-body :global(:where(a)) {
		text-decoration: underline;
	}
	.message-body :global(:where(blockquote)) {
		border-inline-start: 2px solid currentColor;
		padding-inline-start: 0.5rem;
		opacity: 0.8;
	}
	.message-body :global(:where(code)) {
		font-family: var(--font-mono, monospace);
		font-size: 0.875em;
	}
	.message-body :global(:where(pre)) {
		white-space: pre-wrap;
	}
</style>
