import { env } from 'cloudflare:workers';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readSettings, writeOriginLang, writeRelayLangs } from '../../src/settings/store';

// テストどうしで行を共有しないよう、テストごとに別のチャンネル ID を使う。
let nextChannel = 100000000000000000n;
const newChannelId = () => String(nextChannel++);

const rowOf = (channelId: string) =>
	env.DB.prepare('select origin_lang, relay_langs, updated_at from channel_settings where channel_id = ?')
		.bind(channelId)
		.first<{ origin_lang: string; relay_langs: string; updated_at: number }>();

describe('readSettings', () => {
	it('未設定のチャンネルでは既定値（原文の言語 ja、中継言語 en）を返す', async () => {
		const result = await readSettings(env.DB, newChannelId());

		expect(result).toEqual({ ok: true, value: { originLang: 'ja', relayLangs: ['en'] } });
	});

	it('未設定のチャンネルを読んでも行を作らない', async () => {
		const channelId = newChannelId();

		await readSettings(env.DB, channelId);

		expect(await rowOf(channelId)).toBeNull();
	});

	it('書き込んだ設定を読める', async () => {
		const channelId = newChannelId();
		await writeRelayLangs(env.DB, channelId, ['en', 'fr']);
		await writeOriginLang(env.DB, channelId, 'ko');

		const result = await readSettings(env.DB, channelId);

		expect(result).toEqual({ ok: true, value: { originLang: 'ko', relayLangs: ['en', 'fr'] } });
	});

	it('設定はチャンネルごとに独立している', async () => {
		const channelId = newChannelId();
		const other = newChannelId();
		await writeRelayLangs(env.DB, channelId, ['de']);

		const result = await readSettings(env.DB, other);

		expect(result).toEqual({ ok: true, value: { originLang: 'ja', relayLangs: ['en'] } });
	});
});

describe('writeRelayLangs', () => {
	it('未設定のチャンネルでは、原文の言語を既定値にして中継言語を保存し、更新後の設定を返す', async () => {
		const channelId = newChannelId();

		const result = await writeRelayLangs(env.DB, channelId, ['en', 'fr']);

		expect(result).toEqual({ ok: true, value: { originLang: 'ja', relayLangs: ['en', 'fr'] } });
		expect(await rowOf(channelId)).toMatchObject({ origin_lang: 'ja', relay_langs: '["en","fr"]' });
	});

	it('設定済みのチャンネルでは、原文の言語を変えずに中継言語だけを置き換える', async () => {
		const channelId = newChannelId();
		await writeOriginLang(env.DB, channelId, 'ko');
		await writeRelayLangs(env.DB, channelId, ['en', 'fr']);

		const result = await writeRelayLangs(env.DB, channelId, ['de']);

		expect(result).toEqual({ ok: true, value: { originLang: 'ko', relayLangs: ['de'] } });
	});

	it('書き込んだ時刻を updated_at に記録する', async () => {
		const channelId = newChannelId();
		vi.useFakeTimers({ now: 1_700_000_000_000, toFake: ['Date'] });

		await writeRelayLangs(env.DB, channelId, ['en']);

		expect(await rowOf(channelId)).toMatchObject({ updated_at: 1_700_000_000_000 });
	});
});

describe('writeOriginLang', () => {
	it('未設定のチャンネルでは、中継言語を既定値にして原文の言語を保存し、更新後の設定を返す', async () => {
		const channelId = newChannelId();

		const result = await writeOriginLang(env.DB, channelId, 'ko');

		expect(result).toEqual({ ok: true, value: { originLang: 'ko', relayLangs: ['en'] } });
		expect(await rowOf(channelId)).toMatchObject({ origin_lang: 'ko', relay_langs: '["en"]' });
	});

	it('設定済みのチャンネルでは、中継言語を変えずに原文の言語だけを置き換える', async () => {
		const channelId = newChannelId();
		await writeRelayLangs(env.DB, channelId, ['en', 'fr']);

		const result = await writeOriginLang(env.DB, channelId, 'ko');

		expect(result).toEqual({ ok: true, value: { originLang: 'ko', relayLangs: ['en', 'fr'] } });
	});

	it('書き込んだ時刻を updated_at に記録する', async () => {
		const channelId = newChannelId();
		vi.useFakeTimers({ now: 1_700_000_000_000, toFake: ['Date'] });

		await writeOriginLang(env.DB, channelId, 'ko');

		expect(await rowOf(channelId)).toMatchObject({ updated_at: 1_700_000_000_000 });
	});
});

describe('D1 の失敗', () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it.each([
		['読み取り', 'settings.read', () => readSettings(env.DB, newChannelId())],
		['中継言語の書き込み', 'settings.upsert_relay', () => writeRelayLangs(env.DB, newChannelId(), ['en'])],
		['原文の言語の書き込み', 'settings.upsert_origin', () => writeOriginLang(env.DB, newChannelId(), 'ko')],
	] as const)('%sで D1 が例外を投げたら、throw せずにクエリの種類と例外の情報を返す', async (_, operation, call) => {
		vi.spyOn(env.DB, 'prepare').mockImplementation(() => {
			throw new TypeError('原文');
		});

		const result = await call();

		expect(result).toMatchObject({ ok: false, error: { operation, details: { errorName: 'TypeError' } } });
		expect(JSON.stringify(result)).not.toContain('原文');
	});
});

afterEach(() => {
	vi.useRealTimers();
});
