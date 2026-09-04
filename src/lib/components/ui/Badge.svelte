<script lang="ts" module>
	/**
	 * Variant and size classes as **literal** strings.
	 *
	 * `badge-${variant}` is invisible to Tailwind's source scanner, so a computed
	 * name emits no CSS. Every variant here worked only by accident — because
	 * some *other* file wrote the literal — and `badge-secondary`, which nothing
	 * else used, silently rendered an unstyled pill on the page background while
	 * type-checking clean. A lookup table of whole literals is what makes the
	 * component's own type union true.
	 */
	const VARIANTS = {
		outline: 'badge-outline',
		ghost: 'badge-ghost',
		primary: 'badge-primary',
		secondary: 'badge-secondary',
		success: 'badge-success',
		error: 'badge-error',
		warning: 'badge-warning',
		info: 'badge-info',
		neutral: 'badge-neutral'
	} as const;

	const SIZES = {
		xs: 'badge-xs',
		sm: 'badge-sm',
		md: '',
		lg: 'badge-lg'
	} as const;

	export type BadgeVariant = keyof typeof VARIANTS;
	export type BadgeSize = keyof typeof SIZES;
</script>

<script lang="ts">
	import type { Snippet } from 'svelte';
	import clsx from 'clsx';

	let {
		variant,
		size = 'sm',
		class: className = '',
		children,
		...rest
	}: {
		variant?: BadgeVariant;
		size?: BadgeSize;
		class?: string;
		children: Snippet;
		/** Forwarded to the `<span>` — `title`, `id`, `data-*`, aria attributes. */
		[key: string]: unknown;
	} = $props();

	const classes = $derived(clsx('badge', variant && VARIANTS[variant], SIZES[size], className));
</script>

<span {...rest} class={classes}>
	{@render children()}
</span>
