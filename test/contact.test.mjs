// お問い合わせフォームの Worker (worker/) のテスト。
// contact.ts の純粋な関数と、index.ts の fetch ハンドラを偽の env で直接呼ぶ。
// ネットワークには出ない: globalThis.fetch を差し替えて、外へ出ようとした呼び出しを記録する
import assert from 'node:assert/strict'
import { afterEach, beforeEach, describe, it } from 'node:test'
import {
	FIELD_LIMITS,
	MAX_BODY_BYTES,
	TURNSTILE_ACTION,
	buildDiscordPayload,
	isHoneypotFilled,
	isTurnstileSuccess,
	isTurnstileToken,
	truncate,
	validateContact,
} from '../worker/contact.ts'
import worker from '../worker/index.ts'

const VALID = {
	name: '北大 花子',
	email: 'hanako@example.com',
	affiliation: '医学部医学科 2 年',
	message: '見学したいです。\n次の活動日を教えてください。',
}

describe('validateContact', () => {
	it('正しい入力は整えた値で通る', () => {
		const result = validateContact({ ...VALID, name: '  北大\t花子 \n', message: ' a\r\nb ' })
		assert.deepEqual(result, {
			ok: true,
			value: { ...VALID, name: '北大 花子', message: 'a\nb' },
		})
	})

	it('所属は任意 (無くても空でも通り、空文字になる)', () => {
		const { affiliation: _, ...rest } = VALID
		assert.equal(validateContact(rest).value.affiliation, '')
		assert.equal(validateContact({ ...VALID, affiliation: '   ' }).value.affiliation, '')
	})

	it('必須の項目が無い・空・空白だけなら required', () => {
		assert.deepEqual(validateContact({}), {
			ok: false,
			fields: { name: 'required', email: 'required', message: 'required' },
		})
		assert.deepEqual(validateContact({ ...VALID, name: '', message: ' \n ' }).fields, {
			name: 'required',
			message: 'required',
		})
		assert.deepEqual(validateContact({ ...VALID, email: null }).fields, { email: 'required' })
	})

	it('文字列でない値は invalid', () => {
		assert.deepEqual(
			validateContact({ ...VALID, name: 1, affiliation: ['x'], message: { a: 1 } }).fields,
			{ name: 'invalid', affiliation: 'invalid', message: 'invalid' }
		)
	})

	it('上限ちょうどは通り、1 文字超えると too_long', () => {
		for (const [field, max] of Object.entries(FIELD_LIMITS)) {
			if (field === 'email') continue
			assert.equal(validateContact({ ...VALID, [field]: 'あ'.repeat(max) }).ok, true, field)
			assert.deepEqual(
				validateContact({ ...VALID, [field]: 'あ'.repeat(max + 1) }).fields,
				{ [field]: 'too_long' },
				field
			)
		}
		const domain = '@example.com'
		const local = 'a'.repeat(FIELD_LIMITS.email - domain.length)
		assert.equal(validateContact({ ...VALID, email: local + domain }).ok, true)
		assert.deepEqual(validateContact({ ...VALID, email: `a${local}${domain}` }).fields, {
			email: 'too_long',
		})
	})

	it('文字数は絵文字を 1 文字と数える (ブラウザの maxlength より厳しくしない)', () => {
		assert.equal(validateContact({ ...VALID, name: '😀'.repeat(FIELD_LIMITS.name) }).ok, true)
	})

	it('メールアドレスの形式を軽く検査する', () => {
		for (const email of ['a@b.co', 'first.last+tag@sub.example.ac.jp']) {
			assert.equal(validateContact({ ...VALID, email }).ok, true, email)
		}
		for (const email of ['hanako', 'hanako@', '@example.com', 'a@b', 'a b@example.com', 'a@@b.c']) {
			assert.deepEqual(validateContact({ ...VALID, email }).fields, { email: 'invalid' }, email)
		}
	})

	it('1 行の項目の改行は空白になる (embed の field に改行を持ち込まない)', () => {
		assert.equal(validateContact({ ...VALID, name: 'a\nb\r\nc' }).value.name, 'a b c')
	})

	it('制御文字は落とす', () => {
		assert.equal(
			validateContact({ ...VALID, message: 'a\u0000b\u001bc\td' }).value.message,
			'abc\td'
		)
	})
})

