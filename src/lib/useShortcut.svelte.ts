import { parseShortcut, matchesShortcut, isModifierKey, shortcutLabel } from '#lib/shortcuts.js';

export function useShortcut(getShortcut: () => string | undefined, onTrigger: () => void) {
	let modHeld = $state(false);
	const parsed = $derived(getShortcut() ? parseShortcut(getShortcut()!) : null);

	$effect(() => {
		if (!parsed) return;
		const p = parsed;

		function onKeydown(e: KeyboardEvent) {
			if (isModifierKey(e, p)) modHeld = true;
			if (matchesShortcut(e, p)) {
				e.preventDefault();
				onTrigger();
			}
		}

		function onKeyup(e: KeyboardEvent) {
			if (isModifierKey(e, p)) modHeld = false;
		}

		function onBlur() {
			modHeld = false;
		}

		window.addEventListener('keydown', onKeydown);
		window.addEventListener('keyup', onKeyup);
		window.addEventListener('blur', onBlur);

		return () => {
			window.removeEventListener('keydown', onKeydown);
			window.removeEventListener('keyup', onKeyup);
			window.removeEventListener('blur', onBlur);
		};
	});

	return {
		get modHeld() {
			return modHeld;
		},
		get parsed() {
			return parsed;
		}
	};
}

export { shortcutLabel };
