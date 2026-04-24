alter table if exists faq_entries
  add column if not exists topic_label text;

alter table if exists guide_entries
  add column if not exists topic_label text;
