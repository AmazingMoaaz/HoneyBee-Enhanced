FROM golang:1.23-alpine AS builder
RUN apk add --no-cache git build-base
WORKDIR /src
COPY shared ./shared
COPY node ./node
WORKDIR /src/node
RUN go mod download
RUN CGO_ENABLED=0 go build -ldflags="-s -w" -o /out/honeybee-node ./cmd

FROM alpine:3.20
RUN apk add --no-cache ca-certificates git python3 py3-pip bash
WORKDIR /app
COPY --from=builder /out/honeybee-node /usr/local/bin/honeybee-node
COPY node/configs /app/configs
EXPOSE 9100
ENTRYPOINT ["honeybee-node", "--config", "/app/configs/node.yaml"]