describe('isHoneypotFilled', () => {
	it('無い・空・空白だけなら false、値があれば true', () => {
		assert.equal(isHoneypotFilled({}), false)
		assert.equal(isHoneypotFilled({ website: '' }), false)
		assert.equal(isHoneypotFilled({ website: '  ' }), false)
		assert.equal(isHoneypotFilled({ website: null }), false)
		assert.equal(isHoneypotFilled({ website: 'https://spam.example' }), true)
		assert.equal(isHoneypotFilled({ website: 1 }), true)
	})
})

describe('truncate', () => {
	it('上限以内はそのまま、超えたら末尾を … にして上限に収める', () => {
		assert.equal(truncate('abc', 3), 'abc')
		assert.equal(truncate('abcd', 3), 'ab…')
		assert.equal(truncate('あ'.repeat(5000), 4096).length, 4096)
	})

	it('サロゲートペアの途中で切らない', () => {
		const out = truncate('😀😀😀', 4)
		assert.equal(out, '😀…')
		assert.ok(out.length <= 4)
	})
})

describe('buildDiscordPayload', () => {
	const now = new Date('2026-11-20T03:04:05.000Z')

	it('embed 1 つに、タイトル・内容・名前・メール・所属・時刻をまとめる', () => {
		assert.deepEqual(buildDiscordPayload(VALID, now), {
			embeds: [
				{
					title: 'お問い合わせ',
					description: VALID.message,
					fields: [
						{ name: 'お名前', value: VALID.name, inline: true },
						{ name: 'メールアドレス', value: VALID.email, inline: true },
						{ name: '所属・学年など', value: VALID.affiliation, inline: true },
					],
					timestamp: '2026-11-20T03:04:05.000Z',
				},
			],
			allowed_mentions: { parse: [] },
		})
	})

	it('所属が空なら「（未記入）」を入れる (field の value は空にできない)', () => {
		const payload = buildDiscordPayload({ ...VALID, affiliation: '' }, now)
		assert.equal(payload.embeds[0].fields[2].value, '（未記入）')
	})

	it('@everyone やメンション・Markdown は書かれたまま載せ、メンションは解釈させない', () => {
		const hostile = {
			name: '@everyone <@&123456> **太字**',
			email: 'a_b*c@example.com',
			affiliation: '<@123456789> [リンク](https://example.com)',
			message: '@here @everyone\n```\ncode\n```\n> 引用 ||伏せ字|| <#123>',
		}
		const result = validateContact(hostile)
		assert.equal(result.ok, true)
		const payload = buildDiscordPayload(result.value, now)
		const [embed] = payload.embeds
		assert.equal(embed.description, hostile.message)
		assert.deepEqual(
			embed.fields.map((f) => f.value),
			[hostile.name, hostile.email, hostile.affiliation]
		)
		// メンションの通知を止めるのは allowed_mentions。parse が空 = どの種類のメンションも解釈しない
		assert.deepEqual(payload.allowed_mentions, { parse: [] })
		// 通知が飛ぶ content には何も載せない
		assert.equal('content' in payload, false)
	})

	it('Discord の上限 (description 4096・field の value 1024) に切り詰める', () => {
		const payload = buildDiscordPayload(
			{
				name: 'n'.repeat(3000),
				email: 'e'.repeat(3000),
				affiliation: '',
				message: 'm'.repeat(9000),
			},
			now
		)
		const [embed] = payload.embeds
		assert.equal(embed.description.length, 4096)
		assert.ok(embed.description.endsWith('…'))
		assert.equal(embed.fields[0].value.length, 1024)
		assert.equal(embed.fields[1].value.length, 1024)
	})
})

