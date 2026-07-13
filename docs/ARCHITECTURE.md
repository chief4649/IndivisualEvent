# Architecture

生成日時: 2026-07-13T01:33:28.473Z

## 推定データフロー

```text
WTT / 外部データ
  -> 取得・クロールスクリプト
  -> wtt-records/*.json
  -> 各種インデックス生成
  -> player-records-index/・アーカイブJSON
  -> server.js
  -> public/index.html
```

## 検出したHTTPルート

該当なし

## 注意

この文書のルート一覧は正規表現による静的検出であり、動的に組み立てられたルートは含まれない場合がある。
