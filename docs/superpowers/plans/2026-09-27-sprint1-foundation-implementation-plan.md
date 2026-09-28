# Sprint 1 Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Scaffold monorepo and deliver Shopify→FastAPI→PostgreSQL→Next.js orders milestone with auth.

**Architecture:** FastAPI thin routes + service layer (`shopify_service`, `order_service`) over SQLAlchemy 2.0 + Alembic; Next.js App Router reads via `/api/v1`; Postgres is source of truth; Fernet-encrypted Shopify tokens.

**Tech Stack:** Python 3.14, FastAPI 0.115+, SQLAlchemy 2.0, Alembic, Pydantic v2, bcrypt/passlib, python-jose, cryptography (Fernet), pytest+httpx, Next.js 14 TS, Tailwind, shadcn/ui, TanStack Query, Docker Compose v5.

## Global Constraints

- Every business-owned row carries `business_id` UUID.
- Separate `financial_status / fulfillment_status / operational_status`, never single status.
- API envelope `{success:true,data}` / `{success:false,error:{code,message}}`.
- Never expose `access_token` or password hashes to frontend; log no secrets.
- UPSERT on `(business_id, shopify_order_id)` etc.; no duplicate orders on re-sync.
- Route handlers thin; business logic in `services/`.
- Never commit `.env`; provide `.env.example`.
- Python: Ruff+Black+mypy; Frontend: ESLint+Prettier.

---

### Task 1: Monorepo scaffold + env + Docker + health

**Files:**
- Create: `backend/requirements.txt`, `backend/app/main.py`, `backend/app/config.py`, `backend/app/database.py`, `backend/Dockerfile`, `docker-compose.yml`, `.env.example`, `.gitignore`, `frontend/package.json`, `frontend/app/layout.tsx`, `frontend/lib/api.ts`
- Test: `backend/tests/test_health.py`

**Interfaces:**
- Consumes: none
- Produces: `GET /health -> {success:true,data:{status:ok}}`; `Settings.database_url: str`

- [ ] **Step 1: Write failing health test**

```python
# backend/tests/test_health.py
from fastapi.testclient import TestClient
from app.main import app
def test_health():
    c = TestClient(app)
    r = c.get("/health")
    assert r.status_code == 200
    assert r.json()["success"] is True
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest backend/tests/test_health.py -v`
Expected: FAIL with "No module named app" / "main not found"

- [ ] **Step 3: Write minimal backend + env + docker**

```txt
# backend/requirements.txt
fastapi==0.115.6
uvicorn[standard]==0.34.0
sqlalchemy==2.0.36
alembic==1.14.0
psycopg2-binary==2.9.10
pydantic==2.10.4
pydantic-settings==2.7.0
python-jose[cryptography]==3.3.0
passlib[bcrypt]==1.7.4
cryptography==44.0.0
pytest==8.3.4
httpx==0.28.1
python-multipart==0.0.20
```

```python
# backend/app/config.py
from pydantic_settings import BaseSettings
class Settings(BaseSettings):
    database_url: str = "postgresql://postgres:postgres@localhost:5432/recon_mvp"
    jwt_secret: str = "dev-jwt-secret-change-me"
    encryption_key: str = ""  # Fernet key, generated if empty in docs
    shopify_api_version: str = "2026-01"
    class Config:
        env_file = ".env"
settings = Settings()
```

```python
# backend/app/database.py
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, DeclarativeBase
from .config import settings
engine = create_engine(settings.database_url, pool_pre_ping=True)
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)
class Base(DeclarativeBase):
    pass
def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
```

```python
# backend/app/main.py
from fastapi import FastAPI
app = FastAPI(title="Recon MVP")
@app.get("/health")
def health():
    return {"success": True, "data": {"status": "ok"}}
@app.get("/api/v1/health")
def api_health():
    return {"success": True, "data": {"status": "ok"}}
```

```env
# .env.example
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/recon_mvp
JWT_SECRET=change-me-32-chars-min
ENCRYPTION_KEY=
SHOPIFY_SHOP_DOMAIN=your-store.myshopify.com
SHOPIFY_ACCESS_TOKEN=
SHOPIFY_API_VERSION=2026-01
NEXT_PUBLIC_API_URL=http://localhost:8000
```

```yaml
# docker-compose.yml
services:
  db:
    image: postgres:16
    environment:
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: postgres
      POSTGRES_DB: recon_mvp
    ports: ["5432:5432"]
    volumes: [pgdata:/var/lib/postgresql/data]
  backend:
    build: ./backend
    ports: ["8000:8000"]
    env_file: [.env]
    command: uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
    depends_on: [db]
volumes: {pgdata: {}}
```

