// src/commands/definitions.ts のコマンドを Discord に一括で上書き登録する。
// DISCORD_GUILD_ID があればそのギルドのコマンドとして、なければグローバルコマンドとして登録する。
// 開発用アプリはギルドコマンドにして、試すギルドの外に開発中のコマンドを出さない。
// 使い方: node --env-file=.env.development.local scripts/register-commands.ts
import { RouteBases, Routes } from 'discord-api-types/v10';
import { definitions } from '../src/commands/definitions.ts';

const { DISCORD_APPLICATION_ID: applicationId, DISCORD_BOT_TOKEN: botToken, DISCORD_GUILD_ID: guildId } = process.env;
if (!applicationId || !botToken) {
	console.error('DISCORD_APPLICATION_ID と DISCORD_BOT_TOKEN を環境変数で渡してください。');
	process.exit(1);
}

const route = guildId ? Routes.applicationGuildCommands(applicationId, guildId) : Routes.applicationCommands(applicationId);
const response = await fetch(`${RouteBases.api}${route}`, {
	method: 'PUT',
	headers: { Authorization: `Bot ${botToken}`, 'Content-Type': 'application/json' },
	body: JSON.stringify(definitions),
});
if (!response.ok) {
	console.error(`登録に失敗しました（HTTP ${response.status}）`);
	console.error(await response.text());
	process.exit(1);
}
const target = guildId ? `ギルド ${guildId}` : 'グローバル';
console.log(`${target}に${definitions.length}個のコマンドを登録しました。`);
