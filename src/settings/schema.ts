import { sql } from 'drizzle-orm';
import { check, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

// migrations/0001_create_channel_settings.sql と同じ定義を書く。
// drizzle-kit でマイグレーションを生成しないのは、migrations/ の SQL を手で書いて正本にするため
// （docs/architecture.md の「マイグレーション」）。このスキーマはクエリの型付けにだけ使う。
export const channelSettings = sqliteTable(
	'channel_settings',
	{
		channelId: text('channel_id').primaryKey(),
		originLang: text('origin_lang').notNull(),
		relayLangs: text('relay_langs', { mode: 'json' }).$type<string[]>().notNull(),
		// UNIX 時刻（ミリ秒）
		updatedAt: integer('updated_at').notNull(),
	},
	(table) => [check('relay_langs_is_array', sql`json_type(${table.relayLangs}) = 'array'`)],
);
