-- Migration number: 0001
CREATE TABLE channel_settings (
  channel_id  TEXT PRIMARY KEY,
  origin_lang TEXT NOT NULL,
  relay_langs TEXT NOT NULL CHECK (json_type(relay_langs) = 'array'), -- JSON 配列（例: ["en","fr"]）
  updated_at  INTEGER NOT NULL -- UNIX 時刻（ミリ秒）
);
