# WTT Individual Match Formatter

WTT の個人戦結果を取得し、日本語向けの所定書式で書き出すための作業ディレクトリです。

## 現在の前提

- 個人戦の確認用大会 ID は `3231`
- `GetOfficialResult?EventId=<id>&include_match_card=true` で個人戦試合を取得する
- 男子 / 女子の絞り込み、ラウンド絞り込み、日本語整形出力に対応
- 個人戦スコアは
  - デフォルト: `4(7,9,9,11)0`
  - チェック ON: `7,9,9,11`
  に切り替え可能
- 辞書 / ルール編集 UI、Render 運用、閲覧用パスワード保護は団体戦版の枠組みを流用

## 主要ファイル

- `extract_individual_matches.js`
  - 取得、キャッシュ、正規化、フィルタ、整形
- `server.js`
  - Web サーバー本体
  - `/api/individual-matches`
  - 設定 JSON の読込保存 API
- `public/index.html`
  - 個人戦向け Web UI
- `translations.ja.json`
  - 選手名、国名、ラウンド名の辞書
- `rules.json`
  - 見出し表記やラウンド表示などのルール設定

## 使い方

Web MVP 起動:

```bash
npm start
```

起動後:

```text
http://127.0.0.1:3000
```

CLI 例:

```bash
node extract_individual_matches.js --event 3231 --gender men --round final --ja
node extract_individual_matches.js --event 3231 --gender women --round semifinal --ja --omit-set-counts
```

## Web API

- `GET /api/individual-matches`
  - 例: `/api/individual-matches?event=3231&gender=men&round=final&format=ja`
- `format`
  - `ja` / `list` / `text` / `json`
- `GET /api/health`
- `GET /api/config/translations`
- `PUT /api/config/translations`
- `GET /api/config/rules`
- `PUT /api/config/rules`

## 補足

- キャッシュは `.cache/` に保存される
- `eventId=3231` のキャッシュは取得済み
- 大会 ID は UI の入力欄で差し替え可能
- 公開時は `translations.ja.json` / `rules.json` を更新するため永続ストレージ前提
