import { describe, it, expect, beforeEach, vi } from 'vitest';
import emailUtils from '../../src/utils/email-utils';
import accountService from '../../src/service/account-service';
import loginService from '../../src/service/login-service';
import userService from '../../src/service/user-service';
import settingService from '../../src/service/setting-service';
import BizError from '../../src/error/biz-error';
import { t } from '../../src/i18n/i18n';
import { settingConst } from '../../src/const/entity-const';

describe('Sub-address Handling and Access Control', () => {
	describe('emailUtils.getBaseEmail', () => {
		it('should correctly strip plus tags from valid email addresses', () => {
			expect(emailUtils.getBaseEmail('user+tag@domain.com')).toBe('user@domain.com');
			expect(emailUtils.getBaseEmail('user+foo+bar@domain.com')).toBe('user@domain.com');
			expect(emailUtils.getBaseEmail('user@domain.com')).toBe('user@domain.com');
		});

		it('should return empty string on invalid inputs', () => {
			expect(emailUtils.getBaseEmail('invalid-email')).toBe('');
			expect(emailUtils.getBaseEmail('')).toBe('');
			expect(emailUtils.getBaseEmail('user@@domain.com')).toBe('');
		});
	});

	describe('accountService.add - sub-address ownership validation', () => {
		let c;

		beforeEach(() => {
			c = { env: { domain: ['example.com'] } };
			vi.spyOn(settingService, 'query').mockResolvedValue({
				addEmail: settingConst.addEmail.OPEN,
				manyEmail: settingConst.manyEmail.OPEN,
				emailPrefixFilter: [],
				minEmailPrefix: 1,
			});
		});

		it('should throw notOwner error if base account does not exist', async () => {
			vi.spyOn(accountService, 'selectByEmailIncludeDel').mockResolvedValue(null);

			await expect(
				accountService.add(c, { email: 'alice+tag@example.com' }, 101)
			).rejects.toThrow(t('notOwner'));
		});

		it('should throw notOwner error if base account belongs to a different user', async () => {
			vi.spyOn(accountService, 'selectByEmailIncludeDel').mockImplementation(async (_c, email) => {
				if (email === 'alice@example.com') {
					return { accountId: 1, email: 'alice@example.com', userId: 999 };
				}
				return null;
			});

			await expect(
				accountService.add(c, { email: 'alice+tag@example.com' }, 101)
			).rejects.toThrow(t('notOwner'));
		});
	});

	describe('loginService.register - sub-address forbidden', () => {
		it('should immediately reject sub-addresses with subAddressNotAllowed', async () => {
			vi.spyOn(settingService, 'query').mockResolvedValue({
				register: settingConst.register.OPEN,
				registerVerify: settingConst.registerVerify.CLOSE,
				minEmailPrefix: 1,
				emailPrefixFilter: [],
			});

			const c = { env: {} };
			await expect(
				loginService.register(c, { email: 'user+test@example.com', password: 'password123' })
			).rejects.toThrow(t('subAddressNotAllowed'));
		});
	});

	describe('userService.add - admin creating user with sub-address forbidden', () => {
		it('should immediately reject sub-addresses with subAddressNotAllowed', async () => {
			const c = { env: { domain: ['example.com'] } };
			await expect(
				userService.add(c, { email: 'newuser+test@example.com', password: 'password123', type: 1 })
			).rejects.toThrow(t('subAddressNotAllowed'));
		});
	});
});
