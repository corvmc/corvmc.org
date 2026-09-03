<script lang="ts">
	import ProfileSection from './ProfileSection.svelte';
	import type { PressQuote } from '$lib/types/band-page';

	/**
	 * What other people have said, and what the act has done.
	 *
	 * Both halves of the marketing press kit in one section, because separately
	 * each is usually one or two lines and two near-empty cards read worse than
	 * one filled one.
	 */
	let { quotes = [], achievements = [] }: { quotes?: PressQuote[]; achievements?: string[] } =
		$props();

	const shownQuotes = $derived(quotes.filter((q) => q.quote.trim()));
	const shownAchievements = $derived(achievements.filter((a) => a.trim()));
	const hasAny = $derived(shownQuotes.length > 0 || shownAchievements.length > 0);
</script>

{#if hasAny}
	<ProfileSection title="Press">
		{#if shownQuotes.length > 0}
			<div class="press__quotes">
				{#each shownQuotes as quote (quote.quote)}
					<figure class="press__quote">
						<blockquote>{quote.quote}</blockquote>
						<figcaption>
							{#if quote.url}
								<a href={quote.url} target="_blank" rel="noopener external">{quote.publication}</a>
							{:else}
								{quote.publication}
							{/if}
							{#if quote.date}<span class="press__date">{quote.date}</span>{/if}
						</figcaption>
					</figure>
				{/each}
			</div>
		{/if}

		{#if shownAchievements.length > 0}
			<ul class="press__list" class:press__list--spaced={shownQuotes.length > 0}>
				{#each shownAchievements as achievement (achievement)}
					<li>{achievement}</li>
				{/each}
			</ul>
		{/if}
	</ProfileSection>
{/if}

<style>
	.press__quotes {
		display: flex;
		flex-direction: column;
		gap: 14px;
	}
	.press__quote {
		margin: 0;
		border-left: 2px solid color-mix(in oklch, var(--cmc-brown) 30%, transparent);
		padding-left: 12px;
	}
	.press__quote blockquote {
		margin: 0;
		font-style: italic;
		line-height: 1.5;
	}
	.press__quote blockquote::before {
		content: '\201C';
	}
	.press__quote blockquote::after {
		content: '\201D';
	}
	.press__quote figcaption {
		margin-top: 4px;
		font-size: 12px;
		color: var(--fg-3);
	}
	.press__date::before {
		content: ' · ';
	}
	.press__list {
		margin: 0;
		padding-left: 18px;
		display: flex;
		flex-direction: column;
		gap: 4px;
		font-size: 14px;
	}
	.press__list--spaced {
		margin-top: 16px;
		padding-top: 14px;
		border-top: 1px solid color-mix(in oklch, var(--cmc-brown) 14%, transparent);
	}
</style>
