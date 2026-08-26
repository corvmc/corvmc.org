<script lang="ts" module>
	/** daisyUI colour modifiers. `default` emits none — the plain `btn` surface. */
	const VARIANTS = {
		default: '',
		primary: 'btn-primary',
		secondary: 'btn-secondary',
		accent: 'btn-accent',
		neutral: 'btn-neutral',
		info: 'btn-info',
		success: 'btn-success',
		warning: 'btn-warning',
		error: 'btn-error',
		ghost: 'btn-ghost',
		link: 'btn-link'
	} as const;

	const SIZES = { xs: 'btn-xs', sm: 'btn-sm', md: '', lg: 'btn-lg' } as const;

	const SHAPES = {
		square: 'btn-square',
		circle: 'btn-circle',
		wide: 'btn-wide',
		block: 'btn-block'
	} as const;

	export type ButtonVariant = keyof typeof VARIANTS;
	export type ButtonSize = keyof typeof SIZES;
	export type ButtonShape = keyof typeof SHAPES;

	/** Does an escape-hatch `class` already pick a colour? See the note below. */
	const CARRIES_VARIANT = new RegExp(
		`(^|\\s)(${Object.values(VARIANTS).filter(Boolean).join('|')})(\\s|$)`
	);
</script>

<script lang="ts">
	import type { Snippet } from 'svelte';
	import { Button as BitsButton, Tooltip, mergeProps } from 'bits-ui';
	import clsx from 'clsx';

	/**
	 * The app's button. Variant, size and shape are props, not class strings —
	 * `variant="ghost" size="sm"`, never `class="btn-ghost btn-sm"`.
	 *
	 * That spelling used to be the API, and it drifted: one concept ended up
	 * written four ways (`btn-primary btn-sm`, `btn btn-primary btn-sm`, `btn
	 * btn-sm btn-primary`, `btn-sm btn-primary`) and 72 places in the routes gave
	 * up and hand-rolled `<button class="btn …">` instead. Props make the set
	 * enumerable and let `svelte-check` catch a typo that CSS would swallow.
	 *
	 * `outline` is its own boolean rather than a variant because daisyUI stacks
	 * it on a colour — `variant="error" outline` is `btn-error btn-outline`.
	 *
	 * The lookup tables are static objects, not `btn-${size}` template literals:
	 * Tailwind v4's source scanner only sees class names written out in full, so
	 * a computed one produces no CSS at all (`Table.svelte` carries the same note).
	 *
	 * `class` stays available for genuine one-offs — positioning (`mt-4`), a
	 * `join-item`, a bespoke skin (`program-block__cta`). If what you pass
	 * happens to include a daisyUI colour, that wins and the default `primary`
	 * steps aside, so an escape hatch can never collide with the default.
	 */
	let {
		href,
		title,
		disabled = false,
		variant,
		size = 'md',
		shape,
		outline = false,
		class: className = '',
		children,
		...rest
	}: {
		href?: string;
		/**
		 * Tooltip text — rendered on the button itself, not a wrapper (see below).
		 * On a disabled button it becomes a native `title` attribute instead: a
		 * disabled trigger never fires the hover events a tooltip needs, and the
		 * one thing a disabled control owes the user is why it is disabled.
		 */
		title?: string;
		disabled?: boolean;
		variant?: ButtonVariant;
		size?: ButtonSize;
		shape?: ButtonShape;
		/** Outlined treatment; combines with `variant`. */
		outline?: boolean;
		class?: string;
		children?: Snippet;
		[key: string]: unknown;
	} = $props();

	const resolvedVariant = $derived(
		variant ?? (CARRIES_VARIANT.test(className) ? 'default' : 'primary')
	);

	const classes = $derived(
		clsx(
			'btn',
			VARIANTS[resolvedVariant],
			SIZES[size],
			shape && SHAPES[shape],
			outline && 'btn-outline',
			className
		)
	);
</script>

<!-- `triggerProps` are the tooltip trigger's props, merged onto the button itself.
     Rendering them on a wrapper element instead would nest a <button> inside a
     <button> (or an <a> inside a <button>), which drops the control out of the
     accessibility tree entirely. -->
{#snippet renderButton(triggerProps?: Record<string | symbol, unknown>)}
	<BitsButton.Root {...mergeProps(triggerProps ?? {}, rest, { href, disabled, class: classes })}>
		{@render children?.()}
	</BitsButton.Root>
{/snippet}

<!-- A disabled trigger gets no hover events, so bits-ui's tooltip would never
     open and the explanation would be unreachable — which is the opposite of
     what a disabled control needs. Fall back to the native attribute. -->
{#snippet plainButton(nativeTitle?: string)}
	<BitsButton.Root {...mergeProps(rest, { href, disabled, class: classes, title: nativeTitle })}>
		{@render children?.()}
	</BitsButton.Root>
{/snippet}

{#if disabled && title}
	{@render plainButton(title)}
{:else if !title}
	{@render renderButton()}
{:else}
	<Tooltip.Root>
		<Tooltip.Trigger {disabled}>
			{#snippet child({ props })}
				{@render renderButton(props)}
			{/snippet}
		</Tooltip.Trigger>
		<Tooltip.Portal>
			<Tooltip.Content
				side="bottom"
				sideOffset={4}
				class="z-50 rounded bg-neutral px-2 py-1 text-xs text-neutral-content shadow-lg"
			>
				{title}
			</Tooltip.Content>
		</Tooltip.Portal>
	</Tooltip.Root>
{/if}
