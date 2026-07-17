database_url := env_var_or_default("DATABASE_URL", "postgres://localhost/slate_dev?sslmode=disable")

default:
    @just --list

migrate:
    DATABASE_URL={{database_url}} go run ./server/cmd/slate migrate

seed-owner:
    DATABASE_URL={{database_url}} go run ./server/cmd/slate seed-owner

serve:
    DATABASE_URL={{database_url}} COOKIE_SECURE=false go run ./server/cmd/slate serve

test:
    cd server && go test ./...
    cd cli && go test ./...
    node --test server/internal/web/dist/app.test.js

build:
    cd server && go build ./cmd/slate
    cd cli && go build ./cmd/slate
