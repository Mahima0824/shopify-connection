from fastapi import APIRouter, Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError, jwt
from sqlalchemy.orm import Session

from app.config import settings
from app.database import get_db
from app.schemas.auth import LoginRequest

router = APIRouter(prefix="/api/v1/auth", tags=["auth"])
bearer = HTTPBearer(auto_error=False)


def _decode(token: str) -> dict:
    try:
        return jwt.decode(token, settings.jwt_secret, algorithms=["HS256"])
    except JWTError:
        raise HTTPException(401, "Invalid token")


def get_current_user(
    creds: HTTPAuthorizationCredentials = Depends(bearer),
) -> dict:
    """Shared auth dependency: decode jose JWT, 401 on missing/invalid."""
    if creds is None or not creds.credentials:
        raise HTTPException(401, "Not authenticated")
    claims = _decode(creds.credentials)
    return {
        "user_id": claims.get("sub"),
        "business_id": claims.get("bid"),
        "role": claims.get("role"),
    }


@router.post("/login")
def login(body: LoginRequest, db: Session = Depends(get_db)):
    from app.models.user import User
    from app.services.auth_service import create_token, verify_password

    u = db.query(User).filter(User.email == body.email).first()
    if not u or not verify_password(body.password, u.password_hash):
        raise HTTPException(401, "Invalid credentials")
    token = create_token(u.id, u.business_id, u.role)
    return {
        "success": True,
        "data": {"token": token, "user": {"id": u.id, "email": u.email, "role": u.role}},
    }


@router.get("/me")
def me(creds: HTTPAuthorizationCredentials = Depends(bearer), db: Session = Depends(get_db)):
    from app.models.user import User

    if creds is None or not creds.credentials:
        raise HTTPException(401, "Not authenticated")
    claims = _decode(creds.credentials)
    u = db.query(User).filter(User.id == claims.get("sub")).first()
    if not u:
        raise HTTPException(401, "User not found")
    # Never expose password_hash or tokens.
    return {
        "success": True,
        "data": {"id": u.id, "email": u.email, "role": u.role, "business_id": u.business_id},
    }
