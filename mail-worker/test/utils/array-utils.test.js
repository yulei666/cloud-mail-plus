import { describe, it, expect } from 'vitest';
import { chunkArray } from '../../src/utils/array-utils';

describe('array-utils chunkArray', () => {
	it('should return empty array for empty or invalid input', () => {
		expect(chunkArray(null)).toEqual([]);
		expect(chunkArray(undefined)).toEqual([]);
		expect(chunkArray([])).toEqual([]);
	});

	it('should chunk array into batches of default size 90', () => {
		const arr = Array.from({ length: 200 }, (_, i) => i + 1);
		const chunks = chunkArray(arr);
		expect(chunks.length).toBe(3);
		expect(chunks[0].length).toBe(90);
		expect(chunks[1].length).toBe(90);
		expect(chunks[2].length).toBe(20);
	});

	it('should support custom chunk size', () => {
		const arr = [1, 2, 3, 4, 5];
		const chunks = chunkArray(arr, 2);
		expect(chunks).toEqual([[1, 2], [3, 4], [5]]);
	});
});
