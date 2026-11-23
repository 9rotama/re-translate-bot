import { ComponentType, InteractionResponseType, MessageFlags, SeparatorSpacingSize } from 'discord-api-types/v10';
import { describe, expect, it } from 'vitest';
import { help } from '../../src/commands/help';

describe('/help', () => {
	it('使い方と言語コードの表の URL を、呼び出した本人だけに見せる', async () => {
		expect(await help()).toEqual({
			type: InteractionResponseType.ChannelMessageWithSource,
			data: {
				flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
				components: [
					{
						type: ComponentType.Container,
						components: [
							{
								type: ComponentType.TextDisplay,
								content: [
									'### 使い方',
									'`/rt [文章]`',
									'文章を再翻訳して表示',
									'',
									'`/settings show`',
									'このチャンネルの中継ルートを表示',
									'',
									'`/settings relay [言語コード]`',
									'中継する言語を設定（空白区切りで10ヶ国語まで）',
									'',
									'`/settings origin [言語コード]`',
									'原文で使用する言語を設定',
								].join('\n'),
							},
							{ type: ComponentType.Separator, divider: true, spacing: SeparatorSpacingSize.Small },
							{ type: ComponentType.TextDisplay, content: '言語コードの表 → https://huggingface.co/facebook/m2m100_1.2B' },
						],
					},
				],
				allowed_mentions: { parse: [] },
			},
		});
	});
});
