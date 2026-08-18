-- Milestone C15: adds ONE new value ('performance_imported') to
-- product_history_events.event_type's existing CHECK constraint (from
-- 20260810_10_product_history.sql). Nothing else about C14's table,
-- indexes, or RLS policies changes: this is the minimal, additive way to
-- let a performance import point at the same product-centric timeline
-- C14 already built, per §18's own explicit instruction ("Where
-- appropriate, add a C14 history event such as performance_imported ONLY
-- if this fits the existing event architecture cleanly").
--
-- Postgres auto-names an inline column CHECK constraint
-- "<table>_<column>_check": confirmed via the live schema, not assumed.
alter table product_history_events
  drop constraint if exists product_history_events_event_type_check;

alter table product_history_events
  add constraint product_history_events_event_type_check
  check (event_type in (
    'product_created',
    'product_updated',
    'enrichment_started',
    'enrichment_completed',
    'enrichment_failed',
    'listing_generated',
    'listing_edited',
    'listing_approved',
    'listing_rejected',
    'exported',
    'performance_imported'
  ));
