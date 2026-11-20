/**
 * 記事まわりの計算のうち、コンテンツの読み込み (astro:content) に依らない部分。
 * カテゴリの親子・ページ分け・概要の切り出しなど。node --test で単体テストする (test/posts.test.mjs)。
 * ページやコンポーネントからは src/lib/posts.ts 経由で使う
 */
import { CATEGORIES } from './site.ts'

/* ---------- カテゴリの階層 ---------- */

export interface Category {
	slug: string
	label: string
	description?: string
	children: Category[]
}

interface CategorySource {
	slug: string
	label: string
	description?: string
	children?: readonly CategorySource[]
}

const normalize = (source: CategorySource): Category => ({
	slug: source.slug,
	label: source.label,
	description: source.description,
	children: (source.children ?? []).map(normalize),
})

/** site.ts の CATEGORIES を、どの階層も同じ形 (children を必ず持つ) にそろえたもの */
export const CATEGORY_TREE: Category[] = (CATEGORIES as readonly CategorySource[]).map(normalize)

/** 階層を平らにする (親 → 子の順) */
export function flattenCategories(tree: Category[] = CATEGORY_TREE): Category[] {
	return tree.flatMap((category) => [category, ...flattenCategories(category.children)])
}

/** 最上位から slug のカテゴリまでの道筋 (親 → 自分)。無い slug は空配列 */
export function categoryPath(slug: string, tree: Category[] = CATEGORY_TREE): Category[] {
	for (const category of tree) {
		if (category.slug === slug) return [category]
		const below = categoryPath(slug, category.children)
		if (below.length > 0) return [category, ...below]
	}
	return []
}

/** そのカテゴリの一覧に載せる記事の category。自分と配下すべて (親の一覧は子の記事をまとめて出す) */
export function categoryScope(slug: string, tree: Category[] = CATEGORY_TREE): string[] {
	const self = flattenCategories(tree).find((category) => category.slug === slug)
	return self ? flattenCategories([self]).map((category) => category.slug) : []
}

/**
 * 記事の体裁。カードや見出しの色味・大きさが変わる。
 * - reading … 読み物。子を持たない最上位カテゴリ (特集・レポート)
 * - log … 短い記録。子を持つカテゴリ (活動日誌) とその配下
 */
export type PostKind = 'reading' | 'log'

export function kindOf(slug: string, tree: Category[] = CATEGORY_TREE): PostKind {
	const root = categoryPath(slug, tree)[0]
	return root && root.children.length === 0 ? 'reading' : 'log'
}

/**
 * slug を英字の見出しにする ("feature" → "Feature"、"deep-learning" → "Deep Learning")。
 * 英数字以外を含む slug は見出しに向かないので fallback を返す
 */
export function englishLabel(slug: string | null | undefined, fallback: string): string {
	if (!slug || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/i.test(slug)) return fallback
	return slug
		.split('-')
		.map((word) => word.charAt(0).toUpperCase() + word.slice(1))
		.join(' ')
}

/* ---------- 並び ---------- */

interface Dated {
	id: string
	data: { date: Date }
}

/** 日付の新しい順。同じ日付は id の順 (ビルドのたびに並びが変わらないように) */
export function byDateDesc(a: Dated, b: Dated): number {
	return b.data.date.getTime() - a.data.date.getTime() || a.id.localeCompare(b.id)
}

/** 新しい順に並んだ一覧の中での前後。newer = ひとつ新しい記事、older = ひとつ古い記事 */
export function neighborsOf<T extends { id: string }>(
	sorted: T[],
	id: string
): { newer: T | null; older: T | null } {
	const index = sorted.findIndex((item) => item.id === id)
	if (index === -1) return { newer: null, older: null }
	return { newer: sorted[index - 1] ?? null, older: sorted[index + 1] ?? null }
}

/** トップページに出す本数。3 列の格子に端数が出ないよう、6 本以上なら 6、3〜5 本なら 3、2 本以下はあるだけ */
export function latestCount(total: number): number {
	if (total >= 6) return 6
	if (total >= 3) return 3
	return Math.max(0, total)
}

/* ---------- ページ分け ---------- */

export interface Page<T> {
	items: T[]
	/** 1 始まり */
	page: number
	totalPages: number
}

/** perPage 件ずつに分ける。0 件でも空の 1 ページを返す (空表示のページを作るため) */
export function paginate<T>(items: T[], perPage: number): Page<T>[] {
	const totalPages = Math.max(1, Math.ceil(items.length / perPage))
	return Array.from({ length: totalPages }, (_, i) => ({
		items: items.slice(i * perPage, (i + 1) * perPage),
		page: i + 1,
		totalPages,
	}))
}

/**
 * 一覧のルート ([...page].astro) に渡すパラメータ。
 * 1 ページ目は undefined (= /posts/)、2 ページ目以降は "page/2" (= /posts/page/2/)
 */
