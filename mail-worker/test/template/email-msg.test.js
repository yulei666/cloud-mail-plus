import { describe, it, expect } from 'vitest';
import emailMsgTemplate from '../../src/template/email-msg';

describe('emailMsgTemplate - Telegram notification message formatting', () => {
	it('should escape HTML tags in subject, sender, recipient and body', () => {
		const email = {
			subject: '<script>alert("xss")</script>',
			name: 'Attacker <evil>',
			sendEmail: 'evil<script>@evil.com',
			toEmail: 'victim<test>@domain.com',
			text: 'Hello <b>World</b> & <friends>',
		};

		const result = emailMsgTemplate(email, 'show', 'show', 'show');

		expect(result).not.toContain('<script>');
		expect(result).toContain('&lt;script&gt;alert("xss")&lt;/script&gt;');
		expect(result).toContain('&lt;evil&gt;');
		expect(result).toContain('&lt;friends&gt;');
	});

	it('should truncate message text when total length exceeds 3500 chars', () => {
		const email = {
			subject: 'Long Email Subject',
			name: 'Sender',
			sendEmail: 'sender@example.com',
			toEmail: 'receiver@example.com',
			text: 'A'.repeat(5000),
		};

		const result = emailMsgTemplate(email, 'show', 'show', 'show');

		expect(result.length).toBeLessThanOrEqual(3500);
		expect(result.endsWith('...')).toBe(true);
	});

	it('should not have an extra blank line between From and To when both are shown', () => {
		const email = {
			subject: 'Test Subject',
			name: 'Sender',
			sendEmail: 'sender@example.com',
			toEmail: 'receiver@example.com',
			text: 'Hello',
		};

		const result = emailMsgTemplate(email, 'show', 'show', 'hide');
		expect(result).toMatch(/From[\s\S]*?\nTo：/);
		expect(result).not.toMatch(/From[\s\S]*?\n\nTo：/);
	});
});
