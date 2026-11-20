/**
 * RSS 2.0 フィード (新しい順に 20 件)。ビルド時に /rss.xml として書き出す。
 */
import type { APIRoute } from 'astro'
import { FEED_COUNT, escapeXml, excerptOf, getPostViews, postHref } from '../lib/posts'
import { SITE_DESCRIPTION, SITE_NAME } from '../lib/site'

export const GET: APIRoute = async ({ site }) => {
	// 絶対 URL の基点は astro.config.mjs の site
	if (!site) throw new Error('astro.config.mjs に site を設定してください (RSS の絶対 URL に使う)')
	const absolute = (path: string) => new URL(path, site).href

	const views = (await getPostViews()).slice(0, FEED_COUNT)

	const items = views
		.map(({ post, category }) => {
			const postUrl = absolute(postHref(post.id))
			return [
				'    <item>',
				`      <title>${escapeXml(post.data.title)}</title>`,
				`      <link>${postUrl}</link>`,
				`      <guid isPermaLink="true">${postUrl}</guid>`,
				`      <pubDate>${post.data.date.toUTCString()}</pubDate>`,
				`      <category>${escapeXml(category.label)}</category>`,
				`      <description>${escapeXml(excerptOf(post, 200))}</description>`,
				'    </item>',
			].join('\n')
		})
		.join('\n')

	// フィードの更新日時は、載っている中でいちばん新しい記事の日付
	const newest = views[0]?.post.data.date ?? new Date()

	return new Response(
		`<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${escapeXml(SITE_NAME)}</title>
    <link>${absolute('/')}</link>
    <description>${escapeXml(SITE_DESCRIPTION)}</description>
    <atom:link href="${absolute('/rss.xml')}" rel="self" type="application/rss+xml"/>
    <language>ja</language>
    <lastBuildDate>${newest.toUTCString()}</lastBuildDate>
${items}
  </channel>
</rss>
`,
		{ headers: { 'Content-Type': 'application/rss+xml; charset=utf-8' } }
	)
}
