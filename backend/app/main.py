from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager

import app.models  # Register all models
from app.database import Base, engine, SessionLocal
from app.api.auth import router as auth_router
from app.api.orders import router as orders_router
from app.api.shopify import router as shopify_router
from app.api.parcels import router as parcels_router
from app.api.scanning import router as scan_router
from app.api.returns import router as returns_router
from app.api.audit import router as audit_router
from app.api.webhooks import router as webhooks_router
from app.api.reconciliation import router as reconciliation_router
from app.api.dashboard import router as dashboard_router
from app.api.export import router as export_router
from app.api.tally import router as tally_router


def seed_initial_data():
    """Ensure database tables exist and seed demo accounts if empty."""
    try:
        Base.metadata.create_all(bind=engine)
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
    seed_initial_data()
    yield


app = FastAPI(title="Recon MVP", lifespan=lifespan)

# Configure CORS Middleware so cross-origin requests from frontend (localhost:3000) succeed without CORS errors
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth_router)
app.include_router(orders_router)
app.include_router(shopify_router)
app.include_router(parcels_router)
app.include_router(scan_router)
app.include_router(returns_router)
app.include_router(audit_router)
app.include_router(webhooks_router)
app.include_router(reconciliation_router)
app.include_router(dashboard_router)
app.include_router(export_router)
app.include_router(tally_router)


@app.get("/health")
def health():
    return {"success": True, "data": {"status": "ok"}}


@app.get("/api/v1/health")
def api_health():
    return {"success": True, "data": {"status": "ok"}}
