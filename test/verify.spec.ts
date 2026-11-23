import { env } from 'cloudflare:workers';
import { beforeAll, describe, expect, it } from 'vitest';
import { importPublicKey, SIGNATURE_HEADER, TIMESTAMP_HEADER, verifySignature } from '../src/verify';
import { sign, testSigningKey } from './helpers/interactions';

const TIMESTAMP = '1700000000';
const BODY = '{"type":1}';

// vitest.config.mts で作った鍵ペアで署名し、検証する。
let publicKey: CryptoKey;
let validSignature: string;

beforeAll(async () => {
	publicKey = await importPublicKey(env.DISCORD_PUBLIC_KEY);
	validSignature = await sign(await testSigningKey(), TIMESTAMP, BODY);
});

function headers(signature: string | null, timestamp: string | null = TIMESTAMP): Headers {
	const result = new Headers();
	if (signature !== null) result.set(SIGNATURE_HEADER, signature);
	if (timestamp !== null) result.set(TIMESTAMP_HEADER, timestamp);
	return result;
}

const flipFirstByte = (hex: string) => (Number.parseInt(hex.slice(0, 2), 16) ^ 0xff).toString(16).padStart(2, '0') + hex.slice(2);

describe('verifySignature', () => {
	it('タイムスタンプと本文に対する正しい署名を受け入れる', async () => {
		expect((await verifySignature(headers(validSignature), BODY, publicKey)).ok).toBe(true);
	});

	it('公開鍵の16進は大文字でも受け入れる', async () => {
		const upperCaseKey = await importPublicKey(env.DISCORD_PUBLIC_KEY.toUpperCase());

		expect((await verifySignature(headers(validSignature), BODY, upperCaseKey)).ok).toBe(true);
	});

	it.each([
		['署名', false, true],
		['タイムスタンプ', true, false],
	])('%sのヘッダがなければ missing_header で拒む', async (_, withSignature, withTimestamp) => {
		const result = await verifySignature(headers(withSignature ? validSignature : null, withTimestamp ? TIMESTAMP : null), BODY, publicKey);

		expect(result).toEqual({ ok: false, error: 'missing_header' });
	});

	// 正しい署名から1か所だけ変えて作る。
	it.each([
		['署名を書き換えた', { signature: flipFirstByte }],
		['本文を書き換えた', { body: '{"type":2}' }],
		['タイムスタンプを書き換えた', { timestamp: '1700000001' }],
		['署名が16進でない', { signature: (s: string) => 'zz' + s.slice(2) }],
		['署名の長さが64バイトでない', { signature: (s: string) => s.slice(0, -2) }],
		['署名の16進の桁数が奇数', { signature: (s: string) => `${s}0` }],
	])('%sときは invalid_signature で拒む', async (_, change: { signature?: (s: string) => string; body?: string; timestamp?: string }) => {
		const signature = change.signature?.(validSignature) ?? validSignature;

		const result = await verifySignature(headers(signature, change.timestamp ?? TIMESTAMP), change.body ?? BODY, publicKey);

		expect(result).toEqual({ ok: false, error: 'invalid_signature' });
	});
});

describe('importPublicKey', () => {
	it('公開鍵が16進でなければ例外を投げる', async () => {
		await expect(importPublicKey('not a hex key')).rejects.toThrow(TypeError);
	});
});
