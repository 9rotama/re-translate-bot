// 遅延応答（type 5）の後に、Interaction のトークンで元の応答メッセージを編集する（docs/architecture.md の「時間の制約への対処」）。
import { RouteBases, type RESTPatchAPIWebhookWithTokenMessageJSONBody } from 'discord-api-types/v10';
import type { FollowupErrorKind } from '../errors';
import { errorDetails, type ErrorDetails } from '../log';
import { err, ok, type Result } from '../result';

// 翻訳の期限（25秒）の後に残る、30秒の表示期限までの時間に収める。
export const FOLLOWUP_TIMEOUT_MS = 4_000;

export type FollowupTarget = {
	readonly applicationId: string;
	readonly token: string;
};

export type FollowupError = {
	readonly kind: FollowupErrorKind;
	// http_error のときだけ持つ。
	readonly status?: number;
	readonly details: ErrorDetails;
};

export async function editOriginal(
	{ applicationId, token }: FollowupTarget,
	body: RESTPatchAPIWebhookWithTokenMessageJSONBody,
	timeoutMs: number = FOLLOWUP_TIMEOUT_MS,
): Promise<Result<void, FollowupError>> {
	// discord-api-types の Routes.webhookMessage() は @original を %40original にエンコードするので使わず、Discord の文書と同じ形で組み立てる。
	const url = `${RouteBases.api}/webhooks/${applicationId}/${token}/messages/@original`;
	let response: Response;
	try {
		response = await fetch(url, {
			method: 'PATCH',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(body),
			signal: AbortSignal.timeout(timeoutMs),
		});
	} catch (error) {
		return err({ kind: 'network_error', details: errorDetails(error) });
	}
	// 本文は使わないので、読まずに閉じて接続を早く手放す。
	await response.body?.cancel();
	return response.ok ? ok(undefined) : err({ kind: 'http_error', status: response.status, details: {} });
}
