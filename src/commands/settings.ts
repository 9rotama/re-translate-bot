// /settings のサブコマンド（docs/interface.md の「/settings show」）。
import type { APIChatInputApplicationCommandGuildInteraction, APIInteractionResponse } from 'discord-api-types/v10';
import { codeBlock, containerMessage, errorMessage, reply, settingsUnavailableReply, type ContainerMessage } from '../discord/response';
import { interactionPlace, log } from '../log';
import { formatRoute, toRoute, type RouteError } from '../settings/route';
import { readSettings } from '../settings/store';
import { LANGUAGE_TABLE_URL } from '../translation/languages';

const RESET_GUIDE = '/settings relay か /settings origin で設定し直してください';

// 保存済みの値は検証を通っていない文字列かもしれないので、インラインコードを閉じる記号と改行を置き換える。
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
