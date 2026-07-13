# PROJECT_CONTEXT.md

# IndivisualEvent Project Context

最終更新: 2026-07-13

---

# 1. プロジェクト概要

## 目的

IndivisualEvent は、WTT（World Table Tennis）を中心とした卓球大会データから個人戦の試合結果を取得・整理し、卓レポ等で利用できる形式に変換・検索・表示するシステムである。

主な目的は以下。

- WTT大会データのアーカイブ
- 個人戦試合結果の抽出
- 選手別戦績生成
- Head-to-Head生成
- 選手検索
- 大会検索
- Webでの高速閲覧

---

# 2. システム構成

```
WTT
   │
   ▼
取得スクリプト
   │
   ▼
wtt-records/
   │
   ▼
各種インデックス生成
   │
   ├── player-records-index
   ├── manifest
   ├── search
   ├── head-to-head
   └── archive
   │
   ▼
server.js
   │
   ▼
public/index.html
```

---

# 3. 開発環境

OS

macOS

ローカルリポジトリ

```
~/Desktop/IndivisualEvent
```

Node.js

22以上

ソース管理

Git
GitHub

本番

Render

---

# 4. Git運用

メインブランチ

```
main
```

GitHubを正本とする。

基本フロー

```
修正
↓
git status
↓
git diff
↓
動作確認
↓
git commit
↓
git push
↓
Render自動デプロイ
```

---

# 5. ディレクトリ構成

```
public/
server.js
package.json

wtt-records/

player-records-index/

player-record-event-index.json

wtt-archive-index.json
```

---

# 6. Web画面

画面は

```
public/index.html
```

を server.js が配信する。

ルート直下の index.html は現在使用しない。

---

# 7. 主なスクリプト

## 起動

```
npm start
```

実体

```
node -r ./runtime_legacy_ittf_patch.js server.js
```

---

管理画面

```
npm run start:admin
```

---

CLI

```
npm run cli
```

---

WTT検索インデックス生成

```
npm run index:wtt
```

---

WTTスリムデータ生成

```
npm run slim:wtt
```

---

WTT日付取得

```
npm run fetch:wtt-dates
```

---

WTT日付更新

```
npm run update:wtt-dates
```

---

WTTアーカイブ生成

```
npm run export:wtt
```

---

全日本アーカイブ生成

```
npm run export:zennihon
```

---

WTTクロール

```
npm run crawl:wtt
```

---

整合性確認

```
npm run verify:wtt
```

---

# 8. 主なデータ

## WTT大会

```
wtt-records/
```

---

## アーカイブ

```
wtt-archive-index.json
```

---

## 選手イベント

```
player-record-event-index.json
```

---

## Player Records

```
player-records-index/
```

---

## Manifest

```
player-records-index/manifest.json
```

---

## Search

```
player-search-names.json
```

---

## Head-to-Head

```
head-to-head-players.json
head-to-head-manifest.json
head-to-head-status.json
```

---

## Candidate

```
candidate-events.json
candidate-manifest.json
```

---

# 9. データフロー

```
WTT取得

↓

大会JSON生成

↓

大会一覧生成

↓

Player Records生成

↓

Head-to-Head生成

↓

検索インデックス生成

↓

Web公開
```

---

# 10. 設計方針

大量JSONをそのまま読まない。

必要なインデックスを生成し、高速検索を行う。

検索速度を優先する。

Render上で動作することを前提とする。

---

# 11. コーディング方針

推測でコードを変更しない。

既存コードを読んでから修正する。

変更対象を限定する。

影響範囲を説明する。

既存機能を壊さない。

---

# 12. 自動生成ファイル

以下は基本的に手編集しない。

- manifest
- search index
- head-to-head
- shards
- candidate
- archive index

生成スクリプトから更新する。

---

# 13. Render

デプロイはGitHubから自動実行される。

Renderとローカルでは

- タイムアウト
- メモリ
- 実行時間

が異なる。

---

# 14. よくある注意点

JSONを直接編集しない。

manifestとの整合性を保つ。

大量再生成前にバックアップを取る。

WTT仕様変更を考慮する。

Renderのタイムアウトを確認する。

---

# 15. 今後改善したい項目

