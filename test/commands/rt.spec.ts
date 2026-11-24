import { env } from 'cloudflare:workers';
import {
	ApplicationCommandOptionType,
	ComponentType,
	InteractionResponseType,
	MessageFlags,
	type APIChatInputApplicationCommandGuildInteraction,
} from 'discord-api-types/v10';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { retranslate, type RtDeps } from '../../src/commands/rt';
import type { TranslationAi } from '../../src/translation/relay';
import { spyConsole } from '../helpers/console';
import { commandInteraction, GUILD_ID } from '../helpers/interactions';

type Call = { text: string; source_lang: string; target_lang: string };

// 既定では「本文→翻訳先」の形で返し、どのルートで翻訳したかを結果から読めるようにする。
// 結果はエスケープしてから表示するので、Markdown の記号を含めない。
function fakeAi(reply?: (call: Call) => Promise<unknown>) {
	const calls: Call[] = [];
	const ai: TranslationAi = {
		run: async (_model, inputs) => {
			calls.push({ ...inputs });
			return reply === undefined ? { translated_text: `${inputs.text}→${inputs.target_lang}` } : reply(inputs);
		},
	};
	return { ai, calls };
}

// 中断されるまで応答しない Workers AI。
const stalledAi = (): TranslationAi => ({
	run: (_model, _inputs, { signal }) =>
		new Promise((_resolve, reject) => {
			signal.addEventListener('abort', () => reject(signal.reason));
		}),
});

// 結果の行を返す前に delay を待つ D1。delay が解決しなければ応答しない D1 になる。
function delayD1(delay: () => Promise<void>): void {
	const prepare = env.DB.prepare.bind(env.DB);
	vi.spyOn(env.DB, 'prepare').mockImplementation((query) => {
		const statement = prepare(query);
		const bind = statement.bind.bind(statement);
		vi.spyOn(statement, 'bind').mockImplementation((...values) => {
			const bound = bind(...values);
			const raw = bound.raw.bind(bound);
			vi.spyOn(bound, 'raw').mockImplementation(async () => {
				await delay();
				return raw();
			});
			return bound;
		});
		return statement;
	});
}

const upstreamError = (message: string) => Object.assign(new Error(message), { name: 'InferenceUpstreamError' });

// レート制限のカウンタと設定の行をテストどうしで共有しないよう、ユーザーとチャンネルの ID をテストごとに変える。
let nextId = 900000000000000000n;
const newId = () => String(nextId++);

type Overrides = {
	text?: string;
	nick?: string | null;
	memberAvatar?: string | null;
	globalName?: string | null;
	avatar?: string | null;
	discriminator?: string;
	userId?: string;
	channelId?: string;
};

function rtInteraction(overrides: Overrides = {}): APIChatInputApplicationCommandGuildInteraction {
	const base = commandInteraction('rt', [
		{ type: ApplicationCommandOptionType.String, name: 'text', value: overrides.text ?? 'こんにちは' },
	]);
	const channelId = overrides.channelId ?? newId();
	return {
		...base,
		channel: { ...base.channel, id: channelId },
		channel_id: channelId,
		member: {
			...base.member,
			nick: overrides.nick,
			avatar: overrides.memberAvatar,
			user: {
				...base.member.user,
				id: overrides.userId ?? newId(),
				username: 'tester',
				global_name: overrides.globalName ?? null,
				avatar: overrides.avatar ?? null,
				discriminator: overrides.discriminator ?? '0',
			},
		},
	};
}

// waitUntil に渡された処理を集め、テストから完了を待てるようにする。
function fakeContext() {
	const pending: Promise<unknown>[] = [];
	return {
		ctx: { waitUntil: (promise: Promise<unknown>) => void pending.push(promise) },
		settled: () => Promise.all(pending),
		pending,
	};
}

const deps = (ai: TranslationAi, overrides: Partial<RtDeps> = {}): RtDeps => ({
	ai,
	db: env.DB,
	rateLimiter: env.RT_RATE_LIMITER,
	applicationId: '333333333333333333',
	...overrides,
});

// 偽物の Discord API。元のメッセージの編集に送られた本文を記録する。
let fetchSpy: MockInstance<typeof fetch>;
const bodyOf = (init?: RequestInit): unknown => (typeof init?.body === 'string' ? JSON.parse(init.body) : undefined);
const sentBodies = (): unknown[] => fetchSpy.mock.calls.map(([, init]) => bodyOf(init));
const sentBody = (): unknown => sentBodies().at(-1);

async function run(
	interaction: APIChatInputApplicationCommandGuildInteraction,
	ai: TranslationAi,
	overrides: Partial<RtDeps> = {},
	timeoutMs?: number,
) {
	const { ctx, settled, pending } = fakeContext();
	const response = await retranslate(interaction, deps(ai, overrides), ctx, timeoutMs);
	await settled();
	return { response, deferred: pending.length > 0 };
}

