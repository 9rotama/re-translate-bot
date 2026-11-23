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
import { defaultSettings, readSettings, type ChannelSettings } from '../../src/settings/store';
import { spyConsole } from '../helpers/console';
import { GUILD_ID, commandInteraction, subcommand } from '../helpers/interactions';

// テストどうしで行を共有しないよう、テストごとに別のチャンネル ID を使う。
let nextChannel = 200000000000000000n;
const newChannelId = () => String(nextChannel++);

// 書き込みの関数は検証に使った設定を求めるので、前提の設定は SQL で直接入れる。
// prepare を差し替えるテストでも使えるよう、差し替える前の prepare を受け取れるようにする。
function seed(channelId: string, settings: Partial<ChannelSettings>, prepare = env.DB.prepare.bind(env.DB)) {
	const { originLang, relayLangs } = { ...defaultSettings, ...settings };
	return prepare(
		'insert into channel_settings (channel_id, origin_lang, relay_langs, updated_at) values (?, ?, ?, 0) on conflict (channel_id) do update set origin_lang = excluded.origin_lang, relay_langs = excluded.relay_langs',
	)
		.bind(channelId, originLang, JSON.stringify(relayLangs))
		.run();
}

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
		await seed(channelId, { originLang: 'ko', relayLangs: ['en', 'fr'] });

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
			await seed(channelId, { relayLangs: ['en', 'XX', 'yy'] });

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
			await seed(channelId, { relayLangs: ['ja', 'en'] });

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

