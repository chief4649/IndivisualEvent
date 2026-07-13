# Changelog

Gitコミット履歴から自動生成。

生成日時: 2026-07-13T01:33:28.473Z

## 2026-07-13

- Backup after Codex migration (`ecf1067`)

## 2026-07-09

- Add remaining TTE search entries (`94b550f`)

## 2026-07-08

- Add TTE event search metadata (`8b4fd22`)
- Add ITTF TTE2879 junior worlds results (`4d655e5`)

## 2026-07-07

- Add bundled record sync endpoint (`99d1b07`)
- Add Caribbean U11 U13 2023 PDF results (`d38d72c`)

## 2026-07-06

- Prioritize relevant event search results (`191ff11`)
- Reduce wasted work under load (`113217e`)

## 2026-07-03

- Refresh live events for head-to-head results (`bf91a15`)
- Keep health checks responsive under load (`2fb3fc5`)
- Include para categories in WTT outputs (`2602da1`)
- Force WTT record output to use raw archives (`4f99159`)

## 2026-07-02

- Update index.html (`ce8ab07`)

## 2026-07-01

- Restore ascending record round order (`4c5ac7d`)
- Recognize WTT short round labels (`9440540`)
- Fix WTT legacy translation and para filtering (`78f2c63`)
- Map WTT 5068 to ITTF results (`123a56d`)
- Clean aborted player record shard builds (`c30ea16`)
- Use bounded writes for player record shards (`3094bcd`)
- Add sharded player record index (`18c1925`)
- Remove broad stale H2H text scan (`0c1186a`)
- Supplement stale H2H pairs with text candidates (`4eef75e`)
- Refresh US Smash H2H source data (`1f30d42`)
- Use stale H2H player candidates with delta (`7d1f979`)
- Read normal WTT output from slim archives (`40bf30c`)
- Preserve team details in WTT slim records (`ab1b493`)
- Use H2H player events for record candidates (`bfb6fd4`)
- Fix player record fallback for skipped index (`9ce8765`)
- Add lightweight pair event index (`8872d91`)
- Guard player record match index generation (`92e0dfa`)
- Clean aborted player record shards on startup (`2e87a6e`)
- Revert "Shard persistent player record index" (`dfbef90`)
- Revert "Reduce player record index build memory" (`db74152`)
- Reduce player record index build memory (`4a1e948`)
- Shard persistent player record index (`5d37adb`)
- Avoid direct pair index memory growth (`218fd76`)
- Add persistent player record match index (`c001ccb`)
- Fix failed-only 5000 backfill retry (`fca32f6`)
- Allow failed-only 5000 backfill retry (`b30e8bc`)
- Add background backfill for 5000 records (`80135f4`)
- Route legacy ITTF events to results pages (`708be4f`)

## 2026-06-30

- Normalize cadet categories as U15 (`db8fb9a`)
- Align team submatch display sides (`ca48b64`)
- Separate under age singles categories (`5dba662`)
- Use lightweight H2H event index (`b2f8845`)
- Build H2H index on persistent storage (`69e3a41`)
- Support delta scan for stale H2H index (`b897bba`)
- Add persistent head to head index (`d21c94c`)
- Disable H2H background index rebuild (`59c95bc`)
- Use slim archives with stable H2H parsing (`847bbc0`)
- Add slim archives for production WTT records (`8562dd5`)
- Use slim archive for heavy H2H event (`fcb9d0c`)
- Avoid large H2H item stringification (`f913301`)
- Avoid full archive parsing for head to head (`939e6b8`)
- Defer head to head index rebuild (`a17d2d5`)
- Use grep intersection for head to head fallback (`69a23df`)
- Speed up head to head search (`a40eacb`)
- Add head to head player candidate selection (`2f20787`)
- Add singles head to head search (`c986b41`)
- Limit player search grouping to name order variants (`99bf814`)
- Prefer slim WTT record archives (`1f77d62`)

## 2026-06-29

- Persist player search archive name index (`d190ed1`)
- Infer output winner from game scores (`e731d10`)
- Infer player record winner from game scores (`59792c4`)
- Add player record candidate index (`783a1f4`)
- Trigger Render deploy for 2784 records (`5893334`)
- Use bundled WTT records as archive fallback (`a61d469`)
- Add 2784 PDF team records (`6c90bf5`)
- Map missing WTT record source IDs (`19ed79f`)

## 2026-06-26

- Avoid blocking player search suggestions (`950b8a7`)
- Include archived players in search suggestions (`0b4f7b4`)
- Keep health checks responsive during record searches (`05b87a3`)
- Cache parsed player record archives (`726d027`)
- Align player record round labels (`58bb859`)
- Increase player records timeout (`2523b62`)

## 2026-06-25

- Add files via upload (`9e29127`)
- Add files via upload (`1be99d9`)
- Add files via upload (`edfe93f`)
- Add files via upload (`6c24ea5`)
- Add files via upload (`c179bf2`)
- Add files via upload (`42b0229`)
- Add files via upload (`f74cc4c`)
- Add files via upload (`01bbfcc`)
- Add files via upload (`adcb05d`)
- Add files via upload (`d82bd95`)
- Add files via upload (`ba903b3`)
- Add files via upload (`d7350c3`)
- Add files via upload (`f40301d`)
- Add files via upload (`8dc09ac`)
- Add files via upload (`406f206`)
- Add files via upload (`c4705e6`)
- Avoid player record full archive parsing (`ac489db`)
- Read player records from WTT archives (`7e9fecc`)
- Deduplicate player search aliases (`c7fabbe`)
- Include player record shards in Docker image (`eea7029`)
- Fallback to bundled player record shards (`79e6e8b`)

## 2026-06-24

