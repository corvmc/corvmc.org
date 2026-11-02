<script lang="ts">
	/** Every address on a roster to the clipboard, comma-separated and deduplicated. */
	import { toast } from 'svelte-sonner';
	import { IconCopy } from '@tabler/icons-svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import { uniqueEmails } from '$lib/utils/unique-emails';

	let {
		emails
	}: {
		/** The addresses themselves, or a fetch of every match rather than one page's. */
		emails: (string | null)[] | (() => Promise<string[]>);
	} = $props();

	let copying = $state(false);
	async function copy() {
		copying = true;
		try {
			const list = uniqueEmails(typeof emails === 'function' ? await emails() : emails);
			if (list.length === 0) {
				toast.info('No email addresses');
				return;
			}
			await navigator.clipboard.writeText(list.join(', '));
			toast.success(`Copied ${list.length} ${list.length === 1 ? 'address' : 'addresses'}`);
		} catch {
			toast.error("Couldn't copy");
		} finally {
			copying = false;
		}
	}
</script>

<Button variant="ghost" size="sm" onclick={copy} disabled={copying}>
	<IconCopy size={16} />
	Copy emails
</Button>
