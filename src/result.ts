// 想定できる失敗を throw せずに返すための型。
// 例外を捕まえて自前のエラーのデータに変えるのは、外部（Workers AI、D1、fetch）を呼ぶ境界だけにする。
// map などの合成のメソッドは、判別だけで足りるので持たせない。
export type Result<T, E> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: E };

export const ok = <T>(value: T): Result<T, never> => ({ ok: true, value });
export const err = <E>(error: E): Result<never, E> => ({ ok: false, error });
