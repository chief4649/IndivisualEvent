# 引き継ぎマニュアル

## 概要

- 作業対象プロジェクトは `/Users/satotaka/Desktop/ttreport_individual`
- もともとは個人戦専用として作成したが、現在は個人戦と団体戦を一本化して扱える
- ローカル確認 URL は `http://127.0.0.1:3010`
- 直近のローカル起動コマンドは `PORT=3010 node server.js`

## 現在できること

- シニア大会の個人戦
  - 男子シングルス
  - 女子シングルス
  - 男子ダブルス
  - 女子ダブルス
  - 混合ダブルス
- ユース大会
  - `U19男子シングルス` のような日本語カテゴリ表示
  - 年代順、男女順、シングルス優先のソート
- 団体戦
  - 男子団体
  - 女子団体
  - 混合団体
- 予選トーナメント、グループ戦、本戦の表示
- 大会ごとの実施種目だけを種目プルダウンに表示
- 大会名の動的取得と公式大会ページへのリンク表示
- 辞書 JSON / ルール JSON の管理画面編集

## 直近の重要対応

### 全日本対応の入口追加

- CLI / API / UI に `source` パラメータを追加
  - `wtt`: 現行どおり動作
  - `zennihon`: 実装済み
- `extract_individual_matches.js` は source ごとに取得処理を分岐
- 全日本は
  1. `timetable*.shtml` から `show.cgi?...` の試合番号リンクを収集
  2. `show.cgi` の HTML を取得
  3. 既存 match 形式へ正規化
  4. 既存の日本語整形出力へ流す
  という流れで実装
- 現在確認できていること
  - `source=zennihon --event 2025` で全 1114 試合を取得
  - 男子シングルス、男子ダブルスの `--ja` 出力は確認済み
  - `event-names.json` に全日本 2025 を登録済み
- 補足
  - CGI/HTML は EUC-JP なので UTF-8 前提にしない
  - タイムテーブル経由なので、今後大会ごとにページ構成差異がないか確認は必要

### 全日本アーカイブ化

- `2011-2025` の全日本はローカル保存済みアーカイブを一次ソースに変更
- 保存先:
  - `DATA_DIR/zennihon-records/<year>.json`
  - ローカル既定では `/Users/satotaka/Desktop/ttreport_individual/zennihon-records/`
- 通常の `source=zennihon` 読み込みは、まずこの JSON を読む
- `2011-2025` でアーカイブがない場合は外部 fetch せず、管理側に export が必要というエラーにする
- アーカイブ生成スクリプト:
  - [export_zennihon_archives.js](/Users/satotaka/Desktop/ttreport_individual/export_zennihon_archives.js)
  - `npm run export:zennihon`
- 直近で `2011-2025` は生成済み
  - 2011: 1346
  - 2012: 1372
  - 2013: 1325
  - 2014: 1240
  - 2015: 1266
  - 2016: 1214
  - 2017: 1204
  - 2018: 1223
  - 2019: 1212
  - 2020: 843
  - 2021: 1106
  - 2022: 1169
  - 2023: 1145
  - 2024: 1135
  - 2025: 1114
- `event-names.json` の `zennihon` も同スクリプトで更新する

### WTT の ITTF Results/Bornan フォールバック

- `source=wtt` で `GetOfficialResult` が空の大会でも、`TTE<eventId>/champ.json` が存在すれば ITTF Results 側へ自動フォールバックする
- 現在確認済みの代表例:
  - `3158` → `ITTF Pan American Youth Championships 2025`
- 取得の流れ:
  1. まず従来どおり `GetOfficialResult?EventId=<id>&include_match_card=true`
  2. 0 件または WTT API エラー時に `https://results.ittf.com/ittf-web-results/html/TTE<eventId>/champ.json` を probe
  3. `champ.json` の `dates` から `match/dYYYY-MM-DD.json` を収集
  4. 既存 match 形式へ正規化して UI / API / CLI に流す
- `3158` では `584` 試合を確認済み
- Youth 大会向けに
  - `U19 Boys' Singles`
  - `U15 Girls' Teams`
  のようなカテゴリ表示とソートにも対応
- CLI でも `--category` が使える
  - 例: `node extract_individual_matches.js --event 3158 --category "U19 Boys' Singles" --round final --ja`

### WTT アーカイブ方針

- 開催中の WTT 大会はキャッシュを使わず、毎回ライブ取得する
- 終了済みの大会だけ `DATA_DIR/wtt-records/<eventId>.json` を優先できる
- Bornan 系大会は `champ.json` の `isFinished` と `dates` から終了判定
- 通常 WTT は終了日時を安定取得できないケースがあるため、自動判定できないものは安全側でライブ扱い
- 明示アーカイブ用スクリプト:
  - [export_wtt_archive.js](/Users/satotaka/Desktop/ttreport_individual/export_wtt_archive.js)
  - `npm run export:wtt -- --event 3231 --force`
- アーカイブ台帳:
  - `DATA_DIR/wtt-archive-index.json`
  - 明示アーカイブした大会や自動アーカイブ情報を記録