Head-to-Headの高速化

検索高速化

WTT更新処理改善

インデックス生成高速化

Render負荷軽減

ログ改善

エラー検知改善

---

# 16. 開発時チェックリスト

□ git status

□ git diff

□ ローカル確認

□ Render影響確認

□ GitHub push

□ Renderデプロイ確認

□ 本番確認

---

# 17. ChatGPTへの指示

このプロジェクトでは以下を守る。

・推測でコードを書かない。

・既存構造を理解してから提案する。

・変更ファイルを明示する。

・影響範囲を説明する。

・大規模変更は段階的に行う。

・自動生成ファイルとソースコードを区別する。

・JSON構造を壊さない。

・Render運用を考慮する。

・Git運用を前提とする。

・設計変更時は PROJECT_CONTEXT.md を更新する。

<!-- AUTO:CURRENT_STATE:START -->
最終生成: 2026-07-13T01:33:28.473Z

## Git・実行環境

- Branch: `main`
- Commit: `ecf1067`
- Node.js: `>=22`
- Start: `node -r ./runtime_legacy_ittf_patch.js server.js`

## npm scripts

| Command | Implementation |
| --- | --- |
| `npm start` | `node -r ./runtime_legacy_ittf_patch.js server.js` |
| `npm run start:admin` | `ADMIN_TOKEN=secret-token PORT=3001 node -r ./runtime_legacy_ittf_patch.js server.js` |
| `npm run cli` | `node -r ./runtime_legacy_ittf_patch.js extract_individual_matches.js` |
| `npm run index:wtt` | `node build_wtt_search_index.js` |
| `npm run slim:wtt` | `node build_wtt_slim_records.js` |
| `npm run fetch:wtt-dates` | `node fetch_wtt_calendar_dates.js` |
| `npm run update:wtt-dates` | `node update_wtt_date_index.js` |
| `npm run export:zennihon` | `node export_zennihon_archives.js` |
| `npm run export:wtt` | `node export_wtt_archive.js` |
| `npm run crawl:wtt` | `node crawl_wtt_archives.js` |
| `npm run verify:wtt` | `node verify_wtt_alignment.js` |
| `npm run docs:generate` | `node scripts/docs/generate.js` |

## Git管理対象の主要ファイル

