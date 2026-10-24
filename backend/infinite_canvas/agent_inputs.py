"""Persisted reference projection for Agent reads (no editor or Provider calls).

Mirrors referenceInstances, smartContainer.orderedEntries/imageRefs and
promptAuthoring's default/mentioned reference ordering. Contract fixtures compare
this projection with the browser's pure functions. Runtime-dependent Loop and
Splitter inputs are reported explicitly instead of guessing an execution context.
"""

from __future__ import annotations

import copy
import hashlib
import json
import re
from collections import Counter
from html.parser import HTMLParser


def fingerprint(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, ensure_ascii=False,
                                     separators=(",", ":")).encode()).hexdigest()


def display_media(media):
    result = copy.deepcopy(media)
    for key in ("originalLocalUrl", "localUrl", "sourceUrl", "local_url", "source_url", "url"):
        url = media.get(key)
        if url and not re.match(r"^https?://", str(url), re.I):
            result["url"] = url
            break
    if not result.get("kind"):
        url = str(result.get("url", "")).lower()
        result["kind"] = next((kind for kind, suffix in (
            ("audio", r"mp3|wav|m4a|aac|ogg|flac"),
            ("video", r"mp4|webm|mov|m4v|avi|mkv"),
            ("text", r"txt|json|csv|srt|vtt|md"))
            if re.search(r"\.(?:" + suffix + r")(?:\?|$)", url)), "image")
    return result


def media_id(ref):
    return ref.get("media_id") or fingerprint(ref.get("url", ""))


def ref_key(ref):
    if not ref.get("url"):
        return ""
    if ref.get("inputInstanceId"):
        return "instance|" + str(ref["inputInstanceId"])
    if ref.get("outputId"):
        return "output|" + str(ref["outputId"])
    if ref.get("nodeId") and ref.get("imageIndex") is not None:
        return f"{ref['nodeId']}|{ref['imageIndex']}"
    return "url|" + str(ref["url"])


def manual_refs(node):
    return [{**display_media(ref), "inputInstanceId": ref.get("inputInstanceId")
             or "legacy-manual:" + fingerprint([node["id"], index, ref])[:24],
             "imageIndex": ref.get("imageIndex", index)}
            for index, ref in enumerate(node.get("manualInputRefs", [])) if ref.get("url") and ref.get("kind") != "text"]


class MentionParser(HTMLParser):
    def __init__(self, markup):
        super().__init__(convert_charrefs=True)
        self.tokens = []
        self.parts = []
        self.mention_depth = 0
        self.feed(markup or "")

    def handle_starttag(self, tag, attrs):
        if self.mention_depth:
            if tag == "span":
                self.mention_depth += 1
            return
        attrs = dict(attrs)
        if tag != "span" or "mention-image-token" not in attrs.get("class", "").split():
            if tag == "br" or tag in ("div", "p", "li") and self.parts:
                self.parts.append("\n")
            return
        fields = {"url": "url", "kind": "kind", "name": "name", "node-id": "nodeId",
                  "output-id": "outputId", "input-instance-id": "inputInstanceId",
                  "reference-mode": "referenceMode"}
        ref = {field: attrs.get("data-" + key, "") for key, field in fields.items()}
        try:
            ref["imageIndex"] = int(attrs.get("data-image-index") or 0)
        except ValueError:
            ref["imageIndex"] = 0
        ref["kind"] = ref["kind"] or "image"
        self.tokens.append(ref)
        self.parts.append("@" + ref["name"])
        self.mention_depth = 1

    def handle_endtag(self, tag):
        if self.mention_depth:
            if tag == "span":
                self.mention_depth -= 1
        elif tag in ("div", "p", "li"):
            self.parts.append("\n")

    def handle_data(self, data):
        if not self.mention_depth:
            self.parts.append(data)


def draft_prompt(node):
    if "promptDraftText" in node:
        return node["promptDraftText"]
    if node.get("promptDraftHtml"):
        return "".join(MentionParser(node["promptDraftHtml"]).parts)
    return node.get("runPrompt", "")


def node_media(node):
    return [{**display_media(item), "nodeId": node["id"], "imageIndex": index,
             "sourceNodeTitle": node.get("title", "")}
            for index, item in enumerate(node.get("images") or [])
            if isinstance(item, dict) and display_media(item).get("url")]