```dockerfile
# backend/Dockerfile
FROM python:3.14-slim
WORKDIR /code
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY app ./app
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
```

```json
// frontend/package.json (excerpt)
{"name":"recon-frontend","private":true,"scripts":{"dev":"next dev","build":"next build","lint":"next lint"},"dependencies":{"next":"14.2.0","react":"18.3.1","react-dom":"18.3.1"}}
```

```ts
// frontend/lib/api.ts
export const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";
export async function api<T>(p: string, init?: RequestInit): Promise<T> {
  const r = await fetch(`${API}${p}`, { ...init, headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) } });
  const j = await r.json();
  if (!j.success) throw new Error(j.error?.message ?? "API error");
  return j.data as T;
}
```

- [ ] **Step 4: Run tests to verify pass**

Run: `python -m pytest backend/tests/test_health.py -v`
Expected: PASS (run with `workdir: A:/Shopify Connection/backend` and `PYTHONPATH=.` if needed)

- [ ] **Step 5: Commit**

```bash
git add backend frontend docker-compose.yml .env.example .gitignore
git commit -m "feat: sprint1 scaffold with health and env"
```

---

### Task 2: Domain models + Alembic + auth

**Files:**
- Create: `backend/app/models/__init__.py`, `backend/app/models/base.py`, `backend/app/models/business.py`, `backend/app/models/user.py`, `backend/app/models/shopify_store.py`, `backend/app/models/customer.py`, `backend/app/models/product.py`, `backend/app/models/order.py`, `backend/app/models/payment.py`, `backend/app/models/webhook_event.py`, `backend/alembic.ini`, `backend/alembic/env.py`, `backend/alembic/versions/0001_sprint1.py`, `backend/app/api/auth.py`, `backend/app/schemas/auth.py`, `backend/app/services/auth_service.py`
- Modify: `backend/app/main.py:1-20` (include auth router, create_tables fallback for dev)
- Test: `backend/tests/test_auth.py`

**Interfaces:**
- Consumes: `Base`, `SessionLocal`, `Settings`
- Produces: `AuthService.hash_password(p:str)->str`, `verify_password(p,h)->bool`, `create_token(user_id,business_id,role)->str`; `POST /api/v1/auth/login {email,password} -> {token,user}`; `GET /api/v1/auth/me`

- [ ] **Step 1: Write failing auth test**

```python
# backend/tests/test_auth.py
from app.services.auth_service import hash_password, verify_password
def test_hash_verify():
    h = hash_password("StrongPass123!")
    assert verify_password("StrongPass123!", h)
    assert not verify_password("wrong", h)
```

- [ ] **Step 2: Run to verify fail**

Run: `python -m pytest backend/tests/test_auth.py -v`
Expected: FAIL "No module named app.services.auth_service"

- [ ] **Step 3: Minimal models + auth service + routes**

```python
# backend/app/models/base.py
import uuid
from sqlalchemy import String
from sqlalchemy.orm import Mapped, mapped_column
from app.database import Base
def uuidpk():
    return mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
```

```python
# backend/app/models/business.py
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy import String, DateTime, func
from app.database import Base
from .base import uuidpk
class Business(Base):
    __tablename__ = "businesses"
    id: Mapped[str] = uuidpk()
    name: Mapped[str] = mapped_column(String(255))
    email: Mapped[str] = mapped_column(String(255))
    timezone: Mapped[str] = mapped_column(String(64), default="Asia/Kolkata")
    currency: Mapped[str] = mapped_column(String(8), default="INR")
```

```python
# backend/app/models/user.py
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy import String, Boolean, ForeignKey
from app.database import Base
from .base import uuidpk
class User(Base):
    __tablename__ = "users"
    id: Mapped[str] = uuidpk()
    business_id: Mapped[str] = mapped_column(ForeignKey("businesses.id"))
    name: Mapped[str] = mapped_column(String(255))
    email: Mapped[str] = mapped_column(String(255), unique=True)
    password_hash: Mapped[str] = mapped_column(String(255))
    role: Mapped[str] = mapped_column(String(32), default="ADMIN")
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
```

Note: implement remaining models (`shopify_store` with `access_token_encrypted`, `customer`, `product`, `order` with columns `internal_order_number unique, shopify_order_id, shopify_order_name, customer_id nullable, order_date, currency, subtotal_amount, discount_amount, shipping_amount, tax_amount, total_amount, payment_status, financial_status, fulfillment_status, operational_status, cancelled_at nullable, cancel_reason nullable, shopify_created_at, shopify_updated_at`, `order_item`, `payment`, `shopify_webhook_events` with `webhook_id unique`) following same pattern with `business_id` FK, Decimal amounts, timestamps. Keep 1 order=1 parcel assumption documented but no parcels table in Sprint 1.

