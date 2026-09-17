from PIL import Image, ImageDraw
import os
import xml.etree.ElementTree as ET

# Base directory
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SOURCE_3D = os.path.join(ROOT, "web/assets/haptix-logo-final.png")
SOURCE_SVG = os.path.join(ROOT, "web/assets/haptix_mark_clean.svg")

# 1. Load source 3D image and crop to bounding box
im_3d = Image.open(SOURCE_3D)
bbox = im_3d.getbbox()
cropped_3d = im_3d.crop(bbox)
c_w, c_h = cropped_3d.size

# Read SVG paths from clean SVG
tree = ET.parse(SOURCE_SVG)
svg_paths = []
for p in tree.getroot().findall("{http://www.w3.org/2000/svg}path"):
    svg_paths.append(p.attrib["d"])

def create_squircle_icon(size):
    """Creates a dark institutional squircle icon with the metallic Haptix emblem."""
    # Render at high resolution then downsample with LANCZOS
    render_size = max(512, size * 4)
    canvas = Image.new("RGBA", (render_size, render_size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(canvas)
    
    # Rounded squircle radius ~22%
    radius = int(render_size * 0.22)
    # Background: Institutional dark obsidian slate (#0D111A)
    draw.rounded_rectangle([0, 0, render_size, render_size], radius=radius, fill=(13, 17, 26, 255))
    
    # Scale emblem to ~64% of inner width
    emblem_w = int(render_size * 0.64)
    emblem_h = int(c_h * (emblem_w / c_w))
    resized_emblem = cropped_3d.resize((emblem_w, emblem_h), Image.Resampling.LANCZOS)
    
    offset_x = (render_size - emblem_w) // 2
    offset_y = (render_size - emblem_h) // 2
    canvas.paste(resized_emblem, (offset_x, offset_y), resized_emblem)
    
    if render_size != size:
        final_img = canvas.resize((size, size), Image.Resampling.LANCZOS)
    else:
        final_img = canvas
    return final_img

# Output destinations
targets = {
    # Chrome Extension (Unpacked)
    "extension/icons/icon16.png": 16,
    "extension/icons/icon48.png": 48,
    "extension/icons/icon128.png": 128,
    "extension/icons/icon512.png": 512,
    
    # Web Extension Mirror
    "web/extension/icons/icon16.png": 16,
    "web/extension/icons/icon48.png": 48,
    "web/extension/icons/icon128.png": 128,
    "web/extension/icons/icon512.png": 512,
    
    # Web Favicons & Assets
    "web/assets/favicon-32.png": 32,
    "web/assets/favicon-256.png": 256,
    "web/assets/apple-touch-icon.png": 180,
    "assets/favicon-16.png": 16,
    "assets/favicon-32.png": 32,
    "assets/favicon-256.png": 256,
}

for rel_path, size in targets.items():
    full_path = os.path.join(ROOT, rel_path)
    os.makedirs(os.path.dirname(full_path), exist_ok=True)
    icon = create_squircle_icon(size)
    icon.save(full_path, "PNG")
    print(f"Generated {rel_path} ({size}x{size})")

# Generate .ico files (multi-size: 16, 32, 48, 64, 128, 256)
ico_sizes = [(16, 16), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)]
ico_icons = [create_squircle_icon(s[0]) for s in ico_sizes]

for ico_rel in ["web/favicon.ico", "assets/favicon.ico"]:
    full_ico = os.path.join(ROOT, ico_rel)
    ico_icons[0].save(full_ico, format="ICO", sizes=ico_sizes, append_images=ico_icons[1:])
    print(f"Generated {ico_rel} (multi-resolution ICO)")

# Generate clean master SVGs
standalone_svg = f"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" fill="none">
  <!-- Official Haptix Brand Mark -->
  <path d="{svg_paths[0]}" fill="currentColor" />
  <path d="{svg_paths[1]}" fill="currentColor" />
</svg>"""

squircle_svg = f"""<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 100 100" fill="none">
  <!-- Official Haptix App Icon -->
  <rect width="100" height="100" rx="22" fill="#0D111A"/>
  <g transform="translate(18, 18) scale(0.64)">
    <path d="{svg_paths[0]}" fill="#FFFFFF" />
    <path d="{svg_paths[1]}" fill="#FFFFFF" />
  </g>
</svg>"""

logo_with_text_svg = f"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 60" fill="none">
  <!-- Official Haptix Logo Lockup -->
  <g transform="translate(4, 4) scale(0.52)">
    <path d="{svg_paths[0]}" fill="currentColor" />
    <path d="{svg_paths[1]}" fill="currentColor" />
  </g>
  <text x="68" y="41" font-family="-apple-system, BlinkMacSystemFont, 'Inter', 'Outfit', sans-serif" font-size="34" font-weight="700" letter-spacing="-0.03em" fill="currentColor">Haptix</text>
</svg>"""

svg_outputs = {
    "extension/icons/icon.svg": squircle_svg,
    "web/extension/icons/icon.svg": squircle_svg,
    "extension/assets/haptix_logo.svg": standalone_svg,
    "web/extension/assets/haptix_logo.svg": standalone_svg,
    "assets/haptix_logo.svg": standalone_svg,
    "web/assets/haptix_logo.svg": standalone_svg,
}

for rel_path, content in svg_outputs.items():
    full_path = os.path.join(ROOT, rel_path)
    os.makedirs(os.path.dirname(full_path), exist_ok=True)
    with open(full_path, "w") as f:
        f.write(content)
    print(f"Generated {rel_path}")

print("All icons and SVGs generated successfully!")
