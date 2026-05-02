# --- node binary builder (cross-compiles for all platforms) ---
FROM golang:1.23-alpine AS node-builder
RUN apk add --no-cache git build-base
WORKDIR /src
COPY shared ./shared
COPY node ./node
WORKDIR /src/node
RUN go mod download
RUN CGO_ENABLED=0 GOOS=linux   GOARCH=amd64 go build -ldflags="-s -w" -o /out/honeybee-node-linux-amd64   ./cmd
RUN CGO_ENABLED=0 GOOS=linux   GOARCH=arm64 go build -ldflags="-s -w" -o /out/honeybee-node-linux-arm64   ./cmd
RUN CGO_ENABLED=0 GOOS=darwin  GOARCH=amd64 go build -ldflags="-s -w" -o /out/honeybee-node-darwin-amd64  ./cmd
RUN CGO_ENABLED=0 GOOS=darwin  GOARCH=arm64 go build -ldflags="-s -w" -o /out/honeybee-node-darwin-arm64  ./cmd
RUN CGO_ENABLED=0 GOOS=windows GOARCH=amd64 go build -ldflags="-s -w" -o /out/honeybee-node-windows-amd64.exe ./cmd

# --- builder ---
FROM golang:1.23-alpine AS builder
RUN apk add --no-cache git build-base
WORKDIR /src
COPY shared ./shared
COPY core ./core
WORKDIR /src/core
RUN go mod download
RUN CGO_ENABLED=0 go build -ldflags="-s -w" -o /out/honeybee-core ./cmd

# --- runtime ---
FROM alpine:3.20
RUN apk add --no-cache ca-certificates tzdata
WORKDIR /app
COPY --from=builder /out/honeybee-core /usr/local/bin/honeybee-core
COPY --from=node-builder /out /app/bin
COPY core/configs /app/configs
COPY core/migrations /app/migrations
EXPOSE 5100 9001
ENTRYPOINT ["honeybee-core", "--config", "/app/configs/core.yaml"]
