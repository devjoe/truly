.DEFAULT_GOAL := help

.PHONY: help resume build build-dev verify check-public check-build release-preview \
	dev dev-all dev-daemon dev-reload dev-status dev-stop sync-headsup-css \
	test-watch smoke-ollama-vision

help:
	@echo "Truly public development targets"
	@echo ""
	@echo "  make resume              Show repo state and common next commands"
	@echo "  make verify              Run the public gate"
	@echo "  make build               Build the clean extension"
	@echo "  make build-dev           Build and patch local dev shortcut"
	@echo "  make dev-all             Run watch build + reload server"
	@echo "  make dev-status          Show dev watcher status"
	@echo "  make dev-stop            Stop dev watcher processes"
	@echo "  make test-watch          Run unit tests in watch mode"
	@echo "  make sync-headsup-css    Sync shared heads-up CSS block"
	@echo "  make release-preview     Build local Preview artifacts"
	@echo "  make smoke-ollama-vision Optional live Ollama vision smoke"

resume:
	@git status --short --branch
	@echo ""
	@echo "Common commands:"
	@echo "  make dev-all"
	@echo "  make verify"
	@echo "  make release-preview"

build:
	npm run build

build-dev:
	npm run build:dev

verify check-public:
	npm run check:public

check-build:
	npm run check:build

release-preview:
	npm run release:preview

dev:
	npm run dev

dev-all:
	npm run dev:all

dev-daemon:
	npm run dev:daemon

dev-reload:
	npm run dev:reload

dev-status:
	npm run dev:status

dev-stop:
	npm run dev:stop

sync-headsup-css:
	npm run sync:headsup-css

test-watch:
	npm run test:unit:watch

smoke-ollama-vision:
	npm run smoke:ollama-vision
