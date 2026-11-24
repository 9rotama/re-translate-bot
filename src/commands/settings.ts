// /settings のサブコマンド（docs/interface.md の「/settings show」「/settings relay、/settings origin」「エラー」）。
import type { APIChatInputApplicationCommandGuildInteraction, APIInteractionResponse } from 'discord-api-types/v10';
import {
	codeBlock,
	containerMessage,
	errorMessage,
	errorReply,
	reply,
	settingsUnavailableReply,
	type ContainerMessage,
} from '../discord/response';
import { interactionPlace, log } from '../log';
import { formatRoute, toRoute, type RouteError } from '../settings/route';
import { readSettings, writeOriginLang, writeRelayLangs, type ChannelSettings, type StoreError, type WriteResult } from '../settings/store';
import { LANGUAGE_TABLE_URL } from '../translation/languages';
import type { Route } from '../translation/relay';
import { stringOption } from './dispatch';

type Interaction = APIChatInputApplicationCommandGuildInteraction;

const RESET_GUIDE = '/settings relay か /settings origin で設定し直してください';

// 保存済みの値や利用者の入力は検証を通っていない文字列かもしれないので、インラインコードを閉じる記号と改行を置き換える。
// エスケープしないのは、インラインコードの中ではバックスラッシュが効かないため。
const inlineCode = (value: string): string => `\`${value.replaceAll('`', "'").replaceAll(/[\r\n]/g, ' ')}\``;

// 保存済みの設定の誤りと直し方（docs/interface.md の「保存済みの設定の誤り」）。
// /settings relay と /settings origin では、保存した後に残った誤りを成功の見出しの下に置くので、見出しとは分けて組み立てる。
function invalidSettingsContent(error: RouteError): { readonly body: string; readonly footer?: string } {
	if (error.kind === 'unsupported_language') {
		const codes = error.codes.map(inlineCode).join('、');
		return {
			body: `このチャンネルの設定に、対応していない言語コードがあります: ${codes}\n${RESET_GUIDE}`,
			footer: `言語コードの表 → ${LANGUAGE_TABLE_URL}`,
		};
	}
	return { body: `このチャンネルの設定は、同じ言語が続くルートになっています\n${codeBlock(formatRoute(error.route))}\n${RESET_GUIDE}` };
}

// 保存済みの設定から中継ルートを組み立てられなかったとき。
// 公開範囲は呼び出し側で決める。/rt は翻訳中のエラーと同じく全員に見せる。
export function invalidSettingsMessage(error: RouteError): ContainerMessage {
	const { body, footer } = invalidSettingsContent(error);
	return errorMessage(body, footer);
}

export async function settingsShow(interaction: APIChatInputApplicationCommandGuildInteraction, env: Env): Promise<APIInteractionResponse> {
	const settings = await readSettings(env.DB, interaction.channel.id);
	if (!settings.ok) {
		const { operation, details } = settings.error;
		log({ event: 'd1.failed', operation, ...interactionPlace(interaction), ...details });
		return settingsUnavailableReply();
	}

	// 保存する前に relay と origin で検証しているので、ここで失敗するのは検証の漏れか対応言語の変更があったときである。
	// 設定し直せば直るので、待てば直る失敗とは分けて何がおかしいかを見せ、原因を追えるよう記録も残す。
	const route = toRoute(settings.value);
	if (!route.ok) {
		log({ event: 'settings.invalid', errorKind: route.error.kind, ...interactionPlace(interaction) });
		return reply(invalidSettingsMessage(route.error), 'private');
	}

	// ルートは対応言語のコードだけからなり、バッククォートを含まないのでそのままコードブロックに入れられる。
	return reply(containerMessage({ heading: '中継ルート', body: codeBlock(formatRoute(route.value)) }), 'private');
}

// docs/non-functional.md の「入力の上限」
const MAX_RELAY_LANGS = 10;

// 引数の文字列は 6000 文字まで入るので、そのまま並べると TextDisplay の上限（4000 文字）を超えて応答ごと拒まれる。
// 本物の言語コードは 3 文字以内なので、打ち間違いを見せるには 16 書記素あれば足りる。
const MAX_DISPLAYED_GRAPHEMES = 16;
// 結合文字を重ねると 1 書記素がいくらでも長くなるので、書記素の数とは別に文字数（UTF-16 の単位）でも抑える。
// 中継言語の 10 個すべてがこの長さでも、TextDisplay の上限に収まる。
const MAX_DISPLAYED_CODE_UNITS = 64;

// 切り詰めは書記素の単位で行い、絵文字などを途中で割らない。
const graphemes = new Intl.Segmenter();

// 1 書記素だけで上限を超えるときは、サロゲートペアを割らないようコードポイントの単位で切る。
function codePointsWithin(segment: string, budget: number): string {
	let result = '';
	for (const codePoint of segment) {
		if (result.length + codePoint.length > budget) break;
		result += codePoint;
	}
	return result;
}

function truncated(input: string): string {
	let result = '';
	let count = 0;
	for (const { segment } of graphemes.segment(input)) {
		if (count === MAX_DISPLAYED_GRAPHEMES || result.length + segment.length > MAX_DISPLAYED_CODE_UNITS) {
			return `${result === '' ? codePointsWithin(segment, MAX_DISPLAYED_CODE_UNITS) : result}…`;
		}
		result += segment;
		count += 1;
	}
	return result;
}

// \s は全角スペース（U+3000）も含む。
const splitCodes = (input: string): string[] => input.split(/\s+/u).filter((code) => code !== '');

const unsupportedReply = (codes: readonly string[]) =>
	errorReply(
		`対応していない言語コードがあります: ${codes.map((code) => inlineCode(truncated(code))).join('、')}\n言語コードの表 → ${LANGUAGE_TABLE_URL}`,
	);

