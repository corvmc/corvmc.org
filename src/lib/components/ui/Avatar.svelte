<script lang="ts">
	import { hashPattern } from '$lib/utils/patterns';
	import { imageSrc, type ImagePreset } from '$lib/utils/images';
	import { imageStatus, type ImageStatus } from './image-status';

	const {
		src,
		name,
		size = 'avatar-md',
		shape = 'circle',
		...rest
	}: {
		src?: string;
		name: string;
		size?: ImagePreset;
		/**
		 * `square` for an avatar standing in for an icon — a band or club in a
		 * nav row, where a circle among square glyphs reads as a different kind
		 * of thing and lines up with none of them.
		 */
		shape?: 'circle' | 'square';
		[key: string]: unknown;
	} = $props();

	const radius = $derived(shape === 'square' ? 'rounded-sm' : 'rounded-full');

	const img = $derived(imageSrc(src, size));

	const initials = $derived(
		name
			.split(' ')
			.map((w) => w[0])
			.join('')
			.toUpperCase()
			.slice(0, 2)
	);

	let status = $state<ImageStatus>('loading');

	const patternClass = $derived(`poster-gen--${hashPattern(name)}`);
</script>

<div {...rest} class="avatar relative overflow-hidden {radius} {rest.class}">
	{#if status !== 'loaded'}
		<span class="avatar-pattern poster-gen {patternClass}">
			<span class="avatar-initials">{initials}</span>
		</span>
	{/if}
	{#if img.src}
		{#key img.src}
			<img
				src={img.src}
				srcset={img.srcset}
				alt={name}
				class="absolute inset-0 size-full object-cover"
				style:display={status === 'loaded' ? undefined : 'none'}
				{@attach imageStatus((s) => (status = s))}
			/>
		{/key}
	{/if}
</div>

<style>
	:global(.avatar) {
		container-type: size;
	}
	:global(.avatar-pattern) {
		width: 100%;
		height: 100%;
		display: flex;
		align-items: center;
		justify-content: center;
	}
	:global(.avatar-initials) {
		font-weight: 700;
		font-size: 50cqmin;
		color: #fff;
		-webkit-text-stroke: 1.5px var(--cmc-brown);
		paint-order: stroke fill;
		letter-spacing: 0.02em;
		z-index: 1;
	}
</style>
