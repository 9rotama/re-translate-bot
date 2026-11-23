// /help（docs/interface.md の「/help」）。
import type { APIInteractionResponse } from 'discord-api-types/v10';
import { containerMessage, reply } from '../discord/response';
import { LANGUAGE_TABLE_URL } from '../translation/languages';

const usage = [
	['/rt [文章]', '文章を再翻訳して表示'],
	['/settings show', 'このチャンネルの中継ルートを表示'],
	['/settings relay [言語コード]', '中継する言語を設定（空白区切りで10ヶ国語まで）'],
	['/settings origin [言語コード]', '原文で使用する言語を設定'],
] as const;

const body = usage.map(([command, description]) => `\`${command}\`\n${description}`).join('\n\n');

// 本人が確かめるためのものなので、チャンネルに残さない（docs/interface.md の「公開範囲」）。
const response = reply(containerMessage({ heading: '使い方', body, footer: `言語コードの表 → ${LANGUAGE_TABLE_URL}` }), 'private');

// ハンドラの型に合わせて Promise で返す。設定を読まないので Interaction と env は受け取らない。
export function help(): Promise<APIInteractionResponse> {
	return Promise.resolve(response);
}
