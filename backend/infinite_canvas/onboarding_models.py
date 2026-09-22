"""Conservative first-run defaults over a provider's discovered model IDs."""
import re

FIELDS = ('image_models', 'video_models', 'chat_models')


def _version(name, family):
    match = re.search(r'(?:^|[/_-])' + family + r'[-_]?(\d{1,2})(?:[.-](\d{1,2})(?!\d))?(?!\d)', name)
    return (int(match[1]), int(match[2] or 0)) if match else None


def recommended_models(discovered, *, service=""):
    models = {field: list(dict.fromkeys(m.strip() for m in discovered.get(field, [])
              if isinstance(m, str) and m.strip())) for field in FIELDS}
    selected = {field: [] for field in FIELDS}
    for model in models['image_models']:
        name = model.lower().replace('_', '-')
        if (re.search(r'(?:^|[/ -])gpt-image(?:[-/.]|$)', name)
                or re.search(r'(?:^|[/ -])nano-?banana(?:[-/.]|$)', name)
                or re.search(r'(?:^|/)gemini-(?:2\.5-flash|3-pro|3\.1-flash)-image(?:-|$)', name)):
            selected['image_models'].append(model)
    for model in models['video_models']:
        version = _version(model.lower(), 'seedance')
        if version and version >= (2, 0):
            selected['video_models'].append(model)
    gemini = {}
    for model in models['chat_models']:
        name = model.lower().replace('_', '-')
        if re.search(r'image|audio|tts|embedding|robotics|vision', name):
            continue
        version = _version(name, 'gpt')
        if version and version >= (5, 5):
            selected['chat_models'].append(model)
        match = re.search(r'(?:^|/)gemini-(\d{1,2})(?:\.(\d{1,2}))?-(pro|flash-lite|flash)(?:-|$)', name)
        if match:
            version = (int(match[1]), int(match[2] or 0))
            tier = match[3]
            # Prefer the undated stable ID over preview/snapshot aliases of one model.
            preference = ('preview' not in name and 'exp' not in name, not bool(re.search(r'\d{4}', name)), name)
            key = (version, tier)
            if key not in gemini or preference > gemini[key][0]:
                gemini[key] = (preference, model)
    newest = sorted(gemini, key=lambda key: (key[0], {'pro': 2, 'flash': 1, 'flash-lite': 0}[key[1]]), reverse=True)[:2]
    selected['chat_models'].extend(gemini[key][1] for key in newest)
    # Antigravity delegates image/text model choice to its authenticated local CLI.
    # Use the trusted service identity, never a protocol claimed by the catalog.
    if service == 'gemini-cli':
        for field in ('image_models', 'chat_models'):
            if 'auto' in models[field]:
                selected[field].append('auto')
    enabled = {model for field in FIELDS for model in selected[field]}
    selected['model_protocols'] = {model: protocol for model, protocol in discovered.get('model_protocols', {}).items() if model in enabled}
    return selected