- Skip archive sync on Render startup (`d55e8bb`)
- Serve player records from prebuilt shards (`756a3a0`)
- Use prebuilt player record event index (`22b9b4f`)
- Speed up player record loading (`8fa547b`)
- Prioritize exact translated player matches (`78651a2`)
- Reduce player record lookup memory use (`7ba1dd2`)
- Cache player record lookups (`5a0c5fc`)
- Add player record lookup (`06e9a7e`)

## 2026-06-23

- Support Japanese player name search (`2ead6da`)
- Add player name lookup (`19430f6`)
- Sort para categories naturally (`a32032f`)
- Add missing 2026 para future events (`ffa612f`)

## 2026-06-19

- Support WMC 2026 WebGen results (`b6387a5`)

## 2026-06-18

- Respect dictionary player name spacing (`7130228`)

## 2026-06-16

- Limit dynamic knockout round labels (`7b734f4`)

## 2026-06-12

- Align round filters with category context (`81d041b`)

## 2026-06-09

- Prefer complete WTT result game scores (`0687cfa`)

## 2026-06-08

- Serve favicon before login (`fa39746`)
- Add favicon (`b446b09`)

## 2026-06-05

- Compute knockout rounds per category (`61d605a`)

## 2026-05-22

- Support multi-term search filters (`b43f3e1`)

## 2026-05-21

- Show event suggestions on search focus (`0c79dcb`)

## 2026-05-20

- Resolve WTT record source by event metadata (`21c58a6`)
- Restore para showcase event link (`3ef0507`)
- Link para showcase to parent WTT event (`b3080a9`)
- Avoid caching suspicious WTT counts (`0ec6047`)
- Keep timed out WTT crawls retryable (`92761b4`)
- Recheck 30-match WTT archives (`543e9b0`)
- Refresh suspicious WTT archive counts (`6e9f27d`)
- Avoid slow WTT archive supplements (`2eae021`)
- Recheck legacy verified WTT archives (`11d46d2`)
- Refresh suspicious WTT archives (`c5ab520`)
- Fetch WTT archives by subevent when capped (`e760b3c`)
- Remember skipped WTT crawl events (`0ef036e`)
- Increase default WTT fetch size (`87b95b0`)
- Avoid overwriting WTT archives with fewer records (`6e497a1`)
- Fetch ITTF fallback records during crawl (`cbccdf4`)
- Copy WTT crawler into Docker image (`f6f4816`)
- Add WTT archive crawler (`6dcdab3`)

## 2026-05-19

- Sort latest Japanese translations (`cd5ff70`)
- Improve event date search inputs (`9205023`)
- Order WTT qualification rounds before knockout (`b1cf1bf`)
- Fix WTT large result fetch (`a901fc7`)

## 2026-05-15

- Add English formatted output (`0b51b47`)
- Sort and update Japanese translations dictionary (`9039173`)
- Sort and update Japanese translations dictionary (`c9c208a`)
- Sort and update Japanese translations dictionary (`7468144`)
- Add files via upload (`812c931`)
- Remove accidental Codex test file (`e76984c`)
- test (`c8302be`)
- Load legacy ITTF runtime patch for local scripts (`41bd6b4`)
- Load legacy ITTF runtime patch in Docker (`df09c81`)
- Add legacy ITTF runtime fallback patch (`699c891`)
- Prefer indexed names for legacy WTT event IDs (`ff0640d`)
- Add legacy ITTF team archive for event 2587 (`844877d`)

## 2026-05-14

- Fix version patch script escaping (`3f32e39`)
- Patch version timestamp during Docker build (`54f2e0c`)
- Suppress background admin token error (`0ec479d`)
- Restore admin dictionary safety UI (`8ee3304`)

## 2026-05-07

- Add files via upload (`cbc30c0`)
- Add files via upload (`aa049f7`)
- Add files via upload (`ccb953f`)

## 2026-05-06

- Add files via upload (`a44ffe9`)
- Add files via upload (`b4f40ba`)
- Add files via upload (`3d616b2`)
- Add files via upload (`1f84a39`)
- Add files via upload (`3086fb0`)
- Add files via upload (`66b7044`)
- Add files via upload (`66d7f61`)
- Add files via upload (`b39f2df`)
- Add files via upload (`7669414`)
- Add files via upload (`6fc953c`)
- Add files via upload (`3781d1c`)
- Add files via upload (`b8e9c61`)
- Add files via upload (`e94d776`)
- Add files via upload (`70d005e`)
- Add files via upload (`b6a308a`)
- Add files via upload (`251c101`)
- Add files via upload (`06e58f6`)
- Add files via upload (`020a16a`)
- Add files via upload (`90bc137`)
- Add files via upload (`48c1101`)

## 2026-05-05

- Add files via upload (`3ae40cf`)
- Add files via upload (`4b253ce`)
- Add files via upload (`cb9bb01`)
- Add files via upload (`be12a41`)
- Add files via upload (`4767e66`)
- Add files via upload (`22a0e2b`)
- Add files via upload (`c42e511`)
- Add files via upload (`ac69c61`)
- Add files via upload (`5549c99`)
- Add files via upload (`6f7aa74`)
- Add files via upload (`dade2ee`)
- Add files via upload (`baaee74`)
- Add files via upload (`c847341`)
- Add files via upload (`c0fbe0d`)
- Add files via upload (`467eb43`)
- Add files via upload (`eea16d2`)
- Add files via upload (`18a4d95`)
- Add files via upload (`7411f70`)
- Add files via upload (`37b27b5`)

## 2026-05-04

- Add files via upload (`5c99299`)
- Add files via upload (`0d37bab`)
- Add files via upload (`2901cda`)
