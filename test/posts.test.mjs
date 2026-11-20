// 記事まわりの計算 (src/lib/posts-core.ts) の単体テスト。pnpm test で走る
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
	CATEGORY_TREE,
	byDateDesc,
	categoryPath,
	categoryScope,
	englishLabel,
	escapeXml,
	excerptFrom,
	flattenCategories,
	kindOf,
	latestCount,
	neighborsOf,
	pageHref,
	pageParam,
	pagerItems,
	paginate,
	plainText,
	truncate,
} from '../src/lib/posts-core.ts'
import { CATEGORIES, POST_CATEGORIES } from '../src/lib/site.ts'

describe('カテゴリの階層', () => {
	it('site.ts の CATEGORIES を、children を必ず持つ形にそろえる', () => {
		assert.deepEqual(
			CATEGORY_TREE.map((category) => category.slug),
			CATEGORIES.map((category) => category.slug)
		)
		for (const category of flattenCategories()) {
			assert.ok(Array.isArray(category.children), category.slug)
		}
	})

	it('平らにすると 親 → 子 の順に並ぶ', () => {
		const tree = [
			{ slug: 'a', label: 'A', children: [] },
			{
				slug: 'b',
				label: 'B',
				children: [
					{ slug: 'b1', label: 'B1', children: [] },
					{ slug: 'b2', label: 'B2', children: [] },
				],
			},
		]
		assert.deepEqual(
			flattenCategories(tree).map((category) => category.slug),
			['a', 'b', 'b1', 'b2']
		)
	})

	it('記事に付けられるカテゴリ (POST_CATEGORIES) は、子を持たないカテゴリと一致する', () => {
		const leaves = flattenCategories()
			.filter((category) => category.children.length === 0)
			.map((category) => category.slug)
		assert.deepEqual([...leaves].sort(), [...POST_CATEGORIES].sort())
	})

	it('categoryPath は最上位から自分までの道筋を返す', () => {
		const parent = CATEGORY_TREE.find((category) => category.children.length > 0)
		const child = parent.children[0]
		assert.deepEqual(
			categoryPath(child.slug).map((category) => category.slug),
			[parent.slug, child.slug]
		)
		assert.deepEqual(
			categoryPath(parent.slug).map((category) => category.slug),
			[parent.slug]
		)
		assert.deepEqual(categoryPath('no-such-category'), [])
	})

	it('categoryScope は親なら自分と子すべて、子なら自分だけ', () => {
		const parent = CATEGORY_TREE.find((category) => category.children.length > 0)
		const children = parent.children.map((category) => category.slug)
		assert.deepEqual(categoryScope(parent.slug), [parent.slug, ...children])
		assert.deepEqual(categoryScope(children[0]), [children[0]])
		assert.deepEqual(categoryScope('no-such-category'), [])
	})

	it('kindOf: 子を持たない最上位カテゴリは読み物、子を持つカテゴリとその配下は記録', () => {
		for (const root of CATEGORY_TREE) {
			const expected = root.children.length === 0 ? 'reading' : 'log'
			assert.equal(kindOf(root.slug), expected, root.slug)
			for (const child of root.children) assert.equal(kindOf(child.slug), 'log', child.slug)
		}
	})

	it('englishLabel は英数字の slug を見出しにし、それ以外は fallback を返す', () => {
		assert.equal(englishLabel('feature', 'Post'), 'Feature')
		assert.equal(englishLabel('deep-learning', 'Post'), 'Deep Learning')
		assert.equal(englishLabel('勉強会', 'Post'), 'Post')
		assert.equal(englishLabel(undefined, 'Post'), 'Post')
	})
})