### 団体戦 2751 対応

- `Women's Teams` / `Men's Teams` を `女子団体` / `男子団体` として認識するように修正
- 見出しが `▼女子団体決勝トーナメント準決勝` のように出る

### 混合団体 3263 対応

- `Mixed Teams` を `混合団体` として認識するように修正
- `Bronze Medal Match` を `3位決定戦`
- `Group` を `グループ`
- 団体内の第1試合がペア戦のとき、チーム名ではなくペア名を出すように修正
- 混合団体では未実施試合のダミー行を出さない
- 書式は次の形に変更済み

```text
▼混合団体決勝トーナメント準決勝 　
　日本　【8-3】　ドイツ
【3】伊藤美誠／篠塚大登　8,5,6　カウフマン／フランチスカ【0】
【2】張本美和　9,10,-10　ヴィンター【1】
【1】松島輝空　-10,-6,8　ダン・チウ【2】
【2】松島輝空／戸上隼輔　8,4　デュダ／ダン・チウ【0】
```

補足:
- ユーザー説明では「1番が混合ダブルス、2番が女子シングルス、3番が男子シングルス、4番が男子ダブルス、5番が女子ダブルス」
- 「各試合3ゲームを必ず行う」
- 「総取得ゲーム数が8ゲームになったチームの勝利」
- この方針に合わせて実装済み

### UI 直近変更

- `含む文字` を `含む文字列` に変更
- `選手名など` 入力欄を削除
- `team` パラメータも UI / サーバー / 抽出処理から削除
- ラウンド欄はテキスト入力ではなく、複数選択できるチェックボックスに変更
- ラウンド候補は大会と種目に応じて `/api/rounds` から動的表示
- チェックボックスの文字重なりは CSS 修正済み
- `決勝` も `決勝トーナメント決勝` に統一
- タイトルは `個人戦・団体戦記録出力システム`

## API と主要仕様

### 主要エンドポイント

- `/api/individual-matches`
  - 出力本体
- `/api/categories`
  - 大会ごとの実施種目一覧
- `/api/rounds`
  - 大会・種目ごとのラウンド一覧
- `/api/event-names`
  - 大会名取得
- `/api/config/translations`
  - 辞書読込・保存
- `/api/config/rules`
  - ルール読込・保存

### ラウンド複数選択

- `round` は複数値を受けられる
- フロントでは同名 `round` チェックボックスを複数送信
- サーバー側 `buildOptions()` は `searchParams.getAll("round")` を使用
- 抽出側 `applyFilters()` は複数ラウンドを OR 条件でフィルタ

## 主要ファイル

- [extract_individual_matches.js](/Users/satotaka/Desktop/ttreport_individual/extract_individual_matches.js)
  - 個人戦・団体戦の正規化
  - 日本語整形出力
  - 混合団体特殊書式もここで処理
- [server.js](/Users/satotaka/Desktop/ttreport_individual/server.js)
  - Web API
  - `/api/categories`
  - `/api/rounds`
  - 共有辞書同期の仕組み
- [public/index.html](/Users/satotaka/Desktop/ttreport_individual/public/index.html)
  - 入力フォーム
  - ラウンドチェックボックス UI
  - 大会名リンク
- [rules.json](/Users/satotaka/Desktop/ttreport_individual/rules.json)
  - ラウンド表示ルール
- [translations.ja.json](/Users/satotaka/Desktop/ttreport_individual/translations.ja.json)
  - 選手名・国名辞書

## 辞書運用の現状

- 一本化はできたが、公開環境ではまだ旧団体戦 Render の辞書を参照している可能性がある
- 以前の共有辞書用環境変数:

```text
TEAM_TRANSLATIONS_BASE_URL
TEAM_TRANSLATIONS_VIEWER_PASSWORD
TEAM_TRANSLATIONS_ADMIN_TOKEN
```

- 旧団体戦 Render / GitHub を削除する前に、一本化側がこれらに依存していないか確認が必要
- ユーザーは本番アプリの管理画面で辞書を読み込み、内容をコピーできるところまでは実施済み
- 次にやるなら:
  1. 本番で使っている辞書内容を `translations.ja.json` に反映
  2. Render の `TEAM_TRANSLATIONS_*` を削除
  3. 再デプロイ
  4. 管理画面で辞書読み込み・保存確認
  5. 問題なければ旧団体戦 Render / GitHub を削除

## 代表確認大会

- `3231`
  - 個人戦シングルス確認用
- `3234`
  - ダブルス / 混合ダブルス / パラ種目混在の確認用
- `3251`
  - グループ混在ケース
- `3263`
  - 混合団体の特殊書式確認用
- `3267`
  - 団体やダブルスの回戦開始位置確認用
- `3273`
  - ユースカテゴリ確認用
- `3379`
  - グループ戦を `予選` 指定で拾うケース
- `2751`
  - 男女団体確認用

## ローカル確認コマンド