def group_media(group, nodes):
    """The media-first legacy fallback and memberOrder projection from ADR-0010."""
    entries = {}
    fallback = []
    for index, item in enumerate(group.get("images") or []):
        key = ("media", str(item.get("groupMemberId") or f"legacy:{group['id']}:{index}"))
        entries[key] = [{**display_media(item), "nodeId": group["id"], "imageIndex": index}]
        fallback.append(key)
    for member_id in group.get("items") or []:
        member = nodes.get(member_id)
        if not member or member_id == group["id"] or member.get("type") == "smart-frame":
            continue
        key = ("node", member_id)
        # Nested groups are presentation nodes, not recursively flattened media.
        entries[key] = node_media(member) if member.get("type") == "smart-image" else []
        fallback.append(key)
    ordered, seen = [], set()
    for entry in [*(group.get("memberOrder") or []),
                  *({"kind": kind, "id": key} for kind, key in fallback)]:
        key = (entry.get("kind"), entry.get("id"))
        if key in seen or key not in entries:
            continue
        seen.add(key)
        for item in entries[key]:
            if item.get("url"):
                ordered.append({**item, "origin": "group", "source_path": [group["id"], key[1]],
                                "groupNodeId": group["id"], "groupImageIndex": len(ordered)})
    return ordered


def input_connections(canvas, node):
    result, seen = [], set()
    candidates = [*canvas.get("connections", []),
                  *({"from": source, "to": node["id"], "kind": "input"} for source in node.get("inputNodeIds", []))]
    for edge in candidates:
        if edge.get("to") == node["id"] and edge.get("kind", "flow") == "input" and edge.get("from") not in seen:
            seen.add(edge["from"])
            result.append(edge)
    return result


def text_inputs(canvas, node):
    nodes = {n["id"]: n for n in canvas.get("nodes", [])}

    def text_for(source, seen=frozenset()):
        if not source or source["id"] in seen:
            return ""
        if source.get("type") == "smart-prompt":
            return str(source.get("text", "")).strip()
        if source.get("type") == "smart-group":
            return "\n\n".join(filter(None, (text_for(nodes.get(member), seen | {source["id"]})
                                             for member in source.get("items", []))))
        return ""

    result = [{"reference_id": "text|" + edge["from"], "node_id": edge["from"],
               "text": text_for(nodes.get(edge["from"]))}
              for edge in input_connections(canvas, node) if text_for(nodes.get(edge["from"]))]
    result.extend({"reference_id": ref_key(ref), "input_instance_id": ref.get("inputInstanceId"),
                   "text": str(ref.get("textSnapshot", "")), "error": ref.get("textError")}
                  for ref in node.get("localTextRefs", []) if ref.get("url"))
    ranks = {key: index for index, key in enumerate(node.get("inputRefOrder", []))}
    return sorted(result, key=lambda ref: ranks.get(ref["reference_id"], len(ranks)))


