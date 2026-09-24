import { describe, it, expect } from 'vitest';
import roleService from '../../src/service/role-service';

describe('roleService.selectByUserIds guards', () => {
	it('should return empty array if userIds is null, undefined, or empty array', async () => {
		expect(await roleService.selectByUserIds({}, null)).toEqual([]);
		expect(await roleService.selectByUserIds({}, undefined)).toEqual([]);
		expect(await roleService.selectByUserIds({}, [])).toEqual([]);
	});
});
