database_url := env_var_or_default("DATABASE_URL", "postgres://localhost/slate_dev?sslmode=disable")

default:
    @just --list

migrate:
    DATABASE_URL={{database_url}} go run ./server/cmd/slate migrate

seed-admin:
    DATABASE_URL={{database_url}} go run ./server/cmd/slate seed-admin

# Compatibility alias. Prefer seed-admin.
seed-owner: seed-admin

serve:
    DATABASE_URL={{database_url}} COOKIE_SECURE=false go run ./server/cmd/slate serve

test: test-unit

test-unit:
    npm run build:web
    cd server && SLATE_TEST_DATABASE_URL= go test ./...
    cd cli && go test ./...
    npm run test:web
    sh scripts/test-install.sh
    sh scripts/test-cloudbuild.sh

test-ci:
    npm run build:web
    sh scripts/test-server-ci.sh
    cd cli && go test ./...
    npm run test:web
    npm run test:browser
    sh scripts/test-install.sh
    sh scripts/test-cloudbuild.sh

build:
    npm run build:web
    cd server && go build ./cmd/slate
    cd cli && go build ./cmd/slate
