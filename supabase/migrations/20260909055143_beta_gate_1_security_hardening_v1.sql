-- Beta Gate 1 security hardening V1
-- Keep semantic review persistence service-only and remove the mutable
-- search_path warning without modifying its historical migration.

alter function public.prevent_receipt_semantic_review_mutation()
  set search_path = pg_catalog;

revoke all on function public.prevent_receipt_semantic_review_mutation()
  from public, anon, authenticated;
grant execute on function public.prevent_receipt_semantic_review_mutation()
  to service_role;

revoke all on public.receipt_semantic_reviews
  from public, anon, authenticated;
grant all on public.receipt_semantic_reviews
  to service_role;

alter table public.receipt_semantic_reviews enable row level security;
