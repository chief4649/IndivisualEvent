# 引き継ぎメモ

## 現在の到達点

- 団体戦版とは別に、個人戦専用プロジェクトを切り出した
- 作業ディレクトリは `/Users/satotaka/Desktop/ttreport_individual`
- UI / API / README は個人戦前提に更新済み
- 個人戦の確認用大会 ID は `3231`
- `GetOfficialResult?EventId=3231&include_match_card=true` で試合一覧を取得できることを確認済み
- 日本語整形出力は個人戦でも動作確認済み
  - 例: `○林昀儒　4(7,9,9,11)0　張禹珍`
- `omitSetCounts` も確認済み
  - 例: `○陳幸同　9,8,5,6　蒯曼`
- 辞書 / ルール編集 UI、閲覧パスワード保護、Render 運用の枠組みはそのまま残してある

## 主要ファイル

- [extract_individual_matches.js](/Users/satotaka/Desktop/ttreport_individual/extract_individual_matches.js)
  - 団体戦・個人戦の両方を正規化できるが、このプロジェクトでは個人戦用途として使う
  - 個人戦は `teamParentData` がないトップレベル `match_card` を `individual` として扱う
- [server.js](/Users/satotaka/Desktop/ttreport_individual/server.js)
  - 個人戦用 API として `/api/individual-matches` を追加
  - 個人戦用 API は `/api/individual-matches` を使う
- [public/index.html](/Users/satotaka/Desktop/ttreport_individual/public/index.html)
  - タイトルを個人戦向けに変更
  - 大会 ID は自由入力、初期値 `3231`
- [README.md](/Users/satotaka/Desktop/ttreport_individual/README.md)
  - 個人戦プロジェクト向けに更新済み

## 実データ確認で見たこと

- `3231` は少なくとも男子シングルス / 女子シングルスを返す
- `subEventType` は `Men Singles`, `Women Singles`
- ラウンド表記は `Final`, `Semifinal`, `Quarterfinal` など
- トップレベル `match_card` に
  - `competitiors`
  - `overallScores`
  - `gameScores`
  - `subEventDescription`
  が入っている

## まだあり得る次の作業

- 個人戦専用にファイル名を `extract_individual_matches.js` へ寄せる
- ダブルスや混合ダブルスの表示名ルールを整える
- 画面上で大会候補を増やすか、候補 API を作る
- Render 公開用に別リポジトリ / 別サービス名へ調整する

## ローカル確認コマンド

```bash
cd /Users/satotaka/Desktop/ttreport_individual
node extract_individual_matches.js --event 3231 --gender men --round final --ja
node extract_individual_matches.js --event 3231 --gender women --round semifinal --ja --omit-set-counts
```

## 補足

- 元の `/Users/satotaka/Desktop/ttreport` は触っていない
- 元プロジェクトへ反映する操作は承認されていないので未実施
