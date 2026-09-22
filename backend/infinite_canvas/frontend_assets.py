"""HTTP caching for explicitly generated frontend URLs; never rewrites sources."""
import re

from starlette.datastructures import QueryParams
from starlette.staticfiles import StaticFiles


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
