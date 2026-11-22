import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { log, type LogEvent } from '../src/log';

// 型をすり抜けた呼び出し（変数に入れたオブジェクトや、数に変換した値）を再現する。
// 型の検査を通らない値をわざと渡すので、型の絞り込みはしない。
// oxlint-disable-next-line typescript/no-unsafe-type-assertion
const unchecked = (entry: Record<string, unknown>) => entry as unknown as LogEvent;

const stepSucceeded = {
	event: 'translation.step.succeeded',
	step: 1,
	steps: 2,
	attempt: 1,
	from: 'ja',
	to: 'en',
	inputLength: 12,
	outputLength: 20,
	durationMs: 830,
} as const satisfies LogEvent;

describe('log', () => {
	let spies: Record<'log' | 'warn' | 'error', MockInstance>;

	beforeEach(() => {
		spies = {
			log: vi.spyOn(console, 'log').mockImplementation(() => {}),
			warn: vi.spyOn(console, 'warn').mockImplementation(() => {}),
			error: vi.spyOn(console, 'error').mockImplementation(() => {}),
		};
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	describe('レベル', () => {
		it.each([
			['log', stepSucceeded],
			['warn', { event: 'signature.rejected', reason: 'invalid_signature' }],
			['error', { event: 'd1.failed', operation: 'settings.read' }],
		] as const)('イベントごとに決めたレベル（%s）で出力する', (level, entry) => {
			log(entry);

			expect(spies[level]).toHaveBeenCalledTimes(1);
			const others = (['log', 'warn', 'error'] as const).filter((other) => other !== level);
			for (const other of others) expect(spies[other]).not.toHaveBeenCalled();
		});
	});

	describe('出力する値', () => {
		it('イベント名と、イベントに決めた値をそのまま出力する', () => {
			log(stepSucceeded);

			expect(spies.log).toHaveBeenCalledWith(stepSucceeded);
		});

		it('イベントに決めていないプロパティは出力しない', () => {
			log(unchecked({ event: 'rt.rate_limited', userId: '123456789012345678', text: '原文' }));

			expect(spies.log).toHaveBeenCalledWith({ event: 'rt.rate_limited' });
		});

		it('省略できる値を渡さなければ、その値を出さず invalid も付けない', () => {
			log({ event: 'interaction.received', interactionType: 1 });

			expect(spies.log).toHaveBeenCalledWith({ event: 'interaction.received', interactionType: 1 });
		});

		it('省略できない値がなければ、そのフィールド名を invalid に並べる', () => {
			log(unchecked({ event: 'followup.failed' }));

			expect(spies.error).toHaveBeenCalledWith({ event: 'followup.failed', invalid: ['errorKind'] });
		});
	});

	describe('値の検査', () => {
		it.each([
			['ID を数に変換した値', Number('1234567890123456789')],
			['負の数', -1],
			['整数でない数', 1.5],
			['数の形の文字列', '1'],
		])('数のフィールドに%sを渡すと、値を出さずに invalid に並べる', (_, value) => {
			log(unchecked({ ...stepSucceeded, durationMs: value }));

			const { durationMs: _omitted, ...rest } = stepSucceeded;
			expect(spies.log).toHaveBeenCalledWith({ ...rest, invalid: ['durationMs'] });
		});

		it.each([
			['原文', 'こんにちは'],
			['大文字', 'JA'],
			['文字列でない値', 1],
		])('言語コードのフィールドに%sを渡すと、値を出さずに invalid に並べる', (_, value) => {
			log(unchecked({ ...stepSucceeded, to: value }));

			const { to: _omitted, ...rest } = stepSucceeded;
			expect(spies.log).toHaveBeenCalledWith({ ...rest, invalid: ['to'] });
		});

		it.each([
			['列挙にない文字列', 'Account limit of 10000 daily neurons exceeded'],
			['Object のプロパティ名', 'toString'],
		])('列挙のフィールドに%sを渡すと、値を出さずに invalid に並べる', (_, value) => {
			log(unchecked({ event: 'd1.failed', operation: value }));

			expect(spies.error).toHaveBeenCalledWith({ event: 'd1.failed', invalid: ['operation'] });
		});
	});

	describe('存在しないイベント', () => {
		it.each(['原文が入ったイベント名', 'toString'])('「%s」を渡すと、名前を出さずに unknown_event を error で出す', (event) => {
			log(unchecked({ event }));

			expect(spies.error).toHaveBeenCalledWith({ event: 'unknown_event' });
		});
	});
});
