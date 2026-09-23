"""HTTP caching for explicitly generated frontend URLs; never rewrites sources."""
import re
import hashlib
from functools import lru_cache
from pathlib import Path

from starlette.datastructures import QueryParams
from starlette.staticfiles import StaticFiles


@lru_cache(maxsize=4)
def _manifest_revision(path: str, modified: int, size: int) -> str:
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def frontend_revision(manifest: Path) -> str:
    """Read the generated inventory, using file metadata only to invalidate cache."""
    try:
        stat = manifest.stat()
        return _manifest_revision(str(manifest), stat.st_mtime_ns, stat.st_size)
    except OSError:
        return ""


class FrontendStaticFiles(StaticFiles):
    async def get_response(self, path, scope):
        response = await super().get_response(path, scope)
        version = QueryParams(scope.get('query_string', b'').decode()).get('v', '')
        if path.endswith('.html'):
            response.headers['Cache-Control'] = 'no-cache'
        elif re.fullmatch(r'asset-[0-9a-f]{12}', version) and response.status_code in (200, 304):
            response.headers['Cache-Control'] = 'public, max-age=31536000, immutable'
        else:
            response.headers['Cache-Control'] = 'no-cache'
        return response
