# Shared Schemas (Python)

Install this package in editable mode from the API and worker environments to share Pydantic models and cross-service helpers. The API and worker `requirements.txt` files already include `-e ../../packages/shared/python` for local and CI installs.

## Files and purpose
- `README.md` - Overview of the shared Python schemas.
- `shared_schemas/__init__.py` - Package exports for shared models.
- `shared_schemas/models.py` - Pydantic models mirroring API contracts.
- `shared_schemas/url_utils.py` - URL and YouTube target normalization shared by API source de-duplication and worker suggestion handling.
