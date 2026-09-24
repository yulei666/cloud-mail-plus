import { describe, it, expect, vi } from 'vitest';
import emailService from '../../src/service/email-service';
import accountService from '../../src/service/account-service';
import userService from '../../src/service/user-service';

describe('updateEmailStatus and allAccount robustness', () => {
	it('updateEmailStatus should return null when resendEmailId is missing or empty', async () => {
		const c = {};
		expect(await emailService.updateEmailStatus(c, { resendEmailId: null, status: 1 })).toBeNull();
		expect(await emailService.updateEmailStatus(c, { resendEmailId: '', status: 1 })).toBeNull();
		expect(await emailService.updateEmailStatus(c, { status: 1 })).toBeNull();
	});

	it('allAccount should return empty list and 0 total if userRow is not found', async () => {
		vi.spyOn(userService, 'selectByIdIncludeDel').mockResolvedValue(null);
		const result = await accountService.allAccount({}, { userId: 999, num: 1, size: 10 });
		expect(result).toEqual({ list: [], total: 0 });
	});
});
