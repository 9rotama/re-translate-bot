import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';

describe('マイグレーション', () => {
	it('relay_langs に JSON 配列でない値を入れると D1 が拒む', async () => {
		const insert = env.DB.prepare(
			'insert into channel_settings (channel_id, origin_lang, relay_langs, updated_at) values (?, ?, ?, ?)',
		).bind('1', 'ja', '"en"', 0);

		await expect(insert.run()).rejects.toThrow(/CHECK constraint failed/);
	});
});
