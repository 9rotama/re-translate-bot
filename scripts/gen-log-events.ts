// src/log.ts の logEvents から docs/log-events.md を生成する。
// --check を付けると書き込まず、生成結果とファイルが食い違っていたら失敗する。
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { logEvents, type EventSpec, type FieldSpec } from '../src/log.ts';

const OUTPUT = join(import.meta.dirname, '../docs/log-events.md');

function describeValues(field: FieldSpec): string {
	if (field.kind === 'count') return '0以上の整数';
	if (field.kind === 'lang') return '言語コード（例: `ja`）';
	return Object.entries(field.values)
		.map(([value, meaning]) => `\`${value}\`：${meaning}`)
		.join('<br>');
}

function renderEvent(name: string, spec: EventSpec): string[] {
	const lines = [`## \`${name}\``, '', `${spec.description}。レベルは \`${spec.level}\`。`, ''];
	const fields = Object.entries(spec.fields);
	if (fields.length === 0) {
		lines.push('`event` 以外の値は持たない。', '');
		return lines;
	}
	lines.push('| 値 | 意味 | 取りうる値 |', '| --- | --- | --- |');
	for (const [field, fieldSpec] of fields) {
		lines.push(`| \`${field}\` | ${fieldSpec.description} | ${describeValues(fieldSpec)} |`);
	}
	lines.push('');
	return lines;
}

function render(): string {
	const events: [string, EventSpec][] = Object.entries(logEvents);
	const lines = [
		'# ログのイベント一覧',
		'',
		'<!-- このファイルは scripts/gen-log-events.ts で src/log.ts から生成する。手で編集せず、`pnpm run log-events` で作り直す。 -->',
		'',
		'記録の方針は[ログ設計](./logging.md)で定める。',
		'どのイベントもイベント名を `event` に持つ。',
		'値がないか検査を通らなかったときは、その値を出さずにフィールド名を `invalid` に並べる。',
		'存在しないイベント名を渡したときは、`unknown_event` を `error` で出す。',
		'',
		'| イベント | レベル | 内容 |',
		'| --- | --- | --- |',
		...events.map(([name, spec]) => `| \`${name}\` | \`${spec.level}\` | ${spec.description} |`),
		'',
		...events.flatMap(([name, spec]) => renderEvent(name, spec)),
	];
	return `${lines.join('\n').trimEnd()}\n`;
}

const generated = render();
if (process.argv.includes('--check')) {
	let current = '';
	try {
		current = readFileSync(OUTPUT, 'utf8');
	} catch {
		// ファイルがないときも食い違いとして扱う。
	}
	if (current !== generated) {
		console.error('docs/log-events.md が src/log.ts と食い違っています。`pnpm run log-events` で作り直してください。');
		process.exit(1);
	}
} else {
	writeFileSync(OUTPUT, generated);
}
