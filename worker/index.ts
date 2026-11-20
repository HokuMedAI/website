// Worker の入口。お問い合わせフォームの送信 (POST /api/contact) だけを処理して、Discord の Webhook へ流す。
// それ以外のリクエストは static assets (dist/) に任せる。設定は wrangler.jsonc。
//
// ここは配線だけ。入力の検証・整形・Discord 向けの payload は contact.ts (純粋な関数)。
// **入力値 (名前・メール・本文) と Webhook の URL は、ログにも応答にも出さない。** ログに書くのは状況と状態コードだけ
import {
	HONEYPOT_FIELD,
	MAX_BODY_BYTES,
	TURNSTILE_ACTION,
	buildDiscordPayload,
	isHoneypotFilled,
	isRecord,
	isTurnstileSuccess,
	isTurnstileToken,
	validateContact,
} from './contact.ts'
import type { ErrorCode, FieldErrors } from './contact.ts'

const CONTACT_PATH = '/api/contact'
const TURNSTILE_SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify'
/** 外部 (Discord・Turnstile) の応答を待つ上限 */
const UPSTREAM_TIMEOUT_MS = 10_000

function json(status: number, body: object, headers: Record<string, string> = {}): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: {
			'Content-Type': 'application/json; charset=utf-8',
			'Cache-Control': 'no-store',
			...headers,
		},
	})
}

function fail(
	status: number,
	error: ErrorCode,
	extra: { fields?: FieldErrors; headers?: Record<string, string> } = {}
): Response {
	return json(
		status,
		extra.fields ? { ok: false, error, fields: extra.fields } : { ok: false, error },
		extra.headers
	)
}

/** ログは構造化した JSON で、状況だけを書く (入力値を渡さない) */
function logError(message: string, detail: Record<string, string | number> = {}): void {
	console.error(JSON.stringify({ message, ...detail }))
}

/**
 * 本文を上限つきで読む。上限を超えたら null。
 * Content-Length は無い・偽ることがあるので、申告の値を見たうえで、実際に読んだ量でも打ち切る
 */
async function readBody(request: Request, maxBytes: number): Promise<string | null> {
	const declared = Number(request.headers.get('Content-Length') ?? '0')
	if (declared > maxBytes) return null
	if (!request.body) return ''

	const reader = request.body.getReader()
	const decoder = new TextDecoder()
	let text = ''
	let total = 0
	for (;;) {
		const { done, value } = await reader.read()
		if (done) break
		total += value.byteLength
		if (total > maxBytes) {
			await reader.cancel()
			return null
		}
		text += decoder.decode(value, { stream: true })
	}
	return text + decoder.decode()
}

/** Turnstile のトークンを Cloudflare の siteverify で検証する。確かめられなければ通さない (fail closed) */
async function verifyTurnstile(
	secret: string,
	token: string,
	ip: string | null,
	hostname: string
): Promise<boolean> {
	const body = new URLSearchParams({ secret, response: token })
	if (ip) body.set('remoteip', ip)
	try {
		const response = await fetch(TURNSTILE_SITEVERIFY_URL, {
			method: 'POST',
			headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
			body,
			signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
		})
		if (!response.ok) {
			logError('contact: turnstile siteverify returned non-2xx', { status: response.status })
			return false
		}
		return isTurnstileSuccess(await response.json(), { hostname, action: TURNSTILE_ACTION })
	} catch {
		logError('contact: turnstile siteverify failed')
		return false
	}
}

/** Discord の Webhook へ送る。2xx が返れば true。Discord 側の応答本文は読まない・返さない */
async function sendToDiscord(webhookUrl: string, payload: object): Promise<boolean> {
	try {
		const response = await fetch(webhookUrl, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(payload),
			signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
		})
		await response.body?.cancel()
		if (!response.ok) {
			logError('contact: discord webhook returned non-2xx', { status: response.status })
			return false
		}
		return true
	} catch {
		// 例外の文言には送り先の URL が入りうるので、ログに出さない
		logError('contact: discord webhook request failed')
		return false
	}
}

