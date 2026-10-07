# Ledger Correctness — Wave A Design — 2026-10-08

Origin: code review of `backend/app/services/ledger_service.py`, `backend/app/services/tally_service.py`, `backend/app/api/ledger.py`, `backend/app/api/tally.py` (2026-10-08).

## 0. Sequencing

Three independent waves; this spec is **wave A only**.

- **Wave A (this spec)** — ledger correctness. Makes the stored numbers right.
- **Wave B (separate spec)** — Tally XML exporter + Tally-shape defects.
- **Wave C (separate spec)** — report consistency (`monthly_report` P&L divergence, `payments_pending`, legacy `/export` endpoint).

Wave A deliberately pre-shapes wave B: a voucher becomes a balance-checked group of legs, so the wave B XML exporter reads real legs instead of re-deriving them, and `ensure_period_postings` guarantees an export carries the period's freight and COGS.

## 1. Goal

The ledger stops encoding one economic fact twice, stops losing events silently, and stops omitting freight/COD/claim money entirely. `post_voucher` becomes the single write primitive and is balance-enforced.

## 2. P0 — cancellation double-count

`orders/cancelled` on a paid order writes a full-amount `CANCELLATION`; `refunds/create` then writes a `REFUND`. `revenue_summary` subtracts both, so a ₹1,000 order sold-then-fully-refunded yields `gross 1000 − refunds 1000 − canc 1000 = −1000`. Tally receives three vouchers (Sales, Credit Note, Journal) reversing ₹3,000 for one order.

**Decision:** `CANCELLATION` becomes amount-less — a void marker only, as it already is for unpaid orders. `REFUND` is the single revenue-reversing event. A paid order cancelled without a refund keeps its sale on the books until the refund actually posts (an auditor-visible liability, not a silent write-off).

## 3. Primitives — `post_voucher`

A voucher is a list of legs; each leg is `{debit_account, credit_account, amount}` — exactly the shape `FinancialTransaction` already stores. A voucher becomes N rows, one per leg, tied by a new `voucher_group_id`, ordered by `leg_index`.

Each leg additionally carries `pnl_class` ∈ `{REVENUE, COGS, EXPENSE, REVERSAL, NONE}`. This is required, not decorative: a `COD_REMIT` stores four legs all typed `COD_REMIT`, and only the fee and deduction legs are expense — the bank leg is not income. Classifying by `transaction_type` or by account name would both be wrong. `pnl_class` is set by the writer at post time and is the single source of truth for §8.

`post_voucher(db, business_id, event_type, legs, *, order_id=None, transaction_date=None, reference_number=None, idempotency_key=None, ...)`:

- **Refuses to persist unless `sum(debit legs) == sum(credit legs)`** (Decimal, 0.01 tolerance). Raises `UnbalancedVoucher` and writes nothing. This is the invariant that keeps malformed vouchers out of the ledger entirely.
- Idempotent per leg on `{group_key}:{leg_index}`. A replay returns the existing group.
- `record_event` becomes a two-leg wrapper over `post_voucher`. All four existing call sites keep working; the 24 existing ledger/tally tests must stay green unchanged.

Rationale for a new primitive rather than extending `record_event`: a COD remittance needs four legs and a GST credit note needs four; `record_event`'s single debit/credit pair is structurally incapable of expressing either.

## 4. New transaction types

`models/financial_transaction.py` `TRANSACTION_TYPES` gains:

| Type | Meaning |
|---|---|
| `COD_COLLECTION` | COD order delivered; receivable moves customer → carrier |
| `COD_REMIT` | carrier remits collected COD, net of fee and deductions |
| `CARRIER_CLAIM` | claim against a carrier |
| `REFUND_PAYOUT` | money physically leaving gateway/bank for a refund |

`COD_COLLECTION` was not in the original review finding. It is required because nothing ever raises a COD receivable — a COD order has no `Payment` row until settlement — so `COD_REMIT` would have nothing to credit and could never balance.

`SHIPPING_EXPENSE`, `PACKAGING_EXPENSE`, `PAYMENT_GATEWAY_FEE`, `COGS` already exist and gain writers rather than new types.

## 5. Refunds — two vouchers, real GST

`record_refund_from_refund` posts:

1. **`REFUND`** (Credit Note) — Dr Sales (taxable), Dr Output CGST, Dr Output SGST **or** Output IGST, Cr Receivable (gross).
   GST legs come from that order's real `OrderItem.cgst_amount` / `sgst_amount` / `igst_amount`, scaled proportionally to the refunded amount. Replaces today's `_split_gst` half-split, which ignored per-line rates and shipped IGST as 0 for unknown jurisdiction.
