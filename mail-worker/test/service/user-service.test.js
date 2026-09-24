import { describe, it, expect, vi } from 'vitest';
import userService from '../../src/service/user-service';
import { t } from '../../src/i18n/i18n';

describe('userService.resetPassword - password validation', () => {
	it('should throw error when password is empty or shorter than 6 characters', async () => {
		const c = { env: {} };
		await expect(userService.resetPassword(c, { password: '' }, 1)).rejects.toThrow(t('pwdMinLength'));
		await expect(userService.resetPassword(c, { password: '123' }, 1)).rejects.toThrow(t('pwdMinLength'));
		await expect(userService.resetPassword(c, { password: '12345' }, 1)).rejects.toThrow(t('pwdMinLength'));
	});

	it('should throw error when password exceeds 30 characters', async () => {
		const c = { env: {} };
		const longPassword = 'a'.repeat(31);
		await expect(userService.resetPassword(c, { password: longPassword }, 1)).rejects.toThrow(t('pwdLengthLimit'));
	});
});
