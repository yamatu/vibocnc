# FANUC Backend Dockerfile（Go / Gin）

# Optional registry/mirror prefix for base images.
# Examples:
# - docker.io (default)
# - dockerproxy.net
# - docker.m.daocloud.io
ARG BASE_REGISTRY=docker.io

FROM ${BASE_REGISTRY}/library/golang:1.21-alpine AS builder

WORKDIR /src

RUN apk add --no-cache git ca-certificates tzdata

COPY go.mod go.sum ./
RUN go mod download

COPY . .

RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -o /out/server .
RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -o /out/bulk-seo-optimize ./cmd/bulk-seo-optimize

ARG BASE_REGISTRY=docker.io
FROM ${BASE_REGISTRY}/library/alpine:3.19 AS runner

WORKDIR /app
# mysql client tools (mysqldump/mysql) are used by the admin backup/restore endpoints.
RUN apk add --no-cache ca-certificates tzdata mariadb-client

COPY --from=builder /out/server /app/server
COPY --from=builder /out/bulk-seo-optimize /app/bulk-seo-optimize

# 上传目录（建议用 volume 挂载）
RUN mkdir -p /app/uploads

EXPOSE 8080

ENV HOST=0.0.0.0
ENV PORT=8080

CMD ["/app/server"]
