// 構造化ログの出力。
// 記録するイベントとフィールドは logEvents で定め、型と実行時の検査の両方をここから導く。
// docs/log-events.md は logEvents から生成するので、変えたら `pnpm run log-events` を実行する。

type CountField = { readonly kind: 'count'; readonly description: string; readonly optional?: boolean };
type LangField = { readonly kind: 'lang'; readonly description: string; readonly optional?: boolean };
type EnumField = {
	readonly kind: 'enum';
	readonly description: string;
	readonly values: Readonly<Record<string, string>>;
	readonly optional?: boolean;
};
export type FieldSpec = CountField | LangField | EnumField;

export type EventSpec = {
	readonly level: 'log' | 'warn' | 'error';
	readonly description: string;
	readonly fields: Readonly<Record<string, FieldSpec>>;
};

const count = (description: string) => ({ kind: 'count', description }) as const;
const lang = (description: string) => ({ kind: 'lang', description }) as const;
const oneOf = <const V extends Record<string, string>>(description: string, values: V) => ({ kind: 'enum', description, values }) as const;
const optional = <const F extends FieldSpec>(field: F): F & { readonly optional: true } => ({ ...field, optional: true });

const stepErrorKinds = {
	quota_exceeded: '無料枠の使い切り',
	timeout: '時間切れ',
	ai_error: 'それ以外の Workers AI の失敗',
} as const;

export const logEvents = {
	'interaction.received': {
		level: 'log',
		description: 'Interaction を受け取った',
		fields: {
			interactionType: count('Interaction の type（discord-api-types の InteractionType）'),
			command: optional(
				oneOf('コマンド名。コマンド以外の Interaction では出さない', {
					rt: '/rt',
					'settings show': '/settings show',
					'settings relay': '/settings relay',
					'settings origin': '/settings origin',
					help: '/help',
				}),
			),
		},
	},
	'signature.rejected': {
		level: 'warn',
		description: '署名を検証できないリクエストを拒んだ',
		fields: {
			reason: oneOf('拒んだ理由', {
				missing_header: '署名のヘッダがない',
				invalid_signature: '署名の検証に失敗した',
			}),
		},
	},
	'rt.rate_limited': {
		level: 'log',
		description: '/rt をレート制限で断った',
		fields: {},
	},
	'translation.step.succeeded': {
		level: 'log',
		description: '翻訳の1段が成功した',
		fields: {
			step: count('何段目か（1から数える）'),
			steps: count('全体の段数'),
			attempt: count('その段の何回目の試行か（1から数える）'),
			from: lang('翻訳元の言語'),
			to: lang('翻訳先の言語'),
			inputLength: count('翻訳前の文字数'),
			outputLength: count('翻訳後の文字数'),
			durationMs: count('所要時間（ミリ秒）'),
		},
	},
	'translation.step.failed': {
		level: 'warn',
		description: '翻訳の1段が失敗した。再試行した段は試行ごとに出す',
		fields: {
			step: count('何段目か（1から数える）'),
			steps: count('全体の段数'),
			attempt: count('その段の何回目の試行か（1から数える）'),
			from: lang('翻訳元の言語'),
			to: lang('翻訳先の言語'),
			inputLength: count('翻訳前の文字数'),
			durationMs: count('所要時間（ミリ秒）'),
			errorKind: oneOf('エラーの種類', stepErrorKinds),
			status: optional(count('Workers AI が返した HTTP の status。分からないときは出さない')),
		},
	},
	'translation.succeeded': {
		level: 'log',
		description: '翻訳全体が成功した',
		fields: {
			steps: count('全体の段数'),
			inputLength: count('翻訳前の文字数'),
			outputLength: count('翻訳後の文字数'),
			durationMs: count('所要時間（ミリ秒）'),
		},
	},
	'translation.failed': {
		level: 'error',
		description: '翻訳全体が失敗し、利用者にエラーを表示した',
		fields: {
			steps: count('全体の段数'),
			completedSteps: count('失敗までに終わった段数'),
			inputLength: count('翻訳前の文字数'),
			durationMs: count('所要時間（ミリ秒）'),
			errorKind: oneOf('エラーの種類', { ...stepErrorKinds, settings_unavailable: '設定を読めなかった' }),
		},
	},
	'followup.failed': {
		level: 'error',
		description: '遅延応答の後に元のメッセージを編集できなかった',
		fields: {
			errorKind: oneOf('エラーの種類', {
				http_error: 'Discord が失敗の status を返した',
				network_error: '応答を受け取れなかった',
			}),
			status: optional(count('Discord が返した HTTP の status。http_error のときだけ出す')),
		},
	},
	'd1.failed': {
		level: 'error',
		description: 'D1 の読み書きに失敗した',
		fields: {
			operation: oneOf('失敗した操作', {
				'settings.read': '設定の読み取り',
				'settings.write': '設定の書き込み',
			}),
		},
	},
	unhandled_error: {
		level: 'error',
		description: '想定していない例外を最も外側で捕まえた',
		fields: {
			where: oneOf('捕まえた場所', {
				fetch: 'fetch handler',
				wait_until: 'waitUntil に渡した処理',
			}),
		},
	},
} as const satisfies Record<string, EventSpec>;

type FieldValue<F> = F extends { kind: 'count' }
	? number
	: F extends { kind: 'lang' }
		? string
		: F extends { values: infer V }
			? keyof V
			: never;

type Fields<S> = {
	-readonly [K in keyof S as S[K] extends { optional: true } ? never : K]: FieldValue<S[K]>;
} & {
	-readonly [K in keyof S as S[K] extends { optional: true } ? K : never]?: FieldValue<S[K]>;
};

type LogEvents = typeof logEvents;
export type LogEventName = keyof LogEvents;
export type LogEvent = { [E in LogEventName]: { event: E } & Fields<LogEvents[E]['fields']> }[LogEventName];

// 数のフィールドに ID（snowflake）が数として紛れ込んでも出力しないよう、上限を小さく取る。
const MAX_COUNT = 2 ** 31 - 1;
const LANG_CODE = /^[a-z]{2,3}$/;

function isValid(field: FieldSpec, value: unknown): boolean {
	if (field.kind === 'count') {
		return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= MAX_COUNT;
	}
	if (typeof value !== 'string') return false;
	return field.kind === 'lang' ? LANG_CODE.test(value) : Object.hasOwn(field.values, value);
}

function isEventName(name: string): name is LogEventName {
	return Object.hasOwn(logEvents, name);
}

export function log(entry: LogEvent): void {
	const name: string = entry.event;
	if (!isEventName(name)) {
		// 渡された名前は自由な文字列なので出力しない。
		console.error({ event: 'unknown_event' });
		return;
	}
	const spec: EventSpec = logEvents[name];
	const values = entry as Readonly<Record<string, unknown>>;
	const output: Record<string, unknown> = { event: name };
	const invalid: string[] = [];
	for (const [field, fieldSpec] of Object.entries(spec.fields)) {
		const value = values[field];
		if (value === undefined) {
			if (fieldSpec.optional !== true) invalid.push(field);
			continue;
		}
		if (isValid(fieldSpec, value)) {
			output[field] = value;
		} else {
			invalid.push(field);
		}
	}
	if (invalid.length > 0) output.invalid = invalid;
	console[spec.level](output);
}
