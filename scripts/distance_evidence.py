"""Assemble saved browser screenshots; does not drive or render the browser."""
import hashlib
import json
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

root = Path(__file__).resolve().parents[1] / 'docs/evidence-distance-v07'
views = json.loads((root / 'views.json').read_text(encoding='utf-8-sig'))
checks = json.loads((root / 'camera-checks.json').read_text(encoding='utf-8-sig'))
# Retain the last validated screenshot for each view (a recapture replaces it).
checks = {(item['phase'], item['id']): item for item in checks}
manifest = []
for phase in ['before', 'after']:
    for name, view in views.items():
        path = root / phase / (name + '.png')
        with Image.open(path) as image:
            assert image.size == (1920, 889), (path, image.size)
        check = checks[phase, name]
        expected = '机位 ' + ', '.join(f'{n:.1f}' for n in view['position']) + f" m · FOV {view['parameters']['lens']:.1f}°"
        assert check['camera'] == expected, (phase, name, check)
        assert check['mode'] == str(view['mode'])
        assert check['sun'] == str(view['parameters']['sun-angle'])
        manifest.append({'file': str(path.relative_to(root)).replace('\\', '/'),
                         'size': [1920, 889], 'sha256': hashlib.sha256(path.read_bytes()).hexdigest()})
(root / 'screenshot-manifest.json').write_text(json.dumps(manifest, indent=2), encoding='utf-8')
(root / 'camera-checks.json').write_text(json.dumps(list(checks.values()), ensure_ascii=False, indent=2), encoding='utf-8')

font = ImageFont.truetype('C:/Windows/Fonts/msyh.ttc', 25)
def montage(rows, filename):
    width, height, top = 960, 461, 45
    canvas = Image.new('RGB', (width * 2, (height + top) * len(rows)), '#f8f7f2')
    draw = ImageDraw.Draw(canvas)
    for row, pair in enumerate(rows):
        for col, (path, label) in enumerate(pair):
            x, y = col * width, row * (height + top)
            draw.text((x + 16, y + 7), label, fill='#34463f', font=font)
            with Image.open(root / path) as source:
                # Exact same scene crop for both versions; full UI remains in PNGs.
                scene = source.crop((320, 82, 1920, 850)).resize((width, height), Image.Resampling.LANCZOS)
                canvas.paste(scene, (x, y + top))
    canvas.save(root / filename, quality=94)

montage([
    [('before/district-ink.png', 'v0.6.1 · 漫画远景'), ('after/district-ink.png', 'v0.7.0 · 灰阶块面与细线')],
    [('before/district-color.png', 'v0.6.1 · 彩色远景'), ('after/district-color.png', 'v0.7.0 · 玻璃明暗与方向性反光')]
], 'comparison.jpg')
montage([[('after/city-color.png', 'v0.7.0 · 太阳方位 135°'), ('after/city-sun-270.png', 'v0.7.0 · 太阳方位 270°')]], 'sun.jpg')
montage([
    [('before/near-ink.png', 'v0.6.1 · 漫画近景'), ('after/near-ink.png', 'v0.7.0 · 漫画近景')],
    [('before/near-color.png', 'v0.6.1 · 彩色近景'), ('after/near-color.png', 'v0.7.0 · 彩色近景')]
], 'near.jpg')
print(f'Validated {len(manifest)} screenshots; wrote three comparisons.')
