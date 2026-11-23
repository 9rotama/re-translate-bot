import {
	ComponentType,
	InteractionResponseType,
	MessageFlags,
	SeparatorSpacingSize,
	type APIAllowedMentions,
	type APIComponentInContainer,
	type APIContainerComponent,
	type APIInteractionResponseChannelMessageWithSource,
} from 'discord-api-types/v10';

// 本文と footer はエスケープしないので、利用者の入力を含めるときは呼び出し側で崩れないようにする。
export type ContainerContent = {
	readonly heading: string;
	readonly body: string;
	readonly footer?: string;
};

export type ContainerMessage = {
	readonly flags: MessageFlags;
	readonly components: [APIContainerComponent];
	readonly allowed_mentions: APIAllowedMentions;
};

export type Visibility = 'public' | 'private';

// 本文の @everyone などで通知を飛ばさない（docs/non-functional.md）。
const NO_MENTIONS: APIAllowedMentions = { parse: [] };

const text = (content: string): APIComponentInContainer => ({ type: ComponentType.TextDisplay, content });
const separator: APIComponentInContainer = { type: ComponentType.Separator, divider: true, spacing: SeparatorSpacingSize.Small };

export function containerMessage({ heading, body, footer }: ContainerContent): ContainerMessage {
	const components = [text(`### ${heading}\n${body}`)];
	if (footer !== undefined) components.push(separator, text(footer));
	return {
		flags: MessageFlags.IsComponentsV2,
		components: [{ type: ComponentType.Container, components }],
		allowed_mentions: NO_MENTIONS,
	};
}

export function errorMessage(message: string, footer?: string): ContainerMessage {
	return containerMessage({ heading: 'エラー', body: message, footer });
}

// ビット和を data.flags に直接書くと no-unsafe-enum-assignment に掛かるので、関数の戻り値を通す。
const withFlag = (flags: MessageFlags, flag: MessageFlags): MessageFlags => flags | flag;

export function reply(message: ContainerMessage, visibility: Visibility): APIInteractionResponseChannelMessageWithSource {
	const flags = visibility === 'private' ? withFlag(message.flags, MessageFlags.Ephemeral) : message.flags;
	return { type: InteractionResponseType.ChannelMessageWithSource, data: { ...message, flags } };
}

export function errorReply(message: string): APIInteractionResponseChannelMessageWithSource {
	return reply(errorMessage(message), 'private');
}

export function settingsUnavailableReply(): APIInteractionResponseChannelMessageWithSource {
	return errorReply('設定の読み書きに失敗しました。時間をおいて試してください');
}

export function codeBlock(content: string): string {
	return `\`\`\`${content}\`\`\``;
}
