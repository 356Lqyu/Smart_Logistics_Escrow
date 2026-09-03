-- Run this in Supabase SQL Editor before using Milestone Submission Proof.
create table if not exists public.milestone_evidence (
    id bigserial primary key,
    agreement_id integer not null references public.agreements(agreement_id) on delete cascade,
    milestone_index integer not null check (milestone_index >= 0),
    progress_notes text not null,
    proof_url text,
    proof_file_name text,
    submitted_by text not null references public.users(wallet_address),
    transaction_hash text not null unique,
    submitted_at timestamptz not null default now(),
    constraint milestone_evidence_unique_submission unique (agreement_id, milestone_index)
);

create index if not exists idx_milestone_evidence_agreement
    on public.milestone_evidence(agreement_id, milestone_index);

-- Submission photos are stored here and receive a public URL saved in proof_url.
insert into storage.buckets (id, name, public)
values ('milestone-evidence', 'milestone-evidence', true)
on conflict (id) do update set public = true;

create policy "Public read milestone evidence"
on storage.objects for select to public
using (bucket_id = 'milestone-evidence');

create policy "Public upload milestone evidence"
on storage.objects for insert to public
with check (bucket_id = 'milestone-evidence');
