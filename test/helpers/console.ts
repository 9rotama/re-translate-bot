// ログの出力を確かめるために console の各レベルを spy し、出力は捨てる。
import { afterEach, beforeEach, vi, type MockInstance } from 'vitest';

export type ConsoleSpies = Record<'log' | 'warn' | 'error', MockInstance>;

// Workers の実行環境では console.log などを読むたびに別の関数が返るので、spy は戻り値の参照で確かめる。
export function spyConsole(): ConsoleSpies {
	// 中身は beforeEach で差し替える。
	const spies: ConsoleSpies = { log: vi.fn<() => void>(), warn: vi.fn<() => void>(), error: vi.fn<() => void>() };
	beforeEach(() => {
		spies.log = vi.spyOn(console, 'log').mockImplementation(() => {});
		spies.warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		spies.error = vi.spyOn(console, 'error').mockImplementation(() => {});
	});
	afterEach(() => {
		vi.restoreAllMocks();
	});
	return spies;
}
