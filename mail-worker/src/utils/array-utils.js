export function chunkArray(arr, size = 90) {
	if (!Array.isArray(arr) || arr.length === 0) return [];
	const chunkSize = size > 0 ? size : 90;
	const chunks = [];
	for (let i = 0; i < arr.length; i += chunkSize) {
		chunks.push(arr.slice(i, i + chunkSize));
	}
	return chunks;
}

export default { chunkArray };
