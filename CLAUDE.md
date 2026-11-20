# aiken — 北海道大学医学部AI研究会（北医AI研）のサイト

学生団体「北海道大学医学部AI研究会」（通称: 北医AI研）の公式サイト。旧サイトは Hugo の
`HokuMedAI/hokumedai.github.io`（記事は `scripts/import-hugo.mjs` で取り込み済み）。

- Astro（静的出力、adapter なし）。`dist/` を Cloudflare Workers の static assets で配る（`wrangler.jsonc`）。
  Worker スクリプトは `worker/index.ts` の 1 つだけで、お問い合わせフォームの送信（`POST /api/contact`）を受けて
  Discord の Webhook へ流す。それ以外のリクエストは static assets。CI は `.github/workflows/site.yml`（master への push でデプロイ）
- お問い合わせフォーム: **入力値（名前・メール・本文）と Webhook の URL を、ログにも応答にも出さない。** 届け先・連絡手段
  （メール送信、保存、別サービスへの転送など）を勝手に増やさない。Worker の型検査（`pnpm check` の対象外）と設定は README の「公開」
- **姉妹 repo `prism-hu/website`（prism-hu.org）の流儀に揃える**: pnpm、タブインデント、prettier 設定、
  `wrangler.jsonc` と CI の形、末尾スラッシュ付きの URL、ページ遷移の作り。迷ったら website の同種のコードを読む
  （スタイルだけは別: こちらは Tailwind を使わず、コンポーネントの scoped CSS と `src/styles/tokens.css` の変数）
- **中身はすべて repo 内の Markdown / YAML**（`src/content/`）。定義は `src/content.config.ts` で、項目名の
  打ち間違いや型の違いはビルド時にエラーになる。書き方は README
- ページ遷移は普通のページ読み込みのまま、ブラウザ標準の機能だけで滑らかにしている（View Transitions と
  Speculation Rules。`src/layouts/Base.astro` と `tokens.css` の末尾）。SPA ルーター（`<ClientRouter />`）は使わない。
  prerender されたページでも `<script>` は走るので、表示されてから動かす処理は `document.prerendering` に注意する
- サイト内リンクは必ず末尾スラッシュ付きで書く（`/posts/`、`/members/`、`/#about`）
- 色・角丸・影は `src/styles/tokens.css` の変数を使う。コンポーネントに生の値を書かない
- 部員の学年と期は入学年度から計算する（`src/lib/members.ts`）。年度替わりに部員データを直さなくてよい
- トップページの元デザインは `,docs/landing-source.html`（学生が Claude Design で作った書き出し
  `,docs/北医AI研究会HP_261118.html` を展開したもの）。`,docs/` は ken の手元のメモ置き場で、git には入れない

## 開発

- dev サーバーは ken の tmux の window `aiken` で `pnpm dev`（http://localhost:4321、0.0.0.0 で待ち受け。
  スマホからは LAN / Tailscale の IP で開ける）。Claude の内部 shell では起動しない
- `pnpm check`（型と中身の検査）/ `pnpm exec tsc -p worker`（Worker の型）/ `pnpm test`（`src/lib/` と `worker/` の単体テスト）/ `pnpm format`
- 画面の確認は PC と幅 390px の両方で行う

## 決めごと

- **事実でないことを載せない。** 元デザインには生成されたままの架空の内容（部員・人数・連絡先・研究例）が
  混ざっていた。人数・料金・連絡先・所要時間などは、確認できた出典があるものだけを書く
- **この repo は public。** 研究の画像は共同研究先のデータを含むので、足す・差し替えるときは載せてよいかを確かめる。
  部員の写真・コメントも本人が出してよいと言ったものだけ
- commit / push は ken の指示があるときだけ
