"""Build an offline, fixed-camera visual acceptance report from saved screenshots."""
import json
import hashlib
from pathlib import Path
from urllib.parse import quote
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'docs/evidence-trees'
read = lambda name: json.loads((OUT / name).read_text(encoding='utf-8-sig'))
views, before, after, materials = [read(n) for n in ['views.json', 'metrics-before.json', 'metrics-after.json', 'materials.json']]
scores = read('scores.json') if (OUT/'scores.json').exists() else []
assert len(scores) == 6, 'Final independent review must contain six scored dimensions'
names = {
    '01-grove-ink': '绿地与树带 · 漫画中景', '02-grove-color': '绿地与树带 · 彩色中景',
    '03-street-ink': '树荫下的街道 · 漫画', '04-street-color': '树荫下的街道 · 彩色',
    '05-overview-color': '全街区 · 远景', '06-facade-ink': '玻璃幕墙 · 漫画近景',
    '07-facade-color': '玻璃幕墙 · 彩色近景', '08-facade-side': '同一幕墙 · 另一视角',
    '09-tree-close': '树冠 · 斜俯近景',
    'material-warm-brick': '普通饰面 · 暖色砌砖', 'material-cut-stone': '普通饰面 · 石材分缝',
    'material-precast-panels': '普通饰面 · 预制板', 'material-smooth-render': '普通饰面 · 浅色抹灰',
    'material-vertical-piers': '普通饰面 · 竖向壁柱', 'material-ceramic-tile': '普通饰面 · 面砖',
}
keys = [k for k in names if (OUT/f'before/{k}.jpg').exists() and (OUT/f'after/{k}.jpg').exists()]
assert len(keys) == 15, f'Missing screenshots: {set(names)-set(keys)}'
for k in keys:
    assert Image.open(OUT/f'before/{k}.jpg').size == Image.open(OUT/f'after/{k}.jpg').size == (1920,889), k
manifest = []
for phase in ['before', 'after']:
    for k in keys:
        file = OUT/f'{phase}/{k}.jpg'
        manifest.append({'path': file.relative_to(OUT).as_posix(), 'width':1920, 'height':889,
                         'sha256': hashlib.sha256(file.read_bytes()).hexdigest()})
(OUT/'screenshot-manifest.json').write_text(json.dumps(manifest,indent=2),encoding='utf-8')
payload = [{'id': k, 'name': names[k], 'position': views[k]['position'], 'target': views[k]['target'],
            'url': 'http://127.0.0.1:5178/#v='+quote(json.dumps(views[k], separators=(',',':')))} for k in keys]

# Presentation-only montage: exact same viewport crop, no scene alteration.
font = ImageFont.truetype('C:/Windows/Fonts/msyh.ttc', 24)
small = ImageFont.truetype('C:/Windows/Fonts/msyh.ttc', 18)
cover = Image.new('RGB', (1648, 900), '#f7f5ef')
draw = ImageDraw.Draw(cover)
for row, key in enumerate(['09-tree-close','06-facade-ink']):
    for col, phase in enumerate(['before','after']):
        x,y=col*824,row*450
        draw.text((x+16,y+10),('优化前 · v0.5.0' if col==0 else '优化后 · v0.6.0')+' / '+('树冠' if row==0 else '玻璃'),font=font,fill='#28483e')
        im=Image.open(OUT/f'{phase}/{key}.jpg').crop((320,160,1920,849))
        im.thumbnail((808,392),Image.Resampling.LANCZOS)
        cover.paste(im,(x+8,y+48))
