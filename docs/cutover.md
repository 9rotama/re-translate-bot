# 本番への切り替え手順

この文書は、現行の bot（EC2 上の discord.py と GAS）から Cloudflare Workers 上の bot へ本番を切り替える手順を定める（#37）。
手順はどれも外部の環境を変えるので、保守する人が手元から1つずつ実行する。

## 切り替えの考え方

旧 bot は Gateway でメッセージを受け取り、新しい bot は Interactions Endpoint でスラッシュコマンドを受け取る。
受け取る経路が別なので、Interactions Endpoint URL を設定しても旧 bot は止まらない。
そこで、新しい bot を本番で動かして確かめ終えるまで旧 bot を動かしたままにし、最後に旧 bot を止める。
確かめている間に問題が見つかっても、旧 bot はそのまま使えるので、新しい bot の側を戻すだけでよい。

## 事前の確認

切り替えの前に次を確かめる。

- `main` の CI が通っている。
- 開発用の D1 にマイグレーションを適用している（`pnpm run db:migrate:dev`）。適用していないと、開発用 Worker で設定の読み書きを確かめられない。
- [テスト方針](./testing.md)の「自動テストしない範囲」を、開発用 Worker と開発用アプリで確かめ終えている。
- `.env.production.local` に本番アプリの `DISCORD_APPLICATION_ID`（`981977773277061210`）と bot トークンが入っており、`DISCORD_GUILD_ID` が書かれていない。書かれていると、グローバルコマンドではなくそのギルドのコマンドとして登録される。
- `wrangler whoami` で、開発用と同じ Cloudflare アカウントにログインしている。

Rate Limiting binding が無料プランで使えるか（[アーキテクチャ](./architecture.md)の「レート制限」）は、開発用 Worker を `ratelimits` 付きで同じアカウントに配備できていることで確かめた。
使えない binding を含む設定は配備の時点で失敗するからである。

### 招待 URL の scope

招待 URL の scope は `bot` のままでよく、`applications.commands` を足さなくてよい。
Discord のドキュメントは、`applications.commands` が `bot` の scope に含まれると明記している。

- [Application Commands](https://docs.discord.com/developers/interactions/application-commands)
- [OAuth2](https://docs.discord.com/developers/topics/oauth2)

ただし、`bot` の scope だけで以前に招待されたギルドでもコマンドが出るかは、ドキュメントからは読み切れない。
既存のギルドでコマンドが出るかは、手順5の「本番での確認」で確かめる。

## 手順

### 1. 本番の D1 にマイグレーションを適用する

本番の D1（`re-translate-bot`）は作成済みだが、テーブルがまだない。
Worker はテーブルがないと設定の読み書きに失敗するので、配備より先に適用する。
```sh
pnpm run db:migrate
```

適用の前に未適用のマイグレーションの一覧が出て、続けてよいかを聞かれる。
一覧が `0001_create_channel_settings.sql` であることを確かめてから続ける。

### 2. 本番に配備する

```sh
pnpm run deploy
```

`pnpm run deploy` は `--env production` を付けて配備する。
配備の出力に表示される `workers.dev` の URL を、次の手順で使う。

### 3. Interactions Endpoint URL を設定する

保存する前に `wrangler tail --env production` を別の端末で開いておくと、PING を受けたことをその場で確かめられる。

Developer Portal で本番アプリ（`981977773277061210`）の General Information を開き、Interactions Endpoint URL に手順2の URL を入れて保存する。
保存のときに Discord が署名付きの PING を送り、Worker が正しく応答しないと保存できない。
保存できなければ、`wrangler.jsonc` の `env.production.vars` の `DISCORD_PUBLIC_KEY` が本番アプリの公開鍵と一致しているかを確かめる。

### 4. グローバルコマンドを登録する

```sh
pnpm run commands:register
```

出力が「グローバルに…個のコマンドを登録しました。」になっていることを確かめる。
「ギルド …」と出た場合は、`.env.production.local` に `DISCORD_GUILD_ID` が残っている。

### 5. 本番での確認

[テスト方針](./testing.md)の「自動テストしない範囲」の項目を、本番アプリで確かめる。
加えて次を確かめる。

- 以前から bot がいるギルドで、招待し直さずにスラッシュコマンドが表示され、動く。
- 権限を付けずに新しく招待したギルドで、すべてのコマンドが動く。
- Workers Logs に本番の Worker のログが出ている。

問題が見つかったら「切り戻し」に進む。

### 6. 旧 bot を止める

本番での確認を終えたら、次を行う。これらは PR にしない手作業である。

1. EC2 のインスタンスを停止する。
2. Developer Portal の Bot で Message Content Intent を無効にする。Server Members Intent と Presence Intent も、有効になっていれば無効にする。
3. MongoDB のデータベースを削除する。既存のデータは移行しない（[要件](./requirements.md)の「データ移行」）。
4. GAS のプロジェクトを削除する。

EC2 を止めてから intent を外すのは、旧 bot が intent の不足で異常終了と再起動を繰り返さないようにするためである。

### 7. 招待 URL の権限を外す

README の招待 URL は旧 bot の権限（`permissions=274945108992`）を求めている。
新しい bot はギルド内の権限を使わないので（[非機能要件](./non-functional.md)の「セキュリティ」）、`permissions` を外す。
旧 bot が動いている間に外すと、その URL で招待した旧 bot がメッセージを送れないため、旧 bot を止めた後に #38 の README の更新で行う。

## 切り戻し

手順6で旧 bot を止める前なら、次の手順で旧 bot だけが動く状態に戻せる。

1. グローバルコマンドを空で上書きする。`definitions` を一時的に空にして `pnpm run commands:register` を実行するか、`PUT /applications/981977773277061210/commands` に `[]` を送る。
2. Developer Portal で Interactions Endpoint URL を空にする。

本番の Worker と D1 は残しておいてよい。
Endpoint URL を外せば Discord からは呼ばれず、無料プランのため費用もかからない。
