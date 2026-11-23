import { describe, expect, it } from 'vitest';
import { formatRoute, toRoute } from '../../src/settings/route';
import { defaultSettings } from '../../src/settings/store';

describe('toRoute', () => {
	it('原文の言語から中継言語を順に経て原文の言語に戻るルートを返す', () => {
		expect(toRoute({ originLang: 'ja', relayLangs: ['en', 'fr'] })).toEqual({ ok: true, value: ['ja', 'en', 'fr', 'ja'] });
	});

	it('既定の設定からは ja -> en -> ja のルートを返す', () => {
		expect(toRoute(defaultSettings)).toEqual({ ok: true, value: ['ja', 'en', 'ja'] });
	});

	it('大文字を含む言語コードは小文字にしてルートに入れる', () => {
		expect(toRoute({ originLang: 'KO', relayLangs: ['En'] })).toEqual({ ok: true, value: ['ko', 'en', 'ko'] });
	});

	it('隣り合わない同じ言語は許す', () => {
		expect(toRoute({ originLang: 'ja', relayLangs: ['en', 'fr', 'en'] })).toEqual({ ok: true, value: ['ja', 'en', 'fr', 'en', 'ja'] });
	});

	describe('同じ言語が続くルート', () => {
		it.each([
			{ relayLangs: ['ja', 'en'], route: ['ja', 'ja', 'en', 'ja'] },
			{ relayLangs: ['en', 'en'], route: ['ja', 'en', 'en', 'ja'] },
			{ relayLangs: ['en', 'ja'], route: ['ja', 'en', 'ja', 'ja'] },
			{ relayLangs: ['EN', 'en'], route: ['ja', 'en', 'en', 'ja'] },
		])('中継言語が $relayLangs のときは、続いたままのルートを持つエラーを返す', ({ relayLangs, route }) => {
			expect(toRoute({ originLang: 'ja', relayLangs })).toEqual({ ok: false, error: { kind: 'repeated_language', route } });
		});

		it('中継言語がないときは、原文の言語が続くルートとしてエラーを返す', () => {
			expect(toRoute({ originLang: 'ja', relayLangs: [] })).toEqual({
				ok: false,
				error: { kind: 'repeated_language', route: ['ja', 'ja'] },
			});
		});
	});

	describe('対応していない言語コード', () => {
		it('中継言語の対応していないコードを、小文字にして現れる順に重複なく挙げる', () => {
			expect(toRoute({ originLang: 'ja', relayLangs: ['en', 'XX', 'yy', 'xx'] })).toEqual({
				ok: false,
				error: { kind: 'unsupported_language', codes: ['xx', 'yy'] },
			});
		});

		it('原文の言語が対応していないコードなら、それを中継言語のコードより先に挙げる', () => {
			expect(toRoute({ originLang: 'jp', relayLangs: ['zz', 'en'] })).toEqual({
				ok: false,
				error: { kind: 'unsupported_language', codes: ['jp', 'zz'] },
			});
		});

		it('同じ言語も続いているときは、対応していないコードのエラーを返す', () => {
			expect(toRoute({ originLang: 'ja', relayLangs: ['ja', 'xx'] })).toEqual({
				ok: false,
				error: { kind: 'unsupported_language', codes: ['xx'] },
			});
		});
	});
});

describe('formatRoute', () => {
	it('言語コードを " -> " で区切って並べる', () => {
		expect(formatRoute(['ja', 'en', 'fr', 'ja'])).toBe('ja -> en -> fr -> ja');
	});

	it('2つだけのルートも区切って並べる', () => {
		expect(formatRoute(['ja', 'ja'])).toBe('ja -> ja');
	});
});
