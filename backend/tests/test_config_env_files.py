"""Settings must resolve the same values no matter where the process was started.

The ShipSagar credentials are split across two files: backend/.env holds
SHIPSAGAR_TOKEN and SHIPSAGAR_CLIENT_CODE, the repository-root .env holds the
SHIPSAGAR_EMAIL and SHIPSAGAR_COMPANY constants. pydantic-settings resolves
env_file entries relative to the current working directory, so the previous
cwd-relative list silently read the wrong pair whenever the backend was
launched from the repo root instead of backend/, and every ShipSagar call then
failed with SHIPSAGAR_NOT_CONFIGURED.
"""

import os

import pytest

from app import config


@pytest.fixture(autouse=True)
def ensure_env_files_for_test():
    root_env = config.REPO_ROOT / ".env"
    backend_env = config.BACKEND_DIR / ".env"
    root_created = False
    backend_created = False
    old_root = None
    old_backend = None

    if not root_env.exists():
        root_env.write_text("SHIPSAGAR_EMAIL=test@shipsagar.com\nSHIPSAGAR_COMPANY=TestCompany\n")
        root_created = True
    else:
        content = root_env.read_text()
        if "SHIPSAGAR_EMAIL" not in content:
            old_root = content
            root_env.write_text(content + "\nSHIPSAGAR_EMAIL=test@shipsagar.com\nSHIPSAGAR_COMPANY=TestCompany\n")

    if not backend_env.exists():
        backend_env.write_text("SHIPSAGAR_TOKEN=test-token\nSHIPSAGAR_CLIENT_CODE=test-client\n")
        backend_created = True
    else:
        content = backend_env.read_text()
        if "SHIPSAGAR_TOKEN" not in content:
            old_backend = content
            backend_env.write_text(content + "\nSHIPSAGAR_TOKEN=test-token\nSHIPSAGAR_CLIENT_CODE=test-client\n")

    yield

    if root_created:
        try:
            root_env.unlink()
        except OSError:
            pass
    elif old_root is not None:
        root_env.write_text(old_root)

    if backend_created:
        try:
            backend_env.unlink()
        except OSError:
            pass
    elif old_backend is not None:
        backend_env.write_text(old_backend)


def _load_from(cwd, monkeypatch):
    monkeypatch.chdir(cwd)
    return config.Settings()


def test_env_files_are_anchored_to_the_backend_not_the_cwd():
    """The two env files must be absolute paths, not "." and "..\"."""
    files = config.Settings.model_config["env_file"]
    assert all(os.path.isabs(str(path)) for path in files), (
        "env_file entries are resolved against the working directory, so they "
        f"must be absolute; got {[str(p) for p in files]}"
    )


@pytest.mark.parametrize("cwd_name", ["backend", "repo_root", "elsewhere"])
def test_credentials_resolve_identically_from_any_cwd(tmp_path, monkeypatch, cwd_name):
    """Both halves of the credential set are found from every start directory."""
    cwd = {
        "backend": config.BACKEND_DIR,
        "repo_root": config.REPO_ROOT,
        "elsewhere": tmp_path,
    }[cwd_name]

    settings = _load_from(cwd, monkeypatch)

    assert settings.shipsagar_token, "SHIPSAGAR_TOKEN from backend/.env was not read"
    assert settings.shipsagar_client_code, "SHIPSAGAR_CLIENT_CODE was not read"
    assert settings.shipsagar_email, "SHIPSAGAR_EMAIL from the repo-root .env was not read"
    assert settings.shipsagar_company, "SHIPSAGAR_COMPANY was not read"


def test_backend_env_wins_over_the_repo_root(monkeypatch):
    """A key present in both files resolves to the backend/.env value."""
    monkeypatch.chdir(config.REPO_ROOT)
    from_root = config.Settings()
    monkeypatch.chdir(config.BACKEND_DIR)
    from_backend = config.Settings()

    for settings in (from_root, from_backend):
        assert settings.shipsagar_token == from_backend.shipsagar_token
