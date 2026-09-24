import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import analysisDao from '../../src/dao/analysis-dao';

describe('analysisDao - Timezone Modifiers and Negative UTC Offset Handling', () => {
	it('should format tzModifiers correctly for positive, zero, and negative diffHours', () => {
		expect(analysisDao.tzModifiers(8)).toEqual({
			tzMod: '+8 hours',
			tzBack: '-8 hours',
		});

		expect(analysisDao.tzModifiers(0)).toEqual({
			tzMod: '+0 hours',
			tzBack: '+0 hours',
		});

		expect(analysisDao.tzModifiers(-5)).toEqual({
			tzMod: '-5 hours',
			tzBack: '+5 hours',
		});
	});

	describe('SQL execution with negative and positive timezone offsets', () => {
		let sqlite;
		let c;

		beforeEach(() => {
			sqlite = new Database(':memory:');
			sqlite.exec(`
				CREATE TABLE email (
					email_id INTEGER PRIMARY KEY AUTOINCREMENT,
					type INTEGER NOT NULL DEFAULT 0,
					create_time TEXT DEFAULT CURRENT_TIMESTAMP
				);

				CREATE TABLE user (
					user_id INTEGER PRIMARY KEY AUTOINCREMENT,
					email TEXT NOT NULL,
					create_time TEXT DEFAULT CURRENT_TIMESTAMP
				);
			`);

			// Insert sample rows
			sqlite.prepare("INSERT INTO user (email, create_time) VALUES ('u1@test.com', datetime('now', '-2 days'))").run();
			sqlite.prepare("INSERT INTO email (type, create_time) VALUES (0, datetime('now', '-2 days'))").run();
			sqlite.prepare("INSERT INTO email (type, create_time) VALUES (1, datetime('now', '-2 days'))").run();

			c = {
				env: {
					db: {
						prepare: (sql) => ({
							all: () => ({ results: sqlite.prepare(sql).all() }),
						}),
					},
				},
			};
		});

		it('should execute successfully without error for negative offset (e.g. UTC-5 New York)', async () => {
			const users = await analysisDao.userDayCount(c, -5);
			const receives = await analysisDao.receiveDayCount(c, -5);
			const sends = await analysisDao.sendDayCount(c, -5);

			expect(Array.isArray(users)).toBe(true);
			expect(Array.isArray(receives)).toBe(true);
			expect(Array.isArray(sends)).toBe(true);
		});

		it('should exclude status = 6 (SAVING) in numberCount', async () => {
			sqlite.exec(`
				CREATE TABLE account (
					account_id INTEGER PRIMARY KEY AUTOINCREMENT,
					is_del INTEGER DEFAULT 0
				);
			`);
			// Add columns needed for numberCount
			sqlite.exec(`
				DROP TABLE email;
				CREATE TABLE email (
					email_id INTEGER PRIMARY KEY AUTOINCREMENT,
					type INTEGER NOT NULL DEFAULT 0,
					status INTEGER NOT NULL DEFAULT 0,
					is_del INTEGER DEFAULT 0,
					create_time TEXT DEFAULT CURRENT_TIMESTAMP
				);
				DROP TABLE user;
				CREATE TABLE user (
					user_id INTEGER PRIMARY KEY AUTOINCREMENT,
					email TEXT NOT NULL,
					is_del INTEGER DEFAULT 0,
					create_time TEXT DEFAULT CURRENT_TIMESTAMP
				);
			`);

			// Insert a normal email and a saving email (status=6)
			sqlite.prepare("INSERT INTO email (type, status, is_del) VALUES (0, 0, 0)").run();
			sqlite.prepare("INSERT INTO email (type, status, is_del) VALUES (1, 6, 0)").run(); // draft, status=6
			sqlite.prepare("INSERT INTO user (email, is_del) VALUES ('test@example.com', 0)").run();

			const counts = await analysisDao.numberCount(c);
			expect(counts.normalReceiveTotal).toBe(1);
			expect(counts.normalSendTotal).toBe(0); // status=6 should be excluded!
			expect(counts.sendTotal).toBe(0);
		});
	});
});