// 入力を保存してよいかを決める。
// 保存済みの側だけがおかしいときも保存するのは、docs/interface.md の「保存済みの設定の誤り」のとおり設定し直せば直るようにするため。
// 断ると、原文の言語と中継言語の両方がおかしいチャンネルはどちらのコマンドでも直せなくなる。
type Check = { readonly ok: true } | { readonly ok: false; readonly reply: APIInteractionResponse };

const ACCEPTED: Check = { ok: true };
const rejected = (response: APIInteractionResponse): Check => ({ ok: false, reply: response });

// storedPairsOnly は、ルートの隣り合う組のうち入力を含まない組だけで同じ言語が続いているかを返す。
function check(settings: ChannelSettings, inputs: readonly string[], storedPairsOnly: (route: Route) => boolean): Check {
	const route = toRoute(settings);
	if (route.ok) return ACCEPTED;
	if (route.error.kind === 'repeated_language') {
		if (storedPairsOnly(route.error.route)) return ACCEPTED;
		return rejected(errorReply(`同じ言語が続くルートは設定できません\n${codeBlock(formatRoute(route.error.route))}`));
	}
	const fromInput = new Set(inputs.map((input) => input.toLowerCase()));
	const unsupported = route.error.codes.filter((code) => fromInput.has(code));
	return unsupported.length > 0 ? rejected(unsupportedReply(unsupported)) : ACCEPTED;
}

function storeFailed(interaction: Interaction, error: StoreError): APIInteractionResponse {
	log({ event: 'd1.failed', operation: error.operation, ...interactionPlace(interaction), ...error.details });
	return settingsUnavailableReply();
}

// 書き込みが返した更新後の設定でルートを表示する。読んでから書くまでに他の人が設定を変えていても、保存された内容を示せる。
// 保存済みの側に誤りが残っていても、変更は保存できていて全員の /rt に効くので、成功として全員に見せる。
// ルートはまだ組み立てられないので、代わりに残っている誤りと直し方を示す。
function updatedReply(interaction: Interaction, heading: string, settings: ChannelSettings): APIInteractionResponse {
	const route = toRoute(settings);
	if (!route.ok) {
		log({ event: 'settings.invalid', errorKind: route.error.kind, ...interactionPlace(interaction) });
		return reply(containerMessage({ heading, ...invalidSettingsContent(route.error) }), 'public');
	}
	return reply(containerMessage({ heading, body: codeBlock(formatRoute(route.value)) }), 'public');
}

// 他の人が同時に設定を変え続けても応答が遅れすぎないよう、読み直す回数を抑える。
const MAX_WRITE_ATTEMPTS = 3;

// 読んで、検証して、検証に使った設定が変わっていないときだけ書く。
// 書くまでに変わっていたら、変わった後の設定で検証し直す。検証を通った入力が、他の人の変更と合わさって禁止したルートになるのを防ぐため。
async function updateSettings(
	interaction: Interaction,
	env: Env,
	heading: string,
	checkInput: (current: ChannelSettings) => Check,
	write: (current: ChannelSettings) => Promise<WriteResult>,
): Promise<APIInteractionResponse> {
	for (let attempt = 0; attempt < MAX_WRITE_ATTEMPTS; attempt += 1) {
		const current = await readSettings(env.DB, interaction.channel.id);
		if (!current.ok) return storeFailed(interaction, current.error);
		const checked = checkInput(current.value);
		if (!checked.ok) return checked.reply;

		const updated = await write(current.value);
		if (updated.ok) return updatedReply(interaction, heading, updated.value);
		if (updated.error.kind === 'd1_failed') return storeFailed(interaction, updated.error);
	}
	// 時間をおけば書けるので、読み書きの失敗と同じ案内をする。
	log({ event: 'settings.conflict', ...interactionPlace(interaction) });
	return settingsUnavailableReply();
}

export async function settingsRelay(interaction: Interaction, env: Env): Promise<APIInteractionResponse> {
	// 必須の引数なので届かないことはまずないが、届かなければ空の入力と同じく入力を促す。
	const inputs = splitCodes(stringOption(interaction, 'settings relay', 'langs') ?? '');
	if (inputs.length === 0) return errorReply('言語コードを入力してください');
	if (inputs.length > MAX_RELAY_LANGS) return errorReply('中継言語に設定できるのは10ヶ国語までです');

	const relayLangs = inputs.map((input) => input.toLowerCase());
	return updateSettings(
		interaction,
		env,
		'中継言語を設定しました',
		// 中継言語を置き換えると、ルートの隣り合う組はどれも入力を含む。
		(current) => check({ originLang: current.originLang, relayLangs: inputs }, inputs, () => false),
		(current) => writeRelayLangs(env.DB, interaction.channel.id, relayLangs, current),
	);
}

// 原文の言語は両端にだけ現れるので、両端の組で続いていなければ、続いているのは保存済みの中継言語どうしである。
const repeatedOnlyInRelay = (route: Route): boolean => route[1] !== route[0] && route.at(-2) !== route[0];

export async function settingsOrigin(interaction: Interaction, env: Env): Promise<APIInteractionResponse> {
	const inputs = splitCodes(stringOption(interaction, 'settings origin', 'lang') ?? '');
	const [input] = inputs;
	if (input === undefined) return errorReply('言語コードを入力してください');
	if (inputs.length > 1) return errorReply('原文の言語は1ヶ国語のみ入力してください');

	return updateSettings(
		interaction,
		env,
		'原文の言語を設定しました',
		(current) => check({ originLang: input, relayLangs: current.relayLangs }, inputs, repeatedOnlyInRelay),
		(current) => writeOriginLang(env.DB, interaction.channel.id, input.toLowerCase(), current),
	);
}
