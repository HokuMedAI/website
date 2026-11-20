#!/usr/bin/env node
/**
 * 旧サイト（Hugo、hokumedai.github.io）の記事を、この repo の Markdown（src/content/posts/）に書き出す。
 *
 * 使い方:
 *   node scripts/import-hugo.mjs <旧サイト repo のパス> [オプション]
 *
 *   --dry-run                 一覧（slug・カテゴリ・日付・アイキャッチ・本文画像の数・authors・tags）だけ出す。何も書かない
 *   --only <slug>             1 本だけ（複数回指定・カンマ区切り可。旧サイトの `activities/mokumoku/2025-06-11` の形でも可）
 *   --force                   既にある記事も、旧サイトの内容で作り直す（そのディレクトリの中身を置き換える）
 *   --keep-original-images    画像を加工せず原本のバイト列のまま置く（ファイル名の ASCII 化だけ行う）
 *
 * 例:
 *   node scripts/import-hugo.mjs ~/src/github.com/HokuMedAI/hokumedai.github.io --dry-run
 *   node scripts/import-hugo.mjs ~/src/github.com/HokuMedAI/hokumedai.github.io --only 2025-06-11-study
 *   node scripts/import-hugo.mjs ~/src/github.com/HokuMedAI/hokumedai.github.io
 *
 * 取り込む対象:
 *   content/activities/{mokumoku,meeting,seminar}/<dir>/index.md → category: study / meeting / lecture
 *   content/articles/<dir>/index.md                              → category: feature
 *   `draft: true` と `_index.md` は除く。旧サイト repo は読むだけで何も書かない。
 *
 * 書き出す先:
 *   src/content/posts/<slug>/index.md と、同じディレクトリの画像。
 *   slug は「front matter の date の日本時間の日付 + 種別」（2025-06-11-study）。
 *   articles は「日付 + 旧フォルダ名」（2026-04-19-115th-jps-annual-meeting）。
 *   既に同じ slug のディレクトリがあれば触らずに飛ばす（この repo で直した記事を潰さない）。
 *   何度流してもよい。作り直すときだけ --force。
 *
 * frontmatter（src/content.config.ts の posts に合わせる。この順で、値があるものだけ）:
 *   title / date / category / tags / authors / description / thumbnail
 *   - description は、title と同じもの・雛形のままのものは書かない
 *   - tags と authors は src/content/tags.yaml・authors.yaml の id。定義に無いものが出たら止まる
 *   - thumbnail は、ファイル名に feature を含む画像（名前順で最初の 1 枚）。残りは本文の末尾に足す
 *
 * 本文は次の箇所だけ書き換える。それ以外（行末 2 スペースの改行・誤字・全角数字など）は 1 文字も変えない:
 *   - 画像の参照先      bundle 内 / `images/…`・`/images/…`（実体は旧 repo の assets/images/）→ `./<ファイル名>`。外部 URL はそのまま
 *   - {{< gallery >}}   中の <img> を、順に通常の画像（`![](./x.jpg)`）として並べる
 *   - {{< lead >}}      中のテキストを太字の段落にする
 *   - <pre><code>       フェンス付きコードブロックにする（中の行はそのまま。`<` や `&` を文字として確実に出すため）
 *   - 先頭の BOM を除き、末尾の改行を 1 つにそろえる
 *
 * 画像の加工（既定。git に入れるので軽くする）:
 *   - 長辺が 1640px を超えるものは 1640px に縮小（記事で出す最大の幅 820px の 2 倍）
 *   - 透過の無い PNG のうち大きいもの（長辺 1640px 超 または 1MB 以上 = 写真）は JPEG（品質 80）へ
 *   - EXIF などのメタデータは、回転を画素へ反映してから削除（GPS 位置情報を落とす）
 *   - 小さくてメタデータも無い画像（ロゴ・図・スクリーンショット）は原本のバイト列のまま
 *   - ファイル名は ASCII の小文字、拡張子は加工後の形式に合わせる
 */

import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

import sharp from 'sharp'
import { Document, parse } from 'yaml'

// ---------------------------------------------------------------------------
// 決めごと
// ---------------------------------------------------------------------------

const CONTENT_DIR = fileURLToPath(new URL('../src/content/', import.meta.url))
const POSTS_DIR = path.join(CONTENT_DIR, 'posts')

