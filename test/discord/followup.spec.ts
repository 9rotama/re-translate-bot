import { afterEach, describe, expect, it, vi } from 'vitest';
import { editOriginal } from '../../src/discord/followup';

const target = { applicationId: '333333333333333333', token: 'interaction-token' };
const body = { content: 'こんにちは', allowed_mentions: { parse: [] } };

const mockFetch = () => vi.spyOn(globalThis, 'fetch');

describe('editOriginal', () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('Interaction のトークンで元の応答メッセージを PATCH し、本文を JSON で送る', async () => {
		const fetch = mockFetch().mockResolvedValue(new Response('{}', { status: 200 }));

		const result = await editOriginal(target, body);

		expect(result).toEqual({ ok: true, value: undefined });
		const [url, init] = fetch.mock.calls[0] ?? [];
		expect(url).toBe('https://discord.com/api/v10/webhooks/333333333333333333/interaction-token/messages/@original');
		expect(init).toMatchObject({ method: 'PATCH', headers: { 'Content-Type': 'application/json' } });
		expect(typeof init?.body === 'string' ? JSON.parse(init.body) : undefined).toEqual(body);
	});

	it('Discord が失敗の status を返したら、http_error と status を返す', async () => {
		mockFetch().mockResolvedValue(new Response('{"message":"Unknown Webhook"}', { status: 404 }));

		const result = await editOriginal(target, body);

		expect(result).toEqual({ ok: false, error: { kind: 'http_error', status: 404, details: {} } });
	});

	it('応答を受け取れなかったら、throw せずに network_error と例外の情報を返す', async () => {
		mockFetch().mockRejectedValue(new TypeError('Network connection lost.'));

		const result = await editOriginal(target, body);

		expect(result).toMatchObject({ ok: false, error: { kind: 'network_error', details: { errorName: 'TypeError' } } });
		expect(JSON.stringify(result)).not.toContain('Network connection lost.');
	});

	it('期限までに応答がなければ打ち切り、network_error を返す', async () => {
		mockFetch().mockImplementation(
			(_url, init) =>
				new Promise((_resolve, reject) => {
					init?.signal?.addEventListener('abort', () => reject(init.signal?.reason));
				}),
		);

		const result = await editOriginal(target, body, 10);

		expect(result).toMatchObject({ ok: false, error: { kind: 'network_error', details: { errorName: 'TimeoutError' } } });
	});
});