2. **`REFUND_PAYOUT`** — Dr Receivable / Cr Gateway (gross).

Both are needed and they net: the credit note re-creates the receivable, the payout clears it. Today's single event cannot do this, which is why GST on credit notes is currently always zero.

Webhook call site (`webhook_service.py:115`) currently passes no `tax_amount`, defaulting to `"0"`. The default is removed; tax is derived from `OrderItem`, falling back to 0 plus a CA-review flag when the order total is unusable.

## 6. `finance_posting.py`

New module `backend/app/services/finance_posting.py`. Every function idempotent on a stable key, returning the voucher group or `None` when nothing is due.

**COD** — `record_cod_remittance_from_shipment_financial(db, business_id, sf)`:

| Leg | Dr | Cr |
|---|---|---|
| 1 | Bank `net_settlement` | |
| 2 | Carrier Fee `fee_amount` | |
| 3 | COD Deduction `other_deduction` | |
| 4 | | COD Receivable `cleared` |

`cleared = net_settlement + fee_amount + other_deduction`. Asserts `cleared == settled_amount` within ₹1 and refuses to post otherwise — a settlement that does not reconcile becomes a surfaced exception, not a silent bad voucher. Zero legs omitted. Triggered when `ShipmentFinancial.status` reaches `SETTLED`.

`pnl_class` on those legs: bank `NONE`, carrier fee `EXPENSE`, COD deduction `EXPENSE`, COD receivable `NONE`.

**COD collection** — `record_cod_collection_from_shipment(db, business_id, shipment)`, triggered on delivery of a COD order: Dr COD Receivable / Cr Customer Receivable (gross `collected_amount`). Reclass only; both legs `pnl_class = NONE`. Idempotent on `COD_COLLECTION:{shipment_id}`. Without this the COD loop cannot close, because `COD_REMIT` has nothing to credit.

**Period costs** — `post_period_costs(db, business_id, year, month)`:

- `COGS` per order item — `ProductCostHistory` if present, else `CostRule["COGS_DEFAULT"]`
- `SHIPPING_EXPENSE` per shipment — `CostRule["SHIPPING"]`
- `PACKAGING_EXPENSE` per order — `CostRule["PACKAGING"]`
- `PAYMENT_GATEWAY_FEE` per order — `CostRule["GATEWAY_FEE"]`

**Carrier claims** — `CARRIER_CLAIM` is postable by hand from `ShipmentCase.claim_amount`. No claim state machine in this wave.

## 7. Auto-post trigger and kill switches

One idempotent entry point, `ensure_period_postings(db, business_id, start, end)`, called from:

