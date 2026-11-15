# data/

- `raw/` : cached copies of source files fetched by the pipeline (ignored by git; can be large).
- Processed output used by the app is written to `web/data/` and is committed, so the live demo works without running the pipeline.

See [docs/DATA.md](../docs/DATA.md) for sources, formats and provenance.