// 応答の Container の中身を、contents と同じ形で並べる。
function contentsOf(response: APIInteractionResponse): string[] {
	if (response.type !== InteractionResponseType.ChannelMessageWithSource) throw new TypeError('type 4 の応答ではない');
	const [container] = response.data.components ?? [];
	if (container?.type !== ComponentType.Container) throw new TypeError('Container がない');
	return container.components.map((component) => (component.type === ComponentType.TextDisplay ? component.content : '---'));
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

// 書き込みの直前に、他の人が設定を変えたことにする。change は何度目の書き込みかを受け取り、変える設定を返す。
// 返さなければ変えない。prepare は同期で返すので、変更は書き込みを実行するときに待つ。
function changeBeforeWrites(channelId: string, change: (attempt: number) => Partial<ChannelSettings> | undefined) {
	const prepare = env.DB.prepare.bind(env.DB);
	let attempt = 0;
	const delayed = (statement: D1PreparedStatement): D1PreparedStatement =>
		new Proxy(statement, {
			get(target, property) {
				const value: unknown = Reflect.get(target, property);
				if (typeof value !== 'function') return value;
				if (property === 'bind') return (...values: unknown[]) => delayed(target.bind(...values));
				return async (...args: unknown[]) => {
					const settings = change(attempt++);
					if (settings !== undefined) await seed(channelId, settings, prepare);
					return Reflect.apply(value, target, args) as unknown;
				};
			},
		});
	vi.spyOn(env.DB, 'prepare').mockImplementation((query: string) =>
		query.startsWith('insert') ? delayed(prepare(query)) : prepare(query),
	);
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
		await seed(channelId, { originLang: 'ko' });

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
			await seed(channelId, { relayLangs: ['de'] });

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

		it('結合文字を重ねて1書記素が長くなった言語コードも、文字数で切り詰めて示す', async () => {
			const langs = Array.from({ length: 10 }, () => `x${'\u0301'.repeat(599)}`).join(' ');

			const response = await relay(langs, newChannelId());

			expect(textOf(response)).toContain(`\`x${'\u0301'.repeat(63)}…\``);
			expect(textOf(response).length).toBeLessThan(1000);
		});

		it('1書記素だけで文字数の上限を超えても、サロゲートペアを割らずに切り詰めて示す', async () => {
			const response = await relay(`😀${'\u0301'.repeat(100)}`, newChannelId());

			expect(textOf(response)).toContain(`\`😀${'\u0301'.repeat(62)}…\``);
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
	});

	describe('他の人が同時に設定を変えたとき', () => {
		it('読んでから書くまでに原文の言語が変わったら、変わった後の設定で検証し直し、同じ言語が続くなら断る', async () => {
			const channelId = newChannelId();
			changeBeforeWrites(channelId, (attempt) => (attempt === 0 ? { originLang: 'fr' } : undefined));

			const response = await relay('fr', channelId);

			expect(textOf(response)).toBe('### エラー\n同じ言語が続くルートは設定できません\n```fr -> fr -> fr```');
			expect(await settingsOf(channelId)).toEqual({ originLang: 'fr', relayLangs: ['en'] });
		});

		it('読んでから書くまでに原文の言語が変わっても、検証し直して通れば保存し、変わった後の原文の言語でルートを示す', async () => {
			const channelId = newChannelId();
			changeBeforeWrites(channelId, (attempt) => (attempt === 0 ? { originLang: 'ko' } : undefined));

			const response = await relay('fr', channelId);

			expect(textOf(response)).toBe('### 中継言語を設定しました\n```ko -> fr -> ko```');
		});

		it('書くたびに設定が変わり続けたら、3回で諦めて本人だけにエラーを見せ、settings.conflict を記録する', async () => {
			const channelId = newChannelId();
			changeBeforeWrites(channelId, (attempt) => ({ originLang: attempt % 2 === 0 ? 'ko' : 'de' }));

			const response = await relay('fr', channelId);

			expect(textOf(response)).toBe(SETTINGS_UNAVAILABLE);
			expect(isEphemeral(response)).toBe(true);
			expect(await settingsOf(channelId)).toMatchObject({ relayLangs: ['en'] });
			expect(spies.warn).toHaveBeenCalledWith(expect.objectContaining({ event: 'settings.conflict', channelId }));
		});
	});

	describe('保存済みの設定に誤りがあるとき', () => {
		it('誤りを直す入力なら保存し、更新後のルートをチャンネルの全員に見せる', async () => {
			const channelId = newChannelId();
			await seed(channelId, { relayLangs: ['zz'] });

			const response = await relay('en', channelId);

			expect(textOf(response)).toBe('### 中継言語を設定しました\n```ja -> en -> ja```');
			expect(isEphemeral(response)).toBe(false);
		});

		it('保存済みの原文の言語にだけ誤りがあれば入力を保存し、成功とともに残りの誤りと直し方を全員に見せて settings.invalid を記録する', async () => {
			const channelId = newChannelId();
			await seed(channelId, { originLang: 'zz' });

			const response = await relay('EN', channelId);

			expect(contentsOf(response)).toEqual([
				'### 中継言語を設定しました\nこのチャンネルの設定に、対応していない言語コードがあります: `zz`\n/settings relay か /settings origin で設定し直してください',
				'---',
				LANGUAGE_TABLE,
			]);
			expect(isEphemeral(response)).toBe(false);
			expect(await settingsOf(channelId)).toEqual({ originLang: 'zz', relayLangs: ['en'] });
			expect(spies.error).toHaveBeenCalledWith(expect.objectContaining({ event: 'settings.invalid', errorKind: 'unsupported_language' }));
		});

		it('入力にも対応していない言語コードがあれば、入力の分だけを挙げて断る', async () => {
			const channelId = newChannelId();
			await seed(channelId, { originLang: 'zz' });

			const response = await relay('en xx', channelId);

			expect(textOf(response)).toBe(`### エラー\n対応していない言語コードがあります: \`xx\`\n${LANGUAGE_TABLE}`);
			expect(await settingsOf(channelId)).toEqual({ originLang: 'zz', relayLangs: ['en'] });
		});
	});
});

