FROM golang:1.23.12-alpine3.21 AS build

WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -trimpath -ldflags="-s -w" -o /src/nala-trace .

FROM alpine:3.21.3

RUN addgroup -S app && adduser -S -G app app
WORKDIR /app
COPY --from=build /src/nala-trace /app/server
USER app:app
EXPOSE 3003
ENTRYPOINT ["./server"]
