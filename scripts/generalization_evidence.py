"""Validate and assemble saved, unmodified browser captures for the region audit."""
import hashlib
import json
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

root = Path(__file__).resolve().parents[1] / 'docs/evidence-generalization'
sites = [('shanghai', '上海 · 陆家嘴'), ('kyoto', '京都 · 祇园'), ('amsterdam', '阿姆斯特丹 · 运河街区')]
checks = {c['name']: c for c in json.loads((root / 'camera-checks.json').read_text(encoding='utf-8-sig'))}
manifest = []
font = ImageFont.truetype('C:/Windows/Fonts/msyh.ttc', 24)
for view in ['overview', 'roof']:
    montage = Image.new('RGB', (1920, 506 * 3), '#f8f7f2')
    draw = ImageDraw.Draw(montage)
    for row, (site, title) in enumerate(sites):
        for col, mode in enumerate(['ink', 'color']):
            name = f'{site}-{view}-{mode}'
            path = root / 'screenshots' / (name + '.png')
            with Image.open(path) as source:
                assert source.size == (1920, 889), (name, source.size)
                scene = source.crop((320, 82, 1920, 850)).resize((960, 461), Image.Resampling.LANCZOS)
                montage.paste(scene, (col * 960, row * 506 + 45))
            check = checks[name]
            assert check['site'] == site and check['sun'] == '135' and check['seed'] == '种子 1'
            assert check['mode'] == ('0' if mode == 'ink' else '2')
            draw.text((col * 960 + 15, row * 506 + 8), title + (' · 漫画' if mode == 'ink' else ' · 彩色'), fill='#34463f', font=font)
            manifest.append({'file': str(path.relative_to(root)).replace('\\', '/'), 'size': [1920, 889], 'sha256': hashlib.sha256(path.read_bytes()).hexdigest()})
    montage.save(root / (view + '-comparison.jpg'), quality=94)
(root / 'screenshot-manifest.json').write_text(json.dumps(manifest, indent=2), encoding='utf-8')
print(f'Checked {len(manifest)} captures and wrote two comparison sheets.')
