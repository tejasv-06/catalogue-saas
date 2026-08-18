-- Milestone C18 (Photos Only Product Grouping + Credit Accounting): adds
-- 'image_grouping' as a new, additive credit_transactions.reason value.
--
-- Confirmed the ledger uses a CHECK constraint, not a Postgres enum/type
-- (see 20260810_04_credit_transaction_ledger.sql, which added
-- credit_transactions_reason_check: 'reason' itself is a plain text
-- column). This migration only widens that CHECK constraint; it does not
-- touch the column type, the deduct_credits function signature (p_reason
-- stays `text`, already accepts any string: see
-- 20260810_04_credit_transaction_ledger.sql), or any existing row.
--
-- Run this in the Supabase SQL editor (Dashboard > SQL Editor) once, same
-- manual-apply discipline as every other migration file in this folder.
--
-- Existing reasons ('generation', 'account_audit', 'refund') are kept
-- verbatim, in the same order, with 'image_grouping' appended: nothing
-- removed, renamed, or reordered.

alter table credit_transactions
  drop constraint if exists credit_transactions_reason_check;
alter table credit_transactions
  add constraint credit_transactions_reason_check
  check (reason in ('generation', 'account_audit', 'refund', 'image_grouping'));
