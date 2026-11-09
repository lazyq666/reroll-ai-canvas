"""Inspect bounded image originals without rasterizing animation or vectors."""

from io import BytesIO
import math
import re
import xml.etree.ElementTree as ET

from PIL import Image


SVG_HEADERS = {
    "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
    "X-Content-Type-Options": "nosniff",
}
SVG_ELEMENTS = frozenset({
    "svg", "g", "defs", "path", "rect", "circle", "ellipse", "line", "polyline",
    "polygon", "text", "tspan", "textPath", "clipPath", "mask", "linearGradient",
    "radialGradient", "stop", "pattern", "symbol", "title", "desc",
})


def inspect_svg(content):
    if len(content) > 8 * 1024 * 1024:
        raise ValueError("invalid_svg")
    try:
        text = content.decode("utf-8-sig")
        if re.search(r"<!\s*(?:DOCTYPE|ENTITY)|<\?(?!xml\s)", text, re.I):
            raise ValueError("invalid_svg")
        root = ET.fromstring(text)
    except (UnicodeError, ET.ParseError) as exc:
        raise ValueError("invalid_svg") from exc
    if root.tag not in {"svg", "{http://www.w3.org/2000/svg}svg"}:
        raise ValueError("invalid_svg")
    stack = [(root, 0)]
    total = 0
    while stack:
        element, depth = stack.pop()
        total += 1
        tag = element.tag.removeprefix("{http://www.w3.org/2000/svg}")
        if tag not in SVG_ELEMENTS or depth > 64 or total > 50000 or len(element.attrib) > 100:
            raise ValueError("unsafe_svg")
        for key, value in element.attrib.items():
            name = key.rsplit("}", 1)[-1].lower()
            if (name.startswith("on") or name in {"base", "src"}
                    or key.startswith("{") and not key.startswith(("{http://www.w3.org/1999/xlink}", "{http://www.w3.org/XML/1998/namespace}"))
                    or re.search(r"javascript:|data:|https?:|@|\\|expression\s*\(|-moz-binding|behavior\s*:", value, re.I)):
                raise ValueError("unsafe_svg")
            if name == "href" and not re.fullmatch(r"#[A-Za-z_][\w.-]*", value):
                raise ValueError("unsafe_svg")
            references = re.findall(r"url\s*\((.*?)\)", value, re.I | re.S)
            if len(references) != len(re.findall(r"url\s*\(", value, re.I)):
                raise ValueError("unsafe_svg")
            for reference in references:
                if not re.fullmatch(r"""['"]?#[A-Za-z_][\w.-]*['"]?""", reference.strip()):
                    raise ValueError("unsafe_svg")
        stack.extend((child, depth + 1) for child in element)
    view_box = root.get("viewBox", "").replace(",", " ").split()
    try:
        viewport = [float(value) for value in view_box] if view_box else None
        if viewport and (len(viewport) != 4 or not all(math.isfinite(value) for value in viewport)
                         or min(viewport[2:]) <= 0):
            raise ValueError("invalid_svg")
        dimensions = []
        for index, field in enumerate(("width", "height")):
            value = root.get(field, "")
            match = re.fullmatch(r"([0-9]+(?:\.[0-9]+)?)(?:px)?", value)
            dimensions.append(float(match[1]) if match else viewport[index + 2] if viewport else 0)
        if not all(math.isfinite(value) and 0 < value <= 32768 for value in dimensions):
            raise ValueError("invalid_svg")
    except (TypeError, IndexError, ValueError) as exc:
        raise ValueError("invalid_svg") from exc
    return {"format": "svg", "mime": "image/svg+xml", "extension": ".svg",
            "width": dimensions[0], "height": dimensions[1], "view_box": viewport}


def inspect_image(content):
    if not content or len(content) > 128 * 1024 * 1024:
        raise ValueError("invalid_image")
    if content.lstrip(b"\xef\xbb\xbf \t\r\n").startswith(b"<"):
        return inspect_svg(content)
    try:
        with Image.open(BytesIO(content)) as image:
            image_format = str(image.format or "").lower()
            width, height = image.size
            if width * height > 100_000_000:
                raise ValueError("invalid_image")
            frames = getattr(image, "n_frames", 1)
            if frames > 512 or width * height * frames > 256_000_000:
                raise ValueError("invalid_image")
            loop = image.info.get("loop")
            durations = []
            for index in range(frames):
                image.seek(index)
                image.load()
                durations.append(int(image.info.get("duration", 0)))
            result = {"format": image_format, "mime": Image.MIME.get(image.format, "image/" + image_format),
                      "extension": ".jpg" if image_format == "jpeg" else "." + image_format,
                      "width": width, "height": height, "frame_count": frames}
            if image_format == "gif":
                result.update(frame_count=frames, frame_durations_ms=durations, loop=loop)
            return result
    except Exception as exc:
        raise ValueError("invalid_image") from exc
