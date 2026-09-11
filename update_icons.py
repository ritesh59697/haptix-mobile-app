from PIL import Image
import os

source_img = "web/assets/haptix-logo-final.png"
img = Image.open(source_img)

sizes = {
    "web/extension/icons/icon16.png": 16,
    "web/extension/icons/icon48.png": 48,
    "web/extension/icons/icon128.png": 128,
    "web/assets/favicon-32.png": 32,
    "web/assets/favicon-256.png": 256,
    "web/assets/apple-touch-icon.png": 180
}

for path, size in sizes.items():
    if not os.path.exists(os.path.dirname(path)):
        os.makedirs(os.path.dirname(path))
    resized = img.resize((size, size), Image.Resampling.LANCZOS)
    resized.save(path)
    print(f"Saved {path}")

print("Done")
