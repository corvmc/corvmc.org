import { afterEach, describe, expect, it } from 'vitest';
import { ignoreRepeatTap } from './repeat-tap';

const pending = new URL('/programs', location.href);

function tap(attrs: Record<string, string>, init: MouseEventInit = {}, to: URL | null = pending) {
	const a = document.createElement('a');
	for (const [k, v] of Object.entries(attrs)) a.setAttribute(k, v);
	const inner = document.createElement('span');
	a.appendChild(inner);
	document.body.appendChild(a);

	let prevented = false;
	const listener = (e: MouseEvent) => {
		ignoreRepeatTap(e, to);
		prevented = e.defaultPrevented;
		e.preventDefault();
	};
	window.addEventListener('click', listener, true);
	inner.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, ...init }));
	window.removeEventListener('click', listener, true);
	return prevented;
}

afterEach(() => document.body.replaceChildren());

describe('ignoreRepeatTap', () => {
	it('cancels a tap on a link to the page being loaded', () => {
		expect(tap({ href: '/programs' })).toBe(true);
	});

	it('lets every other click through', () => {
		expect(tap({ href: '/events' })).toBe(false);
		expect(tap({ href: '/programs' }, {}, null)).toBe(false);
		expect(tap({ href: '/programs' }, { metaKey: true })).toBe(false);
		expect(tap({ href: '/programs', target: '_blank' })).toBe(false);
		expect(tap({ href: '/programs', download: '' })).toBe(false);
	});
});
