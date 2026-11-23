import { exports } from 'cloudflare:workers';
import { InteractionResponseType, InteractionType } from 'discord-api-types/v10';
import { describe, expect, it } from 'vitest';
import { spyConsole } from './helpers/console';
import { CHANNEL_ID, GUILD_ID, commandInteraction, pingInteraction, signedRequest, subcommand } from './helpers/interactions';

const fetchWorker = (request: Request) => exports.default.fetch(request);

describe('fetch handler', () => {
	const spies = spyConsole();

	it('POST 以外のリクエストには 405 を返す', async () => {
		const response = await exports.default.fetch('https://example.com/', { method: 'GET' });

		expect(response.status).toBe(405);
		expect(response.headers.get('Allow')).toBe('POST');
	});

	describe('署名の検証', () => {
		it('署名のヘッダがなければ 401 を返し、signature.rejected を記録する', async () => {
			const response = await fetchWorker(new Request('https://example.com/', { method: 'POST', body: JSON.stringify(pingInteraction()) }));

			expect(response.status).toBe(401);
			expect(spies.warn).toHaveBeenCalledWith({ event: 'signature.rejected', reason: 'missing_header' });
		});

		it('署名した後に本文を書き換えたリクエストには 401 を返し、signature.rejected を記録する', async () => {
			const signed = await signedRequest(pingInteraction());
			const tampered = new Request(signed, { method: 'POST', body: JSON.stringify({ ...pingInteraction(), id: '999999999999999999' }) });

			const response = await fetchWorker(tampered);

			expect(response.status).toBe(401);
			expect(spies.warn).toHaveBeenCalledWith({ event: 'signature.rejected', reason: 'invalid_signature' });
		});
	});

	it('PING には PONG を返す', async () => {
		const response = await fetchWorker(await signedRequest(pingInteraction()));

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ type: InteractionResponseType.Pong });
		expect(spies.log).toHaveBeenCalledWith({ event: 'interaction.received', interactionType: InteractionType.Ping });
	});

	describe('コマンドの振り分け', () => {
		it('登録したコマンドはハンドラの応答を返し、コマンド名と場所を付けて受信を記録する', async () => {
			const interaction = commandInteraction('settings', subcommand('show'));

			const response = await fetchWorker(await signedRequest(interaction));

			expect(response.status).toBe(200);
			expect(await response.json()).toMatchObject({ type: InteractionResponseType.ChannelMessageWithSource });
			expect(spies.log).toHaveBeenCalledWith({
				event: 'interaction.received',
				interactionType: InteractionType.ApplicationCommand,
				command: 'settings show',
				guildId: GUILD_ID,
				channelId: CHANNEL_ID,
			});
		});

		it('登録していないコマンドには 400 を返す', async () => {
			const response = await fetchWorker(await signedRequest(commandInteraction('unknown')));

			expect(response.status).toBe(400);
		});

		it('ギルドの外から呼ばれたコマンドには 400 を返す', async () => {
			const { guild_id: _guildId, member, ...rest } = commandInteraction('help');

			const response = await fetchWorker(await signedRequest({ ...rest, user: member.user }));

			expect(response.status).toBe(400);
		});

		it('type を持たない本文には 400 を返す', async () => {
			const response = await fetchWorker(await signedRequest({ id: '999999999999999999' }));

			expect(response.status).toBe(400);
		});

		it('コマンド以外の Interaction には 400 を返す', async () => {
			const response = await fetchWorker(await signedRequest({ ...commandInteraction('help'), type: InteractionType.MessageComponent }));

			expect(response.status).toBe(400);
		});
	});

	it('想定していない例外は 500 を返し、unhandled_error を記録する', async () => {
		const response = await fetchWorker(await signedRequest('{"type":'));

		expect(response.status).toBe(500);
		expect(spies.error).toHaveBeenCalledWith(
			expect.objectContaining({ event: 'unhandled_error', where: 'fetch', errorName: 'SyntaxError' }),
		);
	});
});