/** content/ 配下のセクション → category。kind があれば slug は「日付-kind」、無ければ「日付-旧フォルダ名」 */
const SECTIONS = [
	{ dir: 'activities/mokumoku', category: 'study', kind: 'study' },
	{ dir: 'activities/meeting', category: 'meeting', kind: 'meeting' },
	{ dir: 'activities/seminar', category: 'lecture', kind: 'lecture' },
	{ dir: 'articles', category: 'feature', kind: null },
]
/** 旧サイトの著者キー → authors.yaml の id（綴りの直しと、部員のファイル名に合わせた読み替え） */
const AUTHOR_ID_FIX = {
	hokuimedai: 'hokumedai',
	ymd000: 'yamada',
	shogo: 'sato-shogo',
	mbyamaguchi: 'yamaguchi',
}
/** archetype の雛形のまま残っている description */
const TEMPLATE_DESCRIPTIONS = new Set(['ここに説明を入力'])
/** ASCII でないファイル名の読み替え。無いものは内容ハッシュで名前を付ける */
const ASCII_NAMES = { カルビ丼: 'karubidon' }

const MAX_EDGE = 1640
const JPEG_QUALITY = 80
/** 透過の無い PNG を「写真」とみなして JPEG にする下限（これ未満で長辺も MAX_EDGE 以下なら PNG のまま） */
const PNG_PHOTO_MIN_BYTES = 1024 * 1024
const IMAGE_EXT = /\.(png|jpe?g|gif|webp|avif)$/i
const EXT_BY_FORMAT = { jpeg: '.jpg', png: '.png', gif: '.gif', webp: '.webp', avif: '.avif' }
const JST_OFFSET_MS = 9 * 60 * 60 * 1000

// ---------------------------------------------------------------------------
// 引数
// ---------------------------------------------------------------------------

