"""Generate a Render frontend Blueprint using the API's verified public URL."""
import argparse
import json
from pathlib import Path
from urllib.parse import urlsplit


def https_origin(value):
    parsed = urlsplit(value)
    if (parsed.scheme != "https" or not parsed.hostname or parsed.username or
            parsed.password or parsed.path not in {"", "/"} or parsed.query or
            parsed.fragment or parsed.hostname.endswith(".invalid")):
        raise argparse.ArgumentTypeError("Use the actual HTTPS service origin, with no path, credentials, query, or fragment")
    return f"https://{parsed.netloc}"


def blueprint(api_origin):
    services = []
    for target in ("patient", "doctor", "staff"):
        services.append({
            "type": "web", "name": f"oncobrief-round2-{target}", "runtime": "static",
            "buildCommand": f"cd frontend && npm ci --no-audit --no-fund && npm run build:{target}",
            "staticPublishPath": f"./frontend/dist/{target}",
            "autoDeployTrigger": "checksPass",
            "envVars": [{"key": "NODE_VERSION", "value": "24"}, {"key": "SCARF_ANALYTICS", "value": "false"}],
            "routes": [
                {"type": "rewrite", "source": "/api/*", "destination": f"{api_origin}/api/*"},
                {"type": "rewrite", "source": "/docs", "destination": f"{api_origin}/docs"},
                {"type": "rewrite", "source": "/openapi.json", "destination": f"{api_origin}/openapi.json"},
                {"type": "rewrite", "source": "/*", "destination": "/index.html"},
            ],
            "headers": [
                {"path": "/*", "name": "X-Content-Type-Options", "value": "nosniff"},
                {"path": "/*", "name": "X-Frame-Options", "value": "SAMEORIGIN"},
                {"path": "/*", "name": "Referrer-Policy", "value": "no-referrer"},
                {"path": "/*", "name": "Permissions-Policy", "value": "camera=(self), microphone=(self), geolocation=(self)"},
                {"path": "/api/*", "name": "Cache-Control", "value": "no-store"},
                {"path": "/sw.js", "name": "Cache-Control", "value": "no-cache"},
                {"path": "/manifest.webmanifest", "name": "Cache-Control", "value": "no-cache"},
                {"path": "/manifest.webmanifest", "name": "Content-Type", "value": "application/manifest+json"},
                {"path": "/index.html", "name": "Cache-Control", "value": "no-cache"},
                {"path": "/", "name": "Cache-Control", "value": "no-store"},
            ],
        })
    return {"services": services}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--api-url", required=True, type=https_origin)
    parser.add_argument("--output", type=Path, default=Path(__file__).resolve().parents[1] / "deploy" / "render.frontends-free.yaml")
    args = parser.parse_args()
    # JSON is valid YAML; keep this helper dependency-free.
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(blueprint(args.api_url), indent=2) + "\n", encoding="utf-8")
    print(f"Wrote {args.output}")
    print("After frontend creation, set API ALLOWED_ORIGINS to their three actual HTTPS origins.")
    print("Set API PUBLIC_BASE_URL to the patient frontend origin, then redeploy the API.")
