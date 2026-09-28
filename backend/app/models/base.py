import uuid

from sqlalchemy import String
from sqlalchemy.orm import mapped_column

from app.database import Base


def uuidpk():
    return mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