- the top of `generate_workbook_export` (an export always contains the period's costs)
- the top of `close_checks` (a month is never blocked on missing COGS)
- `POST /api/v1/ledger/post-period-costs?year=&month=` (accountant runs it early, or re-runs after fixing a `CostRule`)

Config, matching the `india_post_enabled` style in `config.py`:

```python
ledger_auto_post_costs: bool = True
ledger_auto_post_cod: bool = True
```

Either `false` makes the corresponding writer a no-op that still returns a dry-run summary of what it would have posted, so production can be dry-run before it is trusted. Default in `.env.example` carries a comment explaining the switch.

## 8. Readers — P&L classification

Today the P&L effect of a type is re-inferred at each call site. It becomes an explicit per-leg classification, carried on the row as `pnl_class` and resolved per leg rather than per voucher:

| `pnl_class` | Legs | P&L direction |
|---|---|---|
| `REVENUE` | `SALE` gross | + revenue; split into taxable + tax by the row's own `tax_amount` |
| `REVERSAL` | `REFUND` Sales + GST legs, `CARRIER_CLAIM` on filing | − revenue and − tax |
| `COGS` | `COGS` | − profit |
| `EXPENSE` | `SHIPPING_EXPENSE`, `PACKAGING_EXPENSE`, `PAYMENT_GATEWAY_FEE`, `OTHER_EXPENSE`, `TAX`, `COD_REMIT` fee + deduction legs | − profit |
| `NONE` | `PAYMENT`, `REFUND_PAYOUT`, `COD_COLLECTION`, `COD_REMIT` bank + receivable legs, `CARRIER_CLAIM` on recovery | never touches P&L |

The `COD_REMIT` split is the case that forces per-leg classification: all four legs share one `transaction_type`, and only two are expense.

`profit_summary` gains carrier-fee and COD-deduction lines so they stop being invisible. `CANCELLATION` is removed from the revenue-reversal branch (marker only). `revenue_summary` stops treating zero-amount `CANCELLATION` markers as void markers needing exclusion, since they are now all amount-less.

`to_double_entry` is **retired**. With `post_voucher` the double entry *is* the stored leg pairs; `order_timeline` reads them off the rows. This also removes the hardcoded `"Output GST"` string that ignored the configured mapping.

## 9. Silent event loss → durable failure record

Every `record_*` hook currently wraps its body in `except Exception: return None`, so a `ClosedPeriodError`, an integrity error, or a DB outage silently drops the ledger row while reports still show the revenue.

- Hooks now **raise**.
- The webhook path still must not 500, so it catches narrowly and writes to a new `ledger_posting_failures` table: `business_id, source_type, source_id, event_type, reason, attempts, resolved_at, created_at`.
- `close_checks` gains a `ledger_posting_failures` issue: an unresolved failure blocks month close.

Net effect: "silently lost revenue" becomes "a month you cannot close until it is fixed".

## 10. Migration `0020_ledger_vouchers`

Schema:

- `financial_transactions`: `voucher_group_id VARCHAR(64)` + index, `leg_index INTEGER NOT NULL DEFAULT 0`, `pnl_class VARCHAR(16) NOT NULL DEFAULT 'NONE'`
- `shipment_cases`: `claim_amount NUMERIC(12,2)` nullable
- new table `ledger_posting_failures`

Existing rows backfill `pnl_class` from their `transaction_type` using the §8 table, so pre-existing sales, payments and expenses classify correctly before any new posting lands.

Remediation for existing production data:

- `UPDATE financial_transactions SET amount=0, tax_amount=0, net_amount=0 WHERE transaction_type='CANCELLATION' AND amount <> 0`
- backfill `REFUND.tax_amount` from the order's `OrderItem` CGST+SGST+IGST, pro-rated by `refund_amount / order_total`

**Deliberate exception:** this migration mutates rows in place rather than posting `ADJUSTMENT` reversals. Reversing would double-count, because the original amount was never a real economic event — it was a write-side encoding bug. The alembic revision is the audit trail and its docstring says so.

## 11. Testing

Written before implementation. Existing 24 ledger/tally tests stay green unchanged.

- `post_voucher` rejects an unbalanced voucher and writes nothing
- `post_voucher` writes N legs sharing one `voucher_group_id` in `leg_index` order
- `record_event` behaviour unchanged
- paid cancel + full refund ⇒ revenue exactly `0.00`, not `−1000.00`
- `REFUND` GST legs match real `OrderItem` figures; a mixed 5%/18% order is not one flat half-split
- inter-state refund produces IGST and zero CGST/SGST
- `COD_REMIT` balances; `net + fee + deductions ≠ settled` posts nothing and raises
- `COD_REMIT` bank and receivable legs are `pnl_class=NONE`; fee and deduction legs are `EXPENSE`
- `COD_COLLECTION` → `COD_REMIT` nets COD Receivable to zero
- `ensure_period_postings` idempotent across three consecutive calls
- kill switch off ⇒ nothing written, dry-run summary still returned
- webhook ledger failure lands in `ledger_posting_failures` and blocks `close_checks`
- migration: on a seeded pre-fix DB, remediation zeroes exactly the amount-bearing `CANCELLATION` rows and leaves `net_amount == amount − tax` intact everywhere

## 12. Rollout order

1. `0020_ledger_vouchers` schema + remediation. Run `SELECT count(*) FROM financial_transactions WHERE transaction_type='CANCELLATION' AND amount <> 0` first; it must drop by exactly that count afterwards.
2. `post_voucher` + `record_event` wrapper — no behaviour change; existing tests prove it.
3. `finance_posting.py` writers + triggers, kill switches on.
4. Readers: P&L classification, `ensure_period_postings` hooks, retire `to_double_entry`.
5. Kill switches documented in `.env.example`; flipped on by the operator after reviewing a dry run.

Failure at any step rolls back by flipping a switch. The ledger itself remains append-only.

## 13. Out of scope

- Carrier-claim lifecycle automation (§6, manual by decision)
- Tally XML exporter and all Tally-shape defects — wave B
- `monthly_report` P&L divergence, `payments_pending`, legacy `/export` endpoint — wave C

## 14. Residual risk

Auto-posted `COGS` derives from `CostRule`, a per-unit default — not a purchase-order-derived actual. Until `ProductCostHistory` is populated from real invoices, operating profit is an estimate that happens to be posted as a ledger entry. The existing `ESTIMATED OPERATING PROFIT` label, driven by cost source, is retained so it is never presented as more accurate than it is.