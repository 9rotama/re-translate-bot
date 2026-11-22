// Discord から Interaction を受け取る fetch handler。
// 署名の検証と Interaction の type による振り分けは後続の Issue で実装する。
export default {
	fetch(request): Response {
		if (request.method !== 'POST') {
			return new Response(null, { status: 405, headers: { Allow: 'POST' } });
		}
		return new Response(null, { status: 501 });
	},
} satisfies ExportedHandler<Env>;
