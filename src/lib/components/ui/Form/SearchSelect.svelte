<script lang="ts" generics="T extends { id: string }">
	import { m } from '#lib/paraglide/messages.js';
	/** The keys of `T` whose value is a string — the only ones that can label an option. */
	type StringKey<O> = {
		[K in keyof O]: O[K] extends string | null | undefined ? K : never;
	}[keyof O] &
		string;
	import { Combobox } from 'bits-ui';
	import Button from '#lib/components/ui/Button.svelte';
	import Alert from '#lib/components/ui/Alert.svelte';
	import { errorMessage } from '#lib/error-message.js';
	import type { RemoteFormField, RemoteFormFieldValue } from '$app/server';

	let {
		search,
		value = $bindable(null),
		labelKey = 'name' as StringKey<T>,
		descriptionKey = 'email' as StringKey<T>,
		placeholder = m.ui_search_by_name_email(),
		minChars = 2,
		name,
		field,
		onselect
	}: {
		search: (query: string) => Promise<T[]>;
		value?: T | null;
		labelKey?: StringKey<T>;
		descriptionKey?: StringKey<T>;
		placeholder?: string;
		minChars?: number;
		/**
		 * A plain `name`, for a plain `<form>`.
		 *
		 * **Not for a remote form.** A remote form encodes its own field names, so
		 * a hidden input carrying a bare `name` arrives as nothing: the submit
		 * fails Zod on a field the page never posted, and the issue has no
		 * control to render against. That is invisible — a toast saying to fix
		 * the highlighted fields, and nothing highlighted (#1019). Pass `field`
		 * instead.
		 */
		name?: string;
		/** The remote form's own field, which is what makes the value arrive. */
		field?: RemoteFormField<RemoteFormFieldValue>;
		/** Fires when a result is picked, and with `null` when the choice is cleared. */
		onselect?: (value: T | null) => void;
	} = $props();

	// Results are plain state written by the latest search alone, not an awaited
	// `$derived`: when overlapping searches settled in one tick, the derived kept
	// an older query's results, so a capped prefix search could hide the match
	// for good (#1970). `seq` drops every answer but the newest.
	let typed = $state('');
	let query = $state('');
	let results = $state<T[]>([]);
	let settled = $state('');
	let failure = $state<unknown>(null);
	let seq = 0;
	let timer: ReturnType<typeof setTimeout> | undefined;

	async function run(q: string) {
		const mine = ++seq;
		query = q;
		if (q.length < minChars) {
			results = [];
			settled = q;
			return;
		}
		try {
			const found = await search(q);
			if (mine !== seq) return;
			results = found;
			failure = null;
			settled = q;
		} catch (error) {
			if (mine === seq) failure = error;
		}
	}

	function onTyped(next: string) {
		typed = next;
		clearTimeout(timer);
		timer = setTimeout(() => run(next), 150);
	}
	let comboValue = $state<string[]>([]);

	/**
	 * Commits the pick in the handler bits-ui calls, not in an `$effect`.
	 *
	 * An effect lands a tick *after* the click. Every caller posts the choice
	 * through a hidden input, and a submit inside that tick sends an empty one —
	 * which a remote form reads as a deliberate blank, not as "nothing picked".
	 * The form then reports success having saved the opposite of what was
	 * clicked. `e2e/messages.e2e.ts` had to work around the window; the event
	 * picker in `e2e/volunteering.e2e.ts` failed on it outright.
	 *
	 * `onValueChange` covers the keyboard too — bits-ui selects on Enter without
	 * dispatching a click, so an `onclick` on the item would not have.
	 */
	function commit(ids: string[]) {
		const found = results.find((r) => r.id === ids[0]);
		if (!found) return;
		value = found;
		clearTimeout(timer);
		seq++;
		typed = '';
		query = '';
		results = [];
		onselect?.(found);
	}

	function clear() {
		value = null;
		comboValue = [];
		onselect?.(null);
	}
</script>

{#if field && value}
	<input {...field.as('hidden', value.id)} />
{:else if name && value}
	<input type="hidden" {name} value={value.id} />
{/if}

{#if value}
	<div class="flex items-center gap-2">
		<div class="badge gap-2 badge-lg">
			{value[labelKey]}
			<!-- Named, because a bare ✕ is indistinguishable from the enclosing
			     modal's own close button to a screen reader and to a test. -->
			<Button
				type="button"
				variant="ghost"
				size="xs"
				shape="circle"
				aria-label={m.ui_clear_value({ value: String(value[labelKey]) })}
				onclick={clear}>✕</Button
			>
		</div>
		{#if value[descriptionKey]}
			<span class="text-muted">{value[descriptionKey]}</span>
		{/if}
	</div>
{:else}
	<Combobox.Root type="multiple" bind:value={comboValue} onValueChange={commit} inputValue={typed}>
		<div class="relative">
			<Combobox.Input
				{placeholder}
				class="input w-full"
				oninput={(e: Event) => onTyped((e.target as HTMLInputElement).value)}
			/>
			<!--
					`flex-nowrap` is load bearing. daisyUI's `.menu` is `flex-flow: column
					wrap`, so a capped height makes the list wrap into a *second column*
					rather than scroll — and since `.menu` is also `width: fit-content`,
					that column runs off the side of the popover where it cannot be
					reached. Invisible until a search returns more than a few results.
				-->
			<Combobox.Content
				class="menu z-10 max-h-60 w-full flex-nowrap overflow-y-auto rounded-box bg-base-100 p-1 shadow-lg"
				sideOffset={4}
			>
				{#each results as item (item.id)}
					<Combobox.Item
						value={item.id}
						label={String(item[labelKey] ?? '')}
						class="rounded-btn cursor-pointer px-3 py-2 data-[highlighted]:bg-base-200"
					>
						<span class="font-medium">{item[labelKey]}</span>
						{#if item[descriptionKey]}
							<span class="ml-2 text-muted">{item[descriptionKey]}</span>
						{/if}
					</Combobox.Item>
				{:else}
					{#if query.length < minChars}
						<div class="px-3 py-2 opacity-60">{m.ui_search_prompt()}</div>
					{:else if settled === query}
						<div class="px-3 py-2 opacity-60">{m.ui_search_no_results()}</div>
					{/if}
				{/each}
			</Combobox.Content>
		</div>
	</Combobox.Root>
	{#if failure}
		<Alert type="warning" reset={() => run(query)}>
			{m.ui_search_failed({ error: errorMessage(failure) })}
		</Alert>
	{/if}
{/if}