- `build_player_record_index.js`
- `build_player_records_index.js`
- `build_wtt_search_index.js`
- `build_wtt_slim_records.js`
- `crawl_wtt_archives.js`
- `event-names.json`
- `export_wtt_archive.js`
- `export_zennihon_archives.js`
- `extract_individual_matches.js`
- `fetch_wtt_calendar_dates.js`
- `package.json`
- `patch_version_info.js`
- `player-record-event-index.json`
- `player-records-index/_.json`
- `player-records-index/a.json`
- `player-records-index/b.json`
- `player-records-index/c.json`
- `player-records-index/candidate-events.json`
- `player-records-index/candidate-manifest.json`
- `player-records-index/d.json`
- `player-records-index/e.json`
- `player-records-index/f.json`
- `player-records-index/g.json`
- `player-records-index/h.json`
- `player-records-index/head-to-head-manifest.json`
- `player-records-index/head-to-head-players.json`
- `player-records-index/head-to-head-status.json`
- `player-records-index/i.json`
- `player-records-index/j.json`
- `player-records-index/k.json`
- `player-records-index/l.json`
- `player-records-index/m.json`
- `player-records-index/manifest.json`
- `player-records-index/n.json`
- `player-records-index/o.json`
- `player-records-index/p.json`
- `player-records-index/player-search-names-manifest.json`
- `player-records-index/player-search-names.json`
- `player-records-index/q.json`
- `player-records-index/r.json`
- `player-records-index/s.json`
- `player-records-index/t.json`
- `player-records-index/u.json`
- `player-records-index/v.json`
- `player-records-index/w.json`
- `player-records-index/x.json`
- `player-records-index/y.json`
- `player-records-index/z.json`
- `public/favicon.svg`
- `public/index.html`
- `rules.json`
- `runtime_legacy_ittf_patch.js`
- `server.js`
- `translations.ja.json`
- `update_wtt_date_index.js`
- `verify_wtt_alignment.js`
- `wtt-archive-index.json`
- `wtt-date-index.json`
- `wtt-records-slim/2345.json`
- `wtt-records-slim/2346.json`
- `wtt-records-slim/2462.json`
- `wtt-records-slim/2465.json`
- `wtt-records-slim/2521.json`
- `wtt-records-slim/2522.json`
- `wtt-records-slim/2523.json`
- `wtt-records-slim/2525.json`
- `wtt-records-slim/2526.json`
- `wtt-records-slim/2527.json`
- `wtt-records-slim/2528.json`
- `wtt-records-slim/2529.json`
- `wtt-records-slim/2531.json`
- `wtt-records-slim/2532.json`
- `wtt-records-slim/2533.json`
- `wtt-records-slim/2534.json`
- `wtt-records-slim/2535.json`
- `wtt-records-slim/2536.json`
- `wtt-records-slim/2538.json`
- `wtt-records-slim/2539.json`
- `wtt-records-slim/2540.json`
- `wtt-records-slim/2541.json`
- `wtt-records-slim/2542.json`
- `wtt-records-slim/2543.json`
- `wtt-records-slim/2544.json`
- `wtt-records-slim/2545.json`
- `wtt-records-slim/2546.json`
- `wtt-records-slim/2547.json`
- `wtt-records-slim/2548.json`
- `wtt-records-slim/2549.json`
- `wtt-records-slim/2550.json`
- `wtt-records-slim/2551.json`
- `wtt-records-slim/2552.json`
- `wtt-records-slim/2553.json`
- `wtt-records-slim/2554.json`
- `wtt-records-slim/2555.json`
- `wtt-records-slim/2556.json`
- `wtt-records-slim/2557.json`
- `wtt-records-slim/2559.json`
- `wtt-records-slim/2560.json`
- `wtt-records-slim/2561.json`
- `wtt-records-slim/2562.json`
- `wtt-records-slim/2564.json`
- `wtt-records-slim/2566.json`
- `wtt-records-slim/2567.json`
- `wtt-records-slim/2568.json`
- `wtt-records-slim/2569.json`
- `wtt-records-slim/2570.json`
- `wtt-records-slim/2571.json`
- `wtt-records-slim/2574.json`
- `wtt-records-slim/2577.json`
- `wtt-records-slim/2578.json`
- `wtt-records-slim/2579.json`
- `wtt-records-slim/2580.json`
- `wtt-records-slim/2582.json`
- `wtt-records-slim/2583.json`
- `wtt-records-slim/2587.json`
- `wtt-records-slim/2589.json`
- `wtt-records-slim/2590.json`
- `wtt-records-slim/2591.json`
- `wtt-records-slim/2592.json`
- `wtt-records-slim/2593.json`
- `wtt-records-slim/2602.json`
- `wtt-records-slim/2603.json`
- `wtt-records-slim/2604.json`
- `wtt-records-slim/2605.json`
- `wtt-records-slim/2606.json`
- `wtt-records-slim/2609.json`
- `wtt-records-slim/2610.json`
- `wtt-records-slim/2611.json`
- `wtt-records-slim/2615.json`
- `wtt-records-slim/2616.json`
- `wtt-records-slim/2619.json`
- `wtt-records-slim/2627.json`
- `wtt-records-slim/2629.json`
- `wtt-records-slim/2630.json`
- `wtt-records-slim/2632.json`
- `wtt-records-slim/2633.json`
- `wtt-records-slim/2634.json`
- `wtt-records-slim/2635.json`
- `wtt-records-slim/2636.json`
- `wtt-records-slim/2637.json`
- `wtt-records-slim/2638.json`
- `wtt-records-slim/2639.json`
- `wtt-records-slim/2640.json`
- `wtt-records-slim/2641.json`
- `wtt-records-slim/2642.json`
- `wtt-records-slim/2643.json`
- `wtt-records-slim/2644.json`
- `wtt-records-slim/2645.json`
- `wtt-records-slim/2646.json`
- `wtt-records-slim/2647.json`
- `wtt-records-slim/2648.json`
- `wtt-records-slim/2649.json`
- `wtt-records-slim/2650.json`
- `wtt-records-slim/2652.json`
- `wtt-records-slim/2653.json`
- `wtt-records-slim/2654.json`
- `wtt-records-slim/2655.json`
- `wtt-records-slim/2656.json`
- `wtt-records-slim/2657.json`
- `wtt-records-slim/2658.json`
- `wtt-records-slim/2660.json`
- `wtt-records-slim/2670.json`
- `wtt-records-slim/2671.json`
- `wtt-records-slim/2672.json`
- `wtt-records-slim/2673.json`
- `wtt-records-slim/2675.json`
- `wtt-records-slim/2676.json`
- `wtt-records-slim/2677.json`
- `wtt-records-slim/2678.json`
- `wtt-records-slim/2681.json`
- `wtt-records-slim/2683.json`
- `wtt-records-slim/2684.json`
- `wtt-records-slim/2685.json`
- `wtt-records-slim/2686.json`
- `wtt-records-slim/2687.json`
- `wtt-records-slim/2689.json`
- `wtt-records-slim/2691.json`
- `wtt-records-slim/2692.json`
- `wtt-records-slim/2693.json`
- `wtt-records-slim/2694.json`
- `wtt-records-slim/2695.json`
- `wtt-records-slim/2696.json`
- `wtt-records-slim/2697.json`
- `wtt-records-slim/2698.json`
- `wtt-records-slim/2699.json`
- `wtt-records-slim/2700.json`
- `wtt-records-slim/2701.json`
- `wtt-records-slim/2702.json`
- `wtt-records-slim/2703.json`
- `wtt-records-slim/2704.json`
- `wtt-records-slim/2705.json`
- `wtt-records-slim/2707.json`
- `wtt-records-slim/2708.json`
- `wtt-records-slim/2709.json`
- `wtt-records-slim/2710.json`
- `wtt-records-slim/2711.json`
- `wtt-records-slim/2714.json`
- `wtt-records-slim/2715.json`
- `wtt-records-slim/2717.json`
- `wtt-records-slim/2718.json`
- `wtt-records-slim/2720.json`
- `wtt-records-slim/2721.json`
- `wtt-records-slim/2722.json`
- `wtt-records-slim/2723.json`
- `wtt-records-slim/2724.json`
- `wtt-records-slim/2727.json`
- `wtt-records-slim/2728.json`
- `wtt-records-slim/2730.json`
- `wtt-records-slim/2731.json`
- `wtt-records-slim/2732.json`
- `wtt-records-slim/2733.json`
- `wtt-records-slim/2735.json`
- `wtt-records-slim/2737.json`
- `wtt-records-slim/2738.json`
- `wtt-records-slim/2739.json`
- `wtt-records-slim/2740.json`
- `wtt-records-slim/2742.json`
- `wtt-records-slim/2744.json`
- `wtt-records-slim/2747.json`
- `wtt-records-slim/2749.json`
- `wtt-records-slim/2750.json`
- `wtt-records-slim/2751.json`
- `wtt-records-slim/2753.json`
- `wtt-records-slim/2754.json`
- `wtt-records-slim/2755.json`
- `wtt-records-slim/2756.json`
- `wtt-records-slim/2757.json`
- `wtt-records-slim/2758.json`
- `wtt-records-slim/2760.json`
- `wtt-records-slim/2761.json`
- `wtt-records-slim/2762.json`
- `wtt-records-slim/2763.json`
- `wtt-records-slim/2767.json`
- `wtt-records-slim/2768.json`
- `wtt-records-slim/2770.json`
- `wtt-records-slim/2773.json`
- `wtt-records-slim/2775.json`
- `wtt-records-slim/2776.json`
- `wtt-records-slim/2777.json`
- `wtt-records-slim/2784.json`
- `wtt-records-slim/2786.json`
- `wtt-records-slim/2787.json`
- `wtt-records-slim/2789.json`
- `wtt-records-slim/2791.json`
- `wtt-records-slim/2794.json`
- `wtt-records-slim/2798.json`
- `wtt-records-slim/2801.json`
- `wtt-records-slim/2802.json`
- `wtt-records-slim/2803.json`
- `wtt-records-slim/2804.json`
<!-- AUTO:CURRENT_STATE:END -->
