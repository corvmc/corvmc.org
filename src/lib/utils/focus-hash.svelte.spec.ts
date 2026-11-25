import { afterEach, describe, expect, it } from 'vitest';
import { focusHashTarget } from './focus-hash';

function mount(html: string) {
	const root = document.createElement('div');
	root.innerHTML = html;
	document.body.appendChild(root);
}

afterEach(() => document.body.replaceChildren());

describe('focusHashTarget', () => {
	it('focuses the input inside the element the hash names', () => {
		mount('<div id="bio"><label>Bio <input id="field" /></label></div>');
		expect(focusHashTarget('#bio')).toBe(true);
		expect(document.activeElement?.id).toBe('field');
	});

	it('skips hidden inputs', () => {
		mount('<div id="bio"><input type="hidden" /><textarea id="field"></textarea></div>');
		focusHashTarget('#bio');
		expect(document.activeElement?.id).toBe('field');
	});

	it('prefers an editing area over the toolbar before it', () => {
		mount(
			'<div id="bio"><button type="button">Bold</button><div id="field" contenteditable="true"></div></div>'
		);
		focusHashTarget('#bio');
		expect(document.activeElement?.id).toBe('field');
	});

	it('falls back to a button when the target has no field', () => {
		mount('<div id="logo"><button id="field" type="button">Upload</button></div>');
		focusHashTarget('#logo');
		expect(document.activeElement?.id).toBe('field');
	});

	it('does nothing for an unknown id, an empty hash or a malformed escape', () => {
		mount('<div id="bio"><input /></div>');
		expect(focusHashTarget('#nope')).toBe(false);
		expect(focusHashTarget('')).toBe(false);
		expect(focusHashTarget('#%E0%A4%A')).toBe(false);
		expect(document.activeElement).toBe(document.body);
	});
});
