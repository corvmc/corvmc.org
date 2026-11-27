import { afterNavigate } from '$app/navigation';
import { onMount } from 'svelte';

// A text field or editor wins over buttons, so a rich-text editor's toolbar
// does not take focus before its editing area.
const FIELD =
	'input:not([type="hidden"]):not([disabled]), textarea:not([disabled]), select:not([disabled]), [contenteditable="true"]';
const ANY = `${FIELD}, button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])`;

// How long a target may take to grow its field (a lazily imported editor).
const LAZY_FIELD_MS = 5000;

/**
 * Focus the first control inside the element the hash names. Returns whether one took focus.
 * A target with no field yet is watched: when its field appears it takes focus, unless the
 * user has focused something else by then.
 */
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
	const field = target.querySelector<HTMLElement>(FIELD);
	const control = field ?? target.querySelector<HTMLElement>(ANY);
	control?.focus({ preventScroll: true });
	if (!field) focusFieldWhenItAppears(target, control);
	return !!control && document.activeElement === control;
}

function focusFieldWhenItAppears(target: HTMLElement, placeholder: HTMLElement | null) {
	const stop = () => {
		observer.disconnect();
		clearTimeout(timer);
	};
	const observer = new MutationObserver(() => {
		const active = document.activeElement;
		if (active && active !== document.body && active !== placeholder) return stop();
		const field = target.querySelector<HTMLElement>(FIELD);
		if (!field) return;
		field.focus({ preventScroll: true });
		stop();
	});
	const timer = setTimeout(stop, LAZY_FIELD_MS);
	observer.observe(target, {
		childList: true,
		subtree: true,
		attributes: true,
		attributeFilter: ['contenteditable', 'disabled', 'type']
	});
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
