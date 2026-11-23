import { ComponentType, InteractionResponseType, MessageFlags, SeparatorSpacingSize } from 'discord-api-types/v10';
import { describe, expect, it } from 'vitest';
import { codeBlock, containerMessage, errorMessage, errorReply, reply, settingsUnavailableReply } from '../../src/discord/response';

const textDisplay = (content: string) => ({ type: ComponentType.TextDisplay, content });
const divider = { type: ComponentType.Separator, divider: true, spacing: SeparatorSpacingSize.Small };
const container = (...components: unknown[]) => [{ type: ComponentType.Container, components }];

describe('containerMessage', () => {
	it('見出しと本文を1つのテキストにまとめ、色のない Container に入れる', () => {
		expect(containerMessage({ heading: '中継ルート', body: '```ja -> en -> ja```' })).toEqual({
			flags: MessageFlags.IsComponentsV2,
			components: container(textDisplay('### 中継ルート\n```ja -> en -> ja```')),
			allowed_mentions: { parse: [] },
		});
	});

	it('footer は区切り線を挟んで本文の下に置く', () => {
		expect(containerMessage({ heading: '使い方', body: '本文', footer: '言語コードの表' }).components).toEqual(
			container(textDisplay('### 使い方\n本文'), divider, textDisplay('言語コードの表')),
		);
	});

	it('どのメンションも通知しない', () => {
		expect(containerMessage({ heading: '見出し', body: '@everyone' }).allowed_mentions).toEqual({ parse: [] });
	});
});

describe('errorMessage', () => {
	it('見出しを「エラー」とし、その下にメッセージを置く', () => {
		expect(errorMessage('言語コードを入力してください').components).toEqual(
			container(textDisplay('### エラー\n言語コードを入力してください')),
		);
	});

	it('footer を渡すと区切り線の下に置く', () => {
		expect(errorMessage('翻訳に失敗しました。時間をおいて試してください', '||原文: こんにちは||').components).toEqual(
			container(textDisplay('### エラー\n翻訳に失敗しました。時間をおいて試してください'), divider, textDisplay('||原文: こんにちは||')),
		);
	});
});

describe('reply', () => {
	const message = containerMessage({ heading: '見出し', body: '本文' });

	it('type 4 でメッセージを返す', () => {
		const response = reply(message, 'public');

		expect(response.type).toBe(InteractionResponseType.ChannelMessageWithSource);
		expect(response.data.components).toEqual(message.components);
		expect(response.data.allowed_mentions).toEqual({ parse: [] });
	});

	it('public では ephemeral にしない', () => {
		expect(reply(message, 'public').data.flags).toBe(MessageFlags.IsComponentsV2);
	});

	it('private では ephemeral にする', () => {
		expect(reply(message, 'private').data.flags).toBe(MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral);
	});
});

describe('errorReply', () => {
	it('見出しを「エラー」としたメッセージを、type 4 で呼び出した本人だけに見せる', () => {
		expect(errorReply('言語コードを入力してください')).toEqual({
			type: InteractionResponseType.ChannelMessageWithSource,
			data: {
				flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
				components: container(textDisplay('### エラー\n言語コードを入力してください')),
				allowed_mentions: { parse: [] },
			},
		});
	});
});

describe('settingsUnavailableReply', () => {
	it('設定の読み書きの失敗を、呼び出した本人だけに見せる', () => {
		const response = settingsUnavailableReply();

		expect(response.data.flags).toBe(MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral);
		expect(response.data.components).toEqual(
			container(textDisplay('### エラー\n設定の読み書きに失敗しました。時間をおいて試してください')),
		);
	});
});

describe('codeBlock', () => {
	it('1行のコードブロックで囲む', () => {
		expect(codeBlock('ja -> en -> ja')).toBe('```ja -> en -> ja```');
	});
});
