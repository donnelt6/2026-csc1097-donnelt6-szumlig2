install:
	npm install

dev-web:
	cd apps/web && npm install && npm run dev

dev-api:
	cd apps/api && uvicorn app.main:app --reload --port 8000

dev-worker:
	cd apps/worker && celery -A worker.tasks worker --loglevel=info
