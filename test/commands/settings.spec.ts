import { env } from 'cloudflare:workers';
import {
	ApplicationCommandOptionType,
	ChannelType,
	ComponentType,
	InteractionResponseType,
	MessageFlags,
	type APIChatInputApplicationCommandGuildInteraction,
	type APIInteractionResponse,
} from 'discord-api-types/v10';
import { describe, expect, it, vi } from 'vitest';
import { invalidSettingsMessage, settingsOrigin, settingsRelay, settingsShow } from '../../src/commands/settings';
import { reply, settingsUnavailableReply, type ContainerMessage } from '../../src/discord/response';
import { readSettings, writeOriginLang, writeRelayLangs } from '../../src/settings/store';
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

function interaction(command: string, name: string, value: string, channelId: string): APIChatInputApplicationCommandGuildInteraction {
	const base = commandInteraction('settings', subcommand(command, [{ type: ApplicationCommandOptionType.String, name, value }]));
	return { ...base, channel: { id: channelId, type: ChannelType.GuildText }, channel_id: channelId };
}

const relay = (langs: string, channelId: string) => settingsRelay(interaction('relay', 'langs', langs, channelId), env);
const origin = (lang: string, channelId: string) => settingsOrigin(interaction('origin', 'lang', lang, channelId), env);

// Container の中の唯一の TextDisplay の文字列を取り出す。
function textOf(response: APIInteractionResponse): string {
	if (response.type !== InteractionResponseType.ChannelMessageWithSource) throw new TypeError('type 4 の応答ではない');
	const [container] = response.data.components ?? [];
	const [text] = container !== undefined && 'components' in container ? container.components : [];
	if (text === undefined || !('content' in text) || typeof text.content !== 'string') throw new TypeError('本文がない');
	return text.content;
}

const isEphemeral = (response: APIInteractionResponse) =>
	response.type === InteractionResponseType.ChannelMessageWithSource && ((response.data.flags ?? 0) & MessageFlags.Ephemeral) !== 0;

const settingsOf = async (channelId: string) => {
	const result = await readSettings(env.DB, channelId);
	if (!result.ok) throw new TypeError('設定を読めない');
	return result.value;
};

const LANGUAGE_TABLE = '言語コードの表 → https://huggingface.co/facebook/m2m100_1.2B';
const SETTINGS_UNAVAILABLE = '### エラー\n設定の読み書きに失敗しました。時間をおいて試してください';

// prepare に渡る SQL が書き込みのときだけ例外を投げ、読み取りは本物の D1 に通す。
function failWrites() {
	const prepare = env.DB.prepare.bind(env.DB);
	vi.spyOn(env.DB, 'prepare').mockImplementation((query: string) => {
		if (query.startsWith('insert')) throw new TypeError('原文');
		return prepare(query);
	});
}

function failReads() {
	vi.spyOn(env.DB, 'prepare').mockImplementation(() => {
		throw new TypeError('原文');
	});
}

describe('/settings relay', () => {
	const spies = spyConsole();

	it('中継言語を保存し、更新後のルートをチャンネルの全員に見せる', async () => {
		const channelId = newChannelId();

		const response = await relay('en fr', channelId);

		expect(textOf(response)).toBe('### 中継言語を設定しました\n```ja -> en -> fr -> ja```');
		expect(isEphemeral(response)).toBe(false);
		expect(await settingsOf(channelId)).toEqual({ originLang: 'ja', relayLangs: ['en', 'fr'] });
	});

	it('設定済みの原文の言語を両端に置いたルートを示す', async () => {
		const channelId = newChannelId();
		await writeOriginLang(env.DB, channelId, 'ko');

		const response = await relay('de', channelId);

		expect(textOf(response)).toBe('### 中継言語を設定しました\n```ko -> de -> ko```');
	});

	it('大文字の言語コードは小文字にして保存し、表示する', async () => {
		const channelId = newChannelId();

		const response = await relay('EN Fr', channelId);

		expect(textOf(response)).toContain('```ja -> en -> fr -> ja```');
		expect(await settingsOf(channelId)).toMatchObject({ relayLangs: ['en', 'fr'] });
	});

	it('全角スペースや連続した空白、前後の空白で区切ってもよい', async () => {
		const channelId = newChannelId();

		await relay(' en　fr   de ', channelId);

		expect(await settingsOf(channelId)).toMatchObject({ relayLangs: ['en', 'fr', 'de'] });
	});

	it('10ヶ国語まで設定できる', async () => {
		const channelId = newChannelId();
		const langs = ['en', 'fr', 'de', 'es', 'it', 'ko', 'zh', 'ru', 'pt', 'nl'];

		await relay(langs.join(' '), channelId);

		expect(await settingsOf(channelId)).toMatchObject({ relayLangs: langs });
	});

	it('隣り合わない同じ言語は設定できる', async () => {
		const channelId = newChannelId();

		await relay('en fr en', channelId);

		expect(await settingsOf(channelId)).toMatchObject({ relayLangs: ['en', 'fr', 'en'] });
	});

	describe('入力の誤り', () => {
		it.each([
			['言語コードが空白だけの', '　 ', '### エラー\n言語コードを入力してください'],
			['言語コードが11個の', 'en fr de es it ko zh ru pt nl ar', '### エラー\n中継言語に設定できるのは10ヶ国語までです'],
			[
				'対応していない言語コードがある',
				'en XX yy xx',
				`### エラー\n対応していない言語コードがあります: \`xx\`、\`yy\`\n${LANGUAGE_TABLE}`,
			],
			['同じ言語が続く', 'ja en', '### エラー\n同じ言語が続くルートは設定できません\n```ja -> ja -> en -> ja```'],
		])('%sときは、本人だけにエラーを見せ、設定を変えない', async (_, langs, text) => {
			const channelId = newChannelId();
			await writeRelayLangs(env.DB, channelId, ['de']);

			const response = await relay(langs, channelId);

			expect(textOf(response)).toBe(text);
			expect(isEphemeral(response)).toBe(true);
			expect(await settingsOf(channelId)).toEqual({ originLang: 'ja', relayLangs: ['de'] });
		});

		it('バッククォートを含む言語コードも、インラインコードが途中で切れないように示す', async () => {
			const response = await relay('a`b `c ``d', newChannelId());

			expect(textOf(response)).toContain("対応していない言語コードがあります: `a'b`、`'c`、`''d`");
		});

		it('長すぎる言語コードは切り詰めて示す', async () => {
			const response = await relay('x'.repeat(6000), newChannelId());

			expect(textOf(response)).toContain(`\`${'x'.repeat(16)}…\``);
			expect(textOf(response).length).toBeLessThan(200);
		});
	});

	describe('設定の読み書きの失敗', () => {
		it('設定を読めなかったら、本人だけにエラーを見せて d1.failed を記録する', async () => {
			failReads();

			const response = await relay('en', newChannelId());

			expect(textOf(response)).toBe(SETTINGS_UNAVAILABLE);
			expect(isEphemeral(response)).toBe(true);
			expect(spies.error).toHaveBeenCalledWith(expect.objectContaining({ event: 'd1.failed', operation: 'settings.read' }));
		});

		it('設定を書き込めなかったら、本人だけにエラーを見せて d1.failed を記録する', async () => {
			failWrites();

			const response = await relay('en', newChannelId());

			expect(textOf(response)).toBe(SETTINGS_UNAVAILABLE);
			expect(spies.error).toHaveBeenCalledWith(expect.objectContaining({ event: 'd1.failed', operation: 'settings.upsert_relay' }));
		});

		it('保存済みの原文の言語が対応していないコードなら、入力の誤りとせずに設定の読み書きの失敗として扱う', async () => {
			const channelId = newChannelId();
			await writeOriginLang(env.DB, channelId, 'zz');

			const response = await relay('en', channelId);

			expect(textOf(response)).toBe(SETTINGS_UNAVAILABLE);
		});
	});
});

