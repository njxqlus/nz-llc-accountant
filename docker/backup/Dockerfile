FROM alpine:3.22

RUN apk add --no-cache bash ca-certificates coreutils postgresql16-client rclone restic tzdata

WORKDIR /app

COPY docker/backup/entrypoint.sh /usr/local/bin/backup-entrypoint
COPY docker/backup/run-backup.sh /usr/local/bin/run-backup
COPY docker/backup/restore-latest.sh /usr/local/bin/restore-latest

RUN chmod +x /usr/local/bin/backup-entrypoint /usr/local/bin/run-backup /usr/local/bin/restore-latest

ENTRYPOINT ["backup-entrypoint"]
