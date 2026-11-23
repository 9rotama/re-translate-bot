import { err, ok, type Result } from '../result';
import { toLanguageCode, type LanguageCode } from '../translation/languages';
import type { Route } from '../translation/relay';
import type { ChannelSettings } from './store';

export type RouteError =
	| { readonly kind: 'unsupported_language'; readonly codes: readonly string[] }
	| { readonly kind: 'repeated_language'; readonly route: Route };

const isSupported = (lang: LanguageCode | undefined): lang is LanguageCode => lang !== undefined;

// Route の型では隣り合う同じ言語を防げないので、relay() にはこの関数が返したルートだけを渡す。
export function toRoute(settings: ChannelSettings): Result<Route, RouteError> {
	const inputs = [settings.originLang, ...settings.relayLangs];
	const langs = inputs.map(toLanguageCode);
	// 対応していないコードがあると隣り合う組が決まらないので、続いているかどうかは調べない。
	if (!langs.every(isSupported)) {
		const codes = new Set(inputs.filter((_, index) => langs[index] === undefined).map((input) => input.toLowerCase()));
		return err({ kind: 'unsupported_language', codes: [...codes] });
	}

	const [origin, ...relayLangs] = langs;
	const route: Route = [origin, ...relayLangs, origin];
	const repeated = route.some((lang, index) => index > 0 && lang === route[index - 1]);
	return repeated ? err({ kind: 'repeated_language', route }) : ok(route);
}

export function formatRoute(route: Route): string {
	return route.join(' -> ');
}
