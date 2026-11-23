import { ApplicationCommandOptionType } from 'discord-api-types/v10';
import { describe, expect, expectTypeOf, it } from 'vitest';
import { resolveCommand, type CommandName } from '../src/commands/dispatch';
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
