// src/ に lint と型検査を止めるコメントがないか確かめ、見つかったら失敗する。
// oxlint のルールで検査しないのは、ファイル先頭の `oxlint-disable` がそのルール自体も止めてしまうからである。
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
const SRC = join(ROOT, 'src');
const DIRECTIVE = /(?:oxlint|eslint)-(?:disable|enable)|@ts-(?:ignore|expect-error|nocheck)/;

const found: string[] = [];
for (const entry of readdirSync(SRC, { recursive: true, encoding: 'utf8' })) {
	if (!/\.[cm]?[jt]s$/.test(entry)) continue;
	const path = join(SRC, entry);
	readFileSync(path, 'utf8')
		.split('\n')
		.forEach((line, index) => {
			if (DIRECTIVE.test(line)) found.push(`${relative(ROOT, path)}:${index + 1}: ${line.trim()}`);
		});
}

if (found.length > 0) {
	console.error('src/ では lint と型検査を止めるコメントを使えません。コメントを消し、指摘された箇所を直してください。');
	for (const line of found) console.error(line);
	process.exit(1);
}
