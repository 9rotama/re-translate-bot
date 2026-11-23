// Discord から Interaction を受け取る fetch handler。
// 署名を検証し、Interaction の type とコマンド名で振り分ける。
import {
	InteractionResponseType,
	InteractionType,
	type APIChatInputApplicationCommandGuildInteraction,
	type APIInteraction,
} from 'discord-api-types/v10';
import { isChatInputApplicationCommandInteraction, isGuildInteraction } from 'discord-api-types/utils/v10';
import { resolveCommand } from './commands/dispatch';
import { handlers } from './commands/index';
import { errorDetails, interactionPlace, log } from './log';
import { importPublicKey, verifySignature } from './verify';

// 署名を検証できた本文は Discord が組み立てたものなので、振り分けに使う type だけを確かめ、ほかの項目は型を信じる。
function isInteraction(value: unknown): value is APIInteraction {
	return typeof value === 'object' && value !== null && 'type' in value && typeof value.type === 'number';
}

// 登録したコマンドはすべてギルド専用の Chat Input なので、それ以外の Interaction は扱わない。
function asGuildChatInput(interaction: APIInteraction): APIChatInputApplicationCommandGuildInteraction | undefined {
	if (interaction.type !== InteractionType.ApplicationCommand) return undefined;
	if (!isChatInputApplicationCommandInteraction(interaction) || !isGuildInteraction(interaction)) return undefined;
	return interaction;
}

// env の値は isolate の中で変わらないので、鍵は isolate ごとに1回だけ import する。
let publicKey: Promise<CryptoKey> | undefined;

// 外側で例外を記録するときに失敗の場所を付けられるよう、読み取った Interaction を呼び出し側に残す。
type Received = { interaction?: APIInteraction };

async function handle(request: Request, env: Env, ctx: ExecutionContext, received: Received): Promise<Response> {
	publicKey ??= importPublicKey(env.DISCORD_PUBLIC_KEY);
	const [body, key] = await Promise.all([request.text(), publicKey]);
	const verified = await verifySignature(request.headers, body, key);
	if (!verified.ok) {
		log({ event: 'signature.rejected', reason: verified.error });
		return new Response(null, { status: 401 });
	}

	const interaction: unknown = JSON.parse(body);
	if (!isInteraction(interaction)) return new Response(null, { status: 400 });
	received.interaction = interaction;

	const commandInteraction = asGuildChatInput(interaction);
	const command = commandInteraction === undefined ? undefined : resolveCommand(commandInteraction);
	log({ event: 'interaction.received', interactionType: interaction.type, command, ...interactionPlace(interaction) });

	if (interaction.type === InteractionType.Ping) {
		return Response.json({ type: InteractionResponseType.Pong });
	}
	if (commandInteraction === undefined || command === undefined) {
		return new Response(null, { status: 400 });
	}
	return Response.json(await handlers[command](commandInteraction, env, ctx));
}

export default {
	async fetch(request, env, ctx): Promise<Response> {
		if (request.method !== 'POST') {
			return new Response(null, { status: 405, headers: { Allow: 'POST' } });
		}
		const received: Received = {};
		try {
			return await handle(request, env, ctx, received);
		} catch (error) {
			log({ event: 'unhandled_error', where: 'fetch', ...interactionPlace(received.interaction ?? {}), ...errorDetails(error) });
			return new Response(null, { status: 500 });
		}
	},
} satisfies ExportedHandler<Env>;
