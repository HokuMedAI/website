// 部員の学年・期の計算 (src/lib/members.ts) のテスト。
// 年度の境目は日本時間で決まるので、UTC では前日になる時刻で確かめる
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { classNumberOf, fiscalYear, gradeOf } from '../src/lib/members.ts'

/** 日本時間の日時から Date を作る */
const jst = (iso) => new Date(`${iso}+09:00`)

describe('fiscalYear', () => {
	it('3/31 の終わりまでは前の年度', () => {
		assert.equal(fiscalYear(jst('2026-03-31T23:59:59')), 2025)
	})

	it('4/1 の 0 時から新しい年度', () => {
		assert.equal(fiscalYear(jst('2026-04-01T00:00:00')), 2026)
	})

	it('境目は UTC ではなく日本時間で決まる', () => {
		// 日本時間 4/1 0:00 = UTC 3/31 15:00
		assert.equal(fiscalYear(new Date('2026-03-31T14:59:59Z')), 2025)
		assert.equal(fiscalYear(new Date('2026-03-31T15:00:00Z')), 2026)
	})

	it('1〜3 月は前の年の年度、12 月はその年の年度', () => {
		assert.equal(fiscalYear(jst('2027-01-01T00:00:00')), 2026)
		assert.equal(fiscalYear(jst('2026-12-31T23:59:59')), 2026)
	})
})

describe('gradeOf', () => {
	it('入学した年度が 1 年', () => {
		assert.equal(gradeOf(2026, jst('2026-04-01T00:00:00')), 1)
	})

	it('2022 年度入学は 2026 年度に 5 年', () => {
		assert.equal(gradeOf(2022, jst('2026-11-20T12:00:00')), 5)
	})

	it('年度が替わると 1 つ上がる', () => {
		assert.equal(gradeOf(2024, jst('2026-03-31T23:59:59')), 2)
		assert.equal(gradeOf(2024, jst('2026-04-01T00:00:00')), 3)
	})

	it('入学前 (未来の年度) は null', () => {
		assert.equal(gradeOf(2027, jst('2026-11-20T12:00:00')), null)
		assert.equal(gradeOf(2026, jst('2026-03-31T23:59:59')), null)
	})

	it('入学年度が無ければ null', () => {
		assert.equal(gradeOf(undefined, jst('2026-11-20T12:00:00')), null)
		assert.equal(gradeOf(null, jst('2026-11-20T12:00:00')), null)
	})
})

describe('classNumberOf', () => {
	it('2022 年度入学は 104 期', () => {
		assert.equal(classNumberOf(2022, undefined), 104)
	})

	it('入学年度が 1 つ下がると期も 1 つ下がる', () => {
		assert.equal(classNumberOf(2021, undefined), 103)
		assert.equal(classNumberOf(2026, undefined), 108)
	})

	it('学科を医学科と明記しても同じ', () => {
		assert.equal(classNumberOf(2022, '医学科'), 104)
	})

	it('医学科以外は null', () => {
		assert.equal(classNumberOf(2022, '保健学科'), null)
		assert.equal(classNumberOf(2024, '工学部'), null)
	})

	it('入学年度が無ければ null', () => {
		assert.equal(classNumberOf(undefined, undefined), null)
		assert.equal(classNumberOf(null, '医学科'), null)
	})
})
