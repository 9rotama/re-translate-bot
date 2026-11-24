# 無駄翻訳bot

![Frame 2](https://user-images.githubusercontent.com/65887771/171993445-42c0909b-fd47-4283-b719-16b94dd7838c.png)

Discordで送った文章を、いくつもの言語を経由して再翻訳するbot

## 招待

以下のURLから招待してください。

https://discord.com/api/oauth2/authorize?client_id=981977773277061210&scope=bot%20applications.commands

以前から招待しているサーバーでコマンドが表示されないときは、同じURLから招待し直してください。

※開発中のためサーバの招待・使用におけるトラブルは自己責任でお願いします

## 機能

- 最大で10ヶ国語の中継言語を設定
- 翻訳元の言語を設定

設定はチャンネルごとに保存されます。

## 使い方

| コマンド | 説明 |
| --- | --- |
| `/rt [文章]` | 文章を再翻訳して表示 |
| `/settings show` | このチャンネルの中継ルートを表示 |
| `/settings relay [言語コード]` | 中継する言語を設定（空白区切りで10ヶ国語まで） |
| `/settings origin [言語コード]` | 原文で使用する言語を設定 |
| `/help` | 使い方を表示 |

使える言語コードは [m2m100 の対応言語](https://huggingface.co/facebook/m2m100_1.2B) です。

## 使ったもの

- Cloudflare Workers
- Workers AI（m2m100-1.2b）
- Cloudflare D1
