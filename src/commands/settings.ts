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
import { err, type Result } from '../result';
import { formatRoute, toRoute, type RouteError } from '../settings/route';
import { readSettings, writeOriginLang, writeRelayLangs, type ChannelSettings, type StoreError } from '../settings/store';
import { LANGUAGE_TABLE_URL } from '../translation/languages';
import type { Route } from '../translation/relay';
import { stringOption } from './dispatch';

type Interaction = APIChatInputApplicationCommandGuildInteraction;

const RESET_GUIDE = '/settings relay か /settings origin で設定し直してください';

// 保存済みの値や利用者の入力は検証を通っていない文字列かもしれないので、インラインコードを閉じる記号と改行を置き換える。
// エスケープしないのは、インラインコードの中ではバックスラッシュが効かないため。
const inlineCode = (value: string): string => `\`${value.replaceAll('`', "'").replaceAll(/[\r\n]/g, ' ')}\``;

// 保存済みの設定から中継ルートを組み立てられなかったとき（docs/interface.md の「保存済みの設定の誤り」）。
// 公開範囲は呼び出し側で決める。/rt は翻訳中のエラーと同じく全員に見せる。
export function invalidSettingsMessage(error: RouteError): ContainerMessage {
	if (error.kind === 'unsupported_language') {
		const codes = error.codes.map(inlineCode).join('、');
		return errorMessage(
			`このチャンネルの設定に、対応していない言語コードがあります: ${codes}\n${RESET_GUIDE}`,
			`言語コードの表 → ${LANGUAGE_TABLE_URL}`,
		);
	}
	return errorMessage(`このチャンネルの設定は、同じ言語が続くルートになっています\n${codeBlock(formatRoute(error.route))}\n${RESET_GUIDE}`);
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
// 本物の言語コードは 3 文字以内なので、打ち間違いを見せるには 16 文字あれば足りる。
const MAX_DISPLAYED_CODE_LENGTH = 16;

// 切り詰めは書記素の単位で行い、絵文字などを途中で割らない。
const graphemes = new Intl.Segmenter();

function truncated(input: string): string {
	const segments = Array.from(graphemes.segment(input), ({ segment }) => segment);
	return segments.length > MAX_DISPLAYED_CODE_LENGTH ? `${segments.slice(0, MAX_DISPLAYED_CODE_LENGTH).join('')}…` : input;
}

// \s は全角スペース（U+3000）も含む。
const splitCodes = (input: string): string[] => input.split(/\s+/u).filter((code) => code !== '');

const unsupportedReply = (codes: readonly string[]) =>
	errorReply(
		`対応していない言語コードがあります: ${codes.map((code) => inlineCode(truncated(code))).join('、')}\n言語コードの表 → ${LANGUAGE_TABLE_URL}`,
	);

// 保存済みの設定と入力を合わせてルートを組み立てる。
// 対応していないコードが保存済みの設定の側にだけあるときは、利用者の入力の誤りではないので設定の読み書きの失敗として扱う。
function routeFor(settings: ChannelSettings, inputs: readonly string[]): Result<Route, APIInteractionResponse> {
	const route = toRoute(settings);
	if (route.ok) return route;
	if (route.error.kind === 'repeated_language') {
		return err(errorReply(`同じ言語が続くルートは設定できません\n${codeBlock(formatRoute(route.error.route))}`));
	}
	const fromInput = new Set(inputs.map((input) => input.toLowerCase()));
	const unsupported = route.error.codes.filter((code) => fromInput.has(code));
	return err(unsupported.length > 0 ? unsupportedReply(unsupported) : settingsUnavailableReply());
}

function storeFailed(interaction: Interaction, error: StoreError): APIInteractionResponse {
	log({ event: 'd1.failed', operation: error.operation, ...interactionPlace(interaction), ...error.details });
	return settingsUnavailableReply();
}

// 書き込みが返した更新後の設定でルートを表示する。読んでから書くまでに他の人が設定を変えていても、保存された内容を示せる。
// 書き込む前に検証しているので失敗はまず起きないが、起きたら保存済みの設定が壊れているときと同じに扱う。
function updatedReply(heading: string, settings: ChannelSettings): APIInteractionResponse {
	const route = toRoute(settings);
	if (!route.ok) return settingsUnavailableReply();
	return reply(containerMessage({ heading, body: codeBlock(formatRoute(route.value)) }), 'public');
}

export async function settingsRelay(interaction: Interaction, env: Env): Promise<APIInteractionResponse> {
	// 必須の引数なので届かないことはまずないが、届かなければ空の入力と同じく入力を促す。
	const inputs = splitCodes(stringOption(interaction, 'settings relay', 'langs') ?? '');
	if (inputs.length === 0) return errorReply('言語コードを入力してください');
	if (inputs.length > MAX_RELAY_LANGS) return errorReply('中継言語に設定できるのは10ヶ国語までです');

	const current = await readSettings(env.DB, interaction.channel.id);
	if (!current.ok) return storeFailed(interaction, current.error);
	const route = routeFor({ originLang: current.value.originLang, relayLangs: inputs }, inputs);
	if (!route.ok) return route.error;

	const updated = await writeRelayLangs(env.DB, interaction.channel.id, route.value.slice(1, -1));
	if (!updated.ok) return storeFailed(interaction, updated.error);
	return updatedReply('中継言語を設定しました', updated.value);
}

export async function settingsOrigin(interaction: Interaction, env: Env): Promise<APIInteractionResponse> {
	const inputs = splitCodes(stringOption(interaction, 'settings origin', 'lang') ?? '');
	const [input] = inputs;
	if (input === undefined) return errorReply('言語コードを入力してください');
	if (inputs.length > 1) return errorReply('原文の言語は1ヶ国語のみ入力してください');

	const current = await readSettings(env.DB, interaction.channel.id);
	if (!current.ok) return storeFailed(interaction, current.error);
	const route = routeFor({ originLang: input, relayLangs: current.value.relayLangs }, inputs);
	if (!route.ok) return route.error;

	const updated = await writeOriginLang(env.DB, interaction.channel.id, route.value[0]);
	if (!updated.ok) return storeFailed(interaction, updated.error);
	return updatedReply('原文の言語を設定しました', updated.value);
}