describe('/settings origin', () => {
	const spies = spyConsole();

	it('原文の言語を保存し、更新後のルートをチャンネルの全員に見せる', async () => {
		const channelId = newChannelId();
		await writeRelayLangs(env.DB, channelId, ['en', 'fr']);

		const response = await origin('ko', channelId);

		expect(textOf(response)).toBe('### 原文の言語を設定しました\n```ko -> en -> fr -> ko```');
		expect(isEphemeral(response)).toBe(false);
		expect(await settingsOf(channelId)).toEqual({ originLang: 'ko', relayLangs: ['en', 'fr'] });
	});

	it('未設定のチャンネルでは既定の中継言語でルートを示す', async () => {
		const response = await origin('ko', newChannelId());

		expect(textOf(response)).toBe('### 原文の言語を設定しました\n```ko -> en -> ko```');
	});

	it('大文字の言語コードと前後の空白は、小文字にして保存する', async () => {
		const channelId = newChannelId();

		await origin('　KO ', channelId);

		expect(await settingsOf(channelId)).toMatchObject({ originLang: 'ko' });
	});

	describe('入力の誤り', () => {
		it.each([
			['言語コードが空白だけの', ' ', '### エラー\n言語コードを入力してください'],
			['言語コードが2つの', 'ko en', '### エラー\n原文の言語は1ヶ国語のみ入力してください'],
			['対応していない言語コードの', 'XX', `### エラー\n対応していない言語コードがあります: \`xx\`\n${LANGUAGE_TABLE}`],
			['中継言語と同じ言語の', 'en', '### エラー\n同じ言語が続くルートは設定できません\n```en -> en -> en```'],
		])('%sときは、本人だけにエラーを見せ、設定を変えない', async (_, lang, text) => {
			const channelId = newChannelId();
			await writeRelayLangs(env.DB, channelId, ['en']);

			const response = await origin(lang, channelId);

			expect(textOf(response)).toBe(text);
			expect(isEphemeral(response)).toBe(true);
			expect(await settingsOf(channelId)).toEqual({ originLang: 'ja', relayLangs: ['en'] });
		});
	});

	describe('設定の読み書きの失敗', () => {
		it('設定を読めなかったら、本人だけにエラーを見せて d1.failed を記録する', async () => {
			failReads();

			const response = await origin('ko', newChannelId());

			expect(textOf(response)).toBe(SETTINGS_UNAVAILABLE);
			expect(isEphemeral(response)).toBe(true);
			expect(spies.error).toHaveBeenCalledWith(expect.objectContaining({ event: 'd1.failed', operation: 'settings.read' }));
		});

		it('設定を書き込めなかったら、本人だけにエラーを見せて d1.failed を記録する', async () => {
			failWrites();

			const response = await origin('ko', newChannelId());

			expect(textOf(response)).toBe(SETTINGS_UNAVAILABLE);
			expect(spies.error).toHaveBeenCalledWith(expect.objectContaining({ event: 'd1.failed', operation: 'settings.upsert_origin' }));
		});

		it('保存済みの中継言語が対応していないコードなら、入力の誤りとせずに設定の読み書きの失敗として扱う', async () => {
			const channelId = newChannelId();
			await writeRelayLangs(env.DB, channelId, ['zz']);

			const response = await origin('ko', channelId);

			expect(textOf(response)).toBe(SETTINGS_UNAVAILABLE);
		});
	});
});
