declare namespace Cloudflare {
	interface Env {
		TEST_MIGRATIONS: import('cloudflare:test').D1Migration[];
		// PKCS#8 の DER を16進にした Ed25519 の秘密鍵
		TEST_SIGNING_KEY: string;
	}
}
