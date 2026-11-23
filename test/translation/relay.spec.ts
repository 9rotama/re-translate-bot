import { env } from 'cloudflare:workers';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { interactionPlace } from '../../src/log';
import { relay, textLength, type Route, type TranslationAi } from '../../src/translation/relay';

type Call = { text: string; source_lang: string; target_lang: string };
type Reply = (call: Call, signal: AbortSignal) => Promise<unknown>;

// 実物の binding と同じく、失敗は message に「コード: 説明」を持つ InferenceUpstreamError で投げる。
const upstreamError = (message: string) => Object.assign(new Error(message), { name: 'InferenceUpstreamError' });

// 既定では「[from>to]本文」の形で返し、どの段で何が渡ったかを結果から読めるようにする。
const translated: Reply = async ({ text, source_lang, target_lang }) => ({ translated_text: `[${source_lang}>${target_lang}]${text}` });

function fakeAi(...replies: Reply[]) {
	const calls: Call[] = [];
	const ai: TranslationAi = {
		run: async (_model, inputs, { signal }) => {
			calls.push({ ...inputs });
			const reply = replies[calls.length - 1] ?? translated;
			return reply(inputs, signal);
		},
	};
	return { ai, calls };
}

const failing: Reply = async () => {
	throw upstreamError('3040: Capacity temporarily exceeded');
};
const neverResolves: Reply = () => new Promise(() => {});
const route: Route = ['ja', 'en', 'fr', 'ja'];
const place = interactionPlace({ guild_id: '123456789012345678', channel: { id: '234567890123456789' } });

const eventOf = (entry: unknown) => (typeof entry === 'object' && entry !== null && 'event' in entry ? entry.event : undefined);
const eventsOf = (spy: MockInstance) => spy.mock.calls.map((args: unknown[]) => eventOf(args[0]));

