# Worker Tests

These tests cover the pure helper logic used by the ingestion worker. They avoid
network calls and external services by using simple monkeypatches.

What is tested
- Text normalization and whitespace handling.
- Chunking behavior and overlap rules.
- Batch splitting helper.
- File extension routing for text extraction.

How it works
- Tests import helper functions from their owning worker modules and keep `worker/tasks.py` focused on Celery task orchestration.
- Extraction helpers are patched so no real PDF or DOCX parsing is required.

Run the tests
```
cd 2026-csc1097-donnelt6-szumlig2/src/apps/worker
pip install -r requirements.txt
pytest
```
