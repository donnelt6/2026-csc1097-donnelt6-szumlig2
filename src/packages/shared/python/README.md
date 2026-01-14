# Shared Schemas (Python)

Set `PYTHONPATH=packages/shared/python` when running API or workers to share Pydantic models across services. This keeps API contracts aligned with the frontend TypeScript types.

## Files and purpose
- `README.md` - Overview of the shared Python schemas.
- `shared_schemas/__init__.py` - Package exports for shared models.
- `shared_schemas/models.py` - Pydantic models mirroring API contracts.
