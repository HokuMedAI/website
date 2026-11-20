# 北海道大学医学部AI研究会（北医AI研）のサイト

Astro の静的サイト。中身はすべてこの repo の Markdown と YAML で、master に push すると CI がビルドして
Cloudflare Workers に配置する。お問い合わせフォームの送信だけは、Cloudflare の Worker（`worker/`）が受けて
Discord へ流す。

## 動かす

```bash
pnpm install
pnpm dev        # http://localhost:4321（0.0.0.0 で待ち受け。同じ LAN / VPN のスマホからも開ける）
```

| コマンド      | 内容                                               |
| ------------- | -------------------------------------------------- |
| `pnpm dev`    | 開発サーバー。ファイルを保存すると画面に反映される |
| `pnpm check`  | 型と、記事・部員・研究の項目の検査                 |
| `pnpm test`   | `src/lib/` と `worker/` の単体テスト               |
| `pnpm build`  | 本番ビルド（`dist/`）                              |
| `pnpm format` | 整形（prettier）                                   |

## ページ

| パス                | 内容                                                          |
| ------------------- | ------------------------------------------------------------- |
| `/`                 | トップ（About / Activities / Articles / Research / Join Us）  |
| `/members/`         | メンバー紹介                                                  |
| `/contact/`         | お問い合わせ（Discord・Instagram と、Discord に届くフォーム） |
| `/posts/`           | 記事一覧（2 ページ目以降は `/posts/page/2/`）                 |
| `/posts/<slug>/`    | 記事                                                          |
| `/category/<slug>/` | カテゴリ別の一覧（親カテゴリは子も含む）                      |
| `/tag/<id>/`        | タグ別の一覧                                                  |
| `/rss.xml`          | RSS                                                           |

URL は末尾スラッシュ付き。ページ遷移は普通のページ読み込みのまま、ブラウザ標準の機能だけで滑らかにしている
（新旧ページの短いフェードと、リンクに触れた時点での先読み）。

## 記事の書き方

1 記事 = 1 ディレクトリ。ディレクトリ名が URL になる。`<日付>-<短い英語>` の形にする:

```
src/content/posts/2026-04-22-mokumoku/
├── index.md       # 本文
└── feature.jpg    # 画像は同じディレクトリに置いて相対参照
```

```markdown
---
title: 第47回もくもく会
date: 2026-04-22
category: mokumoku
tags: [the-leader-has-spoken]
authors: [ymd000]
description: 一覧に出る短い説明（省略すると本文の先頭から作る）
thumbnail: ./feature.jpg
---

## 開催概要

本文は Markdown。画像は `![説明](./photo.jpg)`。
```

| 項目          | 必須 | 内容                                                      |
| ------------- | ---- | --------------------------------------------------------- |
| `title`       | ○    | タイトル                                                  |
| `date`        | ○    | 公開日（活動の記録なら開催日）。`YYYY-MM-DD`              |
| `category`    | ○    | 下の表のどれか 1 つ                                       |
| `tags`        |      | `src/content/tags.yaml` の id。新しいタグは先にそこへ足す |
| `authors`     |      | `src/content/authors.yaml` の id。書いた順に表示される    |
| `description` |      | 一覧・SNS 共有に出る短い説明                              |
| `thumbnail`   |      | アイキャッチ画像。一覧のカードと記事の上部に出る          |
| `draft`       |      | `true` の間はサイトに出ない                               |

項目名を打ち間違えたり、定義に無いカテゴリ・タグ・署名を書いたりすると、`pnpm check` とビルドがエラーで止まる。

| `category` | 表示                    | 使いどころ                                     |
| ---------- | ----------------------- | ---------------------------------------------- |
| `feature`  | 特集                    | 技術解説や研究紹介など、読み物として書いた記事 |
| `report`   | レポート                | 学会・イベントへの参加報告                     |
| `mokumoku` | 活動日誌 › もくもく会   | ふだんの活動の記録                             |
| `seminar`  | 活動日誌 › 勉強会       | 〃                                             |
| `meeting`  | 活動日誌 › ミーティング | 〃                                             |

特集とレポートは、記事一覧の上部に大きく出る。

