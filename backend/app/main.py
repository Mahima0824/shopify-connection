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
from app.api.products import router as products_router
from app.api.whatsapp import router as whatsapp_router
from app.api.rto import router as rto_router
from app.api.cod_remittance import router as cod_remittance_router


def seed_initial_data():
    """Lightweight startup initialization."""
    pass



@asynccontextmanager
async def lifespan(app: FastAPI):
    seed_initial_data()
    yield


from fastapi import Request
from fastapi.responses import JSONResponse

app = FastAPI(title="Recon MVP", lifespan=lifespan)

@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    import traceback
    traceback.print_exc()
    return JSONResponse(
        status_code=500,
        content={"success": False, "detail": str(exc)},
        headers={"Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "*"}
    )

# Configure CORS Middleware so cross-origin requests from any frontend origin (localhost:5173, localhost:3000, ngrok) succeed
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["*"],
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
app.include_router(products_router)
app.include_router(whatsapp_router)
app.include_router(rto_router)
app.include_router(cod_remittance_router)


@app.get("/health")
def health():
    return {"success": True, "data": {"status": "ok"}}


@app.get("/api/v1/health")
def api_health():
    return {"success": True, "data": {"status": "ok"}}
