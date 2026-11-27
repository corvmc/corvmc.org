import { afterNavigate } from '$app/navigation';
import { onMount } from 'svelte';

// A text field or editor wins over buttons, so a rich-text editor's toolbar
// does not take focus before its editing area.
const FIELD =
	'input:not([type="hidden"]):not([disabled]), textarea:not([disabled]), select:not([disabled]), [contenteditable="true"]';
const ANY = `${FIELD}, button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])`;

/** Focus the first control inside the element the hash names. Returns whether one took focus. */
export function focusHashTarget(hash: string = location.hash): boolean {
	let id: string;
	try {
		id = decodeURIComponent(hash.replace(/^#/, ''));
	} catch {
		return false;
	}
	if (!id) return false;
	const target = document.getElementById(id);
	if (!target) return false;
	const control =
		target.querySelector<HTMLElement>(FIELD) ?? target.querySelector<HTMLElement>(ANY);
	if (!control) return false;
	control.focus({ preventScroll: true });
	return document.activeElement === control;
}

/**
 * Focus the field a `#id` link points at, on load, after a client navigation and on
 * `hashchange`. Call once while a page component initialises.
 */
export function focusHashOnNavigation(): void {
	afterNavigate(() => {
		focusHashTarget();
	});
	onMount(() => {
		const onHashChange = () => focusHashTarget();
		window.addEventListener('hashchange', onHashChange);
		return () => window.removeEventListener('hashchange', onHashChange);
	});
}
