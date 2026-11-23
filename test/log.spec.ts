import { describe, expect, it } from 'vitest';
import { errorDetails, interactionPlace, log, type LogEvent } from '../src/log';
import { spyConsole } from './helpers/console';

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
	const spies = spyConsole();

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

	describe('ID と例外の情報', () => {
		it('取り出したギルド ID、チャンネル ID、例外の情報を出力する', () => {
			const place = interactionPlace({ guild_id: '111111111111111111', channel: { id: '222222222222222222' } });
			const details = errorDetails(new TypeError('原文'));

			log({ event: 'd1.failed', operation: 'settings.read', ...place, ...details });

			expect(spies.error).toHaveBeenCalledWith({
				event: 'd1.failed',
				operation: 'settings.read',
				guildId: '111111111111111111',
				channelId: '222222222222222222',
				errorName: 'TypeError',
				stack: details.stack,
			});
		});

		it('型では、取り出す関数を通していない文字列を ID や例外の情報として渡せない', () => {
			// @ts-expect-error ユーザー ID のような任意の文字列はギルド ID として渡せない
			log({ event: 'd1.failed', operation: 'settings.read', guildId: '333333333333333333' });
			// @ts-expect-error 例外の message のような任意の文字列は name として渡せない
			log({ event: 'd1.failed', operation: 'settings.read', errorName: '原文' });

			expect(spies.error).toHaveBeenCalledTimes(2);
		});

		it.each([
			['ID の形でない文字列', 'guildId', '原文'],
			['識別子の形でない name', 'errorName', 'Error: 原文'],
			['識別子でも整数でもない code', 'errorCode', '原文'],
			['コードの位置でない行を含む stack', 'stack', 'Error: 原文\n    at f (worker.js:1:1)'],
		])('%sを渡すと、値を出さずに invalid に並べる', (_, field, value) => {
			log(unchecked({ event: 'd1.failed', operation: 'settings.read', [field]: value }));

			expect(spies.error).toHaveBeenCalledWith({ event: 'd1.failed', operation: 'settings.read', invalid: [field] });
		});
	});

	describe('存在しないイベント', () => {
		it.each(['原文が入ったイベント名', 'toString'])('「%s」を渡すと、名前を出さずに unknown_event を error で出す', (event) => {
			log(unchecked({ event }));

			expect(spies.error).toHaveBeenCalledWith({ event: 'unknown_event' });
		});
	});
});

describe('interactionPlace', () => {
	it('Interaction のギルドとチャンネルの ID を取り出す', () => {
		expect(interactionPlace({ guild_id: '111111111111111111', channel: { id: '222222222222222222' } })).toEqual({
			guildId: '111111111111111111',
			channelId: '222222222222222222',
		});
	});

	it('ID がないか ID の形でなければ、その ID を含めない', () => {
		expect(interactionPlace({})).toEqual({});
		expect(interactionPlace({ guild_id: '原文', channel: { id: '1' } })).toEqual({});
	});
});

describe('errorDetails', () => {
	it('例外と cause の name と code、stack のコードの位置の行を取り出し、message は含めない', () => {
		const cause = Object.assign(new RangeError('原文'), { code: 'SQLITE_ERROR' });
		const error = Object.assign(new Error('原文\n2行目の原文', { cause }), { code: 7 });

		const details = errorDetails(error);

		expect(details).toMatchObject({ errorName: 'Error', errorCode: 7, causeName: 'RangeError', causeCode: 'SQLITE_ERROR' });
		expect(details.stack?.split('\n').every((line) => line.trimStart().startsWith('at '))).toBe(true);
		expect(JSON.stringify(details)).not.toContain('原文');
	});

	it('stack のコードの位置の行は、上から10行までにする', () => {
		const error = new Error('原文');
		error.stack = ['Error: 原文', ...Array.from({ length: 12 }, (_, i) => `    at f${i} (worker.js:${i}:1)`)].join('\n');

		expect(errorDetails(error).stack?.split('\n')).toHaveLength(10);
	});

	it('message に `at ` で始まる行があっても、その行を stack に含めない', () => {
		const details = errorDetails(new Error('上流が入力を拒否した:\n    at 原文'));

		expect(details.stack).toBeDefined();
		expect(details.stack).not.toContain('原文');
	});

	it('stack の先頭が name と message から組み立てた形と一致しなければ、stack を含めない', () => {
		const error = new Error('原文');
		error.stack = '    at 原文\n    at f (worker.js:1:1)';

		expect(errorDetails(error).stack).toBeUndefined();
	});

	it('Error でない値が投げられたときは、何も取り出さない', () => {
		expect(errorDetails('原文')).toEqual({});
	});

	it('name と code が決めた形でなければ、それらを含めない', () => {
		const error = Object.assign(new Error('原文'), { code: '原文' });
		error.name = '原文';
		error.stack = 'Error: 原文';

		expect(errorDetails(error)).toEqual({});
	});
});