function usage(message) {
	if (message) console.error(`エラー: ${message}\n`)
	const header = fs.readFileSync(new URL(import.meta.url), 'utf8').match(/\/\*\*([\s\S]*?)\*\//)
	console.error(header ? header[1].replace(/^ \* ?/gm, '').trim() : '')
	process.exit(message ? 2 : 0)
}

const { values: opts, positionals } = parseArgs({
	allowPositionals: true,
	options: {
		'dry-run': { type: 'boolean', default: false },
		only: { type: 'string', multiple: true },
		force: { type: 'boolean', default: false },
		'keep-original-images': { type: 'boolean', default: false },
		help: { type: 'boolean', short: 'h', default: false },
	},
})
if (opts.help) usage()
if (positionals.length !== 1) usage('旧サイト repo のパスを 1 つ渡してください')

const HUGO_ROOT = path.resolve(positionals[0])
const HUGO_CONTENT = path.join(HUGO_ROOT, 'content')
if (!fs.existsSync(HUGO_CONTENT)) usage(`content/ が見つかりません: ${HUGO_ROOT}`)
const KEEP_ORIGINAL = opts['keep-original-images']
const ONLY = (opts.only ?? [])
	.flatMap((v) => v.split(','))
	.map((v) => v.trim().replace(/\/+$/, ''))
	.filter(Boolean)

// ---------------------------------------------------------------------------
// 小道具
// ---------------------------------------------------------------------------

const warnings = []
function warn(where, message) {
	warnings.push({ where, message })
}

const sha1 = (buf) => crypto.createHash('sha1').update(buf).digest('hex')
const formatBytes = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}MB` : `${Math.round(n / 1e3)}KB`)
const squash = (s) => String(s ?? '').replace(/[\s\u3000]+/g, '')

function toSlug(text) {
	return text
		.normalize('NFKC')
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '')
}

/** Hugo の urlize 相当（タグ名 → URL の一部）。記号を落とし、空白をハイフンに */
function urlize(text) {
	return text
		.normalize('NFKC')
		.trim()
		.toLowerCase()
		.replace(/\s+/g, '-')
		.replace(/[^\p{L}\p{N}-]+/gu, '')
		.replace(/-+/g, '-')
}

function toStringList(value) {
	if (value == null) return []
	return (Array.isArray(value) ? value : [value]).map((v) => String(v).trim()).filter(Boolean)
}

/** src/content/<name>.yaml に定義済みの id */
function readDefinedIds(name) {
	const items = parse(fs.readFileSync(path.join(CONTENT_DIR, name), 'utf8')) ?? []
	return new Set(items.map((item) => String(item.id)))
}

// ---------------------------------------------------------------------------
// 旧サイトの読み取り
// ---------------------------------------------------------------------------

/** BOM を除いて front matter（YAML）と本文に分ける。キーは小文字にそろえる */
function readMarkdown(file) {
	const text = fs
		.readFileSync(file, 'utf8')
		.replace(/^\uFEFF/, '')
		.replace(/\r\n/g, '\n')
	const m = text.match(/^---[ \t]*\n([\s\S]*?)\n---[ \t]*(?:\n|$)/)
	if (!m) return { fm: {}, body: text }
	const parsed = parse(m[1]) ?? {}
	const fm = Object.fromEntries(Object.entries(parsed).map(([k, v]) => [k.toLowerCase(), v]))
	return { fm, body: text.slice(m[0].length) }
}

/** front matter の date → 日本時間の日付（YYYY-MM-DD）。時差の書かれていない日時は日本時間とみなす */
function toJstDate(value) {
	if (value == null) return null
	if (value instanceof Date) {
		return new Date(value.getTime() + JST_OFFSET_MS).toISOString().slice(0, 10)
	}
	const s = String(value).trim()
	if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s
	const m = s.match(
		/^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?)\s*(Z|[+-]\d{2}:?\d{2})?$/i
	)
	if (!m) return null
	if (!m[3]) return m[1]
	const time = m[2].length === 5 ? `${m[2]}:00` : m[2]
	const zone = /^z$/i.test(m[3])
		? 'Z'
		: m[3].includes(':')
			? m[3]
			: `${m[3].slice(0, 3)}:${m[3].slice(3)}`
	const instant = new Date(`${m[1]}T${time}${zone}`).getTime()
	if (Number.isNaN(instant)) return null
	return new Date(instant + JST_OFFSET_MS).toISOString().slice(0, 10)
}

/** 取り込み対象の page bundle を集める（下書きは除く） */
function collectBundles() {
	const bundles = []
	const skipped = []
	for (const section of SECTIONS) {
		const base = path.join(HUGO_CONTENT, section.dir)
		if (!fs.existsSync(base)) continue
		const entries = fs
			.readdirSync(base, { withFileTypes: true })
			.sort((a, b) => (a.name < b.name ? -1 : 1))
		for (const entry of entries) {
			if (!entry.isDirectory()) continue
			const dir = path.join(base, entry.name)
			const file = path.join(dir, 'index.md')
			if (!fs.existsSync(file)) continue // _index.md だけのセクション（articles/MIL）はここで外れる
			const rel = `${section.dir}/${entry.name}`
			const { fm, body } = readMarkdown(file)
			if (fm.draft === true) {
				skipped.push(`${rel}（draft）`)
				continue
			}
			const date = toJstDate(fm.date)
			if (!date) throw new Error(`${rel}: date を読めない: ${fm.date}`)
			const slug = `${date}-${section.kind ?? toSlug(entry.name)}`
			bundles.push({ rel, dir, section, slug, date, fm, body })
		}
	}
	return { bundles, skipped }
}

// ---------------------------------------------------------------------------
// 本文
// ---------------------------------------------------------------------------

const HTML_ENTITIES = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'", nbsp: '\u00a0' }
function decodeEntities(text) {
	return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, name) => {
		if (name[0] === '#') {
			const code = /^#x/i.test(name) ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10)
			return Number.isFinite(code) ? String.fromCodePoint(code) : whole
		}
		return HTML_ENTITIES[name.toLowerCase()] ?? whole
	})
}

function attr(tag, name) {
	const m = tag.match(new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i'))
	return m ? decodeEntities(m[1] ?? m[2] ?? m[3] ?? '') : undefined
}

/**
 * 本文の画像の参照先を決める。
 *   外部 URL → そのまま / `images/…`・`/images/…` → 旧 repo の assets/images/… / それ以外 → bundle 内
 */
function resolveImageRef(href, bundle) {
	if (/^(?:https?:)?\/\//i.test(href)) return { kind: 'external' }
	const clean = href.split(/[?#]/)[0]
	const names = [clean]
	try {
		const decoded = decodeURIComponent(clean)
		if (decoded !== clean) names.push(decoded)
	} catch {
		// % の並びが壊れていたら、書かれたままの名前だけで探す
	}
	for (const name of names) {
		const candidates = name.startsWith('/')
			? [path.join(HUGO_ROOT, 'assets', name), path.join(HUGO_ROOT, 'static', name)]
			: [
					path.join(bundle.dir, name),
					path.join(HUGO_ROOT, 'assets', name),
					path.join(HUGO_ROOT, 'static', name),
				]
		for (const file of candidates) {
			if (fs.existsSync(file) && fs.statSync(file).isFile()) return { kind: 'local', file }
		}
	}
	throw new Error(`${bundle.rel}: 画像が見つからない: ${href}`)
}

/** `![alt](href)` と `![alt](href "title")` */
const MD_IMAGE = /(!\[(?:[^\]\\]|\\.)*\]\()([^()\s]+)((?:\s+(?:"[^"]*"|'[^']*'))?\))/g

/** 画像の置き場所が決まるまでの仮の参照先（書き出すときに `./<ファイル名>` へ差し替える） */
const placeholder = (index) => `\u0000${index}\u0000`
const PLACEHOLDER = /\u0000(\d+)\u0000/g

/**
 * 本文を書き換える。決めた箇所（画像の参照先・shortcode・<pre>）以外の行はそのまま通す。
 * 画像の中身にはまだ触らない。ローカルの画像は images に集め、本文には仮の参照先を置く。
 */
function convertBody(bundle, extraImages) {
	const where = bundle.rel
	const images = [] // 本文から参照する画像の原本（初出の順）
	const counts = { local: 0, external: 0 }
	const refer = (file) => {
		let index = images.indexOf(file)
		if (index < 0) index = images.push(file) - 1
		counts.local++
		return placeholder(index)
	}
	const rewrite = (href) => {
		const ref = resolveImageRef(href, bundle)
		if (ref.kind === 'external') {
			counts.external++
			return href
		}
		return refer(ref.file)
	}

	const lines = bundle.body.split('\n')
	const out = []
	/** 段落として独立させたいブロックを、前後を空行で区切って置く */
	const pushBlock = (blockLines, nextLine) => {
		if (out.length && out.at(-1).trim() !== '') out.push('')
		out.push(...blockLines)
		if (nextLine !== undefined && nextLine.trim() !== '') out.push('')
	}

	let fence = null
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i]
		// フェンス付きコードブロックの中は触らない
		if (fence) {
			out.push(line)
			const close = new RegExp(`^ {0,3}${fence[0] === '`' ? '`' : '~'}{${fence.length},}[ \\t]*$`)
			if (close.test(line)) fence = null
			continue
		}
		const fenceStart = line.match(/^ {0,3}(`{3,}|~{3,})/)
		if (fenceStart) {
			fence = fenceStart[1]
			out.push(line)
			continue
		}

		// {{< name >}} … {{< /name >}}
		const open = line.match(/^\s*\{\{[<%]\s*([a-zA-Z][\w-]*)\b[^>%]*[>%]\}\}\s*$/)
		if (open) {
			const name = open[1]
			const close = new RegExp(`^\\s*\\{\\{[<%]\\s*/${name}\\s*[>%]\\}\\}\\s*$`)
			let end = i + 1
			while (end < lines.length && !close.test(lines[end])) end++
			if (end >= lines.length) throw new Error(`${where}: shortcode ${name} が閉じていない`)
			const inner = lines.slice(i + 1, end).join('\n')
			if (name === 'gallery') {
				// 中の <img> を、順に通常の画像として並べる（1 枚 = 1 段落）
				const tags = inner.match(/<img\b[^>]*>/gi) ?? []
				const rest = inner.replace(/<img\b[^>]*>/gi, '').trim()
				if (rest) throw new Error(`${where}: gallery の中に <img> 以外の内容がある: ${rest}`)
				const block = []
				for (const tag of tags) {
					const src = attr(tag, 'src')
					if (!src) throw new Error(`${where}: gallery の <img> に src が無い: ${tag}`)
					if (block.length) block.push('')
					block.push(`![${attr(tag, 'alt') ?? ''}](${rewrite(src)})`)
				}
				pushBlock(block, lines[end + 1])
			} else if (name === 'lead') {
				// リード文は、全体を太字にした段落にする
				const block = []
				for (const paragraph of inner.trim().split(/\n[ \t]*\n/)) {
					if (block.length) block.push('')
					block.push(`**${paragraph.trim()}**`)
				}
				pushBlock(block, lines[end + 1])
			} else {
				throw new Error(`${where}: 未対応の shortcode: ${line.trim()}`)
			}
			i = end
			continue
		}

		// <pre …>\n<code>\n…\n</code>\n</pre> → フェンス付きコードブロック（中の行は 1 文字も変えない）
		if (/^<pre\b/i.test(line)) {
			let end = i
			while (end < lines.length && !/^<\/pre>[ \t]*$/i.test(lines[end])) end++
			const wellFormed =
				end < lines.length &&
				/^<pre\b[^>]*>[ \t]*$/i.test(line) &&
				/^<code>[ \t]*$/i.test(lines[i + 1] ?? '') &&
				/^<\/code>[ \t]*$/i.test(lines[end - 1] ?? '') &&
				end - 1 > i + 1
			if (!wellFormed) throw new Error(`${where}: <pre> の形が想定外（${i + 1} 行目）`)
			const code = lines.slice(i + 2, end - 1)
			// 中身に出てくる一番長いバッククォートの並びより長いフェンスで囲む
			const longest = Math.max(0, ...(code.join('\n').match(/`+/g) ?? []).map((run) => run.length))
			const mark = '`'.repeat(Math.max(3, longest + 1))
			out.push(mark, ...code, mark)
			i = end
			continue
		}

		if (/\{\{[<%]/.test(line)) throw new Error(`${where}: 行の途中に shortcode がある: ${line}`)
		if (/<img\b/i.test(line)) throw new Error(`${where}: 本文に生の <img> がある: ${line}`)
		out.push(line.replace(MD_IMAGE, (_, head, href, tail) => `${head}${rewrite(href)}${tail}`))
	}

	// アイキャッチに使わなかった候補は、本文の末尾に画像として足す
	const appended = []
	for (const file of extraImages) {
		if (images.includes(file)) continue
		while (out.length && out.at(-1).trim() === '') out.pop()
		out.push('', `![](${refer(file)})`)
		appended.push(path.basename(file))
	}

	// 末尾の改行は 1 つにそろえる
	const body = `${out.join('\n').replace(/\n+$/, '')}\n`
	return { body, images, counts, appended }
}

/** 記事 1 本ぶんの書き出し内容を組み立てる（ここまでは画像の中身にも出力先にも触らない） */
function buildPlan(bundle, defined) {
	const { fm, rel } = bundle
	const title = String(fm.title ?? '').trim()
	if (!title) throw new Error(`${rel}: title が空`)
	const rawDescription = String(fm.description ?? '').trim()
	const description =
		!rawDescription ||
		TEMPLATE_DESCRIPTIONS.has(rawDescription) ||
		squash(rawDescription) === squash(title)
			? ''
			: rawDescription

	const tags = toStringList(fm.tags).map(urlize)
	for (const tag of tags) {
		if (!defined.tags.has(tag)) throw new Error(`${rel}: タグ ${tag} が tags.yaml に無い`)
	}
	const authors = toStringList(fm.authors).map((key) => AUTHOR_ID_FIX[key] ?? key)
	for (const author of authors) {
		if (!defined.authors.has(author)) {
			throw new Error(`${rel}: authors の ${author} が authors.yaml に無い`)
		}
	}

	// アイキャッチ: ファイル名に feature を含む画像。名前順で最初の 1 枚、残りは本文の末尾へ
	const files = fs
		.readdirSync(bundle.dir)
		.filter((n) => IMAGE_EXT.test(n))
		.sort()
	const featureFiles = files.filter((n) => /feature/i.test(n)).map((n) => path.join(bundle.dir, n))
	const thumbnail = featureFiles[0] ?? null

	const { body, images, counts, appended } = convertBody(bundle, featureFiles.slice(1))
	const used = new Set([thumbnail, ...images])
	for (const name of files) {
		if (!used.has(path.join(bundle.dir, name))) {
			warn(rel, `bundle 内の画像がどこからも使われていない（書き出さない）: ${name}`)
		}
	}

	return {
		rel,
		slug: bundle.slug,
		category: bundle.section.category,
		title,
		date: bundle.date,
		tags,
		authors,
		description,
		thumbnail,
		body,
		images,
		counts,
		appended,
	}
}

// ---------------------------------------------------------------------------
// 画像
// ---------------------------------------------------------------------------

/** EXIF（TIFF 構造）に GPS の緯度・経度が入っているか */
function exifHasGps(exif) {
	try {
		let base = exif.indexOf('II*\0', 0, 'latin1')
		const be = base < 0
		if (be) base = exif.indexOf('MM\0*', 0, 'latin1')
		if (base < 0) return false
		const u16 = (o) => (be ? exif.readUInt16BE(base + o) : exif.readUInt16LE(base + o))
		const u32 = (o) => (be ? exif.readUInt32BE(base + o) : exif.readUInt32LE(base + o))
		const ifd0 = u32(4)
		for (let i = 0, n = u16(ifd0); i < n; i++) {
			const entry = ifd0 + 2 + i * 12
			if (u16(entry) !== 0x8825) continue
			const gps = u32(entry + 8)
			for (let j = 0, k = u16(gps); j < k; j++) {
				const tag = u16(gps + 2 + j * 12)
				if (tag === 2 || tag === 4) return true // GPSLatitude / GPSLongitude
			}
		}
	} catch {
		// 壊れた EXIF は「GPS なし」と数える（どのみち加工で EXIF ごと落とす）
	}
	return false
}

const hasMetadata = (meta) =>
	Boolean(meta.exif || meta.xmp || meta.iptc) || (meta.orientation ?? 1) !== 1

const imageCache = new Map()
/** 原本を読み、決めごとに従って加工したバイト列を返す（同じ原本は 1 度だけ処理する） */
function prepareImage(file) {
	if (!imageCache.has(file)) imageCache.set(file, processImage(file))
	return imageCache.get(file)
}

async function processImage(file) {
	const original = fs.readFileSync(file)
	const meta = await sharp(original).metadata()
	const result = {
		file,
		format: meta.format,
		bytes: original,
		originalSize: original.length,
		sourceHash: sha1(original),
		hadGps: meta.exif ? exifHasGps(meta.exif) : false,
		action: '原本のまま',
	}
	if (KEEP_ORIGINAL) return result

	const dirty = hasMetadata(meta)
	if (meta.format !== 'jpeg' && meta.format !== 'png') {
		if (dirty) {
			throw new Error(`${meta.format} は加工の対象外だが、メタデータが入っている: ${file}`)
		}
		return result
	}

	const rotated = (meta.orientation ?? 1) >= 5
	const width = rotated ? meta.height : meta.width
	const height = rotated ? meta.width : meta.height
	const resize = Math.max(width, height) > MAX_EDGE
	let toJpeg = meta.format === 'jpeg'
	if (meta.format === 'png' && (resize || original.length >= PNG_PHOTO_MIN_BYTES)) {
		// アルファチャンネルがあっても全画素が不透明なら「透過なし」
		toJpeg = !meta.hasAlpha || (await sharp(original).stats()).isOpaque
	}
	const steps = []
	if (resize) steps.push(`${width}x${height} → 長辺 ${MAX_EDGE}px`)
	if (toJpeg && meta.format === 'png') steps.push('PNG → JPEG')
	if (dirty) steps.push(result.hadGps ? 'EXIF 削除（GPS あり）' : 'メタデータ削除')
	if (steps.length === 0) return result

	let pipeline = sharp(original).rotate() // 引数なしの rotate は EXIF の向きを画素へ反映する
	if (resize) {
		pipeline = pipeline.resize({
			width: MAX_EDGE,
			height: MAX_EDGE,
			fit: 'inside',
			withoutEnlargement: true,
		})
	}
	if (toJpeg) {
		if (meta.hasAlpha) pipeline = pipeline.flatten({ background: '#ffffff' })
		pipeline = pipeline.jpeg({ quality: JPEG_QUALITY, mozjpeg: true })
	} else {
		pipeline = pipeline.png({ compressionLevel: 9 })
	}
	// sharp は既定でメタデータ（EXIF・XMP・ICC）を出力に引き継がない
	const bytes = await pipeline.toBuffer()
	const after = await sharp(bytes).metadata()
	if (hasMetadata(after)) throw new Error(`加工後の画像にメタデータが残っている: ${file}`)
	return { ...result, format: toJpeg ? 'jpeg' : 'png', bytes, action: steps.join('、') }
}

/** 置くファイル名: ASCII の小文字にした元の名前 + 出力形式の拡張子 */
function outputName(image) {
	const ext = path.extname(image.file)
	const stem = path.basename(image.file, ext).normalize('NFKC')
	let ascii = ASCII_NAMES[stem]
	if (!ascii && /^[\x20-\x7e]+$/.test(stem)) {
		ascii = stem
			.toLowerCase()
			.replace(/[^a-z0-9._-]+/g, '-')
			.replace(/^[-.]+|[-.]+$/g, '')
	}
	return `${ascii || `img-${image.sourceHash.slice(0, 8)}`}${EXT_BY_FORMAT[image.format] ?? ext.toLowerCase()}`
}

// ---------------------------------------------------------------------------
// 書き出し
// ---------------------------------------------------------------------------

function renderFrontmatter(plan, thumbnailName) {
	// キーの順は src/content.config.ts の並び。値が無いものは書かない
	const data = {
		title: plan.title,
		date: plan.date,
		category: plan.category,
		...(plan.tags.length ? { tags: plan.tags } : {}),
		...(plan.authors.length ? { authors: plan.authors } : {}),
		...(plan.description ? { description: plan.description } : {}),
		...(thumbnailName ? { thumbnail: `./${thumbnailName}` } : {}),
	}
	const doc = new Document(data)
	// tags と authors は 1 行で書く（tags: [a, b]）
	for (const key of ['tags', 'authors']) {
		const node = doc.get(key, true)
		if (node) node.flow = true
	}
	// lineWidth: 0 は、長い値を途中で折り返さないため
	return `---\n${doc.toString({ lineWidth: 0, flowCollectionPadding: false })}---\n`
}

/** 記事 1 本を src/content/posts/<slug>/ に書き出す */
async function writePost(plan, stats) {
	const dir = path.join(POSTS_DIR, plan.slug)

	// 画像を先に全部作る（失敗しても、書きかけのディレクトリを残さない）
	const sources = [...new Set([...(plan.thumbnail ? [plan.thumbnail] : []), ...plan.images])]
	const nameBySource = new Map()
	const taken = new Set()
	const files = []
	for (const source of sources) {
		const image = await prepareImage(source)
		// 別の原本が同じ名前になってしまったら番号で分ける
		const base = outputName(image)
		let name = base
		for (let n = 2; taken.has(name); n++) name = base.replace(/(\.[a-z0-9]+)$/, `-${n}$1`)
		taken.add(name)
		nameBySource.set(source, name)
		files.push({ name, image })
	}

	const body = plan.body.replace(
		PLACEHOLDER,
		(_, index) => `./${nameBySource.get(plan.images[Number(index)])}`
	)
	const markdown = renderFrontmatter(plan, nameBySource.get(plan.thumbnail)) + body

	// 作り直すとき（--force）も、ディレクトリごと消さずに上書きして、要らなくなったファイルだけ消す。
	// index.md を消して置き直すと、動いている dev サーバーがその記事を見失うことがある
	const existed = fs.existsSync(dir)
	fs.mkdirSync(dir, { recursive: true })
	try {
		for (const { name, image } of files) fs.writeFileSync(path.join(dir, name), image.bytes)
		// index.md を最後に置く（画像がそろう前に記事として読まれないように）
		fs.writeFileSync(path.join(dir, 'index.md'), markdown)
		for (const name of fs.readdirSync(dir)) {
			if (name !== 'index.md' && !taken.has(name)) {
				fs.rmSync(path.join(dir, name), { recursive: true, force: true })
			}
		}
	} catch (error) {
		// 新しく作る途中で失敗したら、書きかけを残さない
		if (!existed) fs.rmSync(dir, { recursive: true, force: true })
		throw error
	}

	for (const { name, image } of files) {
		stats.images++
		stats.originalBytes += image.originalSize
		stats.outputBytes += image.bytes.length
		if (image.action !== '原本のまま') stats.processed++
		if (image.hadGps && !KEEP_ORIGINAL) stats.gpsRemoved++
		if (image.hadGps && KEEP_ORIGINAL) {
			warn(`${plan.slug}/${name}`, 'GPS 位置情報が入ったまま書き出した（--keep-original-images）')
		}
		stats.log.push(
			`${plan.slug}/${name}  ← ${path.relative(HUGO_ROOT, image.file)}  ${formatBytes(image.originalSize)} → ${formatBytes(image.bytes.length)}  ${image.action}`
		)
	}
}

// ---------------------------------------------------------------------------
// 実行
// ---------------------------------------------------------------------------

function printTable(head, rows) {
	const width = (s) => [...String(s)].reduce((n, ch) => n + (ch.charCodeAt(0) > 0xff ? 2 : 1), 0)
	const pad = (s, n) => String(s) + ' '.repeat(Math.max(0, n - width(s)))
	const cols = head.map((h, i) => Math.max(width(h), ...rows.map((r) => width(r[i]))))
	const print = (cells) =>
		console.log(
			cells
				.map((c, i) => pad(c, cols[i]))
				.join('  ')
				.trimEnd()
		)
	print(head)
	for (const row of rows) print(row)
}

function printWarnings() {
	if (!warnings.length) return
	console.log('')
	console.log(`注意 ${warnings.length} 件:`)
	for (const w of warnings) console.log(`  ${w.where}: ${w.message}`)
}

async function main() {
	const defined = { tags: readDefinedIds('tags.yaml'), authors: readDefinedIds('authors.yaml') }
	const { bundles, skipped } = collectBundles()

	// 同じ日に同じ種別の記事が 2 本あると slug が重なる。どちらかを潰さないよう、書く前に止める
	const bySlug = new Map()
	for (const bundle of bundles) {
		bySlug.set(bundle.slug, [...(bySlug.get(bundle.slug) ?? []), bundle.rel])
	}
	const duplicated = [...bySlug].filter(([, rels]) => rels.length > 1)
	if (duplicated.length) {
		const list = duplicated.map(([slug, rels]) => `${slug} ← ${rels.join(' / ')}`)
		throw new Error(`slug が重なっている: ${list.join('、')}`)
	}

	for (const only of ONLY) {
		if (!bundles.some((b) => b.slug === only || b.rel === only)) {
			usage(`--only ${only} に当たる記事が無い`)
		}
	}
	const selected = ONLY.length
		? bundles.filter((b) => ONLY.includes(b.slug) || ONLY.includes(b.rel))
		: bundles
	const plans = selected.map((bundle) => buildPlan(bundle, defined))

	// --- 一覧 ---------------------------------------------------------------
	const byCategory = {}
	const counts = { thumbnail: 0, local: 0, external: 0, appended: 0, authors: 0, tags: 0 }
	const sources = new Set()
	const rows = []
	for (const plan of plans) {
		byCategory[plan.category] = (byCategory[plan.category] ?? 0) + 1
		if (plan.thumbnail) {
			counts.thumbnail++
			sources.add(plan.thumbnail)
		}
		for (const file of plan.images) sources.add(file)
		counts.local += plan.counts.local
		counts.external += plan.counts.external
		counts.appended += plan.appended.length
		if (plan.authors.length) counts.authors++
		if (plan.tags.length) counts.tags++
		const total = plan.counts.local + plan.counts.external
		const notes = [
			plan.counts.external ? `外部 ${plan.counts.external}` : '',
			plan.appended.length ? `末尾に追加 ${plan.appended.length}` : '',
		].filter(Boolean)
		rows.push([
			plan.slug,
			plan.category,
			plan.date,
			plan.thumbnail ? path.basename(plan.thumbnail) : '-',
			total ? `${total}${notes.length ? `（うち${notes.join('・')}）` : ''}` : '-',
			plan.authors.join(',') || '-',
			plan.tags.join(',') || '-',
		])
	}
	const categories = Object.entries(byCategory)
		.map(([k, v]) => `${k} ${v}`)
		.join(' / ')
	const summary = [
		`記事 ${plans.length} 本（${categories}）${skipped.length ? `、除外: ${skipped.join('、')}` : ''}`,
		`アイキャッチ付き ${counts.thumbnail} 本、本文画像 ${counts.local + counts.external} か所（ローカル ${counts.local}〔うち末尾に追加 ${counts.appended}〕+ 外部 URL ${counts.external}）、画像ファイル ${sources.size} 個`,
		`authors 付き ${counts.authors} 本、tags 付き ${counts.tags} 本`,
	]

	if (opts['dry-run']) {
		printTable(['slug', 'category', 'date', 'アイキャッチ', '本文画像', 'authors', 'tags'], rows)
		console.log('')
		for (const line of summary) console.log(line)
		const bytes = [...sources].reduce((n, file) => n + fs.statSync(file).size, 0)
		console.log(`画像の原本 合計 ${formatBytes(bytes)}`)
		printWarnings()
		return 0
	}

	// --- 書き出し -----------------------------------------------------------
	fs.mkdirSync(POSTS_DIR, { recursive: true })
	const result = { created: [], recreated: [], skipped: [], failed: [] }
	const stats = {
		images: 0,
		processed: 0,
		originalBytes: 0,
		outputBytes: 0,
		gpsRemoved: 0,
		log: [],
	}
	for (const plan of plans) {
		const exists = fs.existsSync(path.join(POSTS_DIR, plan.slug))
		if (exists && !opts.force) {
			result.skipped.push(plan.slug)
			console.log(`[既にある・飛ばした] ${plan.slug}`)
			continue
		}
		try {
			await writePost(plan, stats)
			result[exists ? 'recreated' : 'created'].push(plan.slug)
			console.log(`[${exists ? '作り直し' : '作成'}] ${plan.slug}  ← ${plan.rel}`)
		} catch (error) {
			result.failed.push(plan.slug)
			console.error(`[失敗] ${plan.slug}: ${error.message}`)
		}
	}

	if (stats.log.length) {
		console.log('')
		console.log('画像:')
		for (const line of stats.log) console.log(`  ${line}`)
	}
	console.log('')
	for (const line of summary) console.log(line)
	console.log(
		`結果: 作成 ${result.created.length} / 作り直し ${result.recreated.length} / 既にあるので飛ばした ${result.skipped.length} / 失敗 ${result.failed.length}`
	)
	console.log(
		`画像: ${stats.images} 個を書き出し（うち加工 ${stats.processed}）、原本 ${formatBytes(stats.originalBytes)} → 書き出し後 ${formatBytes(stats.outputBytes)}、GPS を落とした画像 ${stats.gpsRemoved} 枚`
	)
	if (result.skipped.length) {
		console.log(
			'飛ばした記事は、この repo にある内容を残している。旧サイトの内容で作り直すなら --force'
		)
	}
	printWarnings()
	return result.failed.length ? 1 : 0
}

main().then(
	(code) => process.exit(code),
	(error) => {
		console.error(`中断: ${error.message}`)
		process.exit(1)
	}
)
