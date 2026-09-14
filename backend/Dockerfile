# FANUC Backend Dockerfile（Go / Gin）

# Optional registry/mirror prefix for base images.
# Examples:
# - docker.io (default)
# - dockerproxy.net
# - docker.m.daocloud.io
ARG BASE_REGISTRY=docker.io

FROM ${BASE_REGISTRY}/library/golang:1.25-alpine AS builder

WORKDIR /src

RUN apk add --no-cache git ca-certificates tzdata

COPY go.mod go.sum ./
RUN go mod download

COPY . .

RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -o /out/server .
RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -o /out/bulk-seo-optimize ./cmd/bulk-seo-optimize

ARG BASE_REGISTRY=docker.io
FROM ${BASE_REGISTRY}/library/alpine:3.23 AS runner

WORKDIR /app
# mysql client tools (mysqldump/mysql) are used by the admin backup/restore endpoints.
# su-exec is used by the entrypoint to drop root privileges.
RUN apk add --no-cache ca-certificates tzdata mariadb-client su-exec

# Run the application as an unprivileged user. UID/GID 10001 is used so the bind
# mounted uploads directory can be chowned predictably on the host:
#   sudo chown -R 10001:10001 backend/uploads
RUN addgroup -g 10001 -S app && adduser -u 10001 -S app -G app

COPY --from=builder /out/server /app/server
COPY --from=builder /out/bulk-seo-optimize /app/bulk-seo-optimize
COPY docker-entrypoint.sh /app/docker-entrypoint.sh
RUN chmod +x /app/docker-entrypoint.sh

# 上传目录（建议用 volume 挂载）。用 COPY 创建目录，避免低内存环境下再启动一层 RUN 容器。
COPY uploads/.gitkeep /app/uploads/.gitkeep

# The entrypoint fixes ownership of the mounted volumes (which Docker creates as
# root) and then drops privileges to the app user before exec'ing the server.
ENTRYPOINT ["/app/docker-entrypoint.sh"]

EXPOSE 8080

ENV HOST=0.0.0.0
ENV PORT=8080

CMD ["/app/server"]
