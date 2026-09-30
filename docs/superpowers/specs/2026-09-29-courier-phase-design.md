# Courier Booking+NDR Phase Spec — 2026-09-29

Source: `courier_integration_india_post_dtdc_implementation_plan.md` (§§4, 9–10, 14, 16–19, 30–31, 39, 42, 46–48, 70, 74).
Only India Post + DTDC (+MANUAL working). No Tirupati additions; existing TIRUPATI stub stays untouched. No guessed endpoints.

## 1. Goal
Book courier shipments explicitly with failure records, handle NDR/reattempt/RTO_DELIVERED as first-class states, drive status mapping from the DB, and expose worker endpoints for polling/refresh/health.

## 2. Booking (§17–19, §42)
`POST /api/v1/shipments/{parcel_id}/book {carrier_code, service?, idempotency_key?}` (WAREHOUSE+):
validate parcel dispatchable (CREATED/PACKED, not cancelled — reuse ScanError codes) → reject if active shipment exists for parcel (400 SHIPMENT_EXISTS) → validate address/mobile/pincode/COD from order+customer (400 with field list on failure, no secrets) → MANUAL provider: allocate AWB as `M<carrier>-<uuid8>`? No — manual AWB must come from worker (carrier hands paper AWB). MANUAL booking REQUIRES awb_number in body; DTDC/India Post (uncredentialed) → 400 CARRIER_NOT_CONNECTED with "contact admin for credentials" message. Create shipment BOOKED + event + audit SHIPMENT_BOOKED. Idempotency: `Idempotency-Key` header OR body key, unique per (business, key) via `booking_idempotency` table (key, business, shipment_id, created_at) — repeat returns original shipment, no dup.
Failure records: `shipment_attempts` table (business, parcel, carrier, http_status NULL, provider_code/message, request_id NULL, occurred_at) on every booking failure incl validation.

## 3. NDR (§35, §53C/D)
New normalized states NDR, NDR_REATTEMPT, RTO_DELIVERED (terminal). `POST /shipments/{id}/ndr {reason?, action: reattempt|return}` (WAREHOUSE+): NDR → creates case (DELIVERY_EXCEPTION), reattempt → NDR_REATTEMPT + event; return → sets RTO_INITIATED path (rto_at, event, reconcile). RTO_DELIVERED added to TERMINAL set (stop polling) + closes RTO_DELAY issues. Cancel: `POST /shipments/{id}/cancel {reason}` (ADMIN): only pre-PICKED_UP statuses → CANCELLED + audit; else 400.

## 4. DB mappings (§14) + refresh cooldown (§70)
`courier_status_mappings` (business NULL=global, provider, provider_status_code UNIQUE per (provider, code), normalized_status, is_terminal/delivered/ndr/rto/hub flags). Seed rows for known DTDC/IndiaPost common codes? NO guessing (§3696) — seed only the generic keyword fallback as rows? Simpler: `normalize_status` consults table FIRST (business override → global), falls back to existing keyword matcher. Seed migration with 6 obvious rows? Any literal is a guess — seed ZERO rows; table starts empty, keyword fallback serves. Admin UI lists rows (read-only in this phase; editing next).
Refresh cooldown: `POST /shipments/{id}/sync` rejects if last_synced_at < 60s ago → 429 REFRESH_COOLDOWN (new code) with retry-after seconds.

## 5. Worker endpoints + health
`POST /shipments/poll-sweep?limit=` (ADMIN): eligible active non-terminal ordered by oldest checkpoint, calls provider sync each (manual → skipped count), returns {checked, updated, skipped, errors}. `POST /sla/evaluate` (ADMIN): runs delay detection → idempotent WAREHOUSE_DELAY/TRACKING_STALE issues (new codes) via _open semantics. `GET /carriers/health`: per provider {configured, last_success, last_error, counts} from carrier_connections.
Feature flags: `carrier_features` table (business, provider, capability, enabled) with defaults from provider.capabilities(); booking checks CREATE_SHIPMENT flag → 403 CAPABILITY_DISABLED? New code CAPABILITY_DISABLED. UI toggles read-only display (editing next phase).

## 6. UI
`/shipments/tracking`: summary cards (counts by status band), search (AWB/order/barcode/customer phone — phone via customer join), filters carrier/status/exception, manual refresh button w/ cooldown message. Dispatch page: courier select + book step (uses booking endpoint, shows AWB + Print/Tracking buttons, BOOKING_ERROR state with Edit/Retry). Shipment detail: NDR action buttons + cancel (ADMIN) + audit/raw panel (ADMIN). Settings carriers page: health cards.

## 7. Testing
Unit (mapping-table-first + keyword fallback, NDR transitions, idempotency-key repeat, cooldown 429, flag gate), integration (book→AWB→checkpoint→NDR→reattempt→RTO→delivered chain; duplicate webhook still 1 event), e2e adapted §53C/D. All green required.

## 8. Out of scope
Live DTDC/IndiaPost HTTP calls + credentials (need user keys), scheduler/cron (endpoints are cron-ready), aggregator, thermal, notifications.