```python
# backend/app/services/auth_service.py
from passlib.context import CryptContext
from jose import jwt
from app.config import settings
pwd = CryptContext(schemes=["bcrypt"], deprecated="auto")
def hash_password(p: str) -> str: return pwd.hash(p)
def verify_password(p: str, h: str) -> bool: return pwd.verify(p, h)
def create_token(user_id: str, business_id: str, role: str) -> str:
    return jwt.encode({"sub": user_id, "bid": business_id, "role": role}, settings.jwt_secret, algorithm="HS256")
```

```python
# backend/app/api/auth.py (excerpt)
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from app.database import get_db
router = APIRouter(prefix="/api/v1/auth", tags=["auth"])
@router.post("/login")
def login(body: dict, db: Session = Depends(get_db)):
    from app.models.user import User
    from app.services.auth_service import verify_password, create_token
    u = db.query(User).filter(User.email == body.get("email")).first()
    if not u or not verify_password(body.get("password",""), u.password_hash):
        raise HTTPException(401, "Invalid credentials")
    token = create_token(u.id, u.business_id, u.role)
    return {"success": True, "data": {"token": token, "user": {"id": u.id, "email": u.email, "role": u.role}}}
```

Alembic `env.py` imports `Base` + all models, `target_metadata = Base.metadata`. `0001_sprint1.py` `upgrade()` uses `op.create_table` for the 9 tables with unique constraints + indexes on `orders(shopify_order_id, order_date, operational_status)`.

- [ ] **Step 4: Run auth + migration check**

Run: `python -m pytest backend/tests/test_auth.py -v`
Expected: PASS
Run: `alembic upgrade head` (with dev DATABASE_URL)
Expected: 9 tables created

- [ ] **Step 5: Commit**

```bash
git add backend/app/models backend/app/services backend/app/api backend/alembic.ini backend/alembic backend/tests/test_auth.py
git commit -m "feat: sprint1 domain models and auth"
```

---

### Task 3: Orders API + Shopify sync service (idempotent)

**Files:**
- Create: `backend/app/services/shopify_service.py`, `backend/app/services/order_service.py`, `backend/app/api/orders.py`, `backend/app/api/shopify.py`, `backend/tests/fixtures/shopify_orders.json`, `backend/tests/test_sync_idempotency.py`
- Modify: `backend/app/main.py` (mount orders+shopify routers)
- Test: `backend/tests/test_sync_idempotency.py`

**Interfaces:**
- Consumes: models, `get_db`
- Produces: `normalize_shopify_order(payload:dict)->dict`, `upsert_order(db,business_id,payload)->str(order_id)`; `POST /api/v1/shopify/sync?days=30`; `GET /api/v1/orders`, `GET /api/v1/orders/{id}`

- [ ] **Step 1: Write failing idempotency test**

```python
def test_upsert_idempotent(db_session, sample_business):
    from app.services.shopify_service import upsert_order
    import json
    payload = json.load(open("backend/tests/fixtures/shopify_orders.json"))[0]
    id1 = upsert_order(db_session, sample_business.id, payload)
    id2 = upsert_order(db_session, sample_business.id, payload)
    assert id1 == id2
    assert db_session.query(Order).count() == 1
```

- [ ] **Step 2: Run to verify fail**

Run: `python -m pytest backend/tests/test_sync_idempotency.py -v`
Expected: FAIL missing service/fixture

- [ ] **Step 3: Minimal fixtures + services + routes**

```json
// backend/tests/fixtures/shopify_orders.json (2 orders, truncated)
[{"id":"gid://shopify/Order/1001","name":"#10452","created_at":"2026-09-20T10:00:00Z","currency":"INR","subtotal":"1300.00","total_discounts":"100.00","total_shipping":"99.00","total_tax":"200.00","total_price":"1499.00","financial_status":"paid","fulfillment_status":"unfulfilled","customer":{"id":"501","first_name":"Rahul","email":"r@test.in","phone":"+91-90000"},"line_items":[{"id":"11","title":"Shoes","sku":"SH-01","quantity":2,"price":"650.00"}]}]
```

