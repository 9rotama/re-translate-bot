// コマンド名ごとのハンドラ。各コマンドの実装は #34〜#36 で差し替える。
import {
	InteractionResponseType,
	MessageFlags,
	type APIChatInputApplicationCommandGuildInteraction,
	type APIInteractionResponse,
} from 'discord-api-types/v10';
import type { CommandName } from './dispatch';

type Handler = (
	interaction: APIChatInputApplicationCommandGuildInteraction,
	env: Env,
	ctx: ExecutionContext,
) => Promise<APIInteractionResponse>;

const notImplemented: Handler = async (): Promise<APIInteractionResponse> => ({
	type: InteractionResponseType.ChannelMessageWithSource,
	data: { content: 'このコマンドはまだ使えません', flags: MessageFlags.Ephemeral },
});

export const handlers: Readonly<Record<CommandName, Handler>> = {
	rt: notImplemented,
	'settings show': notImplemented,
	'settings relay': notImplemented,
	'settings origin': notImplemented,
	help: notImplemented,
};
