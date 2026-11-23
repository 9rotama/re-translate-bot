// Discord からのリクエストであることを Ed25519 の署名で確かめる。
// 署名の対象はタイムスタンプのヘッダと本文をつないだもの（https://discord.com/developers/docs/interactions/overview#preparing-for-interactions）。
import type { SignatureRejectionReason } from './errors';
import { err, ok, type Result } from './result';

export const SIGNATURE_HEADER = 'X-Signature-Ed25519';
export const TIMESTAMP_HEADER = 'X-Signature-Timestamp';
const SIGNATURE_BYTES = 64;
const HEX = /^(?:[\da-f]{2})*$/i;
const encoder = new TextEncoder();

export function hexToBytes(hex: string): Uint8Array<ArrayBuffer> | undefined {
	if (!HEX.test(hex)) return undefined;
	return Uint8Array.from({ length: hex.length / 2 }, (_, i) => Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16));
}

// 公開鍵は vars に書いた設定の値なので、形が不正なら設定の誤りとして例外のまま伝える。
export async function importPublicKey(publicKeyHex: string): Promise<CryptoKey> {
	const raw = hexToBytes(publicKeyHex);
	if (raw === undefined) throw new TypeError('DISCORD_PUBLIC_KEY is not a hex string');
	return crypto.subtle.importKey('raw', raw, { name: 'Ed25519' }, false, ['verify']);
}

export async function verifySignature(
	headers: Headers,
	body: string,
	publicKey: CryptoKey,
): Promise<Result<void, SignatureRejectionReason>> {
	const signatureHex = headers.get(SIGNATURE_HEADER);
	const timestamp = headers.get(TIMESTAMP_HEADER);
	if (signatureHex === null || timestamp === null) return err('missing_header');
	const signature = hexToBytes(signatureHex);
	// 長さの違う署名には Web Crypto が false を返さず例外を投げるので、先に断る。
	if (signature?.length !== SIGNATURE_BYTES) return err('invalid_signature');
	const valid = await crypto.subtle.verify('Ed25519', publicKey, signature, encoder.encode(timestamp + body));
	return valid ? ok(undefined) : err('invalid_signature');
}
