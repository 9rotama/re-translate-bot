import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-plugin';
import { defineConfig } from 'vitest/config';

// 閾値は docs/testing.md の「カバレッジ」の表に合わせる。
const branches90 = { branches: 90 };

export default defineConfig(async () => ({
	plugins: [
		cloudflareTest({
			wrangler: { configPath: './wrangler.jsonc' },
			// Workers AI の本物を呼ぶと無料枠を使うので、Cloudflare には接続しない。テストでは偽物を渡す。
			remoteBindings: false,
			miniflare: {
				bindings: { TEST_MIGRATIONS: await readD1Migrations('./migrations') },
			},
		}),
	],
	test: {
		setupFiles: ['./test/apply-migrations.ts'],
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
