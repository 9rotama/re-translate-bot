// Interaction からコマンド名（サブコマンドを含む）を取り出す。
import { ApplicationCommandOptionType, type APIChatInputApplicationCommandInteraction } from 'discord-api-types/v10';
import { definitions } from './definitions';

type Definition = (typeof definitions)[number];
type SubcommandName<D> = D extends { options: readonly (infer O)[] }
	? O extends { type: ApplicationCommandOptionType.Subcommand; name: infer N extends string }
		? N
		: never
	: never;
type FullName<D> = D extends { name: infer N extends string }
	? [SubcommandName<D>] extends [never]
		? N
		: `${N} ${SubcommandName<D>}`
	: never;
export type CommandName = FullName<Definition>;

const commandNames: ReadonlySet<string> = new Set(
	definitions.flatMap((definition) => {
		const subcommands =
			'options' in definition ? definition.options.filter((option) => option.type === ApplicationCommandOptionType.Subcommand) : [];
		return subcommands.length === 0 ? [definition.name] : subcommands.map((option) => `${definition.name} ${option.name}`);
	}),
);

const isCommandName = (name: string): name is CommandName => commandNames.has(name);

// 登録していないコマンド（古い登録が Discord に残っているものなど）には undefined を返す。
export function resolveCommand(interaction: Pick<APIChatInputApplicationCommandInteraction, 'data'>): CommandName | undefined {
	const { name, options } = interaction.data;
	const subcommand = options?.find((option) => option.type === ApplicationCommandOptionType.Subcommand);
	const fullName = subcommand === undefined ? name : `${name} ${subcommand.name}`;
	return isCommandName(fullName) ? fullName : undefined;
}
