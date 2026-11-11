<script lang="ts" generics="T extends ActivityRow">
	import { m } from '#lib/paraglide/messages.js';
	import type { Snippet } from 'svelte';
	import Button from '../Button.svelte';
	import EmptyState from '../EmptyState.svelte';
	import { formatHistoryTime } from '#lib/utils/format.js';
	import type { ActivityRow } from './types';

	/**
	 * Every staff history, newest first, whatever it was read from. `trailing`
	 * carries a source's own figure (`+$10 · balance $40`, `−2 · repaired`) at
	 * the row's end; the caller maps its rows and owns the empty-state words.
	 */
	let {
		rows,
		hasMore = false,
		onmore,
		empty,
		label = m.ui_activity_label(),
		trailing
	}: {
		rows: T[];
		hasMore?: boolean;
		onmore?: () => void;
		empty: { title: string; description?: string };
		label?: string;
		trailing?: Snippet<[T]>;
	} = $props();
</script>

{#if rows.length === 0}
	<EmptyState title={empty.title} description={empty.description} />
{:else}
	<ol class="flex flex-col divide-y divide-base-200" aria-label={label}>
		{#each rows as row (row.id)}
			<li class="flex items-start gap-3 py-2 text-sm">
				<div class="min-w-0 flex-1">
					<div>
						{#if row.href}
							<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- typed ResolvedPathname; the caller resolved it -->
							<a class="link" href={row.href}>{row.summary}</a>
						{:else}
							{row.summary}
						{/if}
					</div>
					<div class="text-muted text-xs">
						{#if row.actor}
							{#if row.actor.href}
								<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- typed ResolvedPathname; the caller resolved it -->
								<a class="link" href={row.actor.href}>{row.actor.name}</a>
							{:else}
								{row.actor.name}
							{/if}
							·
						{/if}
						<time datetime={row.at.toISOString()}>{formatHistoryTime(row.at)}</time>
						{#if row.context}
							·
							{#if row.context.href}
								<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- typed ResolvedPathname; the caller resolved it -->
								<a class="link" href={row.context.href}>{row.context.label}</a>
							{:else}
								{row.context.label}
							{/if}
						{/if}
					</div>
				</div>
				{#if trailing}
					<div class="shrink-0 text-right whitespace-nowrap tabular-nums">
						{@render trailing(row)}
					</div>
				{/if}
			</li>
		{/each}
	</ol>
	{#if hasMore && onmore}
		<Button size="sm" variant="ghost" onclick={onmore}>{m.ui_feed_show_older_label()}</Button>
	{/if}
{/if}
