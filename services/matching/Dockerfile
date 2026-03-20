FROM golang:1.25-alpine AS build
WORKDIR /app
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN go build -o /matching ./services/matching

FROM alpine:3.19
RUN apk add --no-cache ca-certificates
COPY --from=build /matching /matching
ENTRYPOINT ["/matching"]
