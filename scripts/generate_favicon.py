import math
from PIL import Image, ImageDraw

def create_haptix_icon(size):
    # Create image with RGBA
    img = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    
    # Background rounded squircle
    bg_color = (10, 8, 20, 255) # dark obsidian
    border_color = (255, 255, 255, 40)
    
    # Radius
    r = int(size * 0.22)
    # Draw background squircle
    draw.rounded_rectangle([0, 0, size - 1, size - 1], radius=r, fill=bg_color, outline=border_color, width=max(1, int(size * 0.03)))
    
    # Now draw the stylized H monogram with gradient
    # We will interpolate colors from top-left (Pink/Magenta: 236, 72, 153) to (Purple: 168, 85, 247) to (Cyan/Blue: 0, 130, 255)
    
    # Create a separate layer for H
    h_layer = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    h_draw = ImageDraw.Draw(h_layer)
    
    scale = size / 32.0
    
    # Left pillar path coordinates
    # M4 8 C4 5.2 6.2 3 9 3 H10 C11.1 3 12 3.9 12 5 V12.2 L16.2 14.6 L12 16.8 V27 C12 28.1 11.1 29 10 29 H9 C6.2 29 4 26.8 4 24 V8 Z
    left_poly = [
        (4 * scale, 8 * scale),
        (6.5 * scale, 3 * scale),
        (10 * scale, 3 * scale),
        (12 * scale, 4.5 * scale),
        (12 * scale, 12.2 * scale),
        (16.2 * scale, 14.6 * scale),
        (12 * scale, 17.0 * scale),
        (12 * scale, 27.5 * scale),
        (10 * scale, 29 * scale),
        (6.5 * scale, 29 * scale),
        (4 * scale, 24 * scale)
    ]
    
    # Right pillar path coordinates
    right_poly = [
        (28 * scale, 24 * scale),
        (25.5 * scale, 29 * scale),
        (22 * scale, 29 * scale),
        (20 * scale, 27.5 * scale),
        (20 * scale, 19.8 * scale),
        (15.8 * scale, 17.4 * scale),
        (20 * scale, 15.0 * scale),
        (20 * scale, 4.5 * scale),
        (22 * scale, 3 * scale),
        (25.5 * scale, 3 * scale),
        (28 * scale, 8 * scale)
    ]
    
    # Draw polygons in white mask
    mask = Image.new('L', (size, size), 0)
    mask_draw = ImageDraw.Draw(mask)
    mask_draw.polygon(left_poly, fill=255)
    mask_draw.polygon(right_poly, fill=255)
    
    # Create gradient image
    gradient = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    for y in range(size):
        for x in range(size):
            t = (x + y) / (2.0 * size) # 0.0 to 1.0
            if t < 0.4:
                # Magenta to Purple
                f = t / 0.4
                r_c = int(236 * (1 - f) + 168 * f)
                g_c = int(72 * (1 - f) + 85 * f)
                b_c = int(240 * (1 - f) + 247 * f)
            else:
                # Purple to Cyan/Base Blue
                f = (t - 0.4) / 0.6
                r_c = int(168 * (1 - f) + 0 * f)
                g_c = int(85 * (1 - f) + 130 * f)
                b_c = int(247 * (1 - f) + 255 * f)
            gradient.putpixel((x, y), (r_c, g_c, b_c, 255))
            
    # Composite gradient onto background using mask
    img.paste(gradient, (0, 0), mask)
    return img

# Generate multi-size ICO
sizes = [16, 32, 48, 64, 128, 256]
images = [create_haptix_icon(s) for s in sizes]

# Save favicon.ico (containing 16, 32, 48, 64, 128, 256)
images[0].save('favicon.ico', format='ICO', sizes=[(s, s) for s in sizes], append_images=images[1:])
images[-1].save('assets/favicon-256.png', format='PNG')
images[1].save('assets/favicon-32.png', format='PNG')
images[0].save('assets/favicon-16.png', format='PNG')

# Copy to web/ and root
import shutil
shutil.copy('favicon.ico', 'web/favicon.ico')
shutil.copy('assets/favicon-32.png', 'web/favicon.png')
shutil.copy('favicon.ico', 'assets/favicon.ico')
print("Favicons generated successfully!")
