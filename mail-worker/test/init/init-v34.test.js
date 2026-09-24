import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { dbInit } from '../../src/init/init';

describe('init.v3_4DB - index creation and draft status repair', () => {
	let sqlite;
	let c;

	beforeEach(() => {
		sqlite = new Database(':memory:');
		// Create minimal tables required for all 22 indexes and repair SQL
		sqlite.exec(`
			CREATE TABLE email (
				email_id INTEGER PRIMARY KEY AUTOINCREMENT,
				user_id INTEGER NOT NULL,
				account_id INTEGER NOT NULL,
				name TEXT,
				subject TEXT,
				send_email TEXT,
				to_email TEXT,
				type INTEGER NOT NULL DEFAULT 0,
				status INTEGER NOT NULL DEFAULT 0,
				is_del INTEGER NOT NULL DEFAULT 0,
				create_time TEXT DEFAULT CURRENT_TIMESTAMP
			);

			CREATE TABLE star (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
				user_id INTEGER NOT NULL,
				email_id INTEGER NOT NULL
			);

			CREATE TABLE user (
				user_id INTEGER PRIMARY KEY AUTOINCREMENT,
				email TEXT NOT NULL,
				type INTEGER NOT NULL DEFAULT 0,
				create_time TEXT DEFAULT CURRENT_TIMESTAMP
			);

			CREATE TABLE account (
				account_id INTEGER PRIMARY KEY AUTOINCREMENT,
				user_id INTEGER NOT NULL,
				email TEXT NOT NULL,
				sort INTEGER DEFAULT 0,
				is_del INTEGER DEFAULT 0
			);

			CREATE TABLE attachments (
				att_id INTEGER PRIMARY KEY AUTOINCREMENT,
				email_id INTEGER NOT NULL,
				type INTEGER DEFAULT 0
			);

			CREATE TABLE role_perm (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
				role_id INTEGER NOT NULL
			);

			CREATE TABLE oauth (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
				oauth_user_id TEXT NOT NULL,
				user_id INTEGER NOT NULL
			);
		`);

		c = {
			env: {
				db: sqlite
			}
		};
	});

	it('should successfully execute v3_4DB and repair corrupted draft statuses', async () => {
		// Insert test records
		// 1. Corrupted draft: type = 1, status = 0 (RECEIVE) -> should become status = 6 (SAVING)
		sqlite.prepare(`
			INSERT INTO email (email_id, user_id, account_id, type, status)
			VALUES (1, 100, 1, 1, 0)
		`).run();

		// 2. Corrupted draft: type = 1, status = 7 (NOONE) -> should become status = 6 (SAVING)
		sqlite.prepare(`
			INSERT INTO email (email_id, user_id, account_id, type, status)
			VALUES (2, 100, 1, 1, 7)
		`).run();

		// 3. Normal received email: type = 0, status = 0 -> should remain status = 0
		sqlite.prepare(`
			INSERT INTO email (email_id, user_id, account_id, type, status)
			VALUES (3, 100, 1, 0, 0)
		`).run();

		// 4. Normal received email without account: type = 0, status = 7 -> should remain status = 7
		sqlite.prepare(`
			INSERT INTO email (email_id, user_id, account_id, type, status)
			VALUES (4, 100, 999, 0, 7)
		`).run();

		// Execute v3_4DB
		await dbInit.v3_4DB(c);

		// Verify draft statuses repaired
		const e1 = sqlite.prepare('SELECT status FROM email WHERE email_id = 1').get();
		const e2 = sqlite.prepare('SELECT status FROM email WHERE email_id = 2').get();
		const e3 = sqlite.prepare('SELECT status FROM email WHERE email_id = 3').get();
		const e4 = sqlite.prepare('SELECT status FROM email WHERE email_id = 4').get();

		expect(e1.status).toBe(6);
		expect(e2.status).toBe(6);
		expect(e3.status).toBe(0);
		expect(e4.status).toBe(7);

		// Verify 22 indexes were created in sqlite_master
		const createdIndexes = sqlite.prepare(`
			SELECT name FROM sqlite_master WHERE type = 'index' AND name LIKE 'idx_%'
		`).all().map(r => r.name);

		const expectedIndexes = [
			'idx_email_list_user',
			'idx_email_list_account',
			'idx_star_user_email',
			'idx_star_email_user',
			'idx_email_name_nocase',
			'idx_email_subject_nocase',
			'idx_user_email_nocase',
			'idx_email_to_email_nocase',
			'idx_email_send_email_nocase',
			'idx_account_user_del_sort',
			'idx_email_noone_id',
			'idx_email_type_id',
			'idx_email_saving_account',
			'idx_email_type_name',
			'idx_email_type_create_time',
			'idx_email_create_time',
			'idx_user_create_time',
			'idx_user_type',
			'idx_attachments_email_type',
			'idx_role_perm_role',
			'idx_oauth_oauth_user_id',
			'idx_oauth_user_id'
		];

		for (const idxName of expectedIndexes) {
			expect(createdIndexes).toContain(idxName);
		}
		expect(expectedIndexes.length).toBe(22);
	});
});
