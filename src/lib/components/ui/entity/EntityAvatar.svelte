<script lang="ts">
	import { hashPattern } from '$lib/utils/patterns';
	import { imageSrc, type ImagePreset } from '$lib/utils/images';
	import { imageStatus, type ImageStatus } from '../image-status';

	let {
		shape = 'round',
		name,
		image,
		size = 'avatar-md',
		class: className = ''
	}: {
		/** member = round, band = square — the directory-wide convention */
		shape?: 'round' | 'square';
		name: string;
		image?: string | null;
		/** Match the CSS size this is rendered at, so the fetched image isn't oversized. */
		size?: ImagePreset;
		class?: string;
	} = $props();

	const img = $derived(imageSrc(image, size));

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
	const shapeClass = $derived(shape === 'round' ? 'rounded-full' : 'rounded-lg');
</script>

<div class="avatar relative overflow-hidden {shapeClass} {className}">
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
		font-size: 44cqmin;
		color: #fff;
		-webkit-text-stroke: 1.5px var(--cmc-brown);
		paint-order: stroke fill;
		letter-spacing: 0.02em;
		z-index: 1;
	}
</style>