写真は長辺 1640px 以下の JPEG にしてから置く（スマホの原寸や PNG の写真は数十 MB になる）。
位置情報（EXIF の GPS）が入った写真はそのまま公開されるので、置く前に落とす。

## 部員の更新

1 人 = 1 ファイル（`src/content/members/<名前>.md`）。本文がその人のコメントになる。

```markdown
---
name: 村上 卓
group: 部員
entryYear: 2022
role: 部長
photo: ./photos/murakami.jpg
order: 10
---

ここに書いた文章が、メンバー紹介のカードに吹き出しで出る（空でもよい）。
```

| 項目          | 内容                                                                                                 |
| ------------- | ---------------------------------------------------------------------------------------------------- |
| `name`        | 氏名（必須）                                                                                         |
| `group`       | `部員` / `顧問` / `メンター` / `マスコット`（省略は部員）                                            |
| `entryYear`   | 入学年度（西暦）。部員のみ。**学年と期はここから自動で計算する**ので、年度が替わっても直さなくてよい |
| `department`  | 学科。省略は医学科（期は医学科だけに出る）                                                           |
| `role`        | 役職（部長・副部長など）                                                                             |
| `affiliation` | 所属。顧問・メンターのみ                                                                             |
| `photo`       | 顔写真（縦長 4:5 がきれいに収まる）。無いあいだは人物のシルエットが出る                              |
| `order`       | 並び順（同じ学年の中で小さいほど先）                                                                 |

卒業・退部した人はファイルを消す。

マスコットのふぐ（`fugu.md`）は部員の一覧の最後に並ぶ。人数には数えない。

## 研究の更新

`src/content/research.yaml` に 1 件ずつ書く。画像は `src/content/research/` に置く。
**この repo は public なので、共同研究先のデータを含む画像は、載せてよいかを確かめてから足す。**

## その他の設定

サイト名、Discord の招待リンク、X のアカウント名、Instagram、Google カレンダー、フォームの Turnstile の site key は `src/lib/site.ts` に
まとめてある。Instagram は、URL を入れるとお問い合わせページとフッターに出る（空のあいだは出ない）。
フッターの「リンク」に並べる関連先（`RELATED_LINKS`）と GitHub の URL も同じファイルにある。

トップページの文章（About・Activities・Join Us）は `src/components/landing/` に直接書いてある。

マスコットのふぐの絵は `src/assets/fugu/fugu.svg`（研究会のロゴと同じもの）。ページに置くときは `src/components/Fugu.astro` を使う。
favicon（`public/` の 3 つ）もこの絵から作っている。

SNS（X・Instagram・LINE・Discord など）でリンクを共有したときに出る画像は `public/og.png`（1200×630）。
記事は `thumbnail` があればそれが出て、無い記事とほかのページはこの画像になる。元は `scripts/og-card.html` で、
撮り直し方はそのファイルの先頭に書いてある。SNS 側は画像をしばらく覚えているので、差し替えてもすぐには変わらない。

## 構成

```
src/content/              中身（記事・部員・研究・署名・タグ）
src/content.config.ts     中身の項目の定義
src/pages/                ページ
src/components/           部品（landing = トップ、posts = 記事、members、contact）
src/layouts/Base.astro    共通の枠（head・ナビ・フッター・ページ遷移）
src/lib/                  定数と計算（site.ts、members.ts、posts*.ts）
src/styles/tokens.css     色・角丸・影などの変数
src/styles/prose.css      記事本文の組版
worker/                   お問い合わせフォームを受ける Worker（index.ts = 配線、contact.ts = 検証と Discord 向けの整形）
wrangler.jsonc            Cloudflare Workers の設定（assets・Worker・レート制限）
scripts/import-hugo.mjs   旧サイト（Hugo）の記事の取り込み
test/                     src/lib/ と worker/ の単体テスト
```

## 公開

master への push で `.github/workflows/site.yml` が検査・テスト・ビルドをして、Cloudflare Workers へデプロイする
（`dist/` の static assets と、お問い合わせフォームを受ける Worker `worker/index.ts`。設定は `wrangler.jsonc`）。
PR では検査とビルドまで。

必要なもの:

