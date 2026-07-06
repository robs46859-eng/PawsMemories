import os
import re
import glob

# The targeted design system based on UI_MAP.md
NEW_TAILWIND_CONFIG = """<script id="tailwind-config">
        tailwind.config = {
            darkMode: "class",
            theme: {
                extend: {
                    colors: {
                        primary: "#4a6545",
                        "primary-container": "#a8c69f",
                        secondary: "#964826",
                        "secondary-container": "#fd9a71",
                        surface: "#fff8f3",
                        "surface-container-low": "#faf9f5",
                        "on-surface": "#1a1c1a",
                        "on-surface-variant": "#504441",
                        "outline-variant": "#d4c3be",
                        error: "#ba1a1a"
                    },
                    fontFamily: {
                        sans: ['"Plus Jakarta Sans"', 'sans-serif'],
                        mono: ['"JetBrains Mono"', 'monospace'],
                        "headline-xl": ['"Plus Jakarta Sans"', 'sans-serif'],
                        "headline-lg": ['"Plus Jakarta Sans"', 'sans-serif'],
                        "label-caps": ['"Plus Jakarta Sans"', 'sans-serif'],
                        "body-md": ['"Plus Jakarta Sans"', 'sans-serif'],
                        "body-sm": ['"Plus Jakarta Sans"', 'sans-serif']
                    }
                }
            }
        }
    </script>"""

NEW_FONTS_LINK = """<link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet"/>"""

NEW_CSS = """
        .soft-glow-shadow { box-shadow: 0 10px 25px -5px rgba(74, 101, 69, 0.2); }
        .glowing-shadow-sage { box-shadow: 0 0 30px rgba(168, 198, 159, 0.5); }
        .shimmer-button { position: relative; overflow: hidden; }
        .shimmer-button::after {
            content: '';
            position: absolute;
            top: 0; left: -100%;
            width: 50%; height: 100%;
            background: linear-gradient(to right, rgba(255,255,255,0) 0%, rgba(255,255,255,0.2) 50%, rgba(255,255,255,0) 100%);
            animation: shimmer 2.5s infinite;
        }
        @keyframes shimmer { 100% { left: 200%; } }
        .soft-float { animation: softFloat 6s ease-in-out infinite; }
        @keyframes softFloat {
            0%, 100% { transform: translateY(0px); }
            50% { transform: translateY(-10px); }
        }
"""

def update_file(filepath):
    with open(filepath, 'r', encoding='utf-8') as f:
        content = f.read()

    # 1. Replace Tailwind config
    content = re.sub(
        r'<script id="tailwind-config">.*?</script>',
        NEW_TAILWIND_CONFIG,
        content,
        flags=re.DOTALL
    )

    # 2. Replace fonts
    content = re.sub(
        r'<link href="https://fonts.googleapis.com/css2[^>]+rel="stylesheet"[^>]*>',
        NEW_FONTS_LINK,
        content,
        count=1 # replace the first font link
    )

    # 3. Add custom CSS (just inside <style>)
    if NEW_CSS.strip() not in content and '<style>' in content:
        content = content.replace('<style>', '<style>\n' + NEW_CSS, 1)

    with open(filepath, 'w', encoding='utf-8') as f:
        f.write(content)
    print(f"Updated {filepath}")

def main():
    base_dir = '/Users/robert/Desktop/claude7126/PawsMemories/stitch_pawsome3d'
    # Find all code.html files recursively
    search_pattern = os.path.join(base_dir, '**', 'code.html')
    files = glob.glob(search_pattern, recursive=True)
    
    if not files:
        print("No files found!")
        return

    for f in files:
        update_file(f)

if __name__ == "__main__":
    main()
