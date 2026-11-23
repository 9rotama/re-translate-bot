// テストで使う Interaction の組み立てと署名。
// 必須の項目を既定値で埋め、テストは確かめたい項目だけを指定する（docs/testing.md の「Interaction のデータ」）。
import { env } from 'cloudflare:workers';
import {
	ApplicationCommandOptionType,
	ApplicationCommandType,
	ChannelType,
	GuildMemberFlags,
	InteractionType,
	Locale,
	type APIApplicationCommandInteractionDataOption,
	type APIChatInputApplicationCommandGuildInteraction,
	type APIPingInteraction,
	type APIUser,
} from 'discord-api-types/v10';
import { hexToBytes, SIGNATURE_HEADER, TIMESTAMP_HEADER } from '../../src/verify';

export const GUILD_ID = '111111111111111111';
export const CHANNEL_ID = '222222222222222222';
const APPLICATION_ID = '333333333333333333';
const USER_ID = '444444444444444444';

const user: APIUser = {
	id: USER_ID,
	username: 'tester',
	discriminator: '0',
	global_name: null,
	avatar: null,
};

export function pingInteraction(): APIPingInteraction {
	return {
		id: '555555555555555555',
		application_id: APPLICATION_ID,
		type: InteractionType.Ping,
		token: 'interaction-token',
		version: 1,
		app_permissions: '0',
		entitlements: [],
		authorizing_integration_owners: {},
		attachment_size_limit: 0,
	};
}

export const subcommand = (name: string): APIApplicationCommandInteractionDataOption[] => [
	{ type: ApplicationCommandOptionType.Subcommand, name },
];

export function commandInteraction(
	name: string,
	options?: APIApplicationCommandInteractionDataOption[],
): APIChatInputApplicationCommandGuildInteraction {
	return {
		id: '666666666666666666',
		application_id: APPLICATION_ID,
		type: InteractionType.ApplicationCommand,
		data: { id: '777777777777777777', name, type: ApplicationCommandType.ChatInput, options },
		guild_id: GUILD_ID,
		channel: { id: CHANNEL_ID, type: ChannelType.GuildText },
		channel_id: CHANNEL_ID,
		member: {
			user,
			roles: [],
			joined_at: '2026-01-01T00:00:00.000Z',
			deaf: false,
			mute: false,
			flags: GuildMemberFlags.CompletedOnboarding,
			permissions: '0',
		},
		token: 'interaction-token',
		version: 1,
		app_permissions: '0',
		locale: Locale.Japanese,
		guild_locale: Locale.Japanese,
		entitlements: [],
		authorizing_integration_owners: {},
		attachment_size_limit: 0,
	};
}

const toHex = (buffer: ArrayBuffer) => [...new Uint8Array(buffer)].map((byte) => byte.toString(16).padStart(2, '0')).join('');

export async function sign(privateKey: CryptoKey, timestamp: string, body: string): Promise<string> {
	return toHex(await crypto.subtle.sign('Ed25519', privateKey, new TextEncoder().encode(timestamp + body)));
}

// vitest.config.mts で作った鍵ペアの秘密鍵。公開鍵は DISCORD_PUBLIC_KEY として Worker に渡してある。
let signingKey: Promise<CryptoKey> | undefined;
export function testSigningKey(): Promise<CryptoKey> {
	const pkcs8 = hexToBytes(env.TEST_SIGNING_KEY);
	if (pkcs8 === undefined) throw new TypeError('TEST_SIGNING_KEY is not a hex string');
	signingKey ??= crypto.subtle.importKey('pkcs8', pkcs8, { name: 'Ed25519' }, false, ['sign']);
	return signingKey;
}

export async function signedRequest(body: unknown, timestamp = '1700000000'): Promise<Request> {
	const text = typeof body === 'string' ? body : JSON.stringify(body);
	const signature = await sign(await testSigningKey(), timestamp, text);
	return new Request('https://example.com/', {
		method: 'POST',
		headers: { [SIGNATURE_HEADER]: signature, [TIMESTAMP_HEADER]: timestamp, 'Content-Type': 'application/json' },
		body: text,
	});
}
