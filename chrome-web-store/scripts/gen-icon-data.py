import base64
from pathlib import Path

icon = Path(__file__).resolve().parents[1] / "icons" / "icon128.png"
data = base64.b64encode(icon.read_bytes()).decode()
out = Path(__file__).resolve().parents[1] / "assets" / "icon-data.js"
out.write_text(
    f'window.ICON_DATA_URL = "data:image/png;base64,{data}";\n'
    "(function () {\n"
    "  function apply() {\n"
    "    if (!window.ICON_DATA_URL) return;\n"
    '    document.querySelectorAll("img[data-store-icon]").forEach(function (img) {\n'
    '      img.crossOrigin = "anonymous";\n'
    "      img.src = window.ICON_DATA_URL;\n"
    "    });\n"
    "  }\n"
    '  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", apply);\n'
    "  else apply();\n"
    "})();\n",
    encoding="utf-8",
)
print(f"Wrote {out} ({len(data)} base64 chars)")
