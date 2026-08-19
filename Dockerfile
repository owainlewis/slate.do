FROM node:24-bookworm-slim AS web-build

WORKDIR /src

COPY package.json package-lock.json components.json ./
RUN npm ci

COPY web web
RUN npm run build:web

FROM golang:1.26-bookworm AS build

WORKDIR /src

COPY go.work go.work
COPY server/go.mod server/go.sum* ./server/
COPY cli/go.mod ./cli/
RUN cd server && go mod download

COPY server server
COPY cli cli
COPY --from=web-build /src/server/internal/web/dist ./server/internal/web/dist
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
