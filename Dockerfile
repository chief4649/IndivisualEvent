FROM node:22-alpine

WORKDIR /app

COPY package.json ./
COPY extract_individual_matches.js ./
COPY export_zennihon_archives.js ./
COPY export_wtt_archive.js ./
COPY fetch_wtt_calendar_dates.js ./
COPY update_wtt_date_index.js ./
COPY build_wtt_search_index.js ./
COPY verify_wtt_alignment.js ./
COPY server.js ./
COPY translations.ja.json ./
COPY event-names.json ./
COPY wtt-date-index.json ./
COPY wtt-search-index.json ./
COPY wtt-archive-index.json ./
COPY rules.json ./
COPY public ./public
COPY zennihon-records ./zennihon-records
COPY wtt-records ./wtt-records

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3000
ENV DATA_DIR=/data

EXPOSE 3000

CMD ["node", "server.js"]
