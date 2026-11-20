// サイトの中身 (Markdown / YAML) の定義。項目名の打ち間違いや型の違いは、ここでビルド時にエラーになる。
//   src/content/posts/<slug>/index.md  … 記事。1 記事 = 1 ディレクトリ。画像は同じディレクトリに置いて相対参照
//   src/content/members/<id>.md        … 部員・顧問・メンター・マスコット。1 人 = 1 ファイル。本文がその人のコメント
//   src/content/research.yaml          … 研究テーマの一覧 (画像は src/content/research/)
//   src/content/authors.yaml           … 記事の署名
//   src/content/tags.yaml              … 記事のタグ
import { defineCollection, reference } from 'astro:content'
import { file, glob } from 'astro/loaders'
import { z } from 'astro/zod'
import { MEMBER_GROUPS, POST_CATEGORIES, RESEARCH_SCOPES } from './lib/site'

// <slug>/index.md → <slug>
const dirId = ({ entry }: { entry: string }) => entry.split('/')[0]

const posts = defineCollection({
	loader: glob({ base: './src/content/posts', pattern: '*/index.md', generateId: dirId }),
	schema: ({ image }) =>
		z.strictObject({
			title: z.string(),
			// 公開日 (活動の記録なら開催日)。YYYY-MM-DD
			date: z.coerce.date(),
			category: z.enum(POST_CATEGORIES),
			// src/content/tags.yaml の id
			tags: z.array(reference('tags')).default([]),
			// src/content/authors.yaml の id。書いた順に表示する
			authors: z.array(reference('authors')).default([]),
			// 一覧・OGP に出る短い説明 (任意。無ければ本文の先頭から作る)
			description: z.string().optional(),
			// アイキャッチ画像 (任意)。同じディレクトリの画像を ./feature.jpg のように書く
			thumbnail: image().optional(),
			// true の間はサイトに出ない
			draft: z.boolean().default(false),
		}),
})

const members = defineCollection({
	loader: glob({ base: './src/content/members', pattern: '*.md' }),
	schema: ({ image }) =>
		z.strictObject({
			name: z.string(),
			group: z.enum(MEMBER_GROUPS).default('部員'),
			// 入学年度 (西暦)。部員のみ。学年と期はここから計算するので、年度替わりに直さなくてよい
			entryYear: z.number().int().optional(),
			// 学科。部員のみ。省略は医学科
			department: z.string().optional(),
			// 役職 (部長・副部長など)
			role: z.string().optional(),
			// 肩書き。学生でない部員 (研修医など)。入れると、カードに学科・学年の代わりに出る
			position: z.string().optional(),
			// 性別。部員のカードの色を決める (男 = 青、女 = ピンク。省略は青)
			gender: z.enum(['男', '女']).optional(),
			// 所属。顧問・メンターのみ
			affiliation: z.string().optional(),
			// 顔写真 (任意)。./photos/xxx.jpg のように書く
			photo: image().optional(),
			// 並び順 (同じ学年の中で小さいほど先)
			order: z.number().default(100),
		}),
})

const research = defineCollection({
	loader: file('./src/content/research.yaml'),
	schema: ({ image }) =>
		z.strictObject({
			id: z.string(),
			title: z.string(),
			// 分野のラベル (例: 病理画像)
			label: z.string().optional(),
			// 共同研究先
			partner: z.string().optional(),
			scope: z.enum(RESEARCH_SCOPES).default('学内'),
			summary: z.string().optional(),
			// 画像 (任意)。./research/xxx.jpg のように書く
			image: image().optional(),
			imageAlt: z.string().optional(),
			// 詳細へのリンク (関連記事など。任意)
			url: z.string().optional(),
			// 並び順 (小さいほど先)
			order: z.number().default(100),
		}),
})

const authors = defineCollection({
	loader: file('./src/content/authors.yaml'),
	schema: z.strictObject({
		id: z.string(),
		name: z.string(),
		bio: z.string().optional(),
	}),
})

const tags = defineCollection({
	loader: file('./src/content/tags.yaml'),
	schema: z.strictObject({
		id: z.string(),
		label: z.string(),
		description: z.string().optional(),
	}),
})

export const collections = { posts, members, research, authors, tags }
