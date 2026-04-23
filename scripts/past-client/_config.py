"""
Shared config loader for past-client scripts.

Resolution order for secrets and settings:
    1. CLI flag (e.g. --token XXX)                    — highest priority
    2. Environment variable (TICKET_AGENT_TOKEN, ...)
    3. Config file at ~/.bkb-pco.env (KEY=VALUE lines) — lowest priority

This lets Nathan drop a single file into his home directory instead of
editing his shell profile, and still lets ad-hoc CLI overrides work.

Config file format (one per line):
    TICKET_AGENT_TOKEN=abcdef123...
    PCO_API_BASE=https://bkb-client-intel.vercel.app
    PCO_XLSX_PATH=/Users/nathan/…/BKB-Send-Queue-Review.xlsx

Lines starting with # are comments. Values may be quoted.
"""
import os
from pathlib import Path

CONFIG_FILE = Path.home() / ".bkb-pco.env"
DEFAULT_API = "https://bkb-client-intel.vercel.app"


def _parse_config_file(path):
    """Parse a simple KEY=VALUE env-style file. Returns dict."""
    values = {}
    if not path.exists():
        return values
    try:
        with path.open("r") as f:
            for line_num, line in enumerate(f, 1):
                line = line.strip()
                if not line or line.startswith("#"):
                    continue
                if "=" not in line:
                    continue
                key, _, val = line.partition("=")
                key = key.strip()
                val = val.strip()
                # Strip matching surrounding quotes
                if len(val) >= 2 and val[0] == val[-1] and val[0] in ("'", '"'):
                    val = val[1:-1]
                values[key] = val
    except OSError:
        pass
    return values


_FILE_CACHE = None


def _from_file(key):
    global _FILE_CACHE
    if _FILE_CACHE is None:
        _FILE_CACHE = _parse_config_file(CONFIG_FILE)
    return _FILE_CACHE.get(key)


def get(key, cli_value=None, default=None):
    """
    Resolve a config value using CLI → env → file → default.
    """
    if cli_value:
        return cli_value
    env_val = os.environ.get(key)
    if env_val:
        return env_val
    file_val = _from_file(key)
    if file_val:
        return file_val
    return default


def require(key, cli_value=None, hint=None):
    """Like get(), but raise if not found anywhere."""
    val = get(key, cli_value=cli_value)
    if not val:
        msg = f"Missing required config: {key}"
        if hint:
            msg += f"\n\n{hint}"
        msg += (
            f"\n\nQuickest fix — create {CONFIG_FILE}:\n"
            f'  echo "{key}=YOUR_VALUE" >> {CONFIG_FILE}\n'
            f"  chmod 600 {CONFIG_FILE}\n"
            "\nOr pass via env: "
            f"export {key}=YOUR_VALUE\n"
            f"Or pass via CLI flag if the script supports it."
        )
        raise RuntimeError(msg)
    return val


def config_source(key):
    """Return a human-readable label for where a key resolved from."""
    if os.environ.get(key):
        return "env"
    if _from_file(key):
        return f"{CONFIG_FILE}"
    return "not set"


def get_token(cli_value=None):
    """Shorthand for the TICKET_AGENT_TOKEN value."""
    return require(
        "TICKET_AGENT_TOKEN",
        cli_value=cli_value,
        hint="TICKET_AGENT_TOKEN is the agent-auth header for the Client Hub API. "
             "Same token used by the tickets pipeline.",
    )


def get_api_base(cli_value=None):
    """Shorthand for the PCO_API_BASE value (defaults to production)."""
    return get("PCO_API_BASE", cli_value=cli_value, default=DEFAULT_API)


def get_xlsx_path(cli_value=None, default=None):
    """Shorthand for PCO_XLSX_PATH."""
    return get("PCO_XLSX_PATH", cli_value=cli_value, default=default)
