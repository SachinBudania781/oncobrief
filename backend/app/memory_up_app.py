"""Optional entry point: uvicorn app.memory_up_app:app --port 8000.

Compose the independent feature with the existing app without editing its source.
Register before the SPA catch-all; reuse its authentication, middleware and lifespan.
"""
from .main import app
from .memory_up import router

app.router.routes[0:0] = router.routes
