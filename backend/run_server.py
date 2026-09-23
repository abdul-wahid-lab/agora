"""
PyInstaller entry point - not used in normal dev workflow (that runs
`python -m uvicorn app.api:app` directly, see BUILD_LOG). This exists
because a frozen executable needs a plain script to launch, not a `-m`
module invocation, and because importing app.api directly (rather than
letting uvicorn resolve the "app.api:app" string via importlib at
startup) guarantees PyInstaller's static analysis actually sees the
import and bundles it - a string reference alone can be missed.
"""

import os

import uvicorn

from app.api import app

if __name__ == "__main__":
    port = int(os.environ.get("AGORA_API_PORT", "5001"))
    uvicorn.run(app, host="127.0.0.1", port=port)
