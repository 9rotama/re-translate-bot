import { ApplicationCommandOptionType } from 'discord-api-types/v10';
import { describe, expect, expectTypeOf, it } from 'vitest';
import { resolveCommand, stringOption, type CommandName, type StringOptionName } from '../src/commands/dispatch';
import type { LogEvent } from '../src/log';
import { commandInteraction, subcommand } from './helpers/interactions';

describe('resolveCommand', () => {
	it('サブコマンドのないコマンドは、コマンド名をそのまま返す', () => {
		const interaction = commandInteraction('rt', [{ type: ApplicationCommandOptionType.String, name: 'text', value: 'こんにちは' }]);

		expect(resolveCommand(interaction)).toBe('rt');
	});

	it('サブコマンドのあるコマンドは、コマンド名とサブコマンド名を空白でつないで返す', () => {
		expect(resolveCommand(commandInteraction('settings', subcommand('relay')))).toBe('settings relay');
	});

	it.each([
		['登録していないコマンド', commandInteraction('unknown')],
		['登録していないサブコマンド', commandInteraction('settings', subcommand('unknown'))],
		['サブコマンドを指定していないサブコマンド付きのコマンド', commandInteraction('settings')],
		['Object のプロパティ名', commandInteraction('toString')],
	])('%sには undefined を返す', (_, interaction) => {
		expect(resolveCommand(interaction)).toBeUndefined();
	});

	it('定義から導いたコマンド名は、ログに記録するコマンド名と一致する', () => {
		// log.ts は commands/ を参照できず、コマンド名の列挙を自前で持つので、食い違いを型で検査する。
		expectTypeOf<CommandName>().toEqualTypeOf<NonNullable<Extract<LogEvent, { event: 'interaction.received' }>['command']>>();
	});
});

const text = (value: string) => ({ type: ApplicationCommandOptionType.String, name: 'text', value }) as const;

describe('stringOption', () => {
	it('サブコマンドのないコマンドでは、トップレベルの引数の値を返す', () => {
		expect(stringOption(commandInteraction('rt', [text('こんにちは')]), 'rt', 'text')).toBe('こんにちは');
	});

	it('サブコマンドのあるコマンドでは、そのサブコマンドの中の引数の値を返す', () => {
		const interaction = commandInteraction(
			'settings',
			subcommand('relay', [{ type: ApplicationCommandOptionType.String, name: 'langs', value: 'en fr' }]),
		);

		expect(stringOption(interaction, 'settings relay', 'langs')).toBe('en fr');
	});

	it('引数が渡されていなければ undefined を返す', () => {
		expect(stringOption(commandInteraction('rt'), 'rt', 'text')).toBeUndefined();
		expect(stringOption(commandInteraction('settings', subcommand('relay', [])), 'settings relay', 'langs')).toBeUndefined();
	});

	it('サブコマンドの中に options がなければ undefined を返す', () => {
		const interaction = commandInteraction('settings', subcommand('origin'));

		expect(stringOption(interaction, 'settings origin', 'lang')).toBeUndefined();
	});

	it('別のサブコマンドの Interaction では undefined を返す', () => {
		const interaction = commandInteraction(
			'settings',
			subcommand('relay', [{ type: ApplicationCommandOptionType.String, name: 'lang', value: 'en' }]),
		);

		expect(stringOption(interaction, 'settings origin', 'lang')).toBeUndefined();
	});

	it('別のコマンドの Interaction では undefined を返す', () => {
		expect(stringOption(commandInteraction('other', [text('こんにちは')]), 'rt', 'text')).toBeUndefined();
	});

	it('サブコマンドのあるコマンドでは、トップレベルにある同じ名前の値を読まない', () => {
		const interaction = commandInteraction('settings', [{ type: ApplicationCommandOptionType.String, name: 'langs', value: 'en' }]);

		expect(stringOption(interaction, 'settings relay', 'langs')).toBeUndefined();
	});

	it('名前が同じでも文字列でない引数には undefined を返す', () => {
		const interaction = commandInteraction('rt', [{ type: ApplicationCommandOptionType.Integer, name: 'text', value: 1 }]);

		expect(stringOption(interaction, 'rt', 'text')).toBeUndefined();
	});

	it('型では、definitions にある文字列の引数名だけを受け付ける', () => {
		expectTypeOf<StringOptionName<'rt'>>().toEqualTypeOf<'text'>();
		expectTypeOf<StringOptionName<'settings relay'>>().toEqualTypeOf<'langs'>();
		expectTypeOf<StringOptionName<'settings origin'>>().toEqualTypeOf<'lang'>();
		expectTypeOf<StringOptionName<'settings show'>>().toBeNever();
		expectTypeOf<StringOptionName<'help'>>().toBeNever();

		const interaction = commandInteraction('rt');
		// @ts-expect-error definitions にない引数名
		stringOption(interaction, 'rt', 'txt');
		// @ts-expect-error 別のサブコマンドの引数名
		stringOption(interaction, 'settings relay', 'lang');
		// @ts-expect-error definitions にないコマンド名
		stringOption(interaction, 'settings', 'langs');
	});
});
