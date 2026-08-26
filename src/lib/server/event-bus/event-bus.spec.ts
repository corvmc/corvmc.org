import { describe, it, expect, beforeEach } from 'vitest';
import Emittery from 'emittery';
import { domainEvents } from './event-bus';

beforeEach(() => {
	domainEvents.clearListeners();
});

describe('domainEvents', () => {
	it('is an instance of Emittery', () => {
		expect(domainEvents).toBeInstanceOf(Emittery);
	});

	it('emits and receives typed events', async () => {
		const received: unknown[] = [];
		domainEvents.on('contact.form_submitted', ({ data }) => {
			received.push(data);
		});

		await domainEvents.emit('contact.form_submitted', {
			name: 'Alice',
			threadId: 'thread-1',
			subject: 'General Inquiry',
			email: 'alice@test.com',
			message: 'Hello'
		});

		expect(received).toHaveLength(1);
		expect(received[0]).toEqual(
			expect.objectContaining({ name: 'Alice', email: 'alice@test.com' })
		);
	});

	it('supports multiple listeners on the same event', async () => {
		let callCount = 0;
		domainEvents.on('contact.form_submitted', () => {
			callCount++;
		});
		domainEvents.on('contact.form_submitted', () => {
			callCount++;
		});

		await domainEvents.emit('contact.form_submitted', {
			name: 'Bob',
			threadId: 'thread-1',
			subject: 'General Inquiry',
			email: 'bob@test.com',
			message: 'Hi'
		});

		expect(callCount).toBe(2);
	});

	it('passes event payload to listeners', async () => {
		let receivedPayload: unknown;
		domainEvents.on('reservation.confirmed', ({ data }) => {
			receivedPayload = data;
		});

		const payload = {
			reservationId: 'res-1',
			userId: 'user-1',
			userName: 'Alice',
			userEmail: 'alice@test.com',
			date: '2026-05-20',
			startTime: '10:00',
			endTime: '12:00'
		};

		await domainEvents.emit('reservation.confirmed', payload);

		expect(receivedPayload).toEqual(payload);
	});
});
