import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import type { D1Operation } from '../errors';
import { errorDetails, type ErrorDetails } from '../log';
import { err, ok, type Result } from '../result';
import { channelSettings } from './schema';

export type ChannelSettings = {
	readonly originLang: string;
	readonly relayLangs: readonly string[];
};

export type StoreError = {
	readonly operation: D1Operation;
	readonly details: ErrorDetails;
};

// 現行の bot と同じ既定値。
export const defaultSettings: ChannelSettings = { originLang: 'ja', relayLangs: ['en'] };

const columns = { originLang: channelSettings.originLang, relayLangs: channelSettings.relayLangs };

async function query<T>(operation: D1Operation, run: () => Promise<T>): Promise<Result<T, StoreError>> {
	try {
		return ok(await run());
	} catch (error) {
		return err({ operation, details: errorDetails(error) });
	}
}

export async function readSettings(db: D1Database, channelId: string): Promise<Result<ChannelSettings, StoreError>> {
	const result = await query('settings.read', () =>
		drizzle(db).select(columns).from(channelSettings).where(eq(channelSettings.channelId, channelId)).get(),
	);
	if (!result.ok) return result;
	// 行がないチャンネルは未設定とみなす。読み取りのたびに行を作らないのは、書き込みの回数を設定の変更だけに抑えるため。
	return ok(result.value ?? defaultSettings);
}

// 書き込みは、検証に使った設定（basedOn）から指定しなかった列が変わっていないときだけ行う。
// 変わっていたら書き込まずに undefined を返す。D1 には読んでから書くまでを1つにするトランザクションがないので、
// 他の人が同時にもう一方の列を変えると、どちらの検証も通ったまま禁止したルートが保存されてしまうため。
// 行がないときに basedOn の値を入れるのは、行がなければ読み取りは既定値を返し、basedOn はその既定値だからである。
export type WriteResult = Result<ChannelSettings | undefined, StoreError>;

export async function writeRelayLangs(
	db: D1Database,
	channelId: string,
	relayLangs: readonly string[],
	basedOn: ChannelSettings,
): Promise<WriteResult> {
	const updatedAt = Date.now();
	return query('settings.upsert_relay', () =>
		drizzle(db)
			.insert(channelSettings)
			.values({ channelId, originLang: basedOn.originLang, relayLangs: [...relayLangs], updatedAt })
			.onConflictDoUpdate({
				target: channelSettings.channelId,
				set: { relayLangs: [...relayLangs], updatedAt },
				setWhere: eq(channelSettings.originLang, basedOn.originLang),
			})
			.returning(columns)
			.get(),
	);
}

export async function writeOriginLang(
	db: D1Database,
	channelId: string,
	originLang: string,
	basedOn: ChannelSettings,
): Promise<WriteResult> {
	const updatedAt = Date.now();
	return query('settings.upsert_origin', () =>
		drizzle(db)
			.insert(channelSettings)
			.values({ channelId, originLang, relayLangs: [...basedOn.relayLangs], updatedAt })
			.onConflictDoUpdate({
				target: channelSettings.channelId,
				set: { originLang, updatedAt },
				// relay_langs は JSON の文字列で持ち、Drizzle が書き込みと同じく JSON.stringify した値と比べる。
				setWhere: eq(channelSettings.relayLangs, [...basedOn.relayLangs]),
			})
			.returning(columns)
			.get(),
	);
}
