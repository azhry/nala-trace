.PHONY: test test-backend test-backend-cover test-backend-integration test-frontend test-frontend-lint test-frontend-build

test: test-backend test-backend-integration test-frontend

test-backend:
	cd backend && go test ./... -count=1 -short -v

test-backend-cover:
	cd backend && go test ./... -count=1 -coverprofile=coverage.out -v
	cd backend && go tool cover -func=coverage.out

test-backend-integration:
	cd backend && go test ./integration -count=1 -v

test-frontend:
	cd frontend && npm test -- --run

test-frontend-lint:
	cd frontend && npm run lint

test-frontend-build:
	cd frontend && npm run build
