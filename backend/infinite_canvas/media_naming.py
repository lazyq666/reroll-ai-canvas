"""Canvas-scoped media names, allocated inside the existing commit transaction.

Only media carrying an autoName intent participate. Names without one are user
content. Counters and allocation receipts live in private realtime state, outside
undo; the public name and its provenance travel with the media when moved/copied.
"""
from __future__ import annotations

import copy
import re
from typing import Any

PREFIXES = frozenset({
    't2i', 'i2i', 'outpaint', 'angle', 'repair', 'cutout', 'depth', 'layers',
    'lighting', 'workflow-image', 'workflow-video', 'workflow-audio', 'workflow-text',
    'txt2video', 'img2video', 'frames2video', 'multi2video', 'image', 'video',
    'audio', 'text', 'crop', 'mask', 'paint', 'resize', 'split', 'join',
    'grid-gif', 'video-gif', 'frame-first', 'frame-last', 'frame-current', 'panorama',
})
NAME_RE = re.compile(r'(?:^|-)(%s)-(\d+)(?:-r\d+-c\d+)?(?:\.[a-z0-9]+)?$' % '|'.join(sorted(PREFIXES, key=len, reverse=True)), re.I)


def media_items(value: Any):
    if isinstance(value, list):
        for item in value:
            yield from media_items(item)
    elif isinstance(value, dict):
        if value.get('url') and ('name' in value or 'autoName' in value):
            yield value
        else:
            for item in value.values():
                yield from media_items(item)


def generation_prefix(node: dict, kind: str = 'image') -> str:
    snapshot = node.get('generationInputSnapshot') or {}
    if snapshot.get('namingPrefix') in PREFIXES:
        return snapshot['namingPrefix']
    settings = snapshot.get('settings') or node.get('runSettings') or {}
    refs = snapshot.get('refs') or node.get('runInputRefs') or []
    if kind == 'image':
        if node.get('localRepairRequest'):
            return 'repair'
        special = {'outpaint': 'outpaint', 'angle-control': 'angle'}.get(node.get('aiProcessorKind'))
        if special:
            return special
        if node.get('outputKind') == 'depth-map' or node.get('depthMapSourceNodeId'):
            return 'depth'
        if node.get('mattingJob') or node.get('mattingResult') or node.get('mattingSourceNodeId'):
            return 'cutout'
        if node.get('lightingPrompt') and (node.get('metadata') or {}).get('lightingIntent'):
            return 'lighting'
    if ((settings.get('engine') == 'comfy' and settings.get('comfyMode') == 'custom')
            or (settings.get('engine') == 'runninghub' and not str(settings.get('rhConfigKey') or '').startswith('model:'))):
        return f'workflow-{kind}'
    if kind == 'video' and (snapshot or settings):
        refs = [*refs, *[item for item in settings.get('videoTempShLinks', []) if item.get('manual') and item.get('url')]]
        if not refs:
            return 'txt2video'
        if settings.get('videoUseFrameRoles') or settings.get('videoReferenceMode') == 'first_last_frames':
            return 'frames2video'
        if settings.get('videoReferenceMode') == 'image_to_video' or settings.get('videoMultimodal') is False:
            return 'img2video'
        return 'multi2video'
    if kind == 'image' and (snapshot or settings):
        if settings.get('engine') == 'comfy' and settings.get('comfyMode', 'text') == 'text':
            return 't2i'
        if settings.get('engine') == 'modelscope' and settings.get('msgenModel', 'zimage') == 'zimage':
            return 't2i'
        return 'i2i' if any(ref.get('kind', 'image') == 'image' for ref in refs if isinstance(ref, dict)) else 't2i'
    return kind if kind in PREFIXES else 'image'


class MediaNameAllocator:
    def __init__(self, nodes: list, state: dict):
        self.state = state.setdefault('media_names', {'counters': {}, 'allocations': {}})
        self.counters = self.state.setdefault('counters', {})
        self.allocations = self.state.setdefault('allocations', {})
        for item in media_items(nodes):
            match = NAME_RE.search(str(item.get('name') or ''))
            if match:
                prefix, number = match.group(1).lower(), int(match.group(2))
                self.counters[prefix] = max(self.counters.get(prefix, 0), min(number, 10**12))

    def assign(self, item: dict) -> None:
        request = item.get('autoName')
        if not isinstance(request, dict) or request.get('prefix') not in PREFIXES:
            return
        prefix = request['prefix']
        identity = str(request.get('id') or '')[:4096]
        if not identity:
            return
        # A user rename changes only name, leaving the original assigned name as
        # provenance. Never overwrite it, even after undo or a delayed replay.
        if request.get('name') and item.get('name') != request['name']:
            return
        key = f'{prefix}:{identity}'
        number = self.allocations.get(key)
        if number is None and request.get('pending') is False:
            return  # Copy/import of an already named medium.
        if number is None:
            number = int(self.counters.get(prefix, 0)) + 1
            self.counters[prefix] = number
            self.allocations[key] = number
        source = re.sub(r'[\\/:*?"<>|\x00-\x1f]', '', str(request.get('source') or '')).strip()[:120]
        suffix = str(request.get('suffix') or '')
        if not re.fullmatch(r'(?:-r\d{1,5}-c\d{1,5})?', suffix):
            suffix = ''
        extension = str(request.get('extension') or '')
        if not re.fullmatch(r'\.[a-z0-9]{2,8}', extension):
            extension = '.png'
        name = f'{source + "-" if source else ""}{prefix}-{number:02d}{suffix}{extension}'
        item['name'] = name
        item['autoName'] = {**request, 'name': name, 'pending': False}

    def apply(self, value: Any) -> None:
        for item in media_items(value):
            self.assign(item)


def name_mutation_media(canvas: dict, changes: dict) -> None:
    """Canonicalize new media intents before inverses and public events are built."""
    if not any(item.get('autoName') for item in media_items(changes)):
        return
    allocator = MediaNameAllocator(canvas.get('nodes') or [], canvas.setdefault('_realtime', {}))
    allocator.apply(changes)


def generation_names(values: list, node: dict, peers: list, state: dict, run_id: str) -> list:
    # Imported/legacy names are preserved when the same output arrives again.
    existing = {(item.get('kind', 'image'), item.get('url')): item
                for peer in peers if peer.get('id') == node.get('id') or (
                    node.get('generationOperationId') and peer.get('generationOperationId') == node.get('generationOperationId'))
                for item in peer.get('images', []) if isinstance(item, dict)}
    allocator = MediaNameAllocator(peers, state)
    result = copy.deepcopy(values)
    for index, item in enumerate(result):
        kind = item.get('kind', 'image')
        old = existing.get((kind, item.get('url')))
        if old and old.get('name'):
            item['name'] = old['name']
            if old.get('autoName'):
                item['autoName'] = copy.deepcopy(old['autoName'])
            continue
        prefix = 'repair' if item.get('local_repair') else generation_prefix(node, kind)
        if not prefix:
            continue
        extension = '.' + item['name'].rsplit('.', 1)[-1]
        item['autoName'] = {'id': f"{node.get('generationOperationId') or run_id}:{item.get('url', '')}", 'prefix': prefix, 'extension': extension}
        allocator.assign(item)
    return result
