# syntax=docker/dockerfile:1
FROM node:22-alpine

WORKDIR /app

COPY package.json ./
COPY extract_individual_matches.js ./
COPY ettu_results.js ./
COPY ettu_history_registry.js ./
COPY ettu_webgen_results.js ./
COPY ettu_archive_results.js ./
COPY ettu_team_results.js ./
COPY record_archive_identity.js ./
COPY record_knockout_outcome.js ./
COPY archive_maintenance.js ./
COPY import_ettu_history.js ./
COPY update_wtt_event_indexes.js ./
COPY export_zennihon_archives.js ./
COPY export_wtt_archive.js ./
COPY crawl_wtt_archives.js ./
COPY fetch_wtt_calendar_dates.js ./
COPY wtt_calendar.js ./
COPY ittf_para_calendar.js ./
COPY ittf-para-calendar.json ./
COPY update_wtt_date_index.js ./
COPY build_wtt_search_index.js ./
COPY build_wtt_slim_records.js ./
COPY build_player_records_index.js ./
COPY verify_wtt_alignment.js ./
COPY runtime_legacy_ittf_patch.js ./
COPY wtt_event_metadata_overrides.js ./
COPY player_record_event_index_utils.js ./
COPY player_record_candidate_index_utils.js ./
COPY player_record_event_index_audit.js ./
COPY player_record_display_filters.js ./
COPY head_to_head_query_job_store.js ./
COPY server.js ./
COPY patch_version_info.js ./
COPY translations.ja.json ./
COPY event-names.json ./
COPY wtt-date-index.json ./
COPY wtt-search-index.json ./
COPY rules.json ./
COPY public ./public
# Keep unchanged archive layers independent of application code updates.
COPY --link zennihon-records ./zennihon-records
COPY --link wtt-records ./wtt-records
COPY --link wtt-records-slim ./wtt-records-slim
COPY --link player-records-index/event-records ./player-records-index/event-records
COPY --link player-records-index/event-records-manifest.json ./player-records-index/event-records-manifest.json

RUN node -e 'for (const file of ["server.js", "crawl_wtt_archives.js"]) { const source = require("fs").readFileSync(file, "utf8"); for (const match of source.matchAll(/require\("(\.\/[^\"]+)"\)/g)) require.resolve(match[1]); }'
RUN node patch_version_info.js

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3000
ENV DATA_DIR=/data

EXPOSE 3000

CMD ["node", "-r", "./runtime_legacy_ittf_patch.js", "server.js"]
