import { describe, it, expect, beforeEach } from 'vitest';
import { createTestDb, createD1Adapter } from '../helpers/test-db';
import emailService from '../../src/service/email-service';
import settingService from '../../src/service/setting-service';
import roleService from '../../src/service/role-service';
import { emailConst } from '../../src/const/entity-const';

describe('HandleOnSiteEmail plus subaddress fallback', () => {
	let sqlite;
	let db;
	let c;

	beforeEach(() => {
		const testDb = createTestDb();
		sqlite = testDb.sqlite;
		db = testDb.db;

		// Mock settingService and roleService
		settingService.query = async () => ({ noRecipient: 1 });
		roleService.selectByUserIds = async () => [
			{ userId: 10, banEmail: '', availDomain: '*' },
		];
		roleService.hasAvailDomainPerm = () => true;
		roleService.isBanEmail = () => false;

		c = {
			env: {
				admin: 'admin@example.com',
				db: createD1Adapter(sqlite),
			},
		};

		// Seed base account
		sqlite.prepare(
			`INSERT INTO account (account_id, user_id, email, name) VALUES (?, ?, ?, ?)`
		).run(5, 10, 'user@example.com', 'User');
	});

	it('should route subaddress email to base account when subaddress is not explicitly registered', async () => {
		const receiveEmail = ['user+shopping@example.com'];
		const sendEmailData = {
			sendEmail: 'sender@example.com',
			subject: 'Order Confirmation',
			text: 'Thank you for your order',
			content: '<p>Thank you for your order</p>',
		};

		await emailService.HandleOnSiteEmail(c, receiveEmail, sendEmailData, []);

		const row = sqlite.prepare(`SELECT * FROM email WHERE to_email = ?`).get('user+shopping@example.com');
		expect(row).toBeDefined();
		expect(row.user_id).toBe(10);
		expect(row.account_id).toBe(5);
		expect(row.type).toBe(emailConst.type.RECEIVE);
		expect(row.status).toBe(emailConst.status.RECEIVE);
	});
});