describe('Turnstile の判定', () => {
	const expected = { hostname: 'aiken.example', action: TURNSTILE_ACTION }

	it('トークンは空でない 2048 文字までの文字列', () => {
		assert.equal(isTurnstileToken('x'), true)
		assert.equal(isTurnstileToken('x'.repeat(2048)), true)
		assert.equal(isTurnstileToken('x'.repeat(2049)), false)
		assert.equal(isTurnstileToken(''), false)
		assert.equal(isTurnstileToken(undefined), false)
		assert.equal(isTurnstileToken(1), false)
	})

	it('success に加えて hostname と action が合っているときだけ通す', () => {
		const ok = { success: true, hostname: 'aiken.example', action: TURNSTILE_ACTION }
		assert.equal(isTurnstileSuccess(ok, expected), true)
		assert.equal(isTurnstileSuccess({ ...ok, success: false }, expected), false)
		assert.equal(isTurnstileSuccess({ ...ok, success: 'true' }, expected), false)
		assert.equal(isTurnstileSuccess({ ...ok, hostname: 'evil.example' }, expected), false)
		assert.equal(isTurnstileSuccess({ ...ok, action: 'login' }, expected), false)
		assert.equal(isTurnstileSuccess(null, expected), false)
		assert.equal(isTurnstileSuccess('ok', expected), false)
	})

	it('Cloudflare の試験用の鍵の応答 (hostname が example.com、action が無い) は通さない', () => {
		const testing = {
			success: true,
			'error-codes': [],
			challenge_ts: '2026-11-20T05:58:13.885Z',
			hostname: 'example.com',
			metadata: { result_with_testing_key: true },
		}
		assert.equal(isTurnstileSuccess(testing, expected), false)
	})
})

