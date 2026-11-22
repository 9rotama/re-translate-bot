// 構造化ログの出力。
// 記録するイベントとフィールドは logEvents で定め、型と実行時の検査の両方をここから導く。
// docs/log-events.md は logEvents から生成するので、変えたら `pnpm run log-events` を実行する。

// 自由な文字列を受け付けないよう、文字列の値は下の関数を通したものだけを受け付ける型にする。
declare const brand: unique symbol;
type Branded<T, B extends string> = T & { readonly [brand]: B };
export type GuildId = Branded<string, 'GuildId'>;
export type ChannelId = Branded<string, 'ChannelId'>;
export type Identifier = Branded<string, 'Identifier'>;
export type StackFrames = Branded<string, 'StackFrames'>;
export type ErrorCode = Identifier | number;

type Optional = { readonly optional?: boolean };
type CountField = { readonly kind: 'count'; readonly description: string } & Optional;
type LangField = { readonly kind: 'lang'; readonly description: string } & Optional;
type EnumField = { readonly kind: 'enum'; readonly description: string; readonly values: Readonly<Record<string, string>> } & Optional;
type SnowflakeField = { readonly kind: 'snowflake'; readonly of: 'guild' | 'channel'; readonly description: string } & Optional;
type IdentifierField = { readonly kind: 'identifier'; readonly description: string } & Optional;
type CodeField = { readonly kind: 'code'; readonly description: string } & Optional;
type StackField = { readonly kind: 'stack'; readonly description: string } & Optional;
export type FieldSpec = CountField | LangField | EnumField | SnowflakeField | IdentifierField | CodeField | StackField;

export type EventSpec = {
	readonly level: 'log' | 'warn' | 'error';
	readonly description: string;
	readonly fields: Readonly<Record<string, FieldSpec>>;
};

const count = (description: string) => ({ kind: 'count', description }) as const;
const lang = (description: string) => ({ kind: 'lang', description }) as const;
const oneOf = <const V extends Record<string, string>>(description: string, values: V) => ({ kind: 'enum', description, values }) as const;
const optional = <const F extends FieldSpec>(field: F): F & { readonly optional: true } => ({ ...field, optional: true });

const placeFields = {
	guildId: optional({ kind: 'snowflake', of: 'guild', description: 'ギルド ID。分からないときは出さない' }),
	channelId: optional({ kind: 'snowflake', of: 'channel', description: 'チャンネル ID。分からないときは出さない' }),
} as const;

const errorFields = {
	errorName: optional({ kind: 'identifier', description: '例外の name' }),
	errorCode: optional({ kind: 'code', description: '例外の code' }),
	causeName: optional({ kind: 'identifier', description: '例外の cause の name' }),
	causeCode: optional({ kind: 'code', description: '例外の cause の code' }),
	stack: optional({ kind: 'stack', description: '例外の stack のうち、コードの位置の行' }),
} as const;

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
			...placeFields,
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
			...placeFields,
			...errorFields,
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
			...placeFields,
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
			...placeFields,
			...errorFields,
		},
	},
	'd1.failed': {
		level: 'error',
		description: 'D1 の読み書きに失敗した',
		fields: {
			// クエリの文字列は sql.raw などで入力が混ざりうるので出さず、どのクエリかを列挙で表す。
			operation: oneOf('失敗したクエリ', {
				'settings.read': 'チャンネルの設定の読み取り',
				'settings.upsert_relay': '中継言語の書き込み',
				'settings.upsert_origin': '原文の言語の書き込み',
			}),
			...placeFields,
			...errorFields,
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
			...placeFields,
			...errorFields,
		},
	},
} as const satisfies Record<string, EventSpec>;

type FieldValue<F> = F extends { kind: 'count' }
	? number
	: F extends { kind: 'lang' }
		? string
		: F extends { kind: 'enum'; values: infer V }
			? keyof V
			: F extends { kind: 'snowflake'; of: 'guild' }
				? GuildId
				: F extends { kind: 'snowflake'; of: 'channel' }
					? ChannelId
					: F extends { kind: 'identifier' }
						? Identifier
						: F extends { kind: 'code' }
							? ErrorCode
							: F extends { kind: 'stack' }
								? StackFrames
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
const SNOWFLAKE = /^\d{17,20}$/;
const IDENTIFIER = /^[A-Za-z][\w.-]{0,63}$/;
const STACK_FRAME = /^\s*at \S.{0,299}$/;
const MAX_STACK_FRAMES = 10;