// 区切り線の下に footer を添えたエラーの Container。
const errorWithFooter = (message: string, footer: string) => ({
	flags: MessageFlags.IsComponentsV2,
	components: [
		{
			type: ComponentType.Container,
			components: [
				{ type: ComponentType.TextDisplay, content: `### エラー\n${message}` },
				expect.objectContaining({ type: ComponentType.Separator }),
				{ type: ComponentType.TextDisplay, content: footer },
			],
		},
	],
	allowed_mentions: { parse: [] },
});

const errorContainer = (message: string, original: string) => errorWithFooter(message, `||原文: ${original}||`);

// 書き込むときの検証を通らない設定を、D1 に直接保存する。
async function saveRawSettings(originLang: string, relayLangs: string): Promise<string> {
	const channelId = newId();
	await env.DB.prepare('insert into channel_settings (channel_id, origin_lang, relay_langs, updated_at) values (?, ?, ?, ?)')
		.bind(channelId, originLang, relayLangs, 0)
		.run();
	return channelId;
}

// toMatchObject で比べる。allowed_mentions は response.ts のテストで確かめている。
const privateError = (message: string) => ({
	type: InteractionResponseType.ChannelMessageWithSource,
	data: {
		flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
		components: [{ type: ComponentType.Container, components: [{ type: ComponentType.TextDisplay, content: `### エラー\n${message}` }] }],
	},
});

