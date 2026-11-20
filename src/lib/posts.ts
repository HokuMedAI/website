/**
 * 記事 (posts コレクション) の読み込みと、表示用の整形。
 * 一覧・カテゴリ別・タグ別・詳細・RSS・トップページが共通で使う。
 * コンテンツの読み込みに依らない計算は posts-core.ts にある
 */
import { getCollection, getEntries, getEntry, type CollectionEntry } from 'astro:content'
import {
	byDateDesc,
	categoryPath,
	categoryScope,
	excerptFrom,
	kindOf,
	type Category,
	type PostKind,
} from './posts-core'

export * from './posts-core'

export type PostEntry = CollectionEntry<'posts'>
export type TagEntry = CollectionEntry<'tags'>
export type AuthorEntry = CollectionEntry<'authors'>

/** 一覧 1 ページあたりの件数。3 列・2 列のどちらでも端数が出ない数にしてある */
export const POSTS_PER_PAGE = 18

/** 一覧の先頭に大きく出す読み物 (特集・レポート) の本数 */
export const PICKUP_COUNT = 3

/** RSS に載せる本数 */
export const FEED_COUNT = 20

/**
 * 公開している記事を、日付の新しい順で返す。
 * draft: true の記事はここで落とす。記事を出す所 (一覧・詳細・RSS・件数) は必ずこの関数を通す
 */
export async function getPublishedPosts(): Promise<PostEntry[]> {
	const posts = await getCollection('posts', ({ data }) => !data.draft)
	return posts.sort(byDateDesc)
}

/** カードやチップが使う、表示用にまとめた記事 */
export interface PostView {
	post: PostEntry
	href: string
	kind: PostKind
	/** 記事に付いているカテゴリ。カードのチップに出す */
	category: Category
	/** 最上位から category までの道筋 (親 → 子の順) */
	categories: Category[]
}

export function toPostView(post: PostEntry): PostView {
	const categories = categoryPath(post.data.category)
	return {
		post,
		href: postHref(post.id),
		kind: kindOf(post.data.category),
		category: categories[categories.length - 1],
		categories,
	}
}

/** 公開している記事を、表示用にまとめて新しい順で返す */
export async function getPostViews(): Promise<PostView[]> {
	return (await getPublishedPosts()).map(toPostView)
}

/** そのカテゴリの一覧に載る記事 (親カテゴリは子の記事も含む) */
export function inCategory(views: PostView[], slug: string): PostView[] {
	const scope = categoryScope(slug)
	return views.filter((view) => scope.includes(view.post.data.category))
}

/** そのタグが付いた記事 */
export function withTag(views: PostView[], tagId: string): PostView[] {
	return views.filter((view) => view.post.data.tags.some((tag) => tag.id === tagId))
}

/** その署名が付いた記事 */
export function withAuthor(views: PostView[], authorId: string): PostView[] {
	return views.filter((view) => view.post.data.authors.some((author) => author.id === authorId))
}

/** 一覧や RSS に出す概要。description があればそれを、無ければ本文の先頭から作る */
export function excerptOf(post: PostEntry, max = 110): string {
	return excerptFrom(post.data.description, post.body, max)
}

/**
 * 記事の tags / authors (id の参照) を実体にする。
 * 定義に無い id が書かれていたら、どの記事のどの id かを示してビルドを止める
 */
async function resolve<C extends 'tags' | 'authors'>(
	post: PostEntry,
	field: C,
	refs: { collection: C; id: string }[]
): Promise<CollectionEntry<C>[]> {
	const entries: (CollectionEntry<C> | undefined)[] = await getEntries(refs)
	return entries.map((entry, i) => {
		if (entry) return entry
		throw new Error(
			`src/content/posts/${post.id}/index.md: ${field} の "${refs[i].id}" が src/content/${field}.yaml にありません`
		)
	})
}

/** 記事に付いたタグ (書いた順) */
export const tagsOf = (post: PostEntry) => resolve(post, 'tags', post.data.tags)

/** 記事の署名 (書いた順) */
export const authorsOf = (post: PostEntry) => resolve(post, 'authors', post.data.authors)

/** 署名の表示名。部員に紐づく署名は部員の氏名 (フルネーム)、それ以外は署名の name */
export async function authorNameOf(author: AuthorEntry): Promise<string> {
	if (!author.data.member) return author.data.name
	const member = await getEntry(author.data.member)
	return member?.data.name ?? author.data.name
}

/**
 * 署名をクリックしたときの行き先。部員に紐づく署名はメンバー紹介のその人、それ以外はその署名の記事一覧
 */
export function authorLinkHref(author: AuthorEntry): string {
	return author.data.member ? memberHref(author.data.member.id) : authorHref(author.id)
}

/**
 * 署名の一覧と、部員ごとの「その人の記事一覧の URL と本数」。
 * 署名の member に、src/content/members/ に無い名前が書かれていたらビルドを止める
 */
export async function getAuthorIndex(views: PostView[]) {
	const [authors, members] = await Promise.all([getCollection('authors'), getCollection('members')])
	const memberIds = new Set(members.map((member) => member.id))
	const byMember = new Map<string, { href: string; count: number }>()
	for (const author of authors) {
		const memberId = author.data.member?.id
		if (!memberId) continue
		if (!memberIds.has(memberId)) {
			throw new Error(
				`src/content/authors.yaml: ${author.id} の member "${memberId}" が src/content/members/ にありません`
			)
		}
		if (byMember.has(memberId)) {
			throw new Error(
				`src/content/authors.yaml: member "${memberId}" が 2 つの署名に書かれています (1 人に 1 つまで)`
			)
		}
		byMember.set(memberId, {
			href: authorHref(author.id),
			count: withAuthor(views, author.id).length,
		})
	}
	return { authors, byMember }
}

/* ---------- URL (サイト内リンクは末尾スラッシュ付き) ---------- */

export const POSTS_PATH = '/posts/'

export function postHref(slug: string): string {
	return `/posts/${slug}/`
}

export function categoryHref(slug: string): string {
	return `/category/${slug}/`
}

export function tagHref(id: string): string {
	return `/tag/${id}/`
}

/** 署名ごとの記事一覧 */
export function authorHref(id: string): string {
	return `/author/${id}/`
}

/** メンバー紹介の中の、その人のカード (開くと、そのカードが目立つ) */
export function memberHref(memberId: string): string {
	return `/members/#${memberId}`
}
