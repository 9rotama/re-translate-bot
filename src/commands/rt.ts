// /rt：文章を中継ルートに沿って再翻訳し、結果を Embed で表示する（docs/interface.md の「/rt」）。
import {
	CDNRoutes,
	ImageFormat,
	InteractionResponseType,
	RouteBases,
	type APIChatInputApplicationCommandGuildInteraction,
	type APIEmbed,
	type APIInteractionResponse,
	type RESTPatchAPIWebhookWithTokenMessageJSONBody,
} from 'discord-api-types/v10';
import { editOriginal, type FollowupTarget } from '../discord/followup';
import { errorMessage, errorReply } from '../discord/response';
import type { TranslationErrorKind } from '../errors';
import { errorDetails, interactionPlace, log, type Place } from '../log';
import { formatRoute, toRoute } from '../settings/route';
import { readSettings } from '../settings/store';
import { relay, textLength, TRANSLATION_DEADLINE_MS, type Route, type TranslationAi } from '../translation/relay';
import { stringOption } from './dispatch';
import { invalidSettingsMessage } from './settings';

type Interaction = APIChatInputApplicationCommandGuildInteraction;

// Env から /rt が使う binding と値だけを取り出したもの。テストでは偽物の AI を入れて渡す。
export type RtDeps = {
	readonly ai: TranslationAi;
	readonly db: D1Database;
	readonly rateLimiter: RateLimit;
	readonly applicationId: string;
};

const MESSAGES = {
	emptyText: '文章を入力してください',
	rateLimited: '短時間に使いすぎています。1分ほど待ってから試してください',
	quotaExceeded: '今日の翻訳の上限に達しました。日本時間 9:00（00:00 UTC）以降に試してください',
	failed: '翻訳に失敗しました。時間をおいて試してください',
} as const;

// 本文に @everyone などが含まれていても通知を飛ばさない（docs/non-functional.md の「セキュリティ」）。
const NO_MENTIONS = { parse: [] };

