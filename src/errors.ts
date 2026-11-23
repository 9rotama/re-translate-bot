// Result の失敗側で使うエラーの種類。
// ハンドリングで分けたい粒度とログで見分けたい粒度を揃えるので、ここで別に定義せず log.ts のイベント定義から導く。
import type { LogEvent } from './log';

type FieldOf<E extends LogEvent['event'], K extends keyof Extract<LogEvent, { event: E }>> = Extract<LogEvent, { event: E }>[K];

export type TranslationStepErrorKind = FieldOf<'translation.step.failed', 'errorKind'>;
export type TranslationErrorKind = FieldOf<'translation.failed', 'errorKind'>;
export type FollowupErrorKind = FieldOf<'followup.failed', 'errorKind'>;
export type D1Operation = FieldOf<'d1.failed', 'operation'>;
