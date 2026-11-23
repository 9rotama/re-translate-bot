import { describe, expect, it } from 'vitest';
import { LANGUAGE_CODES, toLanguageCode } from '../../src/translation/languages';

describe('LANGUAGE_CODES', () => {
	it('m2m100 の対応言語100個を重複なく持つ', () => {
		expect(new Set(LANGUAGE_CODES).size).toBe(100);
	});
});

describe('toLanguageCode', () => {
	it.each(['ja', 'en', 'ast', 'zu'])('対応言語のコード（%s）をそのまま返す', (code) => {
		expect(toLanguageCode(code)).toBe(code);
	});

	it('大文字を含むコードは小文字にして返す', () => {
		expect(toLanguageCode('EN')).toBe('en');
		expect(toLanguageCode('Ja')).toBe('ja');
	});

	it.each(['xx', 'jp', '', ' ja', 'en-US', 'zh_CN'])('対応していないコード（%j）には undefined を返す', (input) => {
		expect(toLanguageCode(input)).toBeUndefined();
	});
});
