# Child-Safe E-Library sync server. Pure Go (no cgo), so the final image is tiny.
FROM golang:1.26 AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY *.go ./
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /elibrary-server .

FROM gcr.io/distroless/static-debian12:nonroot
COPY --from=build /elibrary-server /elibrary-server
ENV ELIB_ADDR=:8080 \
    ELIB_DATA_DIR=/data
VOLUME ["/data"]
EXPOSE 8080
ENTRYPOINT ["/elibrary-server"]
