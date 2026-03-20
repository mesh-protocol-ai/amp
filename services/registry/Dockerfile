FROM golang:1.25-alpine AS build
WORKDIR /app
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN go build -o /registry ./services/registry

FROM alpine:3.19
RUN apk add --no-cache ca-certificates
COPY --from=build /registry /registry
EXPOSE 8080
ENTRYPOINT ["/registry"]
