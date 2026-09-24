import { describe, it, expect, beforeEach } from 'vitest';
import { createTestDb } from '../helpers/test-db';
import emailService from '../../src/service/email-service';
import { emailConst } from '../../src/const/entity-const';

describe('emailService.completeReceiveAll - draft safety and status update', () => {
	let testDb;
	let sqlite;
	let c;

	beforeEach(() => {
		testDb = createTestDb();
		sqlite = testDb.sqlite;
		// In tests, completeReceiveAll invokes c.env.db.prepare(...).run()
		c = {
			env: {
				db: sqlite
			}
		};

		// Insert a valid account (account_id = 1)
		sqlite.prepare(`
			INSERT INTO account (account_id, email, name, user_id)
			VALUES (1, 'user@example.com', 'Test User', 100)
		`).run();
	});

	it('should correctly process 4 combinations of email type and account existence', async () => {
		// 1. type = 0 (RECEIVE), has matching account (account_id = 1), initial status = 6 (SAVING)
		sqlite.prepare(`
			INSERT INTO email (email_id, account_id, user_id, type, status, to_email)
			VALUES (1, 1, 100, ${emailConst.type.RECEIVE}, ${emailConst.status.SAVING}, 'user@example.com')
		`).run();

		// 2. type = 0 (RECEIVE), no matching account (account_id = 999), initial status = 6 (SAVING)
		sqlite.prepare(`
			INSERT INTO email (email_id, account_id, user_id, type, status, to_email)
			VALUES (2, 999, 100, ${emailConst.type.RECEIVE}, ${emailConst.status.SAVING}, 'ghost@example.com')
		`).run();

		// 3. type = 1 (SEND / AI draft), has matching account (account_id = 1), initial status = 6 (SAVING)
		sqlite.prepare(`
			INSERT INTO email (email_id, account_id, user_id, type, status, to_email)
			VALUES (3, 1, 100, ${emailConst.type.SEND}, ${emailConst.status.SAVING}, 'target@external.com')
		`).run();

		// 4. type = 1 (SEND / AI draft), no matching account (account_id = 999), initial status = 6 (SAVING)
		sqlite.prepare(`
			INSERT INTO email (email_id, account_id, user_id, type, status, to_email)
			VALUES (4, 999, 100, ${emailConst.type.SEND}, ${emailConst.status.SAVING}, 'target2@external.com')
		`).run();

		// Execute completeReceiveAll
		await emailService.completeReceiveAll(c);

		// Query results
		const email1 = sqlite.prepare('SELECT status FROM email WHERE email_id = 1').get();
		const email2 = sqlite.prepare('SELECT status FROM email WHERE email_id = 2').get();
		const email3 = sqlite.prepare('SELECT status FROM email WHERE email_id = 3').get();
		const email4 = sqlite.prepare('SELECT status FROM email WHERE email_id = 4').get();

		// 1. type=0 with account -> RECEIVE (0)
		expect(email1.status).toBe(emailConst.status.RECEIVE);

		// 2. type=0 without account -> NOONE (7)
		expect(email2.status).toBe(emailConst.status.NOONE);

		// 3. type=1 with account -> must remain SAVING (6)
		expect(email3.status).toBe(emailConst.status.SAVING);

		// 4. type=1 without account -> must remain SAVING (6)
		expect(email4.status).toBe(emailConst.status.SAVING);
	});
});