export function pageParam(page: number): string | undefined {
	return page <= 1 ? undefined : `page/${page}`
}

/** 一覧の n ページ目の URL。basePath は末尾スラッシュ付き (/posts/、/category/activity/ など) */
export function pageHref(basePath: string, page: number): string {
	return page <= 1 ? basePath : `${basePath}page/${page}/`
}

/**
 * ページ送りに並べる番号。7 ページまでは全部、それより多いときは
 * 先頭・末尾・現在地の前後 1 ページだけを残し、飛ばした所に 'gap' を入れる
 */
export function pagerItems(current: number, totalPages: number): Array<number | 'gap'> {
	const all = Array.from({ length: totalPages }, (_, i) => i + 1)
	if (totalPages <= 7) return all
	const shown = all.filter(
		(page) => page === 1 || page === totalPages || Math.abs(page - current) <= 1
	)
	return shown.flatMap((page, i) => {
		const skipped = i > 0 && page - shown[i - 1] > 1
		return skipped ? ['gap' as const, page] : [page]
	})
}

/* ---------- 概要 ---------- */

/** 文字数 (コードポイント単位) で切り、切ったときは … を付ける */
export function truncate(text: string, max: number): string {
	const chars = [...text]
	return chars.length > max ? `${chars.slice(0, max).join('').trimEnd()}…` : text
}

const ENTITIES: Record<string, string> = {
	'&nbsp;': ' ',
	'&lt;': '<',
	'&gt;': '>',
	'&quot;': '"',
	'&#39;': "'",
	'&amp;': '&',
}

/**
 * Markdown の本文から地の文だけを取り出して 1 行にする。
 * 見出し・画像・コード・表・生 HTML のブロック (<pre> など) は飛ばし、強調やリンクの記号は外す
 */
export function plainText(markdown: string): string {
	const text = markdown
		.replace(/\r\n?/g, '\n')
		// コードブロック (``` と ~~~)。閉じていなければ最後まで
		.replace(
			/^ {0,3}(`{3,}|~{3,})[^\n]*\n(?:[\s\S]*?\n)?? {0,3}\1[`~]*[ \t]*$|^ {0,3}(`{3,}|~{3,})[\s\S]*/gm,
			''
		)
		// 中身ごと捨てる HTML
		.replace(/<!--[\s\S]*?-->/g, '')
		.replace(/<(pre|script|style|table|figure|iframe|svg)\b[\s\S]*?<\/\1\s*>/gi, '')
		// 画像、リンク (文字だけ残す)、脚注の参照
		.replace(/!\[[^\]]*\]\([^)]*\)/g, '')
		.replace(/!\[[^\]]*\]\[[^\]]*\]/g, '')
		.replace(/\[\^[^\]]+\]/g, '')
		.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
		.replace(/\[([^\]]+)\]\[[^\]]*\]/g, '$1')
		// 残りの HTML タグは外して中の文字を残す
		.replace(/<\/?[a-z][^>]*>/gi, ' ')

	const lines = text
		.split('\n')
		.filter((line) => {
			const trimmed = line.trim()
			if (/^#{1,6}(\s|$)/.test(trimmed)) return false // 見出し
			if (/^\|/.test(trimmed)) return false // 表
			if (/^([-*_=])(\s*\1){2,}$/.test(trimmed)) return false // 区切り線・見出しの下線
			if (/^\[[^\]]+\]:\s/.test(trimmed)) return false // リンクの定義
			return true
		})
		.map((line) =>
			line
				// 引用・箇条書きの行頭の記号
				.replace(/^\s*(>\s?)+/, '')
				.replace(/^\s*(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?/, '')
				// 行末の改行指定 (バックスラッシュ)
				.replace(/\\$/, '')
				// 強調・打ち消し・インラインコード
				.replace(/(\*{1,3}|~~|`+)/g, '')
				.replace(/(^|[\s(（「『])_{1,3}(?=\S)/g, '$1')
				.replace(/(\S)_{1,3}(?=$|[\s)）」』、。,.!?！？])/g, '$1')
				// 記号のエスケープ (\* など)
				.replace(/\\([\\`*_{}[\]()#+\-.!|<>~])/g, '$1')
		)

	return lines
		.join(' ')
		.replace(/&(?:nbsp|lt|gt|quot|#39|amp);/g, (entity) => ENTITIES[entity])
		.replace(/\s+/g, ' ')
		.trim()
}

/** 一覧や RSS に出す概要。description があればそれを、無ければ本文の先頭から作る */
export function excerptFrom(
	description: string | null | undefined,
	body: string | null | undefined,
	max: number
): string {
	return description?.trim() || truncate(plainText(body ?? ''), max)
}

/* ---------- RSS ---------- */

export function escapeXml(text: string): string {
	return text
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&apos;')
}