```python
# backend/app/services/shopify_service.py (excerpt)
from sqlalchemy.orm import Session
def normalize_shopify_order(p: dict) -> dict:
    return {"shopify_order_id": str(p.get("id")), "shopify_order_name": p.get("name",""), "currency": p.get("currency","INR"),
      "subtotal_amount": float(p.get("subtotal",0)), "discount_amount": float(p.get("total_discounts",0)),
      "shipping_amount": float(p.get("total_shipping",0)), "tax_amount": float(p.get("total_tax",0)), "total_amount": float(p.get("total_price",0)),
      "financial_status": str(p.get("financial_status","pending")).upper(), "fulfillment_status": str(p.get("fulfillment_status","unfulfilled")).upper()}
def upsert_order(db: Session, business_id: str, payload: dict):
    from app.models.order import Order
    n = normalize_shopify_order(payload)
    o = db.query(Order).filter_by(business_id=business_id, shopify_order_id=n["shopify_order_id"]).first()
    if o:
        for k,v in n.items(): setattr(o,k,v)
    else:
        o = Order(business_id=business_id, operational_status="NEW", **n); db.add(o)
    db.commit(); db.refresh(o); return o.id
```

`order_service.py` exposes `list_orders(db,business_id,search,status,page)` with barcode/search stub (barcode lookup added Sprint 2). `api/orders.py` returns envelope. `api/shopify.py` loops fixture or live Shopify REST (`https://{domain}/admin/api/{ver}/orders.json?status=any&created_at_min=...`) with `X-Shopify-Access-Token`, Fernet-decrypts stored token, updates `last_sync_at`, retries transient 429/5xx with backoff (single retry in Sprint 1).

- [ ] **Step 4: Verify pass + manual sync**

Run: `python -m pytest backend/tests/test_sync_idempotency.py -v`
Expected: PASS, no duplicates on second upsert

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/shopify_service.py backend/app/services/order_service.py backend/app/api/orders.py backend/app/api/shopify.py backend/tests/
git commit -m "feat: orders api and idempotent shopify sync"
```

---

### Task 4: Minimal Next.js login + orders + dashboard

**Files:**
- Create: `frontend/app/login/page.tsx`, `frontend/app/orders/page.tsx`, `frontend/app/orders/[id]/page.tsx`, `frontend/app/dashboard/page.tsx`, `frontend/components/OrderTable.tsx`
- Test: `frontend/tests/orders.test.tsx` (Vitest + Testing Library)

**Interfaces:**
- Consumes: `lib/api.ts`
- Produces: pages rendering `GET /api/v1/orders` envelope

- [ ] **Step 1: Write failing component test**

```tsx
// frontend/tests/orders.test.tsx
import { render, screen } from "@testing-library/react";
import OrderTable from "../components/OrderTable";
test("renders order", () => {
  render(<OrderTable orders={[{ id: "1", shopify_order_name: "#10452", total_amount: "1499.00" }]} />);
  expect(screen.getByText("#10452")).toBeDefined();
});
```

- [ ] **Step 2: Run to fail**

Run: `npm test -- orders.test`
Expected: FAIL missing component

- [ ] **Step 3: Minimal pages**

```tsx
// frontend/components/OrderTable.tsx
export default function OrderTable({ orders }: { orders: any[] }) {
  return <table><tbody>{orders.map(o => <tr key={o.id}><td>{o.shopify_order_name}</td><td>{o.total_amount}</td></tr>)}</tbody></table>;
}
```

Login posts to `/api/v1/auth/login`, stores JWT in httpOnly cookie via Next Route Handler (scaffold), orders page uses TanStack Query `api("/api/v1/orders")`.

- [ ] **Step 4: Verify**

Run: `npm test -- orders.test`
Expected: PASS; `npm run build` succeeds

- [ ] **Step 5: Commit**

```bash
git add frontend/
git commit -m "feat: login orders dashboard minimal ui"
```

---

### Task 5: E2E smoke + CI + docs

**Files:**
- Create: `.github/workflows/ci.yml`, `backend/tests/test_e2e_sprint1.py`, `README.md`
- Test: e2e sync→orders visible

- [ ] **Step 1: Write failing e2e**

```python
def test_e2e_sync_then_list(client, auth_headers):
    r = client.post("/api/v1/shopify/sync?days=30", headers=auth_headers)
    assert r.status_code in (200, 201)
    r2 = client.get("/api/v1/orders", headers=auth_headers)
    assert r2.json()["success"] is True and len(r2.json()["data"]) >= 1
```

- [ ] **Step 2: Run fail**, **Step 3: wire seed fallback**, **Step 4: pass**, **Step 5: commit** (same pattern as above).

CI:

```yaml
# .github/workflows/ci.yml
on: [push]
jobs:
  be: {runs-on: ubuntu-latest, steps: [{uses: actions/checkout@v4},{run: pip install -r backend/requirements.txt},{run: pytest backend/tests -q}]}
```

README documents `.env` setup, `alembic upgrade head`, `uvicorn app.main:app --reload`, `npm run dev`, and required env table from spec §9.
