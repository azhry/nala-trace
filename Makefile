.PHONY: verify verify-backend-build verify-backend-live verify-frontend-lint verify-frontend-build

verify: verify-backend-build verify-backend-live verify-frontend-lint verify-frontend-build

verify-backend-build:
	cd backend && go build ./...

verify-backend-live:
	cd backend && go test -tags=integration ./integration -count=1 -v

verify-frontend-lint:
	cd frontend && npm run lint

verify-frontend-build:
	cd frontend && npm run build