// 原文や翻訳結果の記号が Markdown として解釈されると、スポイラーやコードブロックが途中で閉じたり開いたりする。
// Discord は記号の前のバックスラッシュを取り除いて記号そのものを表示するので、書式に使う記号をすべてエスケープする。
// `<` と `:` はエスケープしない。カスタム絵文字（<:name:id>）が絵文字として表示されなくなるため。
const MARKDOWN_SYMBOLS = /[\\*_~`|>#\-[\]()]/g;
const escapeMarkdown = (text: string): string => text.replaceAll(MARKDOWN_SYMBOLS, '\\$&');

const originalSpoiler = (text: string): string => `||原文: ${escapeMarkdown(text)}||`;

// サーバーのニックネーム、表示名、ユーザー名の順で、最初にあるものを使う。
function displayName({ member }: Interaction): string {
	return member.nick ?? member.user.global_name ?? member.user.username;
}

const DEFAULT_AVATARS = [0, 1, 2, 3, 4, 5] as const;

// アバターを設定していないユーザーの既定のアバターは、Discord のクライアントと同じ式で選ぶ。
// 新しいユーザー名（discriminator が 0）は ID から6種類、旧形式は discriminator から5種類のうち1つになる。
function defaultAvatarIndex(userId: string, discriminator: string): (typeof DEFAULT_AVATARS)[number] {
	const index = discriminator === '0' ? Number((BigInt(userId) >> 22n) % 6n) : Number(discriminator) % 5;
	return DEFAULT_AVATARS[index] ?? 0;
}

// サーバー用のアバターがあればそれを使う。
function avatarUrl({ guild_id, member }: Interaction): string {
	const { user } = member;
	const path =
		member.avatar !== null && member.avatar !== undefined
			? CDNRoutes.guildMemberAvatar(guild_id, user.id, member.avatar, ImageFormat.PNG)
			: user.avatar !== null
				? CDNRoutes.userAvatar(user.id, user.avatar, ImageFormat.PNG)
				: CDNRoutes.defaultUserAvatar(defaultAvatarIndex(user.id, user.discriminator));
	return `${RouteBases.cdn}${path}`;
}

function resultMessage(
	interaction: Interaction,
	original: string,
	translated: string,
	route: Route,
): RESTPatchAPIWebhookWithTokenMessageJSONBody {
	// 色を付けないので color は指定しない。
	const embed: APIEmbed = {
		author: { name: displayName(interaction), icon_url: avatarUrl(interaction) },
		description: `${escapeMarkdown(translated)}\n\n${originalSpoiler(original)}`,
		footer: { text: formatRoute(route) },
	};
	return { embeds: [embed], allowed_mentions: NO_MENTIONS };
}

// 翻訳の失敗は「考え中」の表示を置き換えるので全員に見える。原文を添えて、打ち直さずに再試行できるようにする。
function failureMessage(kind: TranslationErrorKind, original: string): RESTPatchAPIWebhookWithTokenMessageJSONBody {
	const message = kind === 'quota_exceeded' ? MESSAGES.quotaExceeded : MESSAGES.failed;
	return errorMessage(message, originalSpoiler(original));
}

type Job = {
	readonly interaction: Interaction;
	readonly text: string;
	readonly deps: RtDeps;
	readonly place: Place;
};

// 設定を読めなかったときは翻訳の失敗として扱う（docs/interface.md の「設定の失敗」）。
// ルートが決まらず翻訳を始めていないので、段数は 0 として記録する。
function settingsUnavailable({ text, place }: Job, startedAt: number): RESTPatchAPIWebhookWithTokenMessageJSONBody {
	log({
		event: 'translation.failed',
		steps: 0,
		completedSteps: 0,
		inputLength: textLength(text),
		durationMs: Date.now() - startedAt,
		errorKind: 'settings_unavailable',
		...place,
	});
	return failureMessage('settings_unavailable', text);
}

const TIMED_OUT = 'timed_out';

// D1 の Promise は打ち切れないので、期限が来たら待つのをやめる。
// StoreError を自分で組み立てないのは、store.ts が StoreError に項目を足したときに食い違わないようにするため。
async function readSettingsBefore(
	db: D1Database,
	channelId: string,
	timeoutMs: number,
): Promise<Awaited<ReturnType<typeof readSettings>> | typeof TIMED_OUT> {
	let timer: ReturnType<typeof setTimeout> | null = null;
	const timeout = new Promise<typeof TIMED_OUT>((resolve) => {
		timer = setTimeout(() => resolve(TIMED_OUT), timeoutMs);
	});
	try {
		return await Promise.race([readSettings(db, channelId), timeout]);
	} finally {
		clearTimeout(timer);
	}
}

async function translate(job: Job, timeoutMs: number): Promise<RESTPatchAPIWebhookWithTokenMessageJSONBody> {
	const { interaction, text, deps, place } = job;
	const startedAt = Date.now();
	// 期限を relay() の中だけで数えると、D1 が遅いときに設定の読み取りの分だけ30秒の表示期限を超える。
	// 設定を読む前から数え、翻訳には残りの時間だけを渡す。
	const settings = await readSettingsBefore(deps.db, interaction.channel.id, timeoutMs);
	if (settings === TIMED_OUT) {
		const details = errorDetails(new DOMException('settings read timed out', 'TimeoutError'));
		log({ event: 'd1.failed', operation: 'settings.read', ...place, ...details });
		return settingsUnavailable(job, startedAt);
	}
	if (!settings.ok) {
		log({ event: 'd1.failed', operation: settings.error.operation, ...place, ...settings.error.details });
		return settingsUnavailable(job, startedAt);
	}
	// 保存済みの設定は書き込むときに検証しているので、ここで失敗するのは保存後に検証の規則が変わった場合などに限る。
	// 再試行しても直らないので、翻訳の失敗とは分けて設定し直す方法を見せる（docs/interface.md の「保存済みの設定の誤り」）。
	const route = toRoute(settings.value);
	if (!route.ok) {
		log({ event: 'settings.invalid', errorKind: route.error.kind, ...place });
		return invalidSettingsMessage(route.error);
	}

	// relay() は失敗を自分で記録する。
	const remainingMs = Math.max(0, timeoutMs - (Date.now() - startedAt));
	const translated = await relay(deps.ai, text, route.value, { place, deadlineMs: remainingMs });
	return translated.ok ? resultMessage(interaction, text, translated.value, route.value) : failureMessage(translated.error.kind, text);
}

async function send({ interaction, deps, place }: Job, body: RESTPatchAPIWebhookWithTokenMessageJSONBody): Promise<void> {
	const target: FollowupTarget = { applicationId: deps.applicationId, token: interaction.token };
	const sent = await editOriginal(target, body);
	if (!sent.ok) {
		const { kind, status, details } = sent.error;
		log({ event: 'followup.failed', errorKind: kind, status, ...place, ...details });
	}
}

async function translateAndSend(job: Job, timeoutMs: number): Promise<void> {
	try {
		await send(job, await translate(job, timeoutMs));
	} catch (error) {
		log({ event: 'unhandled_error', where: 'wait_until', ...job.place, ...errorDetails(error) });
		// 「考え中」の表示のまま終わらせない（docs/non-functional.md の「応答時間」）。
		await send(job, failureMessage('ai_error', job.text));
	}
}

export async function retranslate(
	interaction: Interaction,
	deps: RtDeps,
	ctx: Pick<ExecutionContext, 'waitUntil'>,
	timeoutMs: number = TRANSLATION_DEADLINE_MS,
): Promise<APIInteractionResponse> {
	// text は必須の引数なので Discord からは必ず届くが、届かなかったときも空として扱う。
	const text = stringOption(interaction, 'rt', 'text') ?? '';
	if (text.trim() === '') return errorReply(MESSAGES.emptyText);

	// 入力の誤りは翻訳しないので、回数に数えない。
	const { success } = await deps.rateLimiter.limit({ key: interaction.member.user.id });
	if (!success) {
		log({ event: 'rt.rate_limited' });
		return errorReply(MESSAGES.rateLimited);
	}

	// 翻訳は Discord の応答期限（3秒）に間に合わないので、遅延応答を返してから続ける。
	ctx.waitUntil(translateAndSend({ interaction, text, deps, place: interactionPlace(interaction) }, timeoutMs));
	return { type: InteractionResponseType.DeferredChannelMessageWithSource };
}

export function rt(interaction: Interaction, env: Env, ctx: ExecutionContext): Promise<APIInteractionResponse> {
	return retranslate(
		interaction,
		{ ai: env.AI, db: env.DB, rateLimiter: env.RT_RATE_LIMITER, applicationId: env.DISCORD_APPLICATION_ID },
		ctx,
	);
}
