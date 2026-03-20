FROM golang:1.25-alpine AS build
WORKDIR /app
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN go build -o /relay ./services/relay

FROM alpine:3.19
RUN apk add --no-cache ca-certificates
COPY --from=build /relay /relay
ENTRYPOINT ["/relay"]
