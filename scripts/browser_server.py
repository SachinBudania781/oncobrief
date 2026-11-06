"""Disposable server for browser regressions, never pointed at deployed data."""
import os
from pathlib import Path
import sys
import tempfile

root = Path(__file__).resolve().parents[1]
(root / '.test-data').mkdir(exist_ok=True)
os.environ.update(DATA_DIR=tempfile.mkdtemp(prefix='browser-', dir=root / '.test-data'),
                  DEMO_MODE='true', LLM_PROVIDER='none', COOKIE_SECURE='false')
os.environ.pop('DATABASE_URL', None)
sys.path.insert(0, str(root / 'backend'))

if __name__ == '__main__':
    import uvicorn
    uvicorn.run('app.main:app', host='127.0.0.1', port=8000)
