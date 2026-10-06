from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager

import app.models  # Register all models
from app.config import settings
from app.database import Base, engine, SessionLocal
from app.api.auth import router as auth_router
from app.api.orders import router as orders_router
from app.api.shopify import router as shopify_router
from app.api.parcels import router as parcels_router
from app.api.returns import router as returns_router
from app.api.audit import router as audit_router
from app.api.webhooks import router as webhooks_router
from app.api.reconciliation import router as reconciliation_router
from app.api.dashboard import router as dashboard_router
from app.api.export import router as export_router
from app.api.tally import router as tally_router
from app.api.imports import router as imports_router
from app.api.shipments import router as shipments_router
from app.api.carrier_webhooks import router as carrier_webhooks_router
from app.api.shipsagar import router as shipsagar_router, webhook_router as shipsagar_webhook_router
from app.api.sla import router as sla_router
from app.api.statements import router as statements_router
from app.api.reports import router as reports_router
from app.api.carriers import router as carriers_router
from app.api.ledger import router as ledger_router
from app.api.accounting import router as accounting_router


def seed_initial_data():
    """Ensure database tables exist, missing columns are created, and seed demo accounts if empty."""
    try:
        # Run Alembic migrations programmatically if available
        try:
            import os
            from alembic.config import Config
            from alembic import command

            backend_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
            ini_path = os.path.join(backend_dir, "alembic.ini")
            if os.path.exists(ini_path):
                alembic_cfg = Config(ini_path)
                alembic_cfg.set_main_option("script_location", os.path.join(backend_dir, "alembic"))
                command.upgrade(alembic_cfg, "head")
        except Exception as alembic_err:
            print(f"Alembic auto-upgrade notice: {alembic_err}")

        Base.metadata.create_all(bind=engine)

        # Inspect and auto-add missing columns to existing orders table (e.g. PostgreSQL upgrade safety)
        from sqlalchemy import inspect, text
        inspector = inspect(engine)
        if "orders" in inspector.get_table_names():
            columns = {col["name"] for col in inspector.get_columns("orders")}
            new_cols = [
                ("receiver_name", "VARCHAR(128)"),
                ("receiver_company", "VARCHAR(128)"),
                ("receiver_add1", "VARCHAR(255)"),
                ("receiver_add2", "VARCHAR(255)"),
                ("receiver_city", "VARCHAR(64)"),
                ("receiver_state", "VARCHAR(64)"),
                ("receiver_pincode", "VARCHAR(12)"),
                ("receiver_mobile", "VARCHAR(16)"),
                ("receiver_email", "VARCHAR(128)"),
                ("sender_name", "VARCHAR(128)"),
                ("sender_add1", "VARCHAR(255)"),
                ("sender_city", "VARCHAR(64)"),
                ("sender_state", "VARCHAR(64)"),
                ("sender_pincode", "VARCHAR(12)"),
                ("sender_mobile", "VARCHAR(16)"),
                ("weight_grams", "NUMERIC(10, 2)"),
                ("shape", "VARCHAR(16)"),
                ("length_cm", "NUMERIC(8, 2)"),
                ("breadth_cm", "NUMERIC(8, 2)"),
                ("height_cm", "NUMERIC(8, 2)"),
                ("barcode_no", "VARCHAR(32)"),
                ("bulk_reference", "VARCHAR(64)"),
                ("cod_mode", "VARCHAR(16)"),
                ("cod_value", "NUMERIC(12, 2)"),
                ("dropoff_pincode", "VARCHAR(12)"),
            ]
            with engine.begin() as conn:
                for col_name, col_type in new_cols:
                    if col_name not in columns:
                        conn.execute(text(f"ALTER TABLE orders ADD COLUMN IF NOT EXISTS {col_name} {col_type}"))

        db = SessionLocal()
        try:
            from app.models.business import Business
            from app.models.user import User
            from app.services.auth_service import hash_password

            if db.query(Business).count() == 0:
                b = Business(name="Demo Business", email="demo@business.com")
                db.add(b)
                db.commit()
                db.refresh(b)

                # Seed Admin & Dashboard demo users
                u1 = User(business_id=b.id, name="Admin User", email="admin@t.in", password_hash=hash_password("Pass123!"), role="ADMIN")
                u2 = User(business_id=b.id, name="Dashboard User", email="dash@t.in", password_hash=hash_password("Pass123!"), role="ADMIN")
                db.add_all([u1, u2])
                db.commit()
        finally:
            db.close()
    except Exception as e:
        print(f"Startup seed notice: {e}")



@asynccontextmanager
async def lifespan(app: FastAPI):
    if settings.app_env == "dev":
        seed_initial_data()
    yield


app = FastAPI(title="Recon MVP", lifespan=lifespan)

# Configure CORS Middleware so cross-origin requests from frontend (localhost:3000) succeed without CORS errors
# Prod-safe: wildcard origins only in dev; otherwise explicit frontend origin.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"] if settings.app_env == "dev" else [settings.frontend_origin],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth_router)
app.include_router(orders_router)
app.include_router(shopify_router)
app.include_router(parcels_router)
app.include_router(returns_router)
app.include_router(audit_router)
app.include_router(webhooks_router)
app.include_router(reconciliation_router)
app.include_router(dashboard_router)
app.include_router(export_router)
app.include_router(tally_router)
app.include_router(imports_router)
# NOTE: sla_router must come before shipments_router — its GET
# /shipments/outstanding would otherwise be swallowed by shipments GET /{sid}.
app.include_router(sla_router)
app.include_router(shipments_router)
app.include_router(carrier_webhooks_router)
app.include_router(shipsagar_router)
app.include_router(shipsagar_webhook_router)
app.include_router(statements_router)
app.include_router(reports_router)
app.include_router(carriers_router)
app.include_router(ledger_router)
app.include_router(accounting_router)


@app.get("/health")
def health():
    return {"success": True, "data": {"status": "ok"}}


@app.get("/api/v1/health")
def api_health():
    return {"success": True, "data": {"status": "ok"}}
