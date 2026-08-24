<script lang="ts">
	import type { Snippet } from 'svelte';
	import { onMount, untrack } from 'svelte';
	import { readCollapsed, writeCollapsed } from './nav-collapse';

	let {
		title,
		action,
		children,
		collapsible = false,
		persistKey,
		persistScope = 'staff',
		containsActive = false
	}: {
		title: string;
		action?: Snippet;
		children: Snippet;
		/** Turns the title into a disclosure button. Off keeps the original markup. */
		collapsible?: boolean;
		/** Stable id for the remembered state — a section key, never the title. */
		persistKey?: string;
		/** Namespaces the record, so panels don't share a key space. */
		persistScope?: string;
		/** Does the current page live in this group? */
		containsActive?: boolean;
	} = $props();

	const uid = $props.id();

	// Open on the server and on the first client render, so the markup matches
	// and nothing flashes for the common case. Storage is only consulted once
	// hydration is done.
	let collapsed = $state(false);

	onMount(() => {
		if (collapsible && persistKey) collapsed = readCollapsed(persistScope, persistKey);
	});

	function toggle() {
		collapsed = !collapsed;
		// Written here rather than in an effect: an effect would fire on mount and
		// overwrite the stored value before `onMount` had read it.
		if (persistKey) writeCollapsed(persistScope, persistKey, collapsed);
	}

	// Landing on a page whose group is collapsed would hide the row you are on.
	// Open it, and keep it open — you have just demonstrated you use the group.
	let wasActive = false;
	$effect(() => {
		const nowActive = containsActive;
		untrack(() => {
			if (nowActive && !wasActive && collapsed) {
				collapsed = false;
				if (persistKey) writeCollapsed(persistScope, persistKey, false);
			}
			wasActive = nowActive;
		});
	});
</script>

{#if collapsible}
	<li>
		<button
			type="button"
			class="menu-title menu-dropdown-toggle flex w-full flex-row items-center justify-between"
			class:menu-dropdown-show={!collapsed}
			aria-expanded={!collapsed}
			aria-controls="nav-group-{uid}"
			onclick={toggle}
		>
			<span>{title}</span>
		</button>
		{#if action}
			{@render action()}
		{/if}
		<!-- daisyUI indents and draws a guide rule on any `li ul`; cancelled here so
		     a collapsible group sits flush like the plain one. Its rule is wrapped
		     in `:where()`, so plain utilities outrank it without `!`. -->
		<ul
			id="nav-group-{uid}"
			class="menu-dropdown ms-0 ps-0 before:content-none"
			class:menu-dropdown-show={!collapsed}
		>
			{@render children()}
		</ul>
	</li>
{:else}
	<li class="menu-title flex flex-row items-center justify-between">
		<span>{title}</span>
		{#if action}
			{@render action()}
		{/if}
	</li>
	<ul>{@render children()}</ul>
{/if}

<style>
	/* daisyUI hides `.menu-dropdown:not(.menu-dropdown-show)` too, but only for a
	   `li` inside a `.menu`. Owning the rule means the group still collapses if
	   it is ever rendered outside one, and means the behaviour is testable
	   without loading the app stylesheet. */
	ul.menu-dropdown:not(.menu-dropdown-show) {
		display: none;
	}

	/* daisyUI excludes `.menu-title` from its own hover/focus treatment, which is
	   right for a static label and wrong for a button. */
	button.menu-title {
		cursor: pointer;
		border-radius: var(--radius-field);
	}

	button.menu-title:hover,
	button.menu-title:focus-visible {
		background-color: color-mix(in oklab, var(--color-base-content) 10%, transparent);
	}
</style>