describe('relay', () => {
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

	it('型では、実物の AI binding をそのまま渡せる', () => {
		const ai: TranslationAi = env.AI;

		expect(ai).toBeDefined();
	});

	describe('成功', () => {
		it('中継ルートの隣り合う言語の組を順に翻訳し、前の段の結果を次の段に渡す', async () => {
			const { ai, calls } = fakeAi();

			const result = await relay(ai, 'こんにちは', route);

			expect(calls).toEqual([
				{ text: 'こんにちは', source_lang: 'ja', target_lang: 'en' },
				{ text: '[ja>en]こんにちは', source_lang: 'en', target_lang: 'fr' },
				{ text: '[en>fr][ja>en]こんにちは', source_lang: 'fr', target_lang: 'ja' },
			]);
			expect(result).toEqual({ ok: true, value: '[fr>ja][en>fr][ja>en]こんにちは' });
		});

		it('各段の成功と全体の成功を記録する', async () => {
			const { ai } = fakeAi();

			await relay(ai, 'こんにちは', route);

			expect(eventsOf(spies.log)).toEqual([
				'translation.step.succeeded',
				'translation.step.succeeded',
				'translation.step.succeeded',
				'translation.succeeded',
			]);
			expect(spies.log).toHaveBeenLastCalledWith(expect.objectContaining({ steps: 3, inputLength: 5 }));
		});

		it('文字数はサロゲートペアの文字も1文字と数える', async () => {
			const { ai } = fakeAi();

			await relay(ai, '🍣🍺', ['ja', 'en']);

			expect(spies.log).toHaveBeenLastCalledWith(expect.objectContaining({ inputLength: 2, outputLength: 9 }));
		});
	});

	describe('再試行', () => {
		it('Workers AI の一時的な失敗は、同じ段を1回だけ試し直す', async () => {
			const { ai, calls } = fakeAi(async () => {
				throw upstreamError('3040: Capacity temporarily exceeded');
			});

			const result = await relay(ai, 'こんにちは', ['ja', 'en']);

			expect(calls).toHaveLength(2);
			expect(result).toEqual({ ok: true, value: '[ja>en]こんにちは' });
			expect(spies.warn).toHaveBeenCalledWith(
				expect.objectContaining({ event: 'translation.step.failed', attempt: 1, errorKind: 'ai_error' }),
			);
			expect(spies.log).toHaveBeenCalledWith(expect.objectContaining({ event: 'translation.step.succeeded', attempt: 2 }));
		});

		it('試し直しても失敗したら、ai_error で失敗を返す', async () => {
			const { ai, calls } = fakeAi(failing, failing);

			const result = await relay(ai, 'こんにちは', route);

			expect(calls).toHaveLength(2);
			expect(result).toEqual({ ok: false, error: { kind: 'ai_error' } });
		});

		it('結果に翻訳文がない応答は ai_error として試し直す', async () => {
			const { ai, calls } = fakeAi(async () => ({ request_id: 'abc' }));

			const result = await relay(ai, 'こんにちは', ['ja', 'en']);

			expect(calls).toHaveLength(2);
			expect(result.ok).toBe(true);
		});

		it('Error でない値が投げられたときも ai_error として試し直す', async () => {
			const { ai, calls } = fakeAi(async () => {
				// oxlint-disable-next-line no-throw-literal
				throw 'boom';
			});

			const result = await relay(ai, 'こんにちは', ['ja', 'en']);

			expect(calls).toHaveLength(2);
			expect(result.ok).toBe(true);
		});
	});

	describe('無料枠の使い切り', () => {
		it.each([
			"4006: you have used up your daily free allocation of 10,000 neurons, please upgrade to Cloudflare's Workers Paid plan",
			'3036: Account limited',
		])('「%s」の失敗は、試し直さずに quota_exceeded で失敗を返す', async (message) => {
			const { ai, calls } = fakeAi(async () => {
				throw upstreamError(message);
			});

			const result = await relay(ai, 'こんにちは', route);

			expect(calls).toHaveLength(1);
			expect(result).toEqual({ ok: false, error: { kind: 'quota_exceeded' } });
		});
	});

	describe('時間切れ', () => {
		it('期限までに終わらなければ、残りの段を呼ばずに timeout で失敗を返す', async () => {
			const { ai, calls } = fakeAi(translated, neverResolves);

			const result = await relay(ai, 'こんにちは', route, { deadlineMs: 20 });

			expect(calls).toHaveLength(2);
			expect(result).toEqual({ ok: false, error: { kind: 'timeout' } });
		});

		it('期限を過ぎたら binding に渡した signal を中断する', async () => {
			let received: AbortSignal | undefined;
			const { ai } = fakeAi((_call, signal) => {
				received = signal;
				return neverResolves(_call, signal);
			});

			await relay(ai, 'こんにちは', route, { deadlineMs: 20 });

			expect(received?.aborted).toBe(true);
		});

		it('signal の中断で binding が投げた例外も timeout として扱う', async () => {
			const { ai } = fakeAi(
				(_call, signal) =>
					new Promise((_, reject) => {
						signal.addEventListener('abort', () => reject(upstreamError('3040: aborted')));
					}),
			);

			const result = await relay(ai, 'こんにちは', route, { deadlineMs: 20 });

			expect(result).toEqual({ ok: false, error: { kind: 'timeout' } });
		});

		it('期限を過ぎた後に失敗した段は、試し直さずに timeout で失敗を返す', async () => {
			const { ai, calls } = fakeAi(async () => {
				await new Promise((resolve) => setTimeout(resolve, 40));
				throw upstreamError('3040: Capacity temporarily exceeded');
			});

			const result = await relay(ai, 'こんにちは', route, { deadlineMs: 20 });

			expect(calls).toHaveLength(1);
			expect(result).toEqual({ ok: false, error: { kind: 'timeout' } });
		});
	});

	describe('失敗の記録', () => {
		it('失敗した段と全体の失敗を、ギルドとチャンネルの ID と例外の情報を付けて記録する', async () => {
			const { ai } = fakeAi(translated, async () => {
				throw upstreamError('3036: Account limited');
			});

			await relay(ai, 'こんにちは', route, { place });

			expect(spies.warn).toHaveBeenCalledWith(
				expect.objectContaining({
					event: 'translation.step.failed',
					step: 2,
					from: 'en',
					to: 'fr',
					errorKind: 'quota_exceeded',
					errorName: 'InferenceUpstreamError',
					...place,
				}),
			);
			expect(spies.error).toHaveBeenCalledWith(
				expect.objectContaining({ event: 'translation.failed', steps: 3, completedSteps: 1, errorKind: 'quota_exceeded', ...place }),
			);
			expect(eventsOf(spies.log)).not.toContain('translation.succeeded');
		});

		it('ログに原文と翻訳結果を含めない', async () => {
			const { ai } = fakeAi(translated, async () => {
				throw upstreamError('3040: こんにちは');
			});

			await relay(ai, 'こんにちは', route);

			const output = JSON.stringify([...spies.log.mock.calls, ...spies.warn.mock.calls, ...spies.error.mock.calls]);
			expect(output).not.toContain('こんにちは');
		});
	});
});

describe('textLength', () => {
	it('書記素の数を数える', () => {
		expect(textLength('こんにちは')).toBe(5);
		expect(textLength('')).toBe(0);
	});

	it('絵文字の連結や結合文字を見た目の1文字として数える', () => {
		expect(textLength('👨‍👩‍👧')).toBe(1);
		expect(textLength('が')).toBe(1);
		expect(textLength('🇯🇵a')).toBe(2);
	});
});
