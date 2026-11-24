// コマンド名ごとのハンドラ。
import type { APIChatInputApplicationCommandGuildInteraction, APIInteractionResponse } from 'discord-api-types/v10';
import type { CommandName } from './dispatch';
import { help } from './help';
import { rt } from './rt';
import { settingsOrigin, settingsRelay, settingsShow } from './settings';

type Handler = (
	interaction: APIChatInputApplicationCommandGuildInteraction,
	env: Env,
	ctx: ExecutionContext,
) => Promise<APIInteractionResponse>;

export const handlers: Readonly<Record<CommandName, Handler>> = {
	rt,
	'settings show': settingsShow,
	'settings relay': settingsRelay,
	'settings origin': settingsOrigin,
	help,
};