- GitHub の secrets（Settings → Secrets and variables → Actions）:
  `CLOUDFLARE_API_TOKEN`（Account: Workers Scripts: Edit）、`CLOUDFLARE_ACCOUNT_ID`、
  `DISCORD_WEBHOOK_URL`（お問い合わせフォームの届け先。下の「お問い合わせフォーム」）
- 公開ドメインは `aiken.prism-hu.org`（`astro.config.mjs` の `site`）。Cloudflare のダッシュボードで Worker `prism-aiken` の
  カスタムドメインに紐づける（`workers.dev` の URL は止めてあるので、紐づけるまで外からは見えない）

### お問い合わせフォーム

`/contact/` のフォームは `POST /api/contact` に送られ、Worker が Discord の Webhook へ流す
（名前・メール・所属・内容を 1 つの投稿にまとめる）。Webhook の URL は知られると誰でも投稿できてしまうので、
repo にもブラウザにも置かず、Worker の secret に入れる。

届け先を変えるとき:

1. Discord で、届け先にする**部員だけが見られるチャンネル**の「チャンネルの編集 → 連携サービス → ウェブフック」から
   Webhook を作り、URL をコピーする
2. GitHub の secret `DISCORD_WEBHOOK_URL` をその URL に更新する（URL を repo のファイルに書かない）
3. master に push する（デプロイのたびに、CI が GitHub の secret を Worker の secret として入れ直す）

Worker に届け先が入っていないあいだ、Worker は 503 を返し、フォームは
「送信できませんでした。Discord からご連絡ください」と出す。

迷惑送信への備えは、ほかのサイトからの送信の拒否（Origin の検査）、人に見えない項目（ハニーポット）、
送信元 IP ごとのレート制限（60 秒に 5 件。`wrangler.jsonc` の `ratelimits`）。足りなければ Turnstile を足す:

1. Cloudflare のダッシュボードの Turnstile でウィジェットを作る（ホスト名に公開ドメインを入れる。モードは Managed でよい）
2. site key を `src/lib/site.ts` の `TURNSTILE_SITE_KEY` に入れる（公開してよい値）
3. secret key を `pnpm wrangler secret put TURNSTILE_SECRET_KEY` で入れる
4. push してデプロイする

secret key を入れると、Worker は Turnstile のトークンが無い送信を断る。**site key の入ったサイトがデプロイされる前に
secret key だけ入れると、フォームから送れなくなる**ので、2 と 4 を先に済ませてから 3 を行う
（外すときは逆に、`pnpm wrangler secret delete TURNSTILE_SECRET_KEY` を先に）。

ローカルで送信まで通すとき（`pnpm dev` は Astro の dev サーバーで、`/api/contact` が無い。フォームの見た目は確かめられるが、
送信は必ず「送信できませんでした」になる）:

```bash
cp .dev.vars.example .dev.vars   # 値を入れる。試験用のチャンネルの Webhook を使う（実際に投稿される）
pnpm build                       # wrangler dev は dist/ を配る。サイトを直したらビルドし直す
pnpm wrangler dev                # http://localhost:8787（Worker と static assets の両方）
```

`.dev.vars` は git に入れない（`.gitignore` 済み）。

Turnstile までローカルで通すなら、ウィジェットのホスト名に `localhost` を足して、その site key と secret key を使う。
Worker は「トークンがこのサイト（リクエストを受けたホスト名）の、お問い合わせフォーム用のウィジェットで作られたこと」まで
確かめるので、Cloudflare が公開している[試験用の鍵](https://developers.cloudflare.com/turnstile/troubleshooting/testing/)
（ホスト名が `example.com` で返る）では必ず断られる（403）。

Worker のコードは `pnpm check` の対象外（型の出どころがサイトと違うので `worker/tsconfig.json` に分けてある）。
直したら `pnpm exec tsc -p worker` と `pnpm test` を通す（CI でも走る）。`wrangler.jsonc` の binding
（`assets.binding`・`ratelimits`）を足す・名前を変える、または secret を足すときは、型を作り直して commit する:

```bash
pnpm wrangler types worker/worker-configuration.d.ts --env-file .dev.vars.example
```

Worker のログは Cloudflare のダッシュボード（Worker `prism-aiken` → Observability）か `pnpm wrangler tail` で見る。
入力値（名前・メール・本文）と Webhook の URL はログに出していない。
