// サイト全体で使う定数。文言や区分を変えるときはここを直す

export const SITE_NAME = '北海道大学医学部AI研究会'
/** 通称。ナビなど短く出したい所で使う */
export const SITE_SHORT_NAME = '北医AI研'
export const SITE_NAME_EN = 'Hokkaido University School of Medicine AI Study Club'
export const SITE_DESCRIPTION =
	'通称「北医AI研」。北海道大学医学部の学生を中心に、AIの医療応用を学び、研究する学生団体です。'

/** 設立年度 (紙面の VOL. の起点) */
export const FOUNDED_FISCAL_YEAR = 2023

/** 参加の窓口 */
export const DISCORD_INVITE_URL = 'https://discord.gg/t9kKpVHtyj'
export const PRISM_HU_URL = 'https://prism-hu.org/'

/** X (旧 Twitter) のアカウント名 (@ は付けない)。共有されたときのカードに、サイトのアカウントとして出る */
export const X_ACCOUNT = 'HU_med_ai'

/** Instagram のアカウントの URL。空のあいだは、お問い合わせページとフッターに Instagram を出さない */
export const INSTAGRAM_URL = 'https://www.instagram.com/hu_med_ai/'

/** GitHub の organization */
export const GITHUB_URL = 'https://github.com/HokuMedAI'

/** フッターの「リンク」に、SNS・GitHub の後ろに並べる関連先 */
export const RELATED_LINKS = [
	{ label: 'PRISM-HU', href: PRISM_HU_URL },
	{ label: '北海道大学医学部', href: 'https://www.med.hokudai.ac.jp/' },
] as const

/**
 * お問い合わせフォームの Turnstile (Cloudflare の bot 対策) の site key。公開してよい値。
 * 空のあいだは、フォームに Turnstile を出さない (スクリプトも読み込まない)。
 * 入れるときは、対になる secret key を Worker に入れる (`pnpm wrangler secret put TURNSTILE_SECRET_KEY`。README の「公開」)
 */
export const TURNSTILE_SITE_KEY: string = ''

/** 活動予定の Google カレンダー (公開設定のカレンダー ID) */
export const GOOGLE_CALENDAR_ID =
	'9b29f15f8b6aec88cedffa51301604b4522657a49001d6e9334d0f0d626f366a@group.calendar.google.com'

/**
 * 記事のカテゴリ。記事の frontmatter の category には、子を持たないもの
 * (feature / study / lecture / meeting) の slug を書く。
 * 親 (activity) の一覧ページは子の記事をまとめて出す
 */
export const CATEGORIES = [
	{
		slug: 'feature',
		label: '特集',
		description: '技術解説や研究紹介、学会・イベントの報告など、読み物として書いた記事',
		children: [],
	},
	{
		slug: 'activity',
		label: '活動日誌',
		description: 'ふだんの活動の記録',
		children: [
			{ slug: 'study', label: '勉強会' },
			{ slug: 'lecture', label: '定期レクチャー' },
			{ slug: 'meeting', label: 'ミーティング' },
		],
	},
] as const

/** 記事に付けられるカテゴリ (子を持たないもの) */
export const POST_CATEGORIES = ['feature', 'study', 'lecture', 'meeting'] as const
export type PostCategory = (typeof POST_CATEGORIES)[number]

/** 部員の区分。マスコットは部員の一覧の最後に並び、人数には数えない */
export const MEMBER_GROUPS = ['部員', '顧問', 'メンター', 'マスコット'] as const

/** 研究の区分 */
export const RESEARCH_SCOPES = ['学内', '学外'] as const

/** 日付を「2026.04.22」の形にする (日本時間) */
export function formatDate(date: Date | null | undefined): string {
	if (!date) return ''
	const parts = new Intl.DateTimeFormat('ja-JP', {
		timeZone: 'Asia/Tokyo',
		year: 'numeric',
		month: '2-digit',
		day: '2-digit',
	}).formatToParts(date)
	const get = (type: string) => parts.find((p) => p.type === type)?.value ?? ''
	return `${get('year')}.${get('month')}.${get('day')}`
}
