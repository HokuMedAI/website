/**
 * 部員の学年と期。入学年度 (frontmatter の entryYear) から計算するので、年度が替わっても部員のファイルを直さなくてよい。
 *
 * 期は医学科のもの。2022 年度入学が 104 期 (2026 年度の 5 年生)。
 *
 * このファイルは test/members.test.mjs が node で直接読む。
 * 型を取り除くだけで動く書き方に留め、ほかの .ts を import しない
 */

const MEDICINE_FIRST_CLASS_OFFSET = 1918 // 入学年度 - 1918 = 期 (2022 → 104)
const FISCAL_YEAR_START_MONTH = 4
const DEFAULT_DEPARTMENT = '医学科'

/** 日本時間での年度 (4 月始まり) */
export function fiscalYear(now: Date = new Date()): number {
	const parts = new Intl.DateTimeFormat('en-US', {
		timeZone: 'Asia/Tokyo',
		year: 'numeric',
		month: 'numeric',
	}).formatToParts(now)
	const year = Number(parts.find((p) => p.type === 'year')?.value)
	const month = Number(parts.find((p) => p.type === 'month')?.value)
	return month >= FISCAL_YEAR_START_MONTH ? year : year - 1
}

/** 学年 (1 始まり)。入学年度が無い・未来のときは null */
export function gradeOf(
	entryYear: number | null | undefined,
	now: Date = new Date()
): number | null {
	if (!entryYear) return null
	const grade = fiscalYear(now) - entryYear + 1
	return grade >= 1 ? grade : null
}

/** 医学科の期。医学科以外 (department が入っている) と入学年度なしは null */
export function classNumberOf(
	entryYear: number | null | undefined,
	department: string | null | undefined
): number | null {
	if (!entryYear) return null
	if (department && department !== DEFAULT_DEPARTMENT) return null
	return entryYear - MEDICINE_FIRST_CLASS_OFFSET
}
