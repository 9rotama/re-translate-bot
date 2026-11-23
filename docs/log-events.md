# ログのイベント一覧

<!-- このファイルは scripts/gen-log-events.ts で src/log.ts から生成する。手で編集せず、`pnpm run log-events` で作り直す。 -->

記録の方針は[ログ設計](./logging.md)で定める。
どのイベントもイベント名を `event` に持つ。
値がないか検査を通らなかったときは、その値を出さずにフィールド名を `invalid` に並べる。
存在しないイベント名を渡したときは、`unknown_event` を `error` で出す。

| イベント | レベル | 内容 |
| --- | --- | --- |
| `interaction.received` | `log` | Interaction を受け取った |
| `signature.rejected` | `warn` | 署名を検証できないリクエストを拒んだ |
| `rt.rate_limited` | `log` | /rt をレート制限で断った |
| `translation.step.succeeded` | `log` | 翻訳の1段が成功した |
| `translation.step.failed` | `warn` | 翻訳の1段が失敗した。再試行した段は試行ごとに出す |
| `translation.succeeded` | `log` | 翻訳全体が成功した |
| `translation.failed` | `error` | 翻訳全体が失敗し、利用者にエラーを表示した |
| `followup.failed` | `error` | 遅延応答の後に元のメッセージを編集できなかった |
| `d1.failed` | `error` | D1 の読み書きに失敗した |
| `settings.invalid` | `error` | 保存済みの設定から中継ルートを組み立てられず、利用者にエラーを表示した |
| `unhandled_error` | `error` | 想定していない例外を最も外側で捕まえた |

## `interaction.received`

Interaction を受け取った。レベルは `log`。

| 値 | 意味 | 取りうる値 |
| --- | --- | --- |
| `interactionType` | Interaction の type（discord-api-types の InteractionType） | 0以上の整数 |
| `command` | コマンド名。コマンド以外の Interaction では出さない | `rt`：/rt<br>`settings show`：/settings show<br>`settings relay`：/settings relay<br>`settings origin`：/settings origin<br>`help`：/help |
| `guildId` | ギルド ID。分からないときは出さない | Discord の ID（17〜20桁の数字の文字列） |
| `channelId` | チャンネル ID。分からないときは出さない | Discord の ID（17〜20桁の数字の文字列） |

## `signature.rejected`

署名を検証できないリクエストを拒んだ。レベルは `warn`。

| 値 | 意味 | 取りうる値 |
| --- | --- | --- |
| `reason` | 拒んだ理由 | `missing_header`：署名のヘッダがない<br>`invalid_signature`：署名の検証に失敗した |

## `rt.rate_limited`

/rt をレート制限で断った。レベルは `log`。

`event` 以外の値は持たない。

## `translation.step.succeeded`

翻訳の1段が成功した。レベルは `log`。

| 値 | 意味 | 取りうる値 |
| --- | --- | --- |
| `step` | 何段目か（1から数える） | 0以上の整数 |
| `steps` | 全体の段数 | 0以上の整数 |
| `attempt` | その段の何回目の試行か（1から数える） | 0以上の整数 |
| `from` | 翻訳元の言語 | 言語コード（例: `ja`） |
| `to` | 翻訳先の言語 | 言語コード（例: `ja`） |
| `inputLength` | 翻訳前の文字数 | 0以上の整数 |
| `outputLength` | 翻訳後の文字数 | 0以上の整数 |
| `durationMs` | 所要時間（ミリ秒） | 0以上の整数 |

## `translation.step.failed`

翻訳の1段が失敗した。再試行した段は試行ごとに出す。レベルは `warn`。

| 値 | 意味 | 取りうる値 |
| --- | --- | --- |
| `step` | 何段目か（1から数える） | 0以上の整数 |
| `steps` | 全体の段数 | 0以上の整数 |
| `attempt` | その段の何回目の試行か（1から数える） | 0以上の整数 |
| `from` | 翻訳元の言語 | 言語コード（例: `ja`） |
| `to` | 翻訳先の言語 | 言語コード（例: `ja`） |
| `inputLength` | 翻訳前の文字数 | 0以上の整数 |
| `durationMs` | 所要時間（ミリ秒） | 0以上の整数 |
| `errorKind` | エラーの種類 | `quota_exceeded`：無料枠の使い切り<br>`timeout`：時間切れ<br>`ai_error`：それ以外の Workers AI の失敗 |
| `status` | Workers AI が返した HTTP の status。分からないときは出さない | 0以上の整数 |
| `guildId` | ギルド ID。分からないときは出さない | Discord の ID（17〜20桁の数字の文字列） |
| `channelId` | チャンネル ID。分からないときは出さない | Discord の ID（17〜20桁の数字の文字列） |
| `errorName` | 例外の name | 英字で始まる識別子（64文字まで） |
| `errorCode` | 例外の code | 英字で始まる識別子（64文字まで）か整数 |
| `causeName` | 例外の cause の name | 英字で始まる識別子（64文字まで） |
| `causeCode` | 例外の cause の code | 英字で始まる識別子（64文字まで）か整数 |
| `stack` | 例外の stack のうち、コードの位置の行 | `at` で始まる行を改行でつないだもの（10行まで） |