describe('並び', () => {
	const entry = (id, date) => ({ id, data: { date: new Date(date) } })

	it('byDateDesc は日付の新しい順、同じ日付は id の順', () => {
		const sorted = [
			entry('b', '2025-01-01'),
			entry('c', '2025-03-01'),
			entry('a', '2025-01-01'),
			entry('d', '2024-12-31'),
		].sort(byDateDesc)
		assert.deepEqual(
			sorted.map((item) => item.id),
			['c', 'a', 'b', 'd']
		)
	})

	it('neighborsOf は新しい順の一覧から前後を返す', () => {
		const list = [{ id: 'new' }, { id: 'mid' }, { id: 'old' }]
		assert.deepEqual(neighborsOf(list, 'mid'), { newer: { id: 'new' }, older: { id: 'old' } })
		assert.deepEqual(neighborsOf(list, 'new'), { newer: null, older: { id: 'mid' } })
		assert.deepEqual(neighborsOf(list, 'old'), { newer: { id: 'mid' }, older: null })
		assert.deepEqual(neighborsOf(list, 'none'), { newer: null, older: null })
		assert.deepEqual(neighborsOf([{ id: 'only' }], 'only'), { newer: null, older: null })
	})

	it('latestCount: 6 本以上は 6、3〜5 本は 3、2 本以下はあるだけ', () => {
		assert.deepEqual([0, 1, 2, 3, 4, 5, 6, 7, 73].map(latestCount), [0, 1, 2, 3, 3, 3, 6, 6, 6])
	})
})

describe('ページ分け', () => {
	const range = (n) => Array.from({ length: n }, (_, i) => i + 1)

	it('0 件でも空の 1 ページを返す', () => {
		assert.deepEqual(paginate([], 18), [{ items: [], page: 1, totalPages: 1 }])
	})

	it('ちょうど 1 ページぶんなら 1 ページ', () => {
		const pages = paginate(range(18), 18)
		assert.equal(pages.length, 1)
		assert.equal(pages[0].items.length, 18)
	})

	it('73 件を 18 件ずつ → 5 ページ、最後は 1 件。抜けも重複も無い', () => {
		const pages = paginate(range(73), 18)
		assert.deepEqual(
			pages.map((page) => page.items.length),
			[18, 18, 18, 18, 1]
		)
		assert.deepEqual(
			pages.map((page) => page.page),
			[1, 2, 3, 4, 5]
		)
		assert.ok(pages.every((page) => page.totalPages === 5))
		assert.deepEqual(
			pages.flatMap((page) => page.items),
			range(73)
		)
	})

	it('URL: 1 ページ目は basePath そのまま、2 ページ目以降は page/<n>/ (末尾スラッシュ付き)', () => {
		assert.equal(pageHref('/posts/', 1), '/posts/')
		assert.equal(pageHref('/posts/', 2), '/posts/page/2/')
		assert.equal(pageHref('/category/activity/', 3), '/category/activity/page/3/')
		assert.equal(pageParam(1), undefined)
		assert.equal(pageParam(2), 'page/2')
	})

	it('pagerItems: 7 ページまでは全部並べる', () => {
		assert.deepEqual(pagerItems(1, 1), [1])
		assert.deepEqual(pagerItems(3, 5), [1, 2, 3, 4, 5])
		assert.deepEqual(pagerItems(7, 7), [1, 2, 3, 4, 5, 6, 7])
	})

	it('pagerItems: 8 ページ以上は先頭・末尾・現在地の前後だけ残し、飛ばした所に gap', () => {
		assert.deepEqual(pagerItems(1, 10), [1, 2, 'gap', 10])
		assert.deepEqual(pagerItems(2, 10), [1, 2, 3, 'gap', 10])
		assert.deepEqual(pagerItems(5, 10), [1, 'gap', 4, 5, 6, 'gap', 10])
		assert.deepEqual(pagerItems(9, 10), [1, 'gap', 8, 9, 10])
		assert.deepEqual(pagerItems(10, 10), [1, 'gap', 9, 10])
	})
})