describe('fetch ハンドラ', () => {
	const ORIGIN = 'https://aiken.example'
	const WEBHOOK = 'https://discord.invalid/api/webhooks/0/dummy'
	const SITEVERIFY = 'https://challenges.cloudflare.com/turnstile/v0/siteverify'

	const realFetch = globalThis.fetch
	/** 外へ出ようとした呼び出し */
	let outbound
	/** 差し替えた fetch の応答。URL ごとに決める */
	let respond

	beforeEach(() => {
		outbound = []
		respond = () => new Response(null, { status: 204 })
		globalThis.fetch = async (input, init) => {
			const call = { url: String(input), init }
			outbound.push(call)
			return respond(call)
		}
	})

	afterEach(() => {
		globalThis.fetch = realFetch
	})

	/** 偽の env。ASSETS は呼ばれたことを記録するだけ、レート制限は差し替えられる */
	function makeEnv(overrides = {}) {
		const env = {
			assetCalls: [],
			limitCalls: [],
			ASSETS: {
				fetch: async (request) => {
					env.assetCalls.push(request)
					return new Response('asset', { status: 200 })
				},
			},
			CONTACT_RATE_LIMITER: {
				limit: async (options) => {
					env.limitCalls.push(options)
					return { success: true }
				},
			},
			DISCORD_WEBHOOK_URL: WEBHOOK,
			...overrides,
		}
		return env
	}

	function post(body, { headers = {}, path = '/api/contact' } = {}) {
		return new Request(`${ORIGIN}${path}`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				Origin: ORIGIN,
				'CF-Connecting-IP': '203.0.113.7',
				...headers,
			},
			body: typeof body === 'string' ? body : JSON.stringify(body),
		})
	}

	it('正常系: Discord へ 1 回 POST され、本文に入力が入っている', async () => {
		const env = makeEnv()
		const response = await worker.fetch(post({ ...VALID, website: '' }), env)

		assert.equal(response.status, 200)
		assert.match(response.headers.get('Content-Type'), /^application\/json/)
		assert.deepEqual(await response.json(), { ok: true })

		assert.equal(outbound.length, 1)
		const [call] = outbound
		assert.equal(call.url, WEBHOOK)
		assert.equal(call.init.method, 'POST')
		assert.equal(call.init.headers['Content-Type'], 'application/json')
		const sent = JSON.parse(call.init.body)
		assert.deepEqual(sent.allowed_mentions, { parse: [] })
		assert.equal(sent.embeds.length, 1)
		assert.equal(sent.embeds[0].title, 'お問い合わせ')
		assert.equal(sent.embeds[0].description, VALID.message)
		assert.deepEqual(
			sent.embeds[0].fields.map((f) => f.value),
			[VALID.name, VALID.email, VALID.affiliation]
		)
		assert.ok(!Number.isNaN(Date.parse(sent.embeds[0].timestamp)))

		assert.equal(env.assetCalls.length, 0)
		assert.deepEqual(env.limitCalls, [{ key: '203.0.113.7' }])
	})

	it('Origin が違う・無い POST は 403 (Discord へ送らない)', async () => {
		for (const headers of [{ Origin: 'https://evil.example' }, { Origin: 'null' }]) {
			const response = await worker.fetch(post(VALID, { headers }), makeEnv())
			assert.equal(response.status, 403)
			assert.deepEqual(await response.json(), { ok: false, error: 'forbidden' })
		}
		const request = post(VALID)
		request.headers.delete('Origin')
		assert.equal((await worker.fetch(request, makeEnv())).status, 403)
		assert.equal(outbound.length, 0)
	})

	it('ハニーポットに値があれば 200 を返すが、Discord へは送らない', async () => {
		const response = await worker.fetch(
			post({ ...VALID, website: 'https://spam.example' }),
			makeEnv()
		)
		assert.equal(response.status, 200)
		assert.deepEqual(await response.json(), { ok: true })
		assert.equal(outbound.length, 0)
	})

	it('Webhook が未設定なら 503', async () => {
		for (const DISCORD_WEBHOOK_URL of [undefined, '']) {
			const response = await worker.fetch(post(VALID), makeEnv({ DISCORD_WEBHOOK_URL }))
			assert.equal(response.status, 503)
			assert.deepEqual(await response.json(), { ok: false, error: 'unavailable' })
		}
		assert.equal(outbound.length, 0)
	})

	it('Webhook が 500 を返したら 502 (Discord の応答本文も Webhook の URL も返さない)', async () => {
		respond = () => new Response('{"message":"discord internal detail"}', { status: 500 })
		const response = await worker.fetch(post(VALID), makeEnv())
		assert.equal(response.status, 502)
		const text = await response.text()
		assert.deepEqual(JSON.parse(text), { ok: false, error: 'upstream_failed' })
		assert.ok(!text.includes('discord internal detail'))
		assert.ok(!text.includes('discord.invalid'))
		assert.equal(outbound.length, 1)
	})

	it('Webhook への接続が失敗しても 502', async () => {
		respond = () => {
			throw new TypeError(`fetch failed: ${WEBHOOK}`)
		}
		const response = await worker.fetch(post(VALID), makeEnv())
		assert.equal(response.status, 502)
		assert.deepEqual(await response.json(), { ok: false, error: 'upstream_failed' })
	})

	it('レート制限を超えたら 429 (Discord へ送らない)', async () => {
		const env = makeEnv({ CONTACT_RATE_LIMITER: { limit: async () => ({ success: false }) } })
		const response = await worker.fetch(post(VALID), env)
		assert.equal(response.status, 429)
		assert.equal(response.headers.get('Retry-After'), '60')
		assert.deepEqual(await response.json(), { ok: false, error: 'rate_limited' })
		assert.equal(outbound.length, 0)
	})

	it('レート制限の仕組みが例外を出しても、送信は通す', async () => {
		const env = makeEnv({
			CONTACT_RATE_LIMITER: {
				limit: async () => {
					throw new Error('rate limiter down')
				},
			},
		})
		assert.equal((await worker.fetch(post(VALID), env)).status, 200)
		assert.equal(outbound.length, 1)
	})

	it('入力の不備は 400 で、どの項目かを fields で返す (Discord へ送らない)', async () => {
		const response = await worker.fetch(
			post({ name: '', email: 'not-an-email', message: 'x'.repeat(2001) }),
			makeEnv()
		)
		assert.equal(response.status, 400)
		assert.deepEqual(await response.json(), {
			ok: false,
			error: 'invalid_input',
			fields: { name: 'required', email: 'invalid', message: 'too_long' },
		})
		assert.equal(outbound.length, 0)
	})

	it('JSON でない本文・Content-Type は invalid_input', async () => {
		const broken = await worker.fetch(post('{"name":'), makeEnv())
		assert.equal(broken.status, 400)
		assert.deepEqual(await broken.json(), { ok: false, error: 'invalid_input' })

		const array = await worker.fetch(post('[1,2]'), makeEnv())
		assert.equal(array.status, 400)

		const form = await worker.fetch(
			post('name=a', { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }),
			makeEnv()
		)
		assert.equal(form.status, 415)
		assert.equal(outbound.length, 0)
	})

	it('本文が上限を超えたら 413', async () => {
		const response = await worker.fetch(
			post({ ...VALID, message: 'x'.repeat(MAX_BODY_BYTES) }),
			makeEnv()
		)
		assert.equal(response.status, 413)
		assert.deepEqual(await response.json(), { ok: false, error: 'too_large' })
		assert.equal(outbound.length, 0)
	})

	describe('Turnstile (secret が設定されているとき)', () => {
		const TURNSTILE_SECRET_KEY = 'dummy-secret'

		it('トークンが無ければ 403 (siteverify にも Discord にも出ない)', async () => {
			const response = await worker.fetch(post(VALID), makeEnv({ TURNSTILE_SECRET_KEY }))
			assert.equal(response.status, 403)
			assert.deepEqual(await response.json(), { ok: false, error: 'forbidden' })
			assert.equal(outbound.length, 0)
		})

		it('siteverify が失敗を返したら 403 (Discord へ送らない)', async () => {
			respond = () => Response.json({ success: false, 'error-codes': ['invalid-input-response'] })
			const response = await worker.fetch(
				post({ ...VALID, turnstileToken: 'bad-token' }),
				makeEnv({ TURNSTILE_SECRET_KEY })
			)
			assert.equal(response.status, 403)
			assert.deepEqual(
				outbound.map((c) => c.url),
				[SITEVERIFY]
			)
		})

		it('ほかのサイトのウィジェットで作ったトークン (hostname 違い) は 403', async () => {
			respond = () =>
				Response.json({ success: true, hostname: 'evil.example', action: TURNSTILE_ACTION })
			const response = await worker.fetch(
				post({ ...VALID, turnstileToken: 'token' }),
				makeEnv({ TURNSTILE_SECRET_KEY })
			)
			assert.equal(response.status, 403)
			assert.equal(outbound.length, 1)
		})

		it('検証が通れば、secret・トークン・IP を siteverify に送ったうえで Discord へ送る', async () => {
			respond = ({ url }) =>
				url === SITEVERIFY
					? Response.json({ success: true, hostname: 'aiken.example', action: TURNSTILE_ACTION })
					: new Response(null, { status: 204 })
			const response = await worker.fetch(
				post({ ...VALID, turnstileToken: 'good-token' }),
				makeEnv({ TURNSTILE_SECRET_KEY })
			)
			assert.equal(response.status, 200)
			assert.deepEqual(
				outbound.map((c) => c.url),
				[SITEVERIFY, WEBHOOK]
			)
			const form = new URLSearchParams(outbound[0].init.body)
			assert.equal(form.get('secret'), TURNSTILE_SECRET_KEY)
			assert.equal(form.get('response'), 'good-token')
			assert.equal(form.get('remoteip'), '203.0.113.7')
		})
	})

	it('secret が無ければ Turnstile の検証をしない (トークンがあっても siteverify に出ない)', async () => {
		const response = await worker.fetch(post({ ...VALID, turnstileToken: 'x' }), makeEnv())
		assert.equal(response.status, 200)
		assert.deepEqual(
			outbound.map((c) => c.url),
			[WEBHOOK]
		)
	})

	it('/api/ 配下以外は ASSETS へ渡す', async () => {
		const env = makeEnv()
		for (const path of ['/', '/contact/', '/nope/', '/api', '/apix/contact']) {
			const request = new Request(`${ORIGIN}${path}`)
			const response = await worker.fetch(request, env)
			assert.equal(await response.text(), 'asset', path)
			assert.equal(env.assetCalls.at(-1), request)
		}
		assert.equal(env.assetCalls.length, 5)
		assert.equal(outbound.length, 0)
	})

	it('/api/contact への POST 以外のメソッドは 405', async () => {
		for (const method of ['GET', 'HEAD', 'PUT', 'DELETE', 'OPTIONS']) {
			const env = makeEnv()
			const response = await worker.fetch(new Request(`${ORIGIN}/api/contact`, { method }), env)
			assert.equal(response.status, 405, method)
			assert.equal(response.headers.get('Allow'), 'POST')
			assert.equal(env.assetCalls.length, 0)
		}
		const response = await worker.fetch(new Request(`${ORIGIN}/api/contact`), makeEnv())
		assert.deepEqual(await response.json(), { ok: false, error: 'method_not_allowed' })
	})

	it('/api/ 配下の未知のパスは 404 (JSON。ASSETS へは渡さない)', async () => {
		const env = makeEnv()
		for (const path of ['/api/', '/api/nope', '/api/contact/', '/api/contact/x']) {
			const response = await worker.fetch(post(VALID, { path }), env)
			assert.equal(response.status, 404, path)
			assert.deepEqual(await response.json(), { ok: false, error: 'not_found' })
		}
		assert.equal(env.assetCalls.length, 0)
		assert.equal(outbound.length, 0)
	})

	it('入力値と Webhook の URL をログに出さない', async (t) => {
		const logged = []
		for (const method of ['log', 'info', 'warn', 'error', 'debug']) {
			t.mock.method(console, method, (...args) => logged.push(args.map(String).join(' ')))
		}
		const secretive = {
			name: 'NAME-MARKER',
			email: 'email-marker@example.com',
			affiliation: 'AFFILIATION-MARKER',
			message: 'MESSAGE-MARKER',
		}

		// 成功・Webhook の失敗 (応答 / 例外)・ハニーポット・入力の不備・壊れた JSON
		await worker.fetch(post(secretive), makeEnv())
		respond = () => new Response('nope', { status: 500 })
		await worker.fetch(post(secretive), makeEnv())
		respond = () => {
			throw new TypeError(`fetch failed: ${WEBHOOK}`)
		}
		await worker.fetch(post(secretive), makeEnv())
		await worker.fetch(post({ ...secretive, website: 'HONEYPOT-MARKER' }), makeEnv())
		await worker.fetch(post({ ...secretive, email: 'email-marker' }), makeEnv())
		await worker.fetch(post('{"name":"NAME-MARKER"'), makeEnv())

		const all = logged.join('\n')
		assert.ok(logged.length > 0, '失敗はログに残る')
		for (const marker of ['MARKER', 'email-marker', 'discord.invalid', 'webhooks']) {
			assert.ok(!all.includes(marker), `ログに ${marker} が出ている`)
		}
	})
})
