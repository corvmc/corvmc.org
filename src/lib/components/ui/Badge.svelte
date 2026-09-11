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
	import type { HTMLAttributes } from 'svelte/elements';
	import clsx from 'clsx';

	/**
	 * The overflow is the `<span>`'s own attribute type, not `[key: string]: unknown`.
	 *
	 * A catch-all index signature turns off prop-name checking altogether, so a
	 * prop that does not exist lands on the DOM as a dead attribute and nothing —
	 * not svelte-check, not ESLint, not the browser — says so. Thirteen call sites
	 * passed `color=` for a component whose prop is `variant` (#912) and rendered a
	 * grey pill for it. `HTMLAttributes` still forwards `title`, `id`, `data-*` and
	 * every aria attribute, and now a typo is a type error at the call site.
	 */
	let {
		variant,
		size = 'sm',
		class: className = '',
		children,
		...rest
	}: {
		variant?: BadgeVariant;
		size?: BadgeSize;
		children: Snippet;
	} & HTMLAttributes<HTMLSpanElement> = $props();

	const classes = $derived(clsx('badge', variant && VARIANTS[variant], SIZES[size], className));
</script>

<span {...rest} class={classes}>
	{@render children()}
</span>