cover.save(OUT/'comparison.jpg',quality=94)
score_rows=''.join(f'<tr><td>{s["name"]}</td><td>{s["before"]}</td><td><b>{s["after"]}</b></td><td>{s["note"]}</td></tr>' for s in scores)
profile_rows=''.join(f'<tr><td>{name}</td><td>{n}</td></tr>' for name,n in materials['counts'].items())
source_gallery=''.join(f'<figure><a href="references/{f}"><img loading="lazy" src="references/{f}" alt="{title}"></a><figcaption>{title} · 用户提供的原版截图，仅作为视觉参考</figcaption></figure>' for f,title in [('original-close.png','树冠特写'),('original-glass.png','玻璃明暗与反光'),('original-walls.png','普通建筑多种窗墙节奏')])
html='''<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>树冠与建筑材质 · v0.6.0 对照验收</title>
<style>
*{box-sizing:border-box}body{margin:0;background:#f7f5ef;color:#273c34;font:16px/1.7 system-ui,"Microsoft YaHei",sans-serif}main{max-width:1440px;margin:auto;padding:44px 28px}h1{font-size:38px;line-height:1.25;margin:8px 0 18px}h2{font-size:25px;margin-top:40px}h3{font-size:19px}p{max-width:1060px;color:#516359}a{color:#24644b}small,.muted{font-size:13px;color:#6b7b70}.eyebrow{letter-spacing:2px;color:#6d7c6f;font-size:13px}.cards{display:grid;grid-template-columns:repeat(4,1fr);gap:14px}.card{background:#fffdf7;border:1px solid #dbdfd2;padding:22px;border-radius:10px}.card strong{display:block;font-size:30px}.card span{font-size:14px;color:#637065}.controls{display:flex;gap:16px;align-items:center;flex-wrap:wrap;margin:18px 0}select,button{padding:11px;border:1px solid #bdc8ba;background:white;border-radius:6px;color:#274d3e;font:inherit}input[type=range]{accent-color:#44795e;width:220px}.compare{position:relative;aspect-ratio:1920/889;background:white;border:1px solid #cdd6c9;border-radius:8px;overflow:hidden}.compare img{position:absolute;width:100%;height:100%;object-fit:contain}.labels{position:absolute;bottom:12px;left:12px;right:12px;display:flex;justify-content:space-between;pointer-events:none}.labels b{background:#ffffffeb;padding:5px 12px;border-radius:5px;font-size:13px}.divider{position:absolute;top:0;bottom:0;width:2px;background:#b88949;left:50%;pointer-events:none}.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:16px}figure{margin:0}figure img{width:100%;border:1px solid #d7dfd1;border-radius:7px}figcaption{font-size:13px;color:#667669}.requirements{display:grid;grid-template-columns:1fr 1fr;gap:16px}table{border-collapse:collapse;width:100%;background:#fffdf8;font-size:14px}td,th{text-align:left;padding:11px 14px;border-bottom:1px solid #e0e4d9}th{background:#e8eee2}.note{border-left:4px solid #90a784;padding:12px 20px;background:#ecf0e6}.wide{width:100%;border-radius:8px}footer{margin-top:42px;border-top:1px solid #cdd6c9;padding-top:20px}code{font-size:13px}details{margin-top:20px}summary{cursor:pointer}li{margin:8px 0}@media(max-width:800px){main{padding:24px 14px}h1{font-size:29px}.cards,.requirements,.grid{grid-template-columns:1fr 1fr}.card{padding:12px}.card strong{font-size:24px}table{font-size:12px}td,th{padding:7px}.controls{gap:9px}}@media(max-width:500px){.grid,.requirements{grid-template-columns:1fr}}
</style><main><div class="eyebrow">BEIJING CITY INK / ENGINE UPDATE / 2026-10-30</div>
<h1>树冠、林带与建筑材质</h1><p>v0.5.0 → v0.6.0。在同一北京 CBD 数据上优化通用生成规则：成组种植、饱满的不对称树冠、连续玻璃反射、多种普通饰面。原版图片用于观察视觉特征，没有复制其代码、材质或模型。</p>
<div class="cards"><div class="card"><strong>__TREE_BEFORE__ → __TREE_AFTER__</strong><span>树木总数，含净空过滤</span></div><div class="card"><strong>__TOUCH__%</strong><span>远景冠投影与邻树相接；旧版 0%</span></div><div class="card"><strong>4 + 18</strong><span>玻璃 / 普通建筑窗格语法</span></div><div class="card"><strong>6 种</strong><span>独立的普通墙面饰面</span></div></div>
<h2>15 组固定机位对照</h2><p>相同位置、目标、FOV、太阳与种子，1920 × 889 视口。左侧为旧版，右侧为新版；滑动可直接比较。界面侧栏滚动位置不影响三维画面。截图是静态验收，未据此声称动态全程无闪烁。</p>
<div class="controls"><select id="view" aria-label="选择对照机位"></select><label>分界 <input id="wipe" aria-label="前后分界" type="range" min="0" max="100" value="50"></label><button id="solo">只看新版</button><a id="open" target="_blank" rel="noopener">打开同机位 ↗</a></div>
<div class="compare"><img id="after" alt="新版截图"><img id="before" alt="旧版截图" style="clip-path:inset(0 50% 0 0)"><div class="divider" id="divider"></div><div class="labels"><b>优化前 · v0.5.0</b><b>优化后 · v0.6.0</b></div></div><p class="muted" id="caption"></p>
<h2>落实到引擎的规则</h2><div class="requirements">
<article class="card"><h3>R1 · 树冠形态</h3><p>圆冠、广冠、瓶形冠、窄冠。树冠宽深比、冠厚、偏心、枝长、叶团比例由稳定种子控制；近景由18团叶簇与6枝构成，避免三层竖向堆叠。远景仍保留冠厚与宽深差异。</p></article>
<article class="card"><h3>R2 · 连片种植</h3><p>行道树按8.8–10.4米节奏、小幅纵向漂移布置，成熟高度9.7–11.7米附近。公园沿边缘错列，草坪只种边缘，树林更密；宽院落增加第二排与小树群。预算按来源和地块轮转，避免道路耗尽公园额度。</p></article>
<article class="card"><h3>R3 · 建筑与桥梁净空</h3><p>窄退界自动选窄冠；车辆桥、天桥、坡道和楼梯共用实际桥板几何、厚度与栏杆高度，分别检查树冠、树干、树枝。新增独立实际顶点审计：旧版96棵远冠穿车行桥板，新版0棵。</p></article>
<article class="card"><h3>R4 · 玻璃幕墙</h3><p>玻璃占楼层高度90–97.5%，减少厚实墙带；细窗框与连续玻璃区共同工作。反射方向由观察方向和表面法线计算，包含天空、暗地平线、方向亮区及掠射角变化；明亮玻璃用网点，暗反射形成黑块。</p></article>
<article class="card"><h3>R5 · 普通建筑饰面</h3><p>浅色抹灰、石材、暖砖、预制板、竖向壁柱、面砖与18种普通窗格独立组合。明确的OSM材质标签优先；缺失时按建筑ID与种子稳定选择，换区域继续复用。点击建筑可查看示意饰面。</p></article>
<article class="card"><h3>R6 · 稳定漫画网点</h3><p>窗格细节先按像素与网点尺度过滤；网点固定相位连续长大，修复灰度越过50%突然黑白反相的问题。恢复长竖梃的稳定几何间距；无新增模糊采样或渲染通道。</p></article></div>
<h2>独立视觉评分</h2><p>每项10分，评价本轮画面和规则能力；不是实景还原率，也不是原版项目的客观评分。评审先指出穿车行桥、扁冠与玻璃雪花，再核验修复版。</p>
<table><thead><tr><th>维度</th><th>旧版</th><th>新版</th><th>依据与剩余差距</th></tr></thead><tbody>__SCORES__</tbody></table>
<h2>普通墙面样式</h2><p>下方为当前街区实际生成的样式，属于规则示意。可在上方选择同名机位查看其完整前后对照。</p><div class="grid" id="materials"></div>
<details><summary>展开当前区域饰面统计与复用方法</summary><table><thead><tr><th>材质标识</th><th>栋数</th></tr></thead><tbody>__PROFILE__</tbody></table><p>种植默认值见 <a href="../../src/streetlife.js">TREE_PLANTING_PROFILE</a>，可通过 planStreetLife 的 plantingProfile 参数覆盖；院落株距和数量预算见 <a href="../../public/data/landscape-profile.json">landscape-profile.json</a>。树冠比例集中于 <a href="../../src/foliage.js">foliage.js</a>；普通饰面与窗型分别在 building-rules.js、facade-layout.js，着色在 facade-shader.js。换区先校验OSM地面语义，再按当地参考调整这些比例，不需要按坐标逐处摆树。</p></details>
<h2>原版参考证据</h2><div class="grid">__SOURCES__</div>
<h2>测试、成本与边界</h2><ul><li><a href="tests.txt">105项测试通过</a>，<a href="build.txt">生产构建通过</a>。覆盖seed复现、材料优先级、冠包络、种植预算、车桥/天桥净空、LOD连续性、网点单调性与原有道路/建筑测试。</li><li><a href="metrics-before.json">旧版</a> / <a href="metrics-after.json">新版独立几何审计</a>：车道、步道、禁种地面、建筑冠包络、远冠穿车桥/步桥检查均为0。连冠指标使用实际远景顶点的俯视凸包，是视觉连续性的代理，不是植被面积或实测树数。</li><li>全场每棵远冠仍180三角；近景最多96棵、每棵18团×320三角。树数增加后，远冠预算由约48万增至约91万三角，不能宣称GPU性能不变。未完成手机/集成显卡或长时间动态帧率测试。</li><li>玻璃使用程序化环境反射，不倒映实际周围楼房；墙面和树种为示意生成。林带依旧有规则感，极远细线仍可能与网点竞争。没有照片识别、季节/树种测绘或透明叶片材质。</li><li>GLB只导出几何与基础材质，程序窗格、玻璃反射、墙面纹理、漫画网点不随GLB导出；PNG保留渲染效果。本轮验收针对浏览器画面。</li></ul>
<p class="note">最终默认树量与原始加密实验不同：桥梁净空过滤和树冠加厚后保留 __TREE_AFTER__ 棵。所有最终截图与最终审计均使用该版本。</p>
<footer><a href="http://127.0.0.1:5178/">打开实时预览</a> · <a href="https://github.com/songshikang0111/OpenStreetMap-3D">项目仓库</a> · <a href="camera-checks.json">相机核验记录</a> · <a href="views.json">完整视角参数</a><p class="muted">© OpenStreetMap contributors · ODbL。3D形态与渲染代码为本项目独立实现。原版截图由用户提供，未用作纹理或三维资产。</p></footer>
<script>const views=__VIEWS__;const select=document.querySelector('#view'),wipe=document.querySelector('#wipe'),old=document.querySelector('#before'),fresh=document.querySelector('#after'),divider=document.querySelector('#divider');views.forEach(v=>{const o=document.createElement('option');o.value=v.id;o.textContent=v.name;select.append(o)});function cut(){old.style.clipPath=`inset(0 ${100-wipe.value}% 0 0)`;divider.style.left=wipe.value+'%';document.querySelector('#solo').textContent=wipe.value==='0'?'恢复对照':'只看新版'}function change(){const v=views.find(v=>v.id===select.value);old.src='before/'+v.id+'.jpg';fresh.src='after/'+v.id+'.jpg';document.querySelector('#open').href=v.url;document.querySelector('#caption').textContent=v.name+' · 相机 '+v.position.join(', ')+' m · 目标 '+v.target.join(', ')+' m';cut()}select.addEventListener('change',change);wipe.addEventListener('input',cut);document.querySelector('#solo').onclick=()=>{wipe.value=wipe.value==='0'?'50':'0';cut()};select.value='09-tree-close';change();for(const v of views.filter(v=>v.id.startsWith('material-'))){const f=document.createElement('figure'),a=document.createElement('a'),i=document.createElement('img'),c=document.createElement('figcaption');a.href='after/'+v.id+'.jpg';i.src=a.href;i.alt=v.name;i.loading='lazy';c.textContent=v.name;a.append(i);f.append(a,c);document.querySelector('#materials').append(f)}</script></main></html>'''
for marker,value in {'__TREE_BEFORE__':before['trees'],'__TREE_AFTER__':after['trees'],'__TOUCH__':round(after['connectivity']['touchFraction']*100,1),'__SCORES__':score_rows,'__PROFILE__':profile_rows,'__SOURCES__':source_gallery,'__VIEWS__':json.dumps(payload,ensure_ascii=False)}.items():
    html=html.replace(marker,str(value))
(OUT/'report.html').write_text(html,encoding='utf-8')
print(f'Built {OUT}/report.html with {len(keys)} matched views')
