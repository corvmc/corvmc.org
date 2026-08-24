<script lang="ts">
	import Button from '$lib/components/shared/Button.svelte';
	import { untrack } from 'svelte';
	import { browser } from '$app/environment';
	import { Editor } from '@tiptap/core';
	import StarterKit from '@tiptap/starter-kit';
	import {
		IconBold,
		IconItalic,
		IconUnderline,
		IconList,
		IconListNumbers,
		IconBlockquote,
		IconLink,
		IconH3
	} from '@tabler/icons-svelte';

	let {
		value = $bindable(''),
		placeholder = ''
	}: {
		value?: string;
		placeholder?: string;
	} = $props();

	let element = $state<HTMLDivElement>();
	let editor = $state<Editor>();
	// Bump on every editor transaction so toolbar active-states stay reactive.
	let tick = $state(0);

	// The last external value this editor applied (or produced via onUpdate).
	// Tiptap normalizes content on parse — plain text 'foo' becomes '<p>foo</p>'
	// — so a stored plain-text value can NEVER equal getHTML(). Without this
	// guard the reconcile effect below re-fires setContent (whose transactions
	// write `tick`) on every flush, and Svelte's flush guard throws
	// effect_update_depth_exceeded — the crash that took down the profile and
	// band edit pages for any profile with a plain-text bio. Deliberately a
	// plain (non-reactive) variable.
	let lastApplied: string | null = null;

	$effect(() => {
		if (!browser || !element) return;
		lastApplied = untrack(() => value) ?? '';
		const ed = new Editor({
			element,
			extensions: [StarterKit.configure({ heading: { levels: [3] } })],
			content: untrack(() => value) || '',
			editorProps: {
				attributes: {
					class: 'prose prose-sm max-w-none min-h-32 px-3 py-2 focus:outline-none'
				}
			},
			onUpdate: ({ editor }) => {
				value = editor.getHTML();
				lastApplied = value;
				// Notify the surrounding FormField/Form so dirty tracking fires.
				element?.dispatchEvent(new Event('input', { bubbles: true }));
			},
			onTransaction: () => {
				tick++;
			}
		});
		editor = ed;
		return () => {
			ed.destroy();
			editor = undefined;
		};
	});

	// Tiptap renders an empty document as '<p></p>', so a falsy external value
	// and an empty editor are the same content — without this equivalence the
	// reconcile effect below fires a spurious setContent on every mount with an
	// empty value.
	function sameContent(a: string, b: string): boolean {
		const norm = (s: string) => (s === '' || s === '<p></p>' ? '' : s);
		return norm(a) === norm(b);
	}

	// Reflect external value changes (e.g. async profile load, form reset).
	// Each distinct external value is applied at most once (see lastApplied).
	$effect(() => {
		const v = value ?? '';
		if (!editor || v === lastApplied) return;
		lastApplied = v;
		if (
			!sameContent(
				v,
				untrack(() => editor!.getHTML())
			)
		) {
			editor.commands.setContent(v || '', { emitUpdate: false });
		}
	});

	function isActive(name: string, attrs?: Record<string, unknown>): boolean {
		void tick;
		return editor?.isActive(name, attrs) ?? false;
	}

	function toggleLink() {
		if (!editor) return;
		if (editor.isActive('link')) {
			editor.chain().focus().unsetLink().run();
			return;
		}
		const url = window.prompt('Link URL');
		if (url) editor.chain().focus().setLink({ href: url }).run();
	}
</script>

<div class="rounded-box border border-base-300">
	{#if editor}
		<div class="join flex flex-wrap border-b border-base-300 rounded-b-none">
			<Button
				type="button"
				variant="ghost"
				size="xs"
				shape="square"
				class="join-item rounded-b-none {isActive('bold') ? 'btn-active' : ''}"
				aria-label="Bold"
				onclick={() => editor!.chain().focus().toggleBold().run()}
			>
				<IconBold size={16} />
			</Button>
			<Button
				type="button"
				variant="ghost"
				size="xs"
				shape="square"
				class="join-item {isActive('italic') ? 'btn-active' : ''}"
				aria-label="Italic"
				onclick={() => editor!.chain().focus().toggleItalic().run()}
			>
				<IconItalic size={16} />
			</Button>
			<Button
				type="button"
				variant="ghost"
				size="xs"
				shape="square"
				class="join-item {isActive('underline') ? 'btn-active' : ''}"
				aria-label="Underline"
				onclick={() => editor!.chain().focus().toggleUnderline().run()}
			>
				<IconUnderline size={16} />
			</Button>
			<Button
				type="button"
				variant="ghost"
				size="xs"
				shape="square"
				class="join-item {isActive('heading', { level: 3 }) ? 'btn-active' : ''}"
				aria-label="Heading"
				onclick={() => editor!.chain().focus().toggleHeading({ level: 3 }).run()}
			>
				<IconH3 size={16} />
			</Button>
			<Button
				type="button"
				variant="ghost"
				size="xs"
				shape="square"
				class="join-item {isActive('bulletList') ? 'btn-active' : ''}"
				aria-label="Bullet list"
				onclick={() => editor!.chain().focus().toggleBulletList().run()}
			>
				<IconList size={16} />
			</Button>
			<Button
				type="button"
				variant="ghost"
				size="xs"
				shape="square"
				class="join-item {isActive('orderedList') ? 'btn-active' : ''}"
				aria-label="Numbered list"
				onclick={() => editor!.chain().focus().toggleOrderedList().run()}
			>
				<IconListNumbers size={16} />
			</Button>
			<Button
				type="button"
				variant="ghost"
				size="xs"
				shape="square"
				class="join-item {isActive('blockquote') ? 'btn-active' : ''}"
				aria-label="Quote"
				onclick={() => editor!.chain().focus().toggleBlockquote().run()}
			>
				<IconBlockquote size={16} />
			</Button>
			<Button
				type="button"
				variant="ghost"
				size="xs"
				shape="square"
				class="join-item rounded-b-none {isActive('link') ? 'btn-active' : ''}"
				aria-label="Link"
				onclick={toggleLink}
			>
				<IconLink size={16} />
			</Button>
			<div
				class="filler join-item rounded-b-none grow btn btn-xs pointer-events-none btn-ghost"
			></div>
		</div>
	{/if}
	<div bind:this={element} data-placeholder={placeholder}></div>
</div>
