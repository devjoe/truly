.DEFAULT_GOAL := help

.PHONY: help resume build build-dev verify check-public check-build release-preview release-review release-review-github release-bump-cws-preview cws-review cws-review-github \
	dev dev-all dev-daemon dev-reload dev-status dev-check dev-stop sync-headsup-css \
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
	@echo "  make dev-check           Verify dist/reload-server/Chrome build IDs"
	@echo "  make dev-stop            Stop dev watcher processes"
	@echo "  make test-watch          Run unit tests in watch mode"
	@echo "  make sync-headsup-css    Sync shared heads-up CSS block"
	@echo "  make release-preview     Build local Preview artifacts"
	@echo "  make release-review      Run advisory Claude release review"
	@echo "  make release-review-github"
	@echo "                           Run advisory Claude release review from public GitHub URLs"
	@echo "  make release-bump-cws-preview"
	@echo "                           Bump numeric version and Preview label for CWS"
	@echo "  make cws-review          Run advisory Claude CWS review"
	@echo "  make cws-review-github   Run advisory Claude CWS review from public GitHub URLs"
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

release-review:
	npm run release:review

release-review-github:
	npm run release:review:github

release-bump-cws-preview:
	npm run release:bump-cws-preview

cws-review:
	npm run cws:review

cws-review-github:
	npm run cws:review:github

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

dev-check:
	npm run dev:check

dev-stop:
	npm run dev:stop

sync-headsup-css:
	npm run sync:headsup-css

test-watch:
	npm run test:unit:watch

smoke-ollama-vision:
	npm run smoke:ollama-vision
