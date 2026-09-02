<script lang="ts">
	/**
	 * One of the three ways to send a reply.
	 *
	 * Sending always sets a disposition — the thread has to go *somewhere* — so
	 * the choice rides on the submit button rather than sitting in a separate
	 * control someone can forget. The name/value pair is ordinary HTML: only the
	 * clicked button's value reaches the FormData, so three of these in one form
	 * submit one `disposition`.
	 *
	 * `SubmitButton` renders the default option; this is the alternates. It reads
	 * the same form context for its disabled state so a second click during a
	 * round trip cannot send twice — an email reply is a real wait, and the
	 * primary button being visibly busy is no help if the ones beside it are not.
	 */
	import { getFormContext } from '$lib/components/ui/Form/Form.svelte';
	import Button from '$lib/components/ui/Button.svelte';

	let {
		value,
		label,
		disabled = false
	}: {
		/** The `disposition` this send applies. */
		value: 'resolve' | 'keep_open';
		label: string;
		disabled?: boolean;
	} = $props();

	const ctx = getFormContext();
	const busy = $derived(ctx ? ctx.status !== 'idle' && ctx.status !== 'dirty' : false);
</script>

<Button
	type="submit"
	name="disposition"
	{value}
	variant="default"
	size="sm"
	disabled={disabled || busy}
>
	{label}
</Button>