## `translation.succeeded`

翻訳全体が成功した。レベルは `log`。

| 値 | 意味 | 取りうる値 |
| --- | --- | --- |
| `steps` | 全体の段数 | 0以上の整数 |
| `inputLength` | 翻訳前の文字数 | 0以上の整数 |
| `outputLength` | 翻訳後の文字数 | 0以上の整数 |
| `durationMs` | 所要時間（ミリ秒） | 0以上の整数 |

## `translation.failed`

翻訳全体が失敗し、利用者にエラーを表示した。レベルは `error`。

| 値 | 意味 | 取りうる値 |
| --- | --- | --- |
| `steps` | 全体の段数 | 0以上の整数 |
| `completedSteps` | 失敗までに終わった段数 | 0以上の整数 |
| `inputLength` | 翻訳前の文字数 | 0以上の整数 |
| `durationMs` | 所要時間（ミリ秒） | 0以上の整数 |
| `errorKind` | エラーの種類 | `quota_exceeded`：無料枠の使い切り<br>`timeout`：時間切れ<br>`ai_error`：それ以外の Workers AI の失敗<br>`settings_unavailable`：設定を読めなかった |
| `guildId` | ギルド ID。分からないときは出さない | Discord の ID（17〜20桁の数字の文字列） |
| `channelId` | チャンネル ID。分からないときは出さない | Discord の ID（17〜20桁の数字の文字列） |

## `followup.failed`

遅延応答の後に元のメッセージを編集できなかった。レベルは `error`。

| 値 | 意味 | 取りうる値 |
| --- | --- | --- |
| `errorKind` | エラーの種類 | `http_error`：Discord が失敗の status を返した<br>`network_error`：応答を受け取れなかった |
| `status` | Discord が返した HTTP の status。http_error のときだけ出す | 0以上の整数 |
| `guildId` | ギルド ID。分からないときは出さない | Discord の ID（17〜20桁の数字の文字列） |
| `channelId` | チャンネル ID。分からないときは出さない | Discord の ID（17〜20桁の数字の文字列） |
| `errorName` | 例外の name | 英字で始まる識別子（64文字まで） |
| `errorCode` | 例外の code | 英字で始まる識別子（64文字まで）か整数 |
| `causeName` | 例外の cause の name | 英字で始まる識別子（64文字まで） |
| `causeCode` | 例外の cause の code | 英字で始まる識別子（64文字まで）か整数 |
| `stack` | 例外の stack のうち、コードの位置の行 | `at` で始まる行を改行でつないだもの（10行まで） |

## `d1.failed`

D1 の読み書きに失敗した。レベルは `error`。

| 値 | 意味 | 取りうる値 |
| --- | --- | --- |
| `operation` | 失敗したクエリ | `settings.read`：チャンネルの設定の読み取り<br>`settings.upsert_relay`：中継言語の書き込み<br>`settings.upsert_origin`：原文の言語の書き込み |
| `guildId` | ギルド ID。分からないときは出さない | Discord の ID（17〜20桁の数字の文字列） |
| `channelId` | チャンネル ID。分からないときは出さない | Discord の ID（17〜20桁の数字の文字列） |
| `errorName` | 例外の name | 英字で始まる識別子（64文字まで） |
| `errorCode` | 例外の code | 英字で始まる識別子（64文字まで）か整数 |
| `causeName` | 例外の cause の name | 英字で始まる識別子（64文字まで） |
| `causeCode` | 例外の cause の code | 英字で始まる識別子（64文字まで）か整数 |
| `stack` | 例外の stack のうち、コードの位置の行 | `at` で始まる行を改行でつないだもの（10行まで） |

## `settings.invalid`

保存済みの設定から中継ルートを組み立てられず、利用者にエラーを表示した。レベルは `error`。

| 値 | 意味 | 取りうる値 |
| --- | --- | --- |
| `errorKind` | 組み立てられなかった理由 | `unsupported_language`：対応していない言語コードがある<br>`repeated_language`：同じ言語が続く |
| `guildId` | ギルド ID。分からないときは出さない | Discord の ID（17〜20桁の数字の文字列） |
| `channelId` | チャンネル ID。分からないときは出さない | Discord の ID（17〜20桁の数字の文字列） |

## `unhandled_error`

想定していない例外を最も外側で捕まえた。レベルは `error`。

| 値 | 意味 | 取りうる値 |
| --- | --- | --- |
| `where` | 捕まえた場所 | `fetch`：fetch handler<br>`wait_until`：waitUntil に渡した処理 |
| `guildId` | ギルド ID。分からないときは出さない | Discord の ID（17〜20桁の数字の文字列） |
| `channelId` | チャンネル ID。分からないときは出さない | Discord の ID（17〜20桁の数字の文字列） |
| `errorName` | 例外の name | 英字で始まる識別子（64文字まで） |
| `errorCode` | 例外の code | 英字で始まる識別子（64文字まで）か整数 |
| `causeName` | 例外の cause の name | 英字で始まる識別子（64文字まで） |
| `causeCode` | 例外の cause の code | 英字で始まる識別子（64文字まで）か整数 |
| `stack` | 例外の stack のうち、コードの位置の行 | `at` で始まる行を改行でつないだもの（10行まで） |
