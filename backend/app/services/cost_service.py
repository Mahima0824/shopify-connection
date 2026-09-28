KEYS = ("COGS_DEFAULT", "SHIPPING", "GATEWAY_FEE", "PACKAGING", "RETURN_COST", "RTO_COST", "OTHER")


from datetime import timezone


def _norm(dt):
    if dt is None:
        return None
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def _pick(rows, at):
    best = None
    for r in rows:
        ef = _norm(r.effective_from)
        et = _norm(r.effective_to)
        if ef and ef <= at and (et is None or at < et):
            if best is None or _norm(r.effective_from) > _norm(best.effective_from):
                best = r
    return best


def get_cost(db, business_id: str, key: str, at, product_id: str | None = None) -> tuple[float, str]:
    """Cost as-of a moment: product-specific, else global default, else 0. Returns (amount, source)."""
    from app.models.cost import ProductCostHistory, CostRule
    if product_id:
        best = _pick(db.query(ProductCostHistory).filter_by(
            business_id=business_id, product_id=product_id).all(), at)
        if best is not None:
            return float(best.cost_price or 0), best.source
    best = _pick(db.query(CostRule).filter_by(business_id=business_id, key=key).all(), at)
    if best is not None:
        return float(best.amount or 0), best.source
    return 0.0, "DEFAULT"


def set_cost(db, business_id: str, key: str, amount: float, source: str,
             effective_from, note: str | None = None):
    """Versioned write: closes the open rule, opens a new one. Returns the new rule."""
    from app.models.cost import CostRule
    if key not in KEYS:
        raise ValueError(f"Unknown cost key '{key}'.")
    for r in db.query(CostRule).filter_by(business_id=business_id, key=key).filter(
            CostRule.effective_to.is_(None)).all():
        r.effective_to = effective_from
    r = CostRule(business_id=business_id, key=key, amount=amount, source=source or "MANUAL",
                 effective_from=effective_from, note=note)
    db.add(r)
    db.flush()
    return r
