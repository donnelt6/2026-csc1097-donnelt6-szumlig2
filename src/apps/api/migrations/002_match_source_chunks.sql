-- Vector search function for retrieval
create or replace function match_source_chunks(
  query_embedding vector(1536),
  match_count int,
  match_hub uuid
)
returns table (
  id uuid,
  source_id uuid,
  hub_id uuid,
  chunk_index int,
  text text,
  similarity float
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
    1 - (embedding <=> query_embedding) as similarity
  from source_chunks
  where hub_id = match_hub and embedding is not null
  order by embedding <=> query_embedding
  limit match_count;
$$;
