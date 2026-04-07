# Match Formatter

競技結果を取得し、日本語向けの所定書式で書き出すための作業ディレクトリです。現在の実データ対応は WTT が中心ですが、全日本向けデータソースも追加できるように入口の分離を進めています。

## 現在の前提

- 現在の確認用 WTT 大会 ID は `3231`
- `GetOfficialResult?EventId=<id>&include_match_card=true` で個人戦試合を取得する
- WTT API が空でも、ITTF Results/Bornan 形式の大会は `TTE<eventId>/champ.json` を自動探索してフォールバックする
  - 例: `3158` → `TTE3158`
- WTT / ITTF は取得成功した大会を `DATA_DIR/wtt-records/` に保存してプールする
- WTT は開催中大会では保存済みがあってもライブ取得を優先する
- ライブ取得に失敗した場合は、過去に保存した `wtt-records/<eventId>.json` を代替利用する
- WTT の終了済み大会は `DATA_DIR/wtt-records/` を一次ソースとして再利用する
  - Bornan 系で終了日が取れる大会は自動判定
  - 通常 WTT は `npm run export:wtt -- --event <id>` で明示アーカイブ可能
- `source` パラメータでデータソースを切り替えられる
  - `wtt`: 実装済み
  - `zennihon`: 実装済み
    - `2011-2025` はローカル保存済みアーカイブを優先して読む
    - アーカイブ保存先は `DATA_DIR/zennihon-records/`
    - アーカイブ未作成時のみ、管理側で export スクリプトから生成する
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
node extract_individual_matches.js --source wtt --event 3231 --gender men --round final --ja
node extract_individual_matches.js --source wtt --event 3158 --category "U19 Boys' Singles" --round final --ja
node extract_individual_matches.js --source wtt --event 3231 --gender women --round semifinal --ja --omit-set-counts
node extract_individual_matches.js --source zennihon --event 2025 --gender men --discipline singles --ja
npm run export:zennihon
node export_wtt_archive.js --event 3158
```

全日本アーカイブ生成:

```bash
npm run export:zennihon
node export_zennihon_archives.js --years 2018,2019,2020
```

## Web API

- `GET /api/individual-matches`
  - 例: `/api/individual-matches?source=wtt&event=3231&gender=men&round=final&format=ja`
- `format`
  - `ja` / `list` / `text` / `json`
- `source`
  - `wtt` / `zennihon`
- `GET /api/health`
- `GET /api/config/translations`
- `PUT /api/config/translations`
- `GET /api/config/rules`
- `PUT /api/config/rules`

## 補足

- キャッシュは `.cache/` に保存される
- 全日本 `2011-2025` は `zennihon-records/*.json` を一次ソースとして読む
- `eventId=3231` のキャッシュは取得済み
- 大会 ID は UI の入力欄で差し替え可能
- 公開時は `translations.ja.json` / `rules.json` を更新するため永続ストレージ前提
