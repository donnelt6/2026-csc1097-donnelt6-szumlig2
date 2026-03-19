drop function if exists match_source_chunks(vector(1536), int, uuid, uuid[]);

create or replace function match_source_chunks(
  query_embedding vector(1536),
  match_count int,
  match_hub uuid,
  match_sources uuid[] default null
)
returns table (
  id uuid,
  source_id uuid,
  hub_id uuid,
  chunk_index int,
  text text,
  similarity float,
  embedding vector(1536)
)
language sql
stable
as $$
  select
    id,
    source_id,
    hub_id,
    chunk_index,
    text,
    1 - (embedding <=> query_embedding) as similarity,
    embedding
  from source_chunks
  where hub_id = match_hub
    and embedding is not null
    and (match_sources is null or source_id = any(match_sources))
  order by embedding <=> query_embedding
  limit match_count;
$$;