const isCount = (value: unknown): value is number =>
	typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= MAX_COUNT;
const isSnowflake = (value: unknown): value is string => typeof value === 'string' && SNOWFLAKE.test(value);
const isGuildId = (value: unknown): value is GuildId => isSnowflake(value);
const isChannelId = (value: unknown): value is ChannelId => isSnowflake(value);
const isIdentifier = (value: unknown): value is Identifier => typeof value === 'string' && IDENTIFIER.test(value);
const isErrorCode = (value: unknown): value is ErrorCode =>
	isIdentifier(value) || (typeof value === 'number' && Number.isSafeInteger(value) && Math.abs(value) <= MAX_COUNT);

function isStackFrames(value: unknown): value is StackFrames {
	if (typeof value !== 'string') return false;
	const lines = value.split('\n');
	return lines.length <= MAX_STACK_FRAMES && lines.every((line) => STACK_FRAME.test(line));
}

function isValid(field: FieldSpec, value: unknown): boolean {
	switch (field.kind) {
		case 'count':
			return isCount(value);
		case 'lang':
			return typeof value === 'string' && LANG_CODE.test(value);
		case 'enum':
			return typeof value === 'string' && Object.hasOwn(field.values, value);
		case 'snowflake':
			return isSnowflake(value);
		case 'identifier':
			return isIdentifier(value);
		case 'code':
			return isErrorCode(value);
		default:
			return isStackFrames(value);
	}
}

export type Place = { guildId?: GuildId; channelId?: ChannelId };

// ユーザー ID も同じ形の文字列なので、ギルドとチャンネルの ID は Interaction の決まった項目からだけ取り出す。
export function interactionPlace(interaction: { readonly guild_id?: string; readonly channel?: { readonly id: string } }): Place {
	const place: Place = {};
	if (isGuildId(interaction.guild_id)) place.guildId = interaction.guild_id;
	if (isChannelId(interaction.channel?.id)) place.channelId = interaction.channel.id;
	return place;
}

export type ErrorDetails = {
	errorName?: Identifier;
	errorCode?: ErrorCode;
	causeName?: Identifier;
	causeCode?: ErrorCode;
	stack?: StackFrames;
};

// stack は先頭に「name: message」を含み、message は複数行で `at ` で始まる行も含みうる。
// 行の形だけで選ぶと message の行が紛れ込むので、先頭の部分を name と message から組み立てて正確に取り除く。
function stackFrames(error: Error): string | undefined {
	const header = error.message === '' ? error.name : `${error.name}: ${error.message}`;
	// 先頭が一致しないとき（stack を書き換えた、生成後に name や message を変えた）は、message の範囲が分からないので出さない。
	if (error.stack === undefined || !error.stack.startsWith(header)) return undefined;
	const lines = error.stack
		.slice(header.length)
		.split('\n')
		.filter((line) => line !== '');
	if (lines.length === 0 || !lines.every((line) => STACK_FRAME.test(line))) return undefined;
	return lines.slice(0, MAX_STACK_FRAMES).join('\n');
}

const codeOf = (value: unknown): unknown => (typeof value === 'object' && value !== null && 'code' in value ? value.code : undefined);

// message は入力の一部を含まない保証がないので、取り出さない。
export function errorDetails(error: unknown): ErrorDetails {
	const details: ErrorDetails = {};
	if (!(error instanceof Error)) return details;
	if (isIdentifier(error.name)) details.errorName = error.name;
	const errorCode = codeOf(error);
	if (isErrorCode(errorCode)) details.errorCode = errorCode;
	if (error.cause instanceof Error && isIdentifier(error.cause.name)) details.causeName = error.cause.name;
	const causeCode = codeOf(error.cause);
	if (isErrorCode(causeCode)) details.causeCode = causeCode;
	const frames = stackFrames(error);
	if (isStackFrames(frames)) details.stack = frames;
	return details;
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