def effective_inputs(canvas, node):
    nodes = {n["id"]: n for n in canvas.get("nodes", [])}
    errors, warnings, upstream = [], [], []

    def outputs(source, edge=None):
        if source.get("type") == "smart-group":
            return group_media(source, nodes)
        if source.get("type") in ("smart-loop", "smart-splitter"):
            errors.append({"code": "runtime_input_unsupported", "field": "refs",
                           "node_id": source["id"]})
            return []
        refs = node_media(source)
        pinned = (edge or {}).get("sourceOutputId")
        if pinned and source.get("generationOutputNode"):
            refs = [r for r in refs if r.get("outputId") == pinned]
            if not refs:
                errors.append({"code": "reference_not_found", "field": "refs",
                               "node_id": source["id"], "output_id": pinned})
        elif source.get("generationOutputNode") and len(refs) > 1:
            active = source.get("activeOutputId")
            selected = [r for r in refs if r.get("outputId") == active] if active else []
            refs = selected or refs[:1]
            warnings.append({"code": "active_output_binding", "node_id": source["id"],
                             "output_id": refs[0].get("outputId")})
        return [{**r, "origin": "connection", "referenceMode": "connection",
                 "source_path": [source["id"]]} for r in refs]

    for edge in input_connections(canvas, node):
        source = nodes.get(edge.get("from"))
        if not source:
            errors.append({"code": "reference_not_found", "field": "refs", "node_id": edge.get("from")})
        else:
            upstream.extend(outputs(source, edge))

    own = outputs(node)
    for ref in own:
        ref.update(origin="attached", referenceMode="snapshot")
    stored = []
    for field in ("recipeSourceRefs", "runInputRefs", "runPromptRefs"):
        stored = [{**display_media(r), "origin": "stored", "source_path": [node["id"]]}
                  for r in node.get(field, []) if r.get("url")]
        if stored:
            break
    manual = [{**r, "origin": "manual", "source_path": [node["id"]]} for r in manual_refs(node)]
    blocked = set(node.get("blockedInputRefs") or [])
    connected = [r for r in upstream if ref_key(r) not in blocked]
    defaults = [r for r in [*(connected or stored or own or upstream), *manual] if ref_key(r) not in blocked]
    tokens = MentionParser(node.get("promptDraftHtml", "")).tokens
    mentioned = []
    for token in tokens:
        if token.get("referenceMode") == "connection":
            current = next((r for r in defaults if r.get("nodeId") == token.get("nodeId")
                            and r.get("imageIndex") == token.get("imageIndex")), None)
            if current:
                label = token["name"]
                token.update(current)
                token["name"] = label
            else:
                errors.append({"code": "unresolved_reference", "field": "prompt", "label": token["name"]})
                continue
        if ref_key(token) in blocked:
            errors.append({"code": "unresolved_reference", "field": "prompt", "label": token["name"]})
        elif token.get("url"):
            mentioned.append({**token, "origin": "mention", "source_path": [node["id"]]})

    unique = {}
    for ref in [*defaults, *mentioned]:
        if ref_key(ref):
            unique.setdefault(ref_key(ref), ref)
    ranks = {key: index for index, key in enumerate(node.get("inputRefOrder") or [])}
    refs = sorted(unique.values(), key=lambda r: ranks.get(ref_key(r), len(ranks)))
    counts = Counter()
    aliases = node.get("agentRecipe", {}).get("refs", {})
    bindings, token_bindings = {}, {}
    for token in tokens:
        key = ref_key(token)
        if token.get("name") and key in unique:
            if token["name"] in token_bindings and token_bindings[token["name"]] != key:
                errors.append({"code": "duplicate_reference_label", "field": "prompt", "label": token["name"]})
            token_bindings[token["name"]] = key
    for index, ref in enumerate(refs):
        counts[ref["kind"]] += 1
        key = ref_key(ref)
        label = {"image": "图片", "video": "视频", "audio": "音频"}.get(ref["kind"], "引用") + str(counts[ref["kind"]])
        labels = [name for name, value in token_bindings.items() if value == key]
        for name, source in aliases.items():
            if ((source.get("node") == ref.get("nodeId") and source.get("node")
                 and source.get("index", ref.get("imageIndex")) == ref.get("imageIndex")
                 and source.get("output_id", ref.get("outputId")) == ref.get("outputId"))
                or source.get("media") == media_id(ref)
                or source.get("input") == key) and name not in labels:
                labels.append(name)
        if not labels:
            labels = [label]
        ref.update(reference_id=key, labels=labels, display_number=counts[ref["kind"]],
                   position=index + 1, binding_label=label, media_id=media_id(ref))
        settings = node.get("runSettings", canvas.get("settings", {}))
        ref["role"] = (["first_frame", "last_frame"][index] if index < 2 and settings.get("videoUseFrameRoles")
                       else node.get("videoFrameRoles", {}).get(key, ref.get("role", "")))
        for name in labels:
            if name in bindings and ref_key(bindings[name]) != key:
                errors.append({"code": "duplicate_reference_label", "field": "refs", "label": name})
            else:
                bindings[name] = ref
    return refs, bindings, errors, warnings


def revision(canvas, node):
    refs, _, errors, _ = effective_inputs(canvas, node)
    # Include dependencies affecting this task, not unrelated canvas edits or receipts.
    return fingerprint({"node": {k: v for k, v in node.items() if k not in ("agentSubmission", "agentRecipe")},
                        "inputs": refs, "errors": errors, "text_inputs": text_inputs(canvas, node),
                        "settings": node.get("runSettings", canvas.get("settings", {})),
                        "connections": [e for e in canvas.get("connections", []) if e.get("to") == node["id"]]})


def reference_source(ref):
    if ref.get("inputInstanceId"):
        result = {"input": ref_key(ref)}
    elif ref.get("origin") in ("connection", "group", "attached") and ref.get("nodeId"):
        result = {"node": ref["nodeId"]}
        result.update({"output_id": ref["outputId"]} if ref.get("outputId") else {"index": ref["imageIndex"]})
    else:
        result = {"media": media_id(ref)}
    if ref.get("role") in ("first_frame", "last_frame"):
        result["role"] = ref["role"]
    return result


def unresolved_mentions(prompt, bindings):
    """Only reserved media/numeric forms are references; email and ordinary @ are text."""
    pattern = "|".join(re.escape(k) + (r"(?!\d)" if k[-1:].isdigit() else "")
                       for k in sorted(bindings, key=len, reverse=True))
    remaining = re.sub("@(?:" + pattern + ")", "", prompt) if pattern else prompt
    return [{"code": "unresolved_reference", "field": "prompt", "label": match[1:]}
            for match in re.findall(r"(?<![A-Za-z0-9_@])@(?:图片|图像|图|视频|音频|image\s*|video\s*|audio\s*)?\d+(?!\d)", remaining, re.I)]
