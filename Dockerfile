FROM golang:1.26-bookworm AS build

WORKDIR /src

COPY go.work go.work
COPY server/go.mod server/go.sum* ./server/
COPY cli/go.mod ./cli/
RUN cd server && go mod download

COPY server server
COPY cli cli
RUN cd server && CGO_ENABLED=0 GOOS=linux go build -o /out/slate ./cmd/slate
RUN cd cli && CGO_ENABLED=0 GOOS=linux go build -o /out/slate-cli ./cmd/slate

FROM gcr.io/distroless/static-debian12

WORKDIR /app
COPY --from=build /out/slate /app/slate
COPY --from=build /out/slate-cli /app/slate-cli

EXPOSE 8080
USER nonroot:nonroot

ENTRYPOINT ["/app/slate"]
CMD ["serve"]
