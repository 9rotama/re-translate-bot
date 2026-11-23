import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import type { D1Operation, ErrorDetails } from '../errors';
import { errorDetails } from '../log';
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

export async function writeRelayLangs(
	db: D1Database,
	channelId: string,
	relayLangs: readonly string[],
): Promise<Result<ChannelSettings, StoreError>> {
	const updatedAt = Date.now();
	return query('settings.upsert_relay', () =>
		drizzle(db)
			.insert(channelSettings)
			.values({ channelId, originLang: defaultSettings.originLang, relayLangs: [...relayLangs], updatedAt })
			.onConflictDoUpdate({ target: channelSettings.channelId, set: { relayLangs: [...relayLangs], updatedAt } })
			.returning(columns)
			.get(),
	);
}

export async function writeOriginLang(db: D1Database, channelId: string, originLang: string): Promise<Result<ChannelSettings, StoreError>> {
	const updatedAt = Date.now();
	return query('settings.upsert_origin', () =>
		drizzle(db)
			.insert(channelSettings)
			.values({ channelId, originLang, relayLangs: [...defaultSettings.relayLangs], updatedAt })
			.onConflictDoUpdate({ target: channelSettings.channelId, set: { originLang, updatedAt } })
			.returning(columns)
			.get(),
	);
}
