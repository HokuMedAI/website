// @ts-check
import { defineConfig, fontProviders } from 'astro/config'
import icon from 'astro-icon'

// 静的サイト (adapter なし)。dist/ をそのまま Cloudflare Workers の static assets で配る (wrangler.jsonc)。
// URL は末尾スラッシュ + ディレクトリ形式 (/posts/<slug>/ → dist/posts/<slug>/index.html)。
// Workers の html_handling: auto-trailing-slash と同じ流儀で、/posts/<slug> は /posts/<slug>/ へ寄る
export default defineConfig({
	// 公開ドメイン (canonical・OGP・RSS の絶対 URL に使われる)
	site: 'https://aiken.prism-hu.org',
	output: 'static',
	trailingSlash: 'always',
	// アイコン。<Icon name="simple-icons:x" /> の形で使う (astro-icon/components)。ビルド時に SVG として埋め込まれる。
	// セットは @iconify-json/<名前> を足すと増やせる (いまは各サービスのロゴの simple-icons だけ)
	integrations: [icon()],
	build: {
		format: 'directory',
	},
	server: {
		// LAN / VPN 越しにスマホから確認できるよう、全インターフェースで待ち受ける
		host: true,
	},
	vite: {
		server: {
			// IP 以外の名前 (VPN のホスト名など) で開いても弾かない。dev サーバー限定の設定
			allowedHosts: true,
		},
	},
	fonts: [
		{
			provider: fontProviders.google(),
			name: 'Zen Maru Gothic',
			cssVariable: '--font-body',
			weights: [400, 500, 700, 900],
			styles: ['normal'],
			subsets: ['japanese', 'latin'],
			fallbacks: ['sans-serif'],
			// 代替フォントの寸法合わせ (size-adjust) を切る。和文フォントの寸法に合わせた倍率が
			// 欧文の代替フォントに掛かり、読み込み中に英数字だけ約 2 倍の大きさで出るため
			optimizedFallbacks: false,
		},
		{
			provider: fontProviders.google(),
			name: 'Outfit',
			cssVariable: '--font-display',
			weights: [700, 800],
			styles: ['normal'],
			subsets: ['latin'],
			fallbacks: ['sans-serif'],
		},
	],
	devToolbar: { enabled: false },
})
