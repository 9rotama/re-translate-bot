import type { TranslationStepErrorKind } from '../errors';
import { errorDetails, log, type ErrorDetails, type Place } from '../log';
import { err, ok, type Result } from '../result';
import type { LanguageCode } from './languages';

const MODEL = '@cf/meta/m2m100-1.2b';

// /rt は呼び出しから30秒以内に結果かエラーを表示する（docs/non-functional.md の「応答時間」）。
// 30秒ちょうどを期限にしないのは、翻訳の後に followup で元のメッセージを編集する時間を残すため。
export const TRANSLATION_DEADLINE_MS = 25_000;

// 無料枠の使い切りと時間切れは試し直しても結果が変わらないので、それ以外の失敗だけを試し直す。
const MAX_ATTEMPTS = 2;

// Workers AI の binding は失敗を例外で投げ、message に内部のエラーコードを「4006: …」の形で含める。
// 無料枠の使い切りは 4006（daily free allocation）か 3036（Account limited）で返る。
// HTTP の status は binding の例外から取り出せないので、message のコードで見分ける。
const QUOTA_EXCEEDED = /\b(?:3036|4006):/;

type TranslationInput = { text: string; source_lang: LanguageCode; target_lang: LanguageCode };

// Workers AI の binding（env.AI）のうち、翻訳に使う部分だけの形。テストではこの形の偽物を渡す。
export type TranslationAi = {
	run(model: typeof MODEL, inputs: TranslationInput, options: { signal: AbortSignal }): Promise<unknown>;
};

// 原文の言語から中継言語を経て原文の言語に戻るので、少なくとも2つの言語を持つ。
export type Route = readonly [LanguageCode, LanguageCode, ...LanguageCode[]];

export type RelayError = { readonly kind: TranslationStepErrorKind };

export type RelayOptions = {
	// 呼び出し側が interactionPlace() で Interaction から取り出したもの。
	readonly place?: Place;
	readonly deadlineMs?: number;
};

type StepFailure = { readonly kind: TranslationStepErrorKind; readonly details: ErrorDetails };

class DeadlineExceededError extends Error {
	override name = 'DeadlineExceededError';
}

// 文字数は書記素で数える。絵文字や結合文字を、見た目の1文字より多く数えないため。
const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
const lengthOf = (text: string): number => Array.from(graphemes.segment(text)).length;

function translatedText(output: unknown): string | undefined {
	if (typeof output !== 'object' || output === null || !('translated_text' in output)) return undefined;
	return typeof output.translated_text === 'string' ? output.translated_text : undefined;
}

function failureKind(error: unknown): TranslationStepErrorKind {
	return error instanceof Error && QUOTA_EXCEEDED.test(error.message) ? 'quota_exceeded' : 'ai_error';
}

async function translateOnce(
	ai: TranslationAi,
	input: TranslationInput,
	signal: AbortSignal,
	deadline: Promise<never>,
): Promise<Result<string, StepFailure>> {
	if (signal.aborted) return err({ kind: 'timeout', details: {} });
	try {
		// binding が signal に応じて止まらなくても期限で抜けられるよう、期限の Promise と競わせる。
		const output = await Promise.race([ai.run(MODEL, input, { signal }), deadline]);
		const text = translatedText(output);
		return text === undefined ? err({ kind: 'ai_error', details: {} }) : ok(text);
	} catch (error) {
		return err({ kind: signal.aborted ? 'timeout' : failureKind(error), details: errorDetails(error) });
	}
}

type Step = {
	readonly step: number;
	readonly steps: number;
	readonly from: LanguageCode;
	readonly to: LanguageCode;
	readonly text: string;
};

type Attempt = {
	readonly ai: TranslationAi;
	readonly place: Place;
	readonly signal: AbortSignal;
	readonly deadline: Promise<never>;
};

async function translateStep(
	{ step, steps, from, to, text }: Step,
	{ ai, place, signal, deadline }: Attempt,
): Promise<Result<string, StepFailure>> {
	const inputLength = lengthOf(text);
	for (let attempt = 1; ; attempt++) {
		const startedAt = Date.now();
		const result = await translateOnce(ai, { text, source_lang: from, target_lang: to }, signal, deadline);
		const common = { step, steps, attempt, from, to, inputLength, durationMs: Date.now() - startedAt };
		if (result.ok) {
			log({ event: 'translation.step.succeeded', ...common, outputLength: lengthOf(result.value) });
			return result;
		}
		log({
			event: 'translation.step.failed',
			...common,
			errorKind: result.error.kind,
			...place,
			...result.error.details,
		});
		if (result.error.kind !== 'ai_error' || attempt >= MAX_ATTEMPTS) return result;
	}
}

// 中継ルートに沿って1段ずつ翻訳し、最後の段の結果を返す。
// 途中で失敗したら途中までの結果は返さない（docs/non-functional.md の「障害時の扱い」）。
export async function relay(
	ai: TranslationAi,
	text: string,
	route: Route,
	options: RelayOptions = {},
): Promise<Result<string, RelayError>> {
	const place = options.place ?? {};
	const steps = route.length - 1;
	const inputLength = lengthOf(text);
	const startedAt = Date.now();

	const controller = new AbortController();
	const { promise: deadline, reject } = Promise.withResolvers<never>();
	const timer = setTimeout(() => {
		controller.abort();
		reject(new DeadlineExceededError());
	}, options.deadlineMs ?? TRANSLATION_DEADLINE_MS);
	// 期限を過ぎたときに競わせている呼び出しがなくても、拒否を未処理として報告させない。
	deadline.catch(() => {});
	const attempt: Attempt = { ai, place, signal: controller.signal, deadline };

	try {
		let current = text;
		for (let index = 0; index < steps; index++) {
			const step = { step: index + 1, steps, from: route[index], to: route[index + 1], text: current };
			const result = await translateStep(step, attempt);
			if (!result.ok) {
				const { kind } = result.error;
				log({
					event: 'translation.failed',
					steps,
					completedSteps: index,
					inputLength,
					durationMs: Date.now() - startedAt,
					errorKind: kind,
					...place,
				});
				return err({ kind });
			}
			current = result.value;
		}
		log({ event: 'translation.succeeded', steps, inputLength, outputLength: lengthOf(current), durationMs: Date.now() - startedAt });
		return ok(current);
	} finally {
		clearTimeout(timer);
	}
}
