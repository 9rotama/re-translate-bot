import { env } from 'cloudflare:workers';
import {
	ChannelType,
	ComponentType,
	InteractionResponseType,
	MessageFlags,
	type APIChatInputApplicationCommandGuildInteraction,
} from 'discord-api-types/v10';
import { describe, expect, it, vi } from 'vitest';
import { invalidSettingsMessage, settingsShow } from '../../src/commands/settings';
import { reply, settingsUnavailableReply, type ContainerMessage } from '../../src/discord/response';
import { writeOriginLang, writeRelayLangs } from '../../src/settings/store';
import { spyConsole } from '../helpers/console';
import { GUILD_ID, commandInteraction, subcommand } from '../helpers/interactions';

// テストどうしで行を共有しないよう、テストごとに別のチャンネル ID を使う。
let nextChannel = 200000000000000000n;
const newChannelId = () => String(nextChannel++);

const showInteraction = (channelId: string): APIChatInputApplicationCommandGuildInteraction => ({
	...commandInteraction('settings', subcommand('show')),
	channel: { id: channelId, type: ChannelType.GuildText },
	channel_id: channelId,
});

const routeReply = (route: string) => ({
	type: InteractionResponseType.ChannelMessageWithSource,
	data: {
		flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
		components: [
			{ type: ComponentType.Container, components: [{ type: ComponentType.TextDisplay, content: `### 中継ルート\n\`\`\`${route}\`\`\`` }] },
		],
		allowed_mentions: { parse: [] },
	},
});

describe('/settings show', () => {
	const spies = spyConsole();

	it('未設定のチャンネルでは既定値のルートを、呼び出した本人だけに見せる', async () => {
		expect(await settingsShow(showInteraction(newChannelId()), env)).toEqual(routeReply('ja -> en -> ja'));
	});

	it('保存した原文の言語と中継言語からルートを組み立てて見せる', async () => {
		const channelId = newChannelId();
		await writeRelayLangs(env.DB, channelId, ['en', 'fr']);
		await writeOriginLang(env.DB, channelId, 'ko');

		expect(await settingsShow(showInteraction(channelId), env)).toEqual(routeReply('ko -> en -> fr -> ko'));
	});

	it('設定を読めなかったら、設定の読み書きに失敗したことを伝え、d1.failed を記録する', async () => {
		const channelId = newChannelId();
		vi.spyOn(env.DB, 'prepare').mockImplementation(() => {
			throw new TypeError('D1 is unavailable');
		});

		const response = await settingsShow(showInteraction(channelId), env);

		expect(response).toEqual(settingsUnavailableReply());
		expect(spies.error).toHaveBeenCalledWith(
			expect.objectContaining({ event: 'd1.failed', operation: 'settings.read', guildId: GUILD_ID, channelId }),
		);
	});

	describe('保存済みの設定からルートを組み立てられないとき', () => {
		it('対応していない言語コードを挙げて設定し直すよう、呼び出した本人だけに伝え、settings.invalid を記録する', async () => {
			const channelId = newChannelId();
			await writeRelayLangs(env.DB, channelId, ['en', 'XX', 'yy']);

			const response = await settingsShow(showInteraction(channelId), env);

			expect(response).toEqual(reply(invalidSettingsMessage({ kind: 'unsupported_language', codes: ['xx', 'yy'] }), 'private'));
			expect(spies.error).toHaveBeenCalledWith({
				event: 'settings.invalid',
				errorKind: 'unsupported_language',
				guildId: GUILD_ID,
				channelId,
			});
		});

		it('同じ言語が続くルートを示して設定し直すよう、呼び出した本人だけに伝え、settings.invalid を記録する', async () => {
			const channelId = newChannelId();
			await writeRelayLangs(env.DB, channelId, ['ja', 'en']);

			const response = await settingsShow(showInteraction(channelId), env);

			expect(response).toEqual(reply(invalidSettingsMessage({ kind: 'repeated_language', route: ['ja', 'ja', 'en', 'ja'] }), 'private'));
			expect(spies.error).toHaveBeenCalledWith({ event: 'settings.invalid', errorKind: 'repeated_language', guildId: GUILD_ID, channelId });
		});
	});
});

// Container の中身を、テキストはその内容、区切り線は '---' として並べる。
const contents = (message: ContainerMessage) =>
	message.components[0].components.map((component) => (component.type === ComponentType.TextDisplay ? component.content : '---'));

describe('invalidSettingsMessage', () => {
	it('対応していない言語コードをすべて挙げ、設定し直す方法と言語コードの表の URL を示す', () => {
		expect(contents(invalidSettingsMessage({ kind: 'unsupported_language', codes: ['xx', 'yy'] }))).toEqual([
			'### エラー\nこのチャンネルの設定に、対応していない言語コードがあります: `xx`、`yy`\n/settings relay か /settings origin で設定し直してください',
			'---',
			'言語コードの表 → https://huggingface.co/facebook/m2m100_1.2B',
		]);
	});

	it('言語コードにバッククォートや改行が含まれていても、インラインコードの外にはみ出さない', () => {
		const [body] = contents(invalidSettingsMessage({ kind: 'unsupported_language', codes: ['a`b', 'c\nd'] }));

		expect(body).toContain("`a'b`、`c d`");
	});

	it('同じ言語が続くルートをコードブロックで示し、設定し直す方法を示す', () => {
		expect(contents(invalidSettingsMessage({ kind: 'repeated_language', route: ['ja', 'ja', 'en', 'ja'] }))).toEqual([
			'### エラー\nこのチャンネルの設定は、同じ言語が続くルートになっています\n```ja -> ja -> en -> ja```\n/settings relay か /settings origin で設定し直してください',
		]);
	});
});
