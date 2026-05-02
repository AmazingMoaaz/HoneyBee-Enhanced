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
COPY core/configs /app/configs
COPY core/migrations /app/migrations
EXPOSE 5100 9001
ENTRYPOINT ["honeybee-core", "--config", "/app/configs/core.yaml"]
