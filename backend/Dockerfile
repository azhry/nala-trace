FROM golang:1.23.12-alpine3.21 AS build

WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -trimpath -ldflags="-s -w" -o /out/nala-trace .

FROM alpine:3.21.3

RUN addgroup -S app && adduser -S -G app app
COPY --from=build /out/nala-trace /usr/local/bin/nala-trace
USER app:app
EXPOSE 3003
ENTRYPOINT ["/usr/local/bin/nala-trace"]
