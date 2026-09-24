import { describe, it, expect } from 'vitest';
import { joinNames, sponsorCreditMarkdown, withSponsorCredit } from './sponsor-credit';

const troubadour = { name: 'Troubadour Music', website: 'https://troubadour.example' };
const brewery = { name: 'Block 15', website: null };

describe('joinNames', () => {
	it('reads as a sentence at any length', () => {
		expect(joinNames(['A'])).toBe('A');
		expect(joinNames(['A', 'B'])).toBe('A and B');
		expect(joinNames(['A', 'B', 'C'])).toBe('A, B and C');
	});
});

describe('sponsorCreditMarkdown', () => {
	it('is nothing when nobody is credited', () => {
		expect(sponsorCreditMarkdown([])).toBe('');
	});

	it('links a sponsor with a website and names one without', () => {
		expect(sponsorCreditMarkdown([troubadour, brewery])).toBe(
			'*Sponsored by [Troubadour Music](https://troubadour.example) and Block 15.*'
		);
	});

	it('does not let a name or a URL become markup', () => {
		const line = sponsorCreditMarkdown([{ name: 'A*B [x](y)', website: 'javascript:alert(1)' }]);
		expect(line).toBe('*Sponsored by A\\*B \\[x\\]\\(y\\).*');
	});
});

describe('withSponsorCredit', () => {
	it('leaves a body alone when nobody is credited', () => {
		expect(withSponsorCredit('# Show', [])).toBe('# Show');
	});

	it('appends the credit after a rule, below everything staff wrote', () => {
		expect(withSponsorCredit('# Show\n\n', [brewery])).toBe(
			'# Show\n\n---\n\n*Sponsored by Block 15.*\n'
		);
	});
});
