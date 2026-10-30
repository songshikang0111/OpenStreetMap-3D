"""Arrange captured evidence without changing the rendered scene."""
import hashlib
import json
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

root = Path(__file__).resolve().parents[1]
out = root / 'docs/evidence-conifers'
keys = ['09-tree-close', '02-grove-color', '05-overview-color']
manifest = []
for key in keys:
    for phase, ext in [('before', 'jpg'), ('after', 'png')]:
        file = out / phase / f'{key}.{ext}'
        assert Image.open(file).size == (1920, 889), file
        manifest.append({'path': file.relative_to(out).as_posix(), 'size': [1920,889], 'sha256': hashlib.sha256(file.read_bytes()).hexdigest()})
(out/'screenshot-manifest.json').write_text(json.dumps(manifest,indent=2),encoding='utf-8')
font=ImageFont.truetype('C:/Windows/Fonts/msyh.ttc',24)
cover=Image.new('RGB',(1648,850),'#f7f5ef');draw=ImageDraw.Draw(cover)
for row,key in enumerate(keys[:2]):
    for col,(phase,ext) in enumerate([('before','jpg'),('after','png')]):
        x,y=col*824,row*425
        label=('优化前 · 全阔叶冠' if col==0 else '优化后 · 针阔混植')+(' / 漫画' if row==0 else ' / 彩色')
        draw.text((x+12,y+10),label,font=font,fill='#28483e')
        shot=Image.open(out/phase/f'{key}.{ext}').crop((320,160,1920,849))
        shot.thumbnail((808,360),Image.Resampling.LANCZOS);cover.paste(shot,(x+8,y+50))
cover.save(out/'comparison.jpg',quality=94)
print('Verified 3 matching views; wrote screenshot manifest and presentation montage.')
