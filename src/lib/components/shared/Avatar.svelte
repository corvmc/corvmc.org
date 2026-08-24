<script lang="ts">
	import { Avatar } from 'bits-ui';
	import { hashPattern } from '$lib/utils/patterns';
	import { imageSrc, type ImagePreset } from '$lib/utils/images';

	const {
		src,
		name,
		size = 'avatar-md',
		...rest
	}: { src?: string; name: string; size?: ImagePreset; [key: string]: any } = $props();

	const img = $derived(imageSrc(src, size));

	const initials = $derived(
		name
			.split(' ')
			.map((w) => w[0])
			.join('')
			.toUpperCase()
			.slice(0, 2)
	);

	const patternClass = $derived(`poster-gen--${hashPattern(name)}`);
</script>

<Avatar.Root {...rest} class="avatar relative overflow-hidden rounded-full {rest.class}">
	<Avatar.Fallback class="avatar-pattern poster-gen {patternClass}">
		<span class="avatar-initials">{initials}</span>
	</Avatar.Fallback>
	<Avatar.Image
		src={img.src}
		srcset={img.srcset}
		alt={name}
		class="absolute inset-0 size-full object-cover"
	/>
</Avatar.Root>

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
