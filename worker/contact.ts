// お問い合わせフォームの入力の検証・整形と、Discord の Webhook へ送る payload の作成。
// fetch にも env にも依存しない純粋な関数だけを置く (test/contact.test.mjs が node で直接読む)。
// 配線 (経路・Origin・レート制限・Turnstile・Webhook への送信) は index.ts

/** 項目ごとの文字数の上限。フォームの maxlength (src/components/contact/ContactForm.astro) と揃える */
export const FIELD_LIMITS = {
	name: 80,
	email: 254,
	affiliation: 120,
	message: 2000,
} as const

export type ContactField = keyof typeof FIELD_LIMITS

/** 人には見えない項目。値が入っていたら機械的な送信とみなす */
export const HONEYPOT_FIELD = 'website'

/** リクエスト本文の上限 (バイト)。項目の上限をすべて使い切っても 4 バイト文字で 10KB に届かない */
export const MAX_BODY_BYTES = 16 * 1024

/** Turnstile のウィジェットに付ける action。siteverify の結果と突き合わせる */
export const TURNSTILE_ACTION = 'contact'
/** Turnstile のトークンの最大長 (Cloudflare の仕様) */
export const TURNSTILE_TOKEN_MAX = 2048

/** Discord の embed の上限 (文字数) */
const DISCORD_LIMITS = {
	title: 256,
	description: 4096,
	fieldName: 256,
	fieldValue: 1024,
} as const

export interface ContactInput {
	name: string
	email: string
	/** 任意。未記入は空文字 */
	affiliation: string
	message: string
}

/** required = 未入力 / too_long = 上限超え / invalid = 形式が違う */
export type FieldError = 'required' | 'too_long' | 'invalid'
export type FieldErrors = Partial<Record<ContactField, FieldError>>

export type ValidationResult =
	{ ok: true; value: ContactInput } | { ok: false; fields: FieldErrors }

/** 応答の error に入れるコード */
export type ErrorCode =
	| 'invalid_input'
	| 'forbidden'
	| 'rate_limited'
	| 'unavailable'
	| 'upstream_failed'
	| 'too_large'
	| 'not_found'
	| 'method_not_allowed'
	| 'internal'

// 制御文字 (改行とタブ以外)。Discord に流しても意味が無く、表示を乱すだけなので落とす
const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g

/** 1 行の項目: 改行やタブも含めて空白の連なりを 1 つの空白にし、前後を削る */
function normalizeLine(value: string): string {
	return value.replace(CONTROL_CHARS, '').replace(/\s+/g, ' ').trim()
}

/** 複数行の項目: 改行を LF に揃え、前後の空白を削る。途中の改行はそのまま残す */
function normalizeText(value: string): string {
	return value.replace(/\r\n?/g, '\n').replace(CONTROL_CHARS, '').trim()
}

/** 文字数。絵文字などのサロゲートペアを 1 文字と数える (ブラウザの maxlength より厳しくならない) */
function lengthOf(value: string): number {
	return [...value].length
}

// 形式の検査は軽く: 「空白と @ を含まない文字列 @ ドットを含むドメイン」だけを見る。
// 実在するかどうかは返信してみるまで分からないので、ここで厳密にしても意味が無い
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** JSON を parse した結果がオブジェクト ({...}) かどうか */
export function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** ハニーポットに値が入っているか */
export function isHoneypotFilled(body: Record<string, unknown>): boolean {
	const value = body[HONEYPOT_FIELD]
	if (value === undefined || value === null) return false
	return typeof value === 'string' ? value.trim() !== '' : true
}

/**
 * 入力を検証し、整えた値を返す。問題があれば、項目ごとの理由を返す。
 * 文字列でない値 (数値・配列・オブジェクト) は invalid、無い・空は required (任意の項目は空文字として通す)
 */
export function validateContact(body: Record<string, unknown>): ValidationResult {
	const fields: FieldErrors = {}

	const read = (field: ContactField, required: boolean, multiline = false): string => {
		const raw = body[field]
		if (raw === undefined || raw === null) {
			if (required) fields[field] = 'required'
			return ''
		}
		if (typeof raw !== 'string') {
			fields[field] = 'invalid'
			return ''
		}
		const value = multiline ? normalizeText(raw) : normalizeLine(raw)
		if (value === '') {
			if (required) fields[field] = 'required'
			return ''
		}
		if (lengthOf(value) > FIELD_LIMITS[field]) fields[field] = 'too_long'
		return value
	}

	const value: ContactInput = {
		name: read('name', true),
		email: read('email', true),
		affiliation: read('affiliation', false),
		message: read('message', true, true),
	}

	if (!fields.email && !EMAIL_PATTERN.test(value.email)) fields.email = 'invalid'

	return Object.keys(fields).length > 0 ? { ok: false, fields } : { ok: true, value }
}

/**
 * max 文字 (UTF-16 の長さ。Discord の数え方より緩くならない) に収める。
 * 切ったときは末尾を「…」にする。サロゲートペアの途中では切らない
 */
export function truncate(value: string, max: number): string {
	if (value.length <= max) return value
	let out = ''
	for (const char of value) {
		if (out.length + char.length > max - 1) break
		out += char
	}
	return `${out}…`
}

export interface DiscordWebhookPayload {
	embeds: {
		title: string
		description: string
		fields: { name: string; value: string; inline: boolean }[]
		timestamp: string
	}[]
	allowed_mentions: { parse: [] }
}

/**
 * Discord の Webhook へ送る本文。embed 1 つにまとめる。
 *
 * 入力は書かれたまま載せる (エスケープしない)。`@everyone` やロール・個人へのメンションを書かれても
 * 通知が飛ばないよう、allowed_mentions.parse を空にして「どのメンションも解釈しない」と明示する
 */
export function buildDiscordPayload(input: ContactInput, now: Date): DiscordWebhookPayload {
	const field = (name: string, value: string) => ({
		name: truncate(name, DISCORD_LIMITS.fieldName),
		// field の value は空にできない
		value: truncate(value === '' ? '（未記入）' : value, DISCORD_LIMITS.fieldValue),
		inline: true,
	})

	return {
		embeds: [
			{
				title: truncate('お問い合わせ', DISCORD_LIMITS.title),
				description: truncate(input.message, DISCORD_LIMITS.description),
				fields: [
					field('お名前', input.name),
					field('メールアドレス', input.email),
					field('所属・学年など', input.affiliation),
				],
				timestamp: now.toISOString(),
			},
		],
		allowed_mentions: { parse: [] },
	}
}

/** Turnstile のトークンとして受け取れる形か (空でない文字列で、長すぎない) */
export function isTurnstileToken(value: unknown): value is string {
	return typeof value === 'string' && value.length > 0 && value.length <= TURNSTILE_TOKEN_MAX
}

/**
 * siteverify の応答を見て、通してよいかを決める。success だけでなく、
 * 「このサイトの (hostname)」「お問い合わせフォームの (action)」ウィジェットで作られたトークンであることも確かめる。
 * ほかのサイト・ほかの用途のウィジェットで作ったトークンの使い回しを通さないため
 */
export function isTurnstileSuccess(
	result: unknown,
	expected: { hostname: string; action: string }
): boolean {
	return (
		isRecord(result) &&
		result.success === true &&
		result.hostname === expected.hostname &&
		result.action === expected.action
	)
}