async function handleContact(request: Request, env: Env, url: URL): Promise<Response> {
	// 1. 同一オリジンの検査。ほかのサイトに置いたフォームやスクリプトからの送信を通さない
	if (request.headers.get('Origin') !== url.origin) return fail(403, 'forbidden')

	// Webhook が未設定なら受け付けていない。入力を見る前に返す (直させてから断らない)。
	// secret は、生成した型 (worker-configuration.d.ts) では string だが、入れていなければ実行時は undefined
	const webhookUrl = env.DISCORD_WEBHOOK_URL
	if (!webhookUrl) return fail(503, 'unavailable')

	// 2. レート制限。送信元 IP ごと。数え方はおおよそなので、迷惑送信をならす程度の備え。
	// 制限の仕組みが落ちているときは通す (問い合わせを受けられる方を優先する)
	const ip = request.headers.get('CF-Connecting-IP')
	try {
		const { success } = await env.CONTACT_RATE_LIMITER.limit({ key: ip ?? 'unknown' })
		if (!success) return fail(429, 'rate_limited', { headers: { 'Retry-After': '60' } })
	} catch {
		logError('contact: rate limiter failed')
	}

	// 本文は JSON だけ。大きすぎるものは読み切らずに断る
	const contentType = request.headers.get('Content-Type') ?? ''
	if (!/^application\/json\b/i.test(contentType)) return fail(415, 'invalid_input')
	const text = await readBody(request, MAX_BODY_BYTES)
	if (text === null) return fail(413, 'too_large')

	let body: unknown
	try {
		body = JSON.parse(text)
	} catch {
		// JSON.parse の例外の文言には本文の一部が入るので、ログに出さない
		return fail(400, 'invalid_input')
	}
	if (!isRecord(body)) return fail(400, 'invalid_input')

	// 3. ハニーポット。人には見えない項目が埋まっていたら機械的な送信。
	// 成功したように見せて (再試行や作り直しを誘わない)、Discord には流さない
	if (isHoneypotFilled(body)) {
		console.log(JSON.stringify({ message: 'contact: honeypot filled', field: HONEYPOT_FIELD }))
		return json(200, { ok: true })
	}

	const result = validateContact(body)
	if (!result.ok) return fail(400, 'invalid_input', { fields: result.fields })

	// 4. Turnstile。secret が設定されているときだけ検証する
	const turnstileSecret = env.TURNSTILE_SECRET_KEY
	if (turnstileSecret) {
		const token = body.turnstileToken
		if (!isTurnstileToken(token)) return fail(403, 'forbidden')
		if (!(await verifyTurnstile(turnstileSecret, token, ip, url.hostname))) {
			return fail(403, 'forbidden')
		}
	}

	const sent = await sendToDiscord(webhookUrl, buildDiscordPayload(result.value, new Date()))
	if (!sent) return fail(502, 'upstream_failed')

	return json(200, { ok: true })
}

export default {
	async fetch(request, env): Promise<Response> {
		const url = new URL(request.url)

		// /api/ 配下以外は static assets へ。wrangler.jsonc の run_worker_first で、アセットより先にここへ来るのは
		// /api/ 配下だけ。ほかは「アセットに当たらなかったリクエスト」が来るので、assets 側の 404 ページの処理に渡す
		if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(request)

		if (url.pathname !== CONTACT_PATH) return fail(404, 'not_found')
		if (request.method !== 'POST') {
			return fail(405, 'method_not_allowed', { headers: { Allow: 'POST' } })
		}

		try {
			return await handleContact(request, env, url)
		} catch (error) {
			// 例外の文言は出さない (入力の一部が入りうる)。種類だけを残す
			logError('contact: unhandled error', {
				error: error instanceof Error ? error.name : 'unknown',
			})
			return fail(500, 'internal')
		}
	},
} satisfies ExportedHandler<Env>
