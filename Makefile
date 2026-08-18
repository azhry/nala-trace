.PHONY: verify verify-backend-build verify-frontend-lint verify-frontend-build

verify: verify-backend-build verify-frontend-lint verify-frontend-build

verify-backend-build:
	cd backend && go build ./...

verify-frontend-lint:
	cd frontend && npm run lint

verify-frontend-build:
	cd frontend && npm run build
