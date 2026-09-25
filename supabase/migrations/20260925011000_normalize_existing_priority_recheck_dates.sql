-- Older completed requests can have unrelated eligibility dates. Make their
-- next Priority Queue check exactly five days after their last completion.
update public.public_collection_requests r
set eligible_at = r.completed_at + interval '5 days',
    updated_at = now()
where r.status = 'completed'
  and r.completed_at is not null
  and r.eligible_at is distinct from r.completed_at + interval '5 days';
