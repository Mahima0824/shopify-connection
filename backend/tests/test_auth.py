from app.services.auth_service import hash_password, verify_password


def test_hash_verify():
    h = hash_password("StrongPass123!")
    assert verify_password("StrongPass123!", h)
    assert not verify_password("wrong", h)
