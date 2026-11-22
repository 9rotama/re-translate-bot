import { exports } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';

describe('fetch handler', () => {
	it('POST 以外のリクエストには 405 を返す', async () => {
		const response = await exports.default.fetch('https://example.com/', { method: 'GET' });

		expect(response.status).toBe(405);
		expect(response.headers.get('Allow')).toBe('POST');
	});
});