describe('/rt', () => {
	const spies = spyConsole();

	beforeEach(() => {
		fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response('{}', { status: 200 }));
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	describe('成功', () => {
		it('遅延応答を返し、翻訳が終わったら元のメッセージを結果の Embed に書き換える', async () => {
			const { ai } = fakeAi();
			const interaction = rtInteraction({ text: 'こんにちは', userId: '444444444444444444' });

			const { response, deferred } = await run(interaction, ai);

			expect(response).toEqual({ type: InteractionResponseType.DeferredChannelMessageWithSource });
			expect(deferred).toBe(true);
			expect(fetchSpy).toHaveBeenCalledOnce();
			expect(fetchSpy.mock.calls[0]?.[0]).toBe(
				'https://discord.com/api/v10/webhooks/333333333333333333/interaction-token/messages/@original',
			);
			const icon = `https://cdn.discordapp.com/embed/avatars/${Number((444444444444444444n >> 22n) % 6n)}.png`;
			expect(sentBody()).toEqual({
				embeds: [
					{
						author: { name: 'tester', icon_url: icon },
						description: 'こんにちは→en→ja\n\n||原文: こんにちは||',
						footer: { text: 'ja -> en -> ja', icon_url: icon },
					},
				],
				allowed_mentions: { parse: [] },
			});
		});

		it('チャンネルに保存した中継ルートで翻訳する', async () => {
			// 書き込みの関数は使わず、行を直接入れる。書き込みの関数の引数は /settings の実装で変わりうるため。
			const channelId = await saveRawSettings('ja', '["en","fr"]');
			const { ai, calls } = fakeAi();

			await run(rtInteraction({ channelId }), ai);

			expect(calls.map(({ source_lang, target_lang }) => `${source_lang}>${target_lang}`)).toEqual(['ja>en', 'en>fr', 'fr>ja']);
			expect(sentBody()).toMatchObject({ embeds: [{ footer: { text: 'ja -> en -> fr -> ja' } }] });
		});

		it.each([
			{ case: 'ニックネームがあればニックネーム', nick: 'ニック', globalName: '表示名', name: 'ニック' },
			{ case: 'ニックネームがなければ表示名', nick: null, globalName: '表示名', name: '表示名' },
			{ case: 'どちらもなければユーザー名', nick: null, globalName: null, name: 'tester' },
		])('author の名前は、$case を使う', async ({ nick, globalName, name }) => {
			await run(rtInteraction({ nick, globalName }), fakeAi().ai);

			expect(sentBody()).toMatchObject({ embeds: [{ author: { name } }] });
		});

		it.each([
			{
				case: 'サーバー用のアバターがあればそれ',
				overrides: { userId: '444444444444444444', memberAvatar: 'guildhash', avatar: 'userhash' },
				url: `https://cdn.discordapp.com/guilds/${GUILD_ID}/users/444444444444444444/avatars/guildhash.png`,
			},
			{
				case: 'サーバー用のアバターがなければユーザーのアバター',
				overrides: { userId: '444444444444444444', memberAvatar: null, avatar: 'userhash' },
				url: 'https://cdn.discordapp.com/avatars/444444444444444444/userhash.png',
			},
			{
				case: '旧形式のユーザー名でアバターがなければ、discriminator で選んだ既定のアバター',
				overrides: { discriminator: '1237' },
				url: 'https://cdn.discordapp.com/embed/avatars/2.png',
			},
		])('author とフッターのアイコンは、$case を使う', async ({ overrides, url }) => {
			await run(rtInteraction(overrides), fakeAi().ai);

			expect(sentBody()).toMatchObject({ embeds: [{ author: { icon_url: url }, footer: { icon_url: url } }] });
		});

		it('原文と翻訳結果の Markdown の記号をエスケープし、スポイラーが途中で切れないようにする', async () => {
			const original = '||a|| `b` **c** ```d```';
			const { ai } = fakeAi(async ({ text }) => ({ translated_text: text }));

			await run(rtInteraction({ text: original }), ai);

			const escaped = String.raw`\|\|a\|\| \`b\` \*\*c\*\* \`\`\`d\`\`\``;
			expect(sentBody()).toMatchObject({ embeds: [{ description: `${escaped}\n\n||原文: ${escaped}||` }] });
		});

		it('本文の @everyone で通知を飛ばさない', async () => {
			await run(rtInteraction({ text: '@everyone' }), fakeAi().ai);

			expect(sentBody()).toMatchObject({ allowed_mentions: { parse: [] } });
		});
	});

	describe('入力の誤り', () => {
		it.each([' ', '　 　'])('本文が空白だけ（%j）なら、翻訳せずに本人だけにエラーを返す', async (text) => {
			const { ai, calls } = fakeAi();

			const { response, deferred } = await run(rtInteraction({ text }), ai);

			expect(response).toMatchObject(privateError('文章を入力してください'));
			expect(deferred).toBe(false);
			expect(calls).toHaveLength(0);
		});

		it('本文が空白だけの呼び出しは、レート制限の回数に数えない', async () => {
			const userId = newId();
			for (let i = 0; i < 3; i++) await run(rtInteraction({ userId, text: ' ' }), fakeAi().ai);

			const { response } = await run(rtInteraction({ userId }), fakeAi().ai);

			expect(response).toEqual({ type: InteractionResponseType.DeferredChannelMessageWithSource });
		});
	});

	describe('レート制限', () => {
		it('同じユーザーの4回目の呼び出しは、翻訳せずに本人だけにエラーを返し、rt.rate_limited を記録する', async () => {
			const userId = newId();
			for (let i = 0; i < 3; i++) await run(rtInteraction({ userId }), fakeAi().ai);
			const { ai, calls } = fakeAi();

			const { response, deferred } = await run(rtInteraction({ userId }), ai);

			expect(response).toMatchObject(privateError('短時間に使いすぎています。1分ほど待ってから試してください'));
			expect(deferred).toBe(false);
			expect(calls).toHaveLength(0);
			expect(spies.log).toHaveBeenCalledWith({ event: 'rt.rate_limited' });
		});

		it('回数はユーザーごとに数える', async () => {
			for (let i = 0; i < 3; i++) await run(rtInteraction({ userId: newId() }), fakeAi().ai);

			const { response } = await run(rtInteraction({ userId: newId() }), fakeAi().ai);

			expect(response).toEqual({ type: InteractionResponseType.DeferredChannelMessageWithSource });
		});
	});

	describe('翻訳の失敗', () => {
		it('無料枠を使い切ったら、元のメッセージを上限のエラーと原文のスポイラーに書き換える', async () => {
			const { ai } = fakeAi(async () => {
				throw upstreamError('4006: you have used up your daily free allocation of 10,000 neurons');
			});

			await run(rtInteraction({ text: 'a|b' }), ai);

			expect(sentBody()).toEqual(errorContainer('今日の翻訳の上限に達しました。日本時間 9:00（00:00 UTC）以降に試してください', 'a\\|b'));
		});

		it('それ以外の失敗では、元のメッセージを翻訳の失敗のエラーと原文のスポイラーに書き換える', async () => {
			const { ai } = fakeAi(async () => {
				throw upstreamError('3040: Capacity temporarily exceeded');
			});

			await run(rtInteraction({ text: 'こんにちは' }), ai);

			expect(sentBody()).toEqual(errorContainer('翻訳に失敗しました。時間をおいて試してください', 'こんにちは'));
		});

		it('結果はチャンネルの全員に見せる（Ephemeral を付けない）', async () => {
			const { ai } = fakeAi(async () => {
				throw upstreamError('3040: Capacity temporarily exceeded');
			});

			await run(rtInteraction(), ai);

			expect(sentBody()).toMatchObject({ flags: MessageFlags.IsComponentsV2 });
		});
	});

	describe('設定の失敗', () => {
		it('設定を読めなかったら、翻訳せずに翻訳の失敗として表示し、d1.failed と translation.failed を記録する', async () => {
			vi.spyOn(env.DB, 'prepare').mockImplementation(() => {
				throw new TypeError('D1_ERROR');
			});
			const { ai, calls } = fakeAi();

			await run(rtInteraction({ text: 'こんにちは' }), ai);

			expect(calls).toHaveLength(0);
			expect(sentBody()).toEqual(errorContainer('翻訳に失敗しました。時間をおいて試してください', 'こんにちは'));
			expect(spies.error).toHaveBeenCalledWith(expect.objectContaining({ event: 'd1.failed', operation: 'settings.read' }));
			expect(spies.error).toHaveBeenCalledWith(expect.objectContaining({ event: 'translation.failed', errorKind: 'settings_unavailable' }));
		});

		it('設定の読み取りが期限までに終わらなければ、待つのをやめて翻訳の失敗として表示し、d1.failed を記録する', async () => {
			const { ai, calls } = fakeAi();
			delayD1(() => new Promise(() => {}));

			await run(rtInteraction({ text: 'こんにちは' }), ai, {}, 20);

			expect(calls).toHaveLength(0);
			expect(sentBody()).toEqual(errorContainer('翻訳に失敗しました。時間をおいて試してください', 'こんにちは'));
			expect(spies.error).toHaveBeenCalledWith(
				expect.objectContaining({ event: 'd1.failed', operation: 'settings.read', errorName: 'TimeoutError' }),
			);
		});

		it('設定の読み取りにかかった時間は、翻訳の期限から差し引く', async () => {
			delayD1(() => new Promise((resolve) => setTimeout(resolve, 150)));
			const startedAt = Date.now();

			await run(rtInteraction({ text: 'こんにちは' }), stalledAi(), {}, 200);

			// 期限を翻訳だけで数えると、読み取りの 150ms と合わせて 350ms 以上かかる。
			expect(Date.now() - startedAt).toBeLessThan(300);
			expect(sentBody()).toEqual(errorContainer('翻訳に失敗しました。時間をおいて試してください', 'こんにちは'));
		});

		it('保存済みの設定に対応していない言語コードがあれば、翻訳せずに設定し直す方法を全員に見せ、settings.invalid を記録する', async () => {
			const channelId = await saveRawSettings('xx', '["en"]');
			const { ai, calls } = fakeAi();

			await run(rtInteraction({ channelId, text: 'こんにちは' }), ai);

			expect(calls).toHaveLength(0);
			expect(sentBody()).toEqual(
				errorWithFooter(
					'このチャンネルの設定に、対応していない言語コードがあります: `xx`\n/settings relay か /settings origin で設定し直してください',
					'言語コードの表 → https://huggingface.co/facebook/m2m100_1.2B',
				),
			);
			expect(spies.error).toHaveBeenCalledWith(expect.objectContaining({ event: 'settings.invalid', errorKind: 'unsupported_language' }));
			expect(spies.error).not.toHaveBeenCalledWith(expect.objectContaining({ event: 'translation.failed' }));
		});

		it('保存済みの設定が同じ言語が続くルートなら、翻訳せずにそのルートと設定し直す方法を見せる', async () => {
			const channelId = await saveRawSettings('ja', '["ja","en"]');
			const { ai, calls } = fakeAi();

			await run(rtInteraction({ channelId }), ai);

			expect(calls).toHaveLength(0);
			expect(sentBody()).toMatchObject({
				components: [
					{
						components: [
							{
								content:
									'### エラー\nこのチャンネルの設定は、同じ言語が続くルートになっています\n```ja -> ja -> en -> ja```\n/settings relay か /settings origin で設定し直してください',
							},
						],
					},
				],
			});
			expect(spies.error).toHaveBeenCalledWith(expect.objectContaining({ event: 'settings.invalid', errorKind: 'repeated_language' }));
		});
	});

	describe('followup の失敗', () => {
		it('元のメッセージを編集できなかったら、followup.failed を記録する', async () => {
			fetchSpy.mockResolvedValue(new Response('{}', { status: 404 }));

			await run(rtInteraction(), fakeAi().ai);

			expect(spies.error).toHaveBeenCalledWith(expect.objectContaining({ event: 'followup.failed', errorKind: 'http_error', status: 404 }));
		});

		it('想定していない例外が起きたら、unhandled_error を記録し、元のメッセージを翻訳の失敗に書き換える', async () => {
			const broken = new ReadableStream({
				cancel() {
					throw new RangeError('broken');
				},
			});
			fetchSpy.mockResolvedValueOnce(new Response(broken, { status: 200 }));

			await run(rtInteraction({ text: 'こんにちは' }), fakeAi().ai);

			expect(spies.error).toHaveBeenCalledWith(
				expect.objectContaining({ event: 'unhandled_error', where: 'wait_until', errorName: 'RangeError' }),
			);
			expect(sentBodies()).toHaveLength(2);
			expect(sentBody()).toEqual(errorContainer('翻訳に失敗しました。時間をおいて試してください', 'こんにちは'));
		});
	});
});
