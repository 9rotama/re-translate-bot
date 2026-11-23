// コマンドの定義。scripts/register-commands.ts が Discord に登録する。
// 名前と文言は docs/interface.md の「コマンド」に合わせる。
import {
	ApplicationCommandOptionType,
	ApplicationCommandType,
	ApplicationIntegrationType,
	InteractionContextType,
	type RESTPutAPIApplicationCommandsJSONBody,
} from 'discord-api-types/v10';

// bot との DM には出さない。ユーザーへのインストールも受け付けない。
const guildOnly = {
	contexts: [InteractionContextType.Guild],
	integration_types: [ApplicationIntegrationType.GuildInstall],
};

// as const では discord-api-types の配列の型（readonly でない）に合わなくなるので、const 型引数で名前をリテラル型のまま残す。
const defineCommands = <const T extends RESTPutAPIApplicationCommandsJSONBody>(commands: T): T => commands;

export const definitions = defineCommands([
	{
		type: ApplicationCommandType.ChatInput,
		name: 'rt',
		description: '文章を再翻訳して表示します',
		...guildOnly,
		options: [
			{
				type: ApplicationCommandOptionType.String,
				name: 'text',
				description: '再翻訳する文章',
				required: true,
				// docs/non-functional.md の「入力の上限」
				max_length: 200,
			},
		],
	},
	{
		type: ApplicationCommandType.ChatInput,
		name: 'settings',
		description: 'このチャンネルの翻訳設定',
		...guildOnly,
		options: [
			{
				type: ApplicationCommandOptionType.Subcommand,
				name: 'show',
				description: 'このチャンネルの中継ルートを表示します',
			},
			{
				type: ApplicationCommandOptionType.Subcommand,
				name: 'relay',
				description: '中継言語を設定します（10言語まで）',
				options: [
					{
						type: ApplicationCommandOptionType.String,
						name: 'langs',
						description: '言語コードを空白区切りで入力（例: en fr de）',
						required: true,
					},
				],
			},
			{
				type: ApplicationCommandOptionType.Subcommand,
				name: 'origin',
				description: '原文の言語を設定します',
				options: [
					{
						type: ApplicationCommandOptionType.String,
						name: 'lang',
						description: '言語コード（例: ja）',
						required: true,
					},
				],
			},
		],
	},
	{
		type: ApplicationCommandType.ChatInput,
		name: 'help',
		description: '使い方を表示します',
		...guildOnly,
	},
]);
