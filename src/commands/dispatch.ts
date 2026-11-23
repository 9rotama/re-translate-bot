// Interaction からコマンド名（サブコマンドを含む）と引数を取り出す。
import {
	ApplicationCommandOptionType,
	type APIApplicationCommandInteractionDataBasicOption,
	type APIApplicationCommandInteractionDataOption,
	type APIApplicationCommandInteractionDataStringOption,
	type APIApplicationCommandInteractionDataSubcommandOption,
	type APIChatInputApplicationCommandInteraction,
} from 'discord-api-types/v10';
import { definitions } from './definitions';

type Definition = (typeof definitions)[number];
type OptionsOf<T> = T extends { options: readonly (infer O)[] } ? O : never;
type SubcommandOf<D> = Extract<OptionsOf<D>, { type: ApplicationCommandOptionType.Subcommand }>;

// コマンド名と引数名の型を別々に導かないのは、定義の形が変わったときに両者がずれないようにするため。
type EntryOf<D> = D extends { name: infer N extends string }
	? [SubcommandOf<D>] extends [never]
		? { readonly name: N; readonly options: OptionsOf<D> }
		: SubcommandOf<D> extends infer S
			? S extends { name: infer SN extends string }
				? { readonly name: `${N} ${SN}`; readonly options: OptionsOf<S> }
				: never
			: never
	: never;
type Entry = EntryOf<Definition>;

export type CommandName = Entry['name'];
export type OptionDefinitionOf<C extends CommandName> = Extract<Entry, { name: C }>['options'];

const commandNames: ReadonlySet<string> = new Set(
	definitions.flatMap((definition) => {
		const subcommands =
			'options' in definition ? definition.options.filter((option) => option.type === ApplicationCommandOptionType.Subcommand) : [];
		return subcommands.length === 0 ? [definition.name] : subcommands.map((option) => `${definition.name} ${option.name}`);
	}),
);

const isCommandName = (name: string): name is CommandName => commandNames.has(name);

const isSubcommand = (option: APIApplicationCommandInteractionDataOption): option is APIApplicationCommandInteractionDataSubcommandOption =>
	option.type === ApplicationCommandOptionType.Subcommand;
const isBasicOption = (option: APIApplicationCommandInteractionDataOption): option is APIApplicationCommandInteractionDataBasicOption =>
	option.type !== ApplicationCommandOptionType.Subcommand && option.type !== ApplicationCommandOptionType.SubcommandGroup;

export type Invocation = {
	readonly command: CommandName;
	readonly options: readonly APIApplicationCommandInteractionDataBasicOption[];
};

// 登録していないコマンド（古い登録が Discord に残っているものなど）には undefined を返す。
export function resolveInvocation(interaction: Pick<APIChatInputApplicationCommandInteraction, 'data'>): Invocation | undefined {
	const { name, options = [] } = interaction.data;
	const subcommand = options.find(isSubcommand);
	const command = subcommand === undefined ? name : `${name} ${subcommand.name}`;
	if (!isCommandName(command)) return undefined;
	return { command, options: subcommand === undefined ? options.filter(isBasicOption) : (subcommand.options ?? []) };
}

export function resolveCommand(interaction: Pick<APIChatInputApplicationCommandInteraction, 'data'>): CommandName | undefined {
	return resolveInvocation(interaction)?.command;
}

// 引数名を文字列で直接書かず definitions の型から導くのは、登録した引数名との食い違いを型検査で見つけるため。
export type StringOptionName<C extends CommandName> = Extract<OptionDefinitionOf<C>, { type: ApplicationCommandOptionType.String }>['name'];

export function stringOption<C extends CommandName>(
	interaction: Pick<APIChatInputApplicationCommandInteraction, 'data'>,
	command: C,
	name: StringOptionName<C>,
): string | undefined {
	const invocation = resolveInvocation(interaction);
	if (invocation?.command !== command) return undefined;
	const isTarget = (option: APIApplicationCommandInteractionDataBasicOption): option is APIApplicationCommandInteractionDataStringOption =>
		option.type === ApplicationCommandOptionType.String && option.name === name;
	return invocation.options.find(isTarget)?.value;
}