describe('/settings origin', () => {
	const spies = spyConsole();

	it('原文の言語を保存し、更新後のルートをチャンネルの全員に見せる', async () => {
		const channelId = newChannelId();
		await seed(channelId, { relayLangs: ['en', 'fr'] });

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
			await seed(channelId, { relayLangs: ['en'] });

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
	});

	describe('他の人が同時に設定を変えたとき', () => {
		it('読んでから書くまでに中継言語が変わったら、変わった後の設定で検証し直し、同じ言語が続くなら断る', async () => {
			const channelId = newChannelId();
			changeBeforeWrites(channelId, (attempt) => (attempt === 0 ? { relayLangs: ['fr'] } : undefined));

			const response = await origin('fr', channelId);

			expect(textOf(response)).toBe('### エラー\n同じ言語が続くルートは設定できません\n```fr -> fr -> fr```');
			expect(await settingsOf(channelId)).toEqual({ originLang: 'ja', relayLangs: ['fr'] });
		});

		it('書くたびに設定が変わり続けたら、3回で諦めて本人だけにエラーを見せ、settings.conflict を記録する', async () => {
			const channelId = newChannelId();
			changeBeforeWrites(channelId, (attempt) => ({ relayLangs: [attempt % 2 === 0 ? 'ko' : 'de'] }));

			const response = await origin('fr', channelId);

			expect(textOf(response)).toBe(SETTINGS_UNAVAILABLE);
			expect(await settingsOf(channelId)).toMatchObject({ originLang: 'ja' });
			expect(spies.warn).toHaveBeenCalledWith(expect.objectContaining({ event: 'settings.conflict', channelId }));
		});
	});

	describe('保存済みの設定に誤りがあるとき', () => {
		it('誤りを直す入力なら保存し、更新後のルートをチャンネルの全員に見せる', async () => {
			const channelId = newChannelId();
			await seed(channelId, { originLang: 'zz' });

			const response = await origin('ko', channelId);

			expect(textOf(response)).toBe('### 原文の言語を設定しました\n```ko -> en -> ko```');
			expect(isEphemeral(response)).toBe(false);
		});

		it('保存済みの中継言語にだけ誤りがあれば入力を保存し、成功とともに残りの誤りと直し方を全員に見せて settings.invalid を記録する', async () => {
			const channelId = newChannelId();
			await seed(channelId, { relayLangs: ['zz'] });

			const response = await origin('KO', channelId);

			expect(contentsOf(response)).toEqual([
				'### 原文の言語を設定しました\nこのチャンネルの設定に、対応していない言語コードがあります: `zz`\n/settings relay か /settings origin で設定し直してください',
				'---',
				LANGUAGE_TABLE,
			]);
			expect(isEphemeral(response)).toBe(false);
			expect(await settingsOf(channelId)).toEqual({ originLang: 'ko', relayLangs: ['zz'] });
			expect(spies.error).toHaveBeenCalledWith(expect.objectContaining({ event: 'settings.invalid', errorKind: 'unsupported_language' }));
		});

		it('同じ言語が続いているのが保存済みの中継言語どうしだけなら、入力を保存し、成功とともに続いているルートを全員に見せる', async () => {
			const channelId = newChannelId();
			await seed(channelId, { relayLangs: ['en', 'en'] });

			const response = await origin('ko', channelId);

			expect(contentsOf(response)).toEqual([
				'### 原文の言語を設定しました\nこのチャンネルの設定は、同じ言語が続くルートになっています\n```ko -> en -> en -> ko```\n/settings relay か /settings origin で設定し直してください',
			]);
			expect(isEphemeral(response)).toBe(false);
			expect(await settingsOf(channelId)).toMatchObject({ originLang: 'ko' });
		});

		it('入力の原文の言語が中継言語と続くなら、保存済みの中継言語どうしが続いていても断る', async () => {
			const channelId = newChannelId();
			await seed(channelId, { relayLangs: ['en', 'en'] });

			const response = await origin('en', channelId);

			expect(textOf(response)).toBe('### エラー\n同じ言語が続くルートは設定できません\n```en -> en -> en -> en```');
			expect(await settingsOf(channelId)).toMatchObject({ originLang: 'ja' });
		});

		it('原文の言語と中継言語の両方に誤りがあっても、2つのコマンドで順に直せる', async () => {
			const channelId = newChannelId();
			await seed(channelId, { originLang: 'zz', relayLangs: ['yy'] });

			await origin('ja', channelId);
			const response = await relay('en', channelId);

			expect(textOf(response)).toBe('### 中継言語を設定しました\n```ja -> en -> ja```');
		});
	});
});
