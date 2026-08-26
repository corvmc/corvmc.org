<script lang="ts">
	import type { Snippet } from 'svelte';

	let {
		children,
		itemCount = 0,
		cardWidth = 360,
		class: className = ''
	}: {
		children: Snippet;
		itemCount?: number;
		cardWidth?: number;
		class?: string;
	} = $props();

	let trackEl: HTMLDivElement | undefined = $state();
	let currentIndex = $state(0);
	let maxIndex = $state(0);

	$effect(() => {
		if (!trackEl || itemCount === 0) return;

		function onScroll() {
			if (!trackEl) return;
			const gap = 18;
			const step = cardWidth + gap;
			const idx = Math.round(trackEl.scrollLeft / step);
			currentIndex = idx;
		}

		function computeMax() {
			if (!trackEl) return;
			const gap = 18;
			const step = cardWidth + gap;
			const visible = Math.floor((trackEl.clientWidth + gap) / step);
			maxIndex = Math.max(0, itemCount - visible);
		}

		computeMax();
		trackEl.addEventListener('scroll', onScroll, { passive: true });
		const resizeObs = new ResizeObserver(computeMax);
		resizeObs.observe(trackEl);

		return () => {
			trackEl?.removeEventListener('scroll', onScroll);
			resizeObs.disconnect();
		};
	});

	function scrollTo(index: number) {
		if (!trackEl) return;
		const gap = 18;
		const step = cardWidth + gap;
		trackEl.scrollTo({ left: step * index, behavior: 'smooth' });
	}

	function prev() {
		scrollTo(Math.max(0, currentIndex - 1));
	}
	function next() {
		scrollTo(Math.min(maxIndex, currentIndex + 1));
	}
</script>

<div class="carousel-wrap {className}">
	<div class="carousel__track" bind:this={trackEl} style="--card-w: {cardWidth}px">
		{@render children()}
	</div>

	{#if maxIndex > 0}
		<div class="carousel__ctrls">
			<button
				class="carousel__nav"
				onclick={prev}
				disabled={currentIndex === 0}
				aria-label="Previous"
			>
				<svg
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					stroke-width="2.5"
					stroke-linecap="round"
					stroke-linejoin="round"><path d="M15 6l-6 6 6 6" /></svg
				>
			</button>
			<div class="carousel__dots">
				{#each Array(maxIndex + 1) as _, i (i)}
					<button
						class="carousel__dot"
						class:is-active={i === currentIndex}
						onclick={() => scrollTo(i)}
						aria-label="Go to slide {i + 1}"
					></button>
				{/each}
			</div>
			<button
				class="carousel__nav"
				onclick={next}
				disabled={currentIndex >= maxIndex}
				aria-label="Next"
			>
				<svg
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					stroke-width="2.5"
					stroke-linecap="round"
					stroke-linejoin="round"><path d="M9 6l6 6-6 6" /></svg
				>
			</button>
		</div>
	{/if}
</div>

<style>
	.carousel__track > :global(*) {
		flex-shrink: 0;
		width: var(--card-w, 360px);
		scroll-snap-align: start;
	}
</style>
