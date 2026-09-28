"""Auth service: password hashing + JWT creation.

Interface (per plan): hash_password(p) -> str, verify_password(p, h) -> bool,
create_token(user_id, business_id, role) -> str.

Note: plan snippet uses passlib CryptContext(bcrypt), but passlib 1.7.4 is
incompatible with installed bcrypt 5.0.0 (missing __about__.__version__ plus
72-byte bug), so hashing is implemented directly on bcrypt with an identical
interface. Revisit if requirements pin bcrypt<4.1.
"""

import bcrypt
from jose import jwt

from app.config import settings


def hash_password(p: str) -> str:
    return bcrypt.hashpw(p.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(p: str, h: str) -> bool:
    try:
        return bcrypt.checkpw(p.encode("utf-8"), h.encode("utf-8"))
    except Exception:
        return False


def create_token(user_id: str, business_id: str, role: str) -> str:
    return jwt.encode(
        {"sub": user_id, "bid": business_id, "role": role},
        settings.jwt_secret,
        algorithm="HS256",
    )
