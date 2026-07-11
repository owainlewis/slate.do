default:
    @just --list

migrate:
    go run ./server/cmd/slate migrate

seed-owner:
    go run ./server/cmd/slate seed-owner

serve:
    COOKIE_SECURE=false go run ./server/cmd/slate serve

test:
    cd server && go test ./...
    cd cli && go test ./...
    node --test server/internal/web/dist/app.test.js

build:
    cd server && go build ./cmd/slate
    cd cli && go build ./cmd/slate