```bash
cd /Users/satotaka/Desktop/ttreport_individual
node extract_individual_matches.js --event 3231 --category "Men Singles" --ja
node extract_individual_matches.js --event 2751 --gender women --round semifinal --ja
node extract_individual_matches.js --event 3263 --ja
PORT=3010 node server.js
```

## git 状態メモ

直近確認時の変更ファイル:

- `extract_individual_matches.js`
- `public/index.html`
- `rules.json`
- `server.js`
- `translations.ja.json`

未追跡キャッシュ:

- `.cache/event_2751_take_800.json`
- `.cache/event_3263_take_800.json`
- `.cache/event_3379_take_800.json`
- その他 `.cache/event_*`

通常、`.cache/` は GitHub に上げない

## 次スレッドでやる可能性が高いこと

- 全日本の元データ形式の特定
  - HTML / JSON / CSV / 手元ファイルのどれを正とするか決める
- `source=zennihon` の fetch / parse 実装
- 全日本特有の種目名・ラウンド名の正規化追加
- 本番辞書の一本化完了
- 旧団体戦 Render / GitHub の安全な削除
- 混合団体の細部表記調整
  - 例: 選手の並び順やペア順の微修正
- 本番反映前の push 対象ファイル整理

## 注意

- このプロジェクト名は `ttreport_individual` だが、実態は個人戦・団体戦一本化版
- 旧 handoff の内容は初期段階のものなので、もう信用しない方がよい

## 2026-04-07 追記

### 全日本

- `source=zennihon` は `2011-2025` をローカル保存データ参照に切替済み
- 保存先:
  - `zennihon-records/2011.json` から `zennihon-records/2025.json`
- 通常利用では `japantabletennis.com` を毎回見に行かない

### WTT カレンダー日付連携

- WTT 公式カレンダー API は取得成功済み
  - `https://wtt-website-api-prod-3-frontdoor-bddnb2haduafdze9.a01.azurefd.net/api/eventcalendar`
- 追加スクリプト:
  - `fetch_wtt_calendar_dates.js`
- npm script:
  - `npm run fetch:wtt-dates`
- 日付保存先:
  - `wtt-date-index.json`
- 直近実行結果:
  - `Fetched 2916 calendar rows, updated 2916 date entries`

### WTT 検索候補まわり

- 候補は `WTT / ITTF` 分類表示
- `para` を含む大会は `ITTF` 側に分類
- 候補と緑色の大会名に開催期間を併記
- 日付表記ルール:
  - 基本: `2024/8/29-9/7`
  - 同月内: `2026/1/7-11`
- 候補検索は複数語 AND 検索
- `Champions` 検索で `championships` を誤ヒットしないよう修正

### 日付検索

- 大会候補検索は開催日でもヒットする
- `2024/8` と `2024/08` は同じ結果になるよう修正済み
- 年月入力は event ID に誤爆しないよう補正済み
- こちらで再現確認した結果:
  - `2024/8`
  - `2024/08`
  - どちらも 5 件に絞られる
- 主なヒット:
  - `Paris 2024 Olympic Games`
  - `WTT Contender Lima 2024`
  - `WTT Feeder Olomouc 2024`
  - `WTT Feeder Muscat 2024`
  - `2024 ITTF Pan American Youth Championships`

### 3020 の件

- `3020 = WTT Feeder Düsseldorf 2025`
- 以前入っていなかった原因:
  - 公式カレンダー行の `EventCode` が `null`
  - 取り込みが `EventCode` しか見ていなかった
- 修正:
  - `fetch_wtt_calendar_dates.js` で `EventCode` が無い場合は `EventId` を使う
- 現在の `wtt-date-index.json` には反映済み:
  - `startDate: 2025-02-11`
  - `endDate: 2025-02-14`
  - 表示上は `2025/2/11-14`

### 3231 の件

- `3231 = WTT Champions Doha 2026`
- 現在の日付:
  - `2026-01-07` から `2026-01-11`
  - 表示上は `2026/1/7-11`
- `日付未確定` ではなくなっている

### オリンピック関連

- `2603` のオリンピック団体で未実施の 4・5 番は、ダブルス出場制約から補完するよう修正済み
- 例:
  - `陳夢 - 平野美宇`
  - `孫穎莎 - 早田ひな`
- 団体の表示順も `1回戦 → 準々決勝 → 準決勝 → 決勝` に統一済み

### 今の主要ファイル

- `server.js`
- `public/index.html`
- `extract_individual_matches.js`
- `fetch_wtt_calendar_dates.js`
- `wtt-date-index.json`
- `wtt-search-index.json`
- `translations.ja.json`

### 今の状態

- `3010` は最新コードで起動中
- WTT 候補検索は `wtt-search-index.json` を母集団にしつつ、日付は `wtt-date-index.json` で上書きして表示する
- `3231` は日付付きで表示される
- `3020` も日付索引には反映済み

### 次スレッドですぐやるなら

- UI 上で `Feeder` 候補の見え方を実際に最終確認
- 必要なら `wtt-search-index.json` 自体もカレンダー起点で再生成して、候補母集団をさらに広げる
