import { describe, it, expect, vi } from 'vitest';
import settingService from '../../src/service/setting-service';
import verifyRecordService from '../../src/service/verify-record-service';

describe('settingService tgBotToken masking and protection', () => {
	it('should mask tgBotToken in get()', async () => {
		const rawToken = '1234567890:ABCdefGHIjklMNOpqrsTUVwxyz';
		const mockSetting = {
			siteKey: '12345678',
			secretKey: '87654321',
			resendTokens: { 'example.com': 'token123456789' },
			s3AccessKey: 'access123456789',
			s3SecretKey: 'secret123456789',
			tgBotToken: rawToken,
			regVerifyCount: 5,
			addVerifyCount: 5,
		};

		vi.spyOn(settingService, 'query').mockResolvedValue(mockSetting);
		vi.spyOn(verifyRecordService, 'selectListByIP').mockResolvedValue([]);

		const c = {
			req: { header: () => '127.0.0.1' },
			env: { r2: null, AI: null },
		};

		const result = await settingService.get(c);
		expect(result.tgBotToken).toBe(`${rawToken.slice(0, 20)}******`);
	});

	it('should remove tgBotToken in set() if it contains masked asterisks', async () => {
		const updateMock = vi.fn().mockReturnValue({
			set: vi.fn().mockReturnValue({
				returning: vi.fn().mockReturnValue({
					get: vi.fn().mockResolvedValue({}),
				}),
			}),
		});

		vi.spyOn(settingService, 'query').mockResolvedValue({ resendTokens: {} });
		vi.spyOn(settingService, 'refresh').mockResolvedValue();

		const params = {
			tgBotToken: '1234567890:ABCdefGHI******',
			customDomain: 'mail.example.com',
		};

		// We mock orm by overriding settingService's call or inspecting params
		// But in settingService.set:
		// if (params.tgBotToken && params.tgBotToken.includes('******')) { delete params.tgBotToken; }
		// so after settingService.set, params.tgBotToken is undefined!

		// Let's pass a mock c
		const c = {
			env: {
				db: {
					prepare: () => ({
						bind: () => ({ run: vi.fn() }),
					}),
				},
			},
		};

		// Spy on orm call: since orm(c).update(setting).set({ ...params }) is called,
		// we verify params no longer has tgBotToken
		try {
			await settingService.set(c, params);
		} catch (e) {
			// ignore orm mock failure if any
		}

		expect(params.tgBotToken).toBeUndefined();
	});
});
