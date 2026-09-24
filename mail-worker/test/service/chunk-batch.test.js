import { describe, it, expect, beforeEach } from 'vitest';
import { createTestDb } from '../helpers/test-db';
import emailService from '../../src/service/email-service';
import { isDel, emailConst } from '../../src/const/entity-const';

describe('emailService chunked batch operations', () => {
	let sqlite;
	let db;
	let c;

	beforeEach(() => {
		const testDb = createTestDb();
		sqlite = testDb.sqlite;
		db = testDb.db;

		c = {
			env: {
				db: {
					prepare: (sql) => {
						const stmt = sqlite.prepare(sql);
						return {
							bind: (...args) => ({
								all: () => ({ results: stmt.all(...args) }),
								run: () => stmt.run(...args),
							}),
							all: () => ({ results: stmt.all() }),
							run: () => stmt.run(),
						};
					},
					batch: async (statements) => {
						return statements.map((s) => (s.all ? s.all() : s.run()));
					},
				},
			},
		};
	});

	it('should soft delete more than 100 emails without error', async () => {
		const userId = 1;
		const totalEmails = 150;
		const ids = [];

		for (let i = 1; i <= totalEmails; i++) {
			sqlite.prepare(
				`INSERT INTO email (email_id, user_id, account_id, message_id, type, status, is_del, unread)
				 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
			).run(i, userId, 1, `msg-${i}`, 0, 1, isDel.NORMAL, emailConst.unread.UNREAD);
			ids.push(i);
		}

		await emailService.delete(c, { emailIds: ids.join(',') }, userId);

		const remaining = sqlite.prepare(`SELECT count(*) as cnt FROM email WHERE is_del = ?`).get(isDel.NORMAL);
		expect(remaining.cnt).toBe(0);

		const deleted = sqlite.prepare(`SELECT count(*) as cnt FROM email WHERE is_del = ?`).get(isDel.DELETE);
		expect(deleted.cnt).toBe(150);
	});

	it('should mark more than 100 emails as read without error', async () => {
		const userId = 1;
		const totalEmails = 150;
		const ids = [];

		for (let i = 1; i <= totalEmails; i++) {
			sqlite.prepare(
				`INSERT INTO email (email_id, user_id, account_id, message_id, type, status, is_del, unread)
				 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
			).run(i, userId, 1, `msg-${i}`, 0, 1, isDel.NORMAL, emailConst.unread.UNREAD);
			ids.push(i);
		}

		await emailService.read(c, { emailIds: ids }, userId);

		const unreadCount = sqlite.prepare(`SELECT count(*) as cnt FROM email WHERE unread = ?`).get(emailConst.unread.UNREAD);
		expect(unreadCount.cnt).toBe(0);

		const readCount = sqlite.prepare(`SELECT count(*) as cnt FROM email WHERE unread = ?`).get(emailConst.unread.READ);
		expect(readCount.cnt).toBe(150);
	});
});
