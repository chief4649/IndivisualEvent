# Data Flow

生成日時: 2026-07-13T01:33:28.473Z

## JavaScriptファイルから検出したJSON参照

| Script | Referenced JSON |
| --- | --- |
| `build_player_record_index.js` | `player-record-event-index.json` |
| `build_player_records_index.js` | `translations.ja.json`<br>`rules.json`<br>`wtt-archive-index.json`<br>`wtt-date-index.json`<br>`wtt-search-index.json`<br>`event-names.json`<br>`manifest.json`<br>`wtt-records/*.json`<br>`${shardName}.json` |
| `build_wtt_search_index.js` | `wtt-search-index.json` |
| `crawl_wtt_archives.js` | `wtt-archive-index.json`<br>`wtt-date-index.json`<br>`wtt-search-index.json`<br>`${String(eventId).trim()}.json` |
| `export_wtt_archive.js` | `wtt-archive-index.json` |
| `export_zennihon_archives.js` | `event-names.json` |
| `extract_individual_matches.js` | `translations.ja.json`<br>`rules.json`<br>`wtt-archive-index.json`<br>`wtt-date-index.json`<br>`wtt-record-source-resolutions.json`<br>`${source}_event_${eventId}_take_${take}.json`<br>`event_${eventId}_take_${take}.json`<br>`).trim()}.json`<br>`champ.json`<br>`match/d${rawDate}.json`<br>`${baseUrl}/${eventIdText}/officialresult/officialresult_minimal.json` |
| `server.js` | `translations.ja.json`<br>`rules.json`<br>`wtt-archive-index.json`<br>`wtt-date-index.json`<br>`wtt-search-index.json`<br>`event-names.json`<br>`backfill-5000-status.json`<br>`candidate-events.json`<br>`candidate-manifest.json`<br>`player-search-names.json`<br>`player-search-names-manifest.json`<br>`head-to-head-players.json`<br>`head-to-head-manifest.json`<br>`head-to-head-status.json`<br>`${normalizedId}.json`<br>`Bundled record not found: ${normalizedId}.json`<br>`wtt-record-source-resolutions.json`<br>`).slice(0, 2)}.json` |
| `update_wtt_date_index.js` | `wtt-date-index.json` |

## 注意

文字列リテラルとして記述されたJSONパスのみを検出する。動的パスは含まれない場合がある。
