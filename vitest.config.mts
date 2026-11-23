import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-plugin';
import { generateKeyPairSync } from 'node:crypto';
import { defineConfig } from 'vitest/config';

// 閾値は docs/testing.md の「カバレッジ」の表に合わせる。
const branches90 = { branches: 90 };

// 署名付きの Interaction を作るための鍵ペア。テスト用でも秘密鍵をリポジトリに置かないよう、実行のたびに作る。
const signingKeys = generateKeyPairSync('ed25519');
// SPKI の DER は末尾の32バイトが生の公開鍵になる。
const testPublicKey = signingKeys.publicKey.export({ format: 'der', type: 'spki' }).subarray(-32).toString('hex');
const testSigningKey = signingKeys.privateKey.export({ format: 'der', type: 'pkcs8' }).toString('hex');

export default defineConfig(async () => ({
	plugins: [
		cloudflareTest({
			wrangler: { configPath: './wrangler.jsonc' },
			// Workers AI の本物を呼ぶと無料枠を使うので、Cloudflare には接続しない。テストでは偽物を渡す。
			remoteBindings: false,
			miniflare: {
				bindings: {
					TEST_MIGRATIONS: await readD1Migrations('./migrations'),
					DISCORD_PUBLIC_KEY: testPublicKey,
					TEST_SIGNING_KEY: testSigningKey,
				},
			},
		}),
	],
	test: {
		setupFiles: ['./test/apply-migrations.ts'],
		// discord-api-types の ESM は CJS を default import して値を取り出す形で、Vitest の実行環境ではその default が CJS の exports にならず enum が undefined になる。
		// 事前に束ねて ESM に変換しておく。
		deps: { optimizer: { ssr: { enabled: true, include: ['discord-api-types/v10', 'discord-api-types/utils/v10'] } } },
		coverage: {
			provider: 'istanbul' as const,
			include: ['src/**'],
			// コマンドの定義は Discord に登録して初めて意味を持つので、自動テストでは測らない。
			exclude: ['src/commands/definitions.ts'],
			reporter: ['text', 'html'],
			thresholds: {
				'src/verify.ts': branches90,
				'src/log.ts': branches90,
				'src/translation/**': branches90,
				'src/settings/route.ts': branches90,
				'src/settings/store.ts': branches90,
				'src/discord/**': branches90,
			},
		},
	},
}));