describe('概要の切り出し', () => {
	it('truncate は文字数で切って … を付ける (絵文字を途中で割らない)', () => {
		assert.equal(truncate('あいうえお', 5), 'あいうえお')
		assert.equal(truncate('あいうえおか', 5), 'あいうえお…')
		assert.equal(truncate('😀😀😀', 2), '😀😀…')
		assert.equal(truncate('あい うえ', 3), 'あい…')
	})

	it('段落をつなぎ、強調・リンク・インラインコードの記号を外す', () => {
		const md = [
			'これは**太字**と*強調*と~~打ち消し~~と`code`です。',
			'',
			'[リンク](https://example.com/)と[参照リンク][ref]も文字だけ残る。',
			'',
			'[ref]: https://example.com/ref',
		].join('\n')
		assert.equal(
			plainText(md),
			'これは太字と強調と打ち消しとcodeです。 リンクと参照リンクも文字だけ残る。'
		)
	})

	it('見出し・画像・表・区切り線は飛ばす', () => {
		const md = [
			'## 開催概要',
			'',
			'本文の一行目。',
			'![写真](./photo.jpg)',
			'',
			'| 手法 | 精度 |',
			'| --- | ---: |',
			'| A | 0.8 |',
			'',
			'---',
			'',
			'最後の段落。',
		].join('\n')
		assert.equal(plainText(md), '本文の一行目。 最後の段落。')
	})

	it('箇条書き・引用は行頭の記号を外して文字を残す', () => {
		const md = [
			'- **日時**: 2025/8/20 16:30~',
			'- **人数**: 5名',
			'  - 入れ子',
			'1. 番号つき',
			'> 引用の文',
		].join('\n')
		assert.equal(plainText(md), '日時: 2025/8/20 16:30~ 人数: 5名 入れ子 番号つき 引用の文')
	})

	it('コードブロックと <pre> は中身ごと飛ばす', () => {
		const md = [
			'前の文。',
			'',
			'```python',
			'import torch  # **これは出ない**',
			'```',
			'',
			'間の文。',
			'',
			'<pre>',
			'  ∧＿∧',
			' （´∀｀）',
			'</pre>',
			'',
			'~~~',
			'これも出ない',
			'~~~',
			'',
			'後ろの文。',
		].join('\n')
		assert.equal(plainText(md), '前の文。 間の文。 後ろの文。')
	})

	it('閉じていないコードブロックは最後まで飛ばす', () => {
		assert.equal(plainText('前の文。\n\n```\nコード\n続き'), '前の文。')
	})

	it('コードブロックが 2 つあっても、間の文は残る', () => {
		const md = '```\nA\n```\n\n間の文。\n\n```\nB\n```\n\n後ろの文。'
		assert.equal(plainText(md), '間の文。 後ろの文。')
	})

	it('生 HTML のタグは外して中の文字を残し、行末 2 スペースや <br> の改行は空白 1 つにする', () => {
		const md = '一行目  \n二行目<br>三行目 <span class="x">強調</span>&amp;&nbsp;記号 <!-- メモ -->'
		assert.equal(plainText(md), '一行目 二行目 三行目 強調 & 記号')
	})

	it('snake_case や URL の下線は消さない', () => {
		assert.equal(
			plainText('関数 get_user_name と https://example.com/a_b_c と _強調_ です'),
			'関数 get_user_name と https://example.com/a_b_c と 強調 です'
		)
	})

	it('excerptFrom: description があればそのまま、無ければ本文の先頭を切って使う', () => {
		assert.equal(excerptFrom(' 手で書いた概要 ', '本文', 10), '手で書いた概要')
		assert.equal(
			excerptFrom(undefined, '## 見出し\n\nあいうえおかきくけこさしすせそ', 10),
			'あいうえおかきくけこ…'
		)
		assert.equal(excerptFrom('', '短い本文', 10), '短い本文')
		assert.equal(excerptFrom(undefined, undefined, 10), '')
		assert.equal(excerptFrom(undefined, '![](./only-image.jpg)', 10), '')
	})
})

describe('RSS', () => {
	it('escapeXml は XML の特殊文字を実体参照にする', () => {
		assert.equal(
			escapeXml(`A&B <tag> "quote" 'apos'`),
			'A&amp;B &lt;tag&gt; &quot;quote&quot; &apos;apos&apos;'
		)
	})
})
