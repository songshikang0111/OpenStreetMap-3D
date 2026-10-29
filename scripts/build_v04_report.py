"""Build an offline acceptance report from reviewed screenshots and measurements."""
import argparse
import hashlib
import html
import json
from pathlib import Path

parser = argparse.ArgumentParser()
parser.add_argument('directory', type=Path)
root = parser.parse_args().directory
review = json.loads((root / 'review.json').read_text(encoding='utf-8'))
views = [('13-bridge-under', '桥下结构'), ('15-sidewalk', '路缘与铺装'), ('12-bridge-oblique', '立交俯视'), ('14-footbridge', '行人天桥'), ('09-facade', '近看立面'), ('11-crossing', '路口留白'), ('03-street-ink', '街道漫画'), ('04-street-color', '街道彩色'), ('10-roof', '屋顶与街树'), ('08-cctv', '央视总部'), ('07-citic', '中国尊'), ('01-overview-ink', '街区俯瞰'), ('02-skyline-ink', '城市天际线'), ('05-overview-color', '俯瞰彩色'), ('06-top-ink', '正上方')]
esc = html.escape
options = ''.join(f'<option value="{k}">{n}</option>' for k, n in views)
rows = ''.join(f'<tr><td>{s["id"]} · {esc(s["name"])}</td><td>{s["before"]}</td><td><b>{s["after"]}</b></td><td>{esc(s["result"])}</td></tr>' for s in review['scores'])
old = sum(s['before'] * s['weight'] / 10 for s in review['scores'])
new = sum(s['after'] * s['weight'] / 10 for s in review['scores'])
checks = ''.join(f'<li>{esc(s)}</li>' for s in review['checks'])
commits = ''.join(f'<li><code>{c["hash"]}</code> {esc(c["summary"])}</li>' for c in review['commits'])
audits = ''.join(f'<tr><td>{esc(a["name"])}</td><td>{esc(a["status"])}</td><td>{esc(a["next"])}</td></tr>' for a in review['audit'])
gallery = ''.join(f'<a href="after/{k}.png"><img loading="lazy" src="after/{k}.png" alt="{n}"><span>{n}</span></a>' for k,n in views)
budget = json.loads((root / 'geometry-budget.json').read_text(encoding='utf-8'))
budget_rows = ''.join(f'<tr><td>{esc(v["key"])}</td><td>{v["before"]["sceneTriangles"]:,}</td><td>{v["after"]["sceneTriangles"]:,}</td><td>{v["before"]["detailInstances"]:,} → {v["after"]["detailInstances"]:,}</td></tr>' for v in budget['views'] if v['key'] in ['01-overview-ink','03-street-ink','09-facade','11-crossing'])
page = '''<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>京城线境 · 第三轮引擎验收</title><style>
*{box-sizing:border-box}body{margin:0;background:#f4f1e9;color:#253b36;font:16px/1.75 system-ui,"Microsoft YaHei",sans-serif}main{max-width:1450px;margin:auto;padding:38px 36px 72px}h1{font-size:44px;line-height:1.25;margin:14px 0}h2{font-size:25px;margin:40px 0 14px}.eyebrow{font-size:12px;letter-spacing:3px;color:#74867a}.lede{font-size:19px;color:#5b7167;max-width:1060px}.muted{font-size:14px;color:#708279}.cards{display:grid;grid-template-columns:repeat(3,1fr);gap:16px;margin:28px 0}.card{padding:24px;background:#fff;border:1px solid #dce2d8;border-radius:12px}.card b{font-size:22px}.card p{margin-bottom:0}.toolbar{display:flex;align-items:center;gap:18px;flex-wrap:wrap;background:#e4eae0;padding:14px;border-radius:10px 10px 0 0}select,button{font:inherit;padding:8px 13px;background:white;color:inherit;border:1px solid #c5d0c3;border-radius:6px}.wipe{position:relative;overflow:hidden;aspect-ratio:1920/945;--cut:50%;background:#fff;border:1px solid #ccd7ca}.wipe img{position:absolute;inset:0;width:100%;height:100%;object-fit:contain}.old{clip-path:inset(0 calc(100% - var(--cut)) 0 0)}.divider{position:absolute;top:0;bottom:0;left:var(--cut);border-left:2px solid #c87949}.badge{position:absolute;top:14px;background:#244c40eb;color:#fff;padding:3px 11px;border-radius:5px;font-size:13px}.badge.left{left:14px}.badge.right{right:14px}#slider{width:100%;accent-color:#b76b42}.links{display:flex;gap:20px;flex-wrap:wrap;font-size:14px}a{color:#327260}.table-wrap{overflow:auto}table{background:white;border-collapse:collapse;width:100%}th,td{text-align:left;padding:13px 15px;border-bottom:1px solid #dae1d5;vertical-align:top}th{background:#e5ebe1}td:first-child{min-width:165px}td:last-child{min-width:360px}.score{color:#406e5b;font-size:30px}.gallery{display:grid;grid-template-columns:repeat(3,1fr);gap:14px}.gallery a{background:#fff;border:1px solid #dce2d6;border-radius:8px;overflow:hidden;text-decoration:none;color:inherit}.gallery img{width:100%;display:block}.gallery span{display:block;padding:8px 13px}details{background:#fff;border:1px solid #d7e0d1;border-radius:8px;padding:15px;margin:14px 0}details img{max-width:100%}code{background:#e8ece2;padding:2px 5px}.warning{background:#ece7d9;border-left:3px solid #b47547;padding:14px 21px}li{margin:7px 0}footer{font-size:13px;color:#7f8b7f;margin-top:40px}@media(max-width:760px){main{padding:24px 16px}h1{font-size:32px}.cards{grid-template-columns:1fr}.gallery{grid-template-columns:1fr 1fr}}
</style></head><body><main>
<div class="eyebrow">BEIJING CITY INK / ENGINE STUDY 03 / 2026.10.30</div><h1>建筑、道路与漫画层次。</h1><p class="lede">同一份国贸数据，继续打磨通用引擎。v0.3 → v0.4：窗框与窗格对齐、玻璃有连续亮区、树冠连续过渡、地面区分白纸与落影，补足桥梁结构与步行铺装。</p>
<div class="cards"><div class="card"><b>建筑细节覆盖整批对象</b><p>4类建筑、12种确定性窗格语法。修复输入顺序截断窗框的问题，附近墙面按距离获得实体细节。</p></div><div class="card"><b>玻璃与地面分开处理</b><p>玻璃增加示意天空反光；地面主要在投影与接触处上网点。复用现有渲染通道。</p></div><div class="card"><b>连续、有限额的树冠</b><p>共同基础冠加外围叶簇，所有通道共用连续变化的几何。保留2,473个树位，近簇面数降低。</p></div></div>
<h2>同机位滑动对照</h2><div class="toolbar"><label>机位 <select id="view">__OPTIONS__</select></label><span class="muted">1920 × 945 / 相同相机、太阳与种子</span><button id="swap">单看新版</button></div>
<div class="wipe" id="wipe"><img id="new" src="after/13-bridge-under.png" alt="v0.4"><img id="old" class="old" src="before/13-bridge-under.png" alt="v0.3"><div class="divider"></div><span class="badge left">v0.3 优化前</span><span class="badge right">v0.4 优化后</span></div><input id="slider" type="range" min="0" max="100" value="50" aria-label="前后对照分界">
<div class="links"><a id="oldLink" href="before/13-bridge-under.png">完整旧版截图</a><a id="newLink" href="after/13-bridge-under.png">完整新版截图</a><a href="camera-checks.json">相机与参数记录</a><a href="matched-checks.json">配准检查</a></div>
<p class="muted">原11组旧版图复用上一轮已归档的v0.3截图，新增4组道路机位重新拍摄两版；共15组，同相机、共有参数与画幅逐项核对。新增玻璃留白默认65%，两版远窗保留均为50%。原版只用于同地段风格参考，未与它做像素配准。</p>
<h2>逐项复评 <span class="score">__OLD__ → __NEW__ / 100</span></h2><p class="muted">沿用R1–R7权重。这是人工工程量表，不是实景还原率；功能完成不自动换成视觉加分。</p><div class="table-wrap"><table><thead><tr><th>需求</th><th>v0.3</th><th>v0.4</th><th>截图判断与剩余差距</th></tr></thead><tbody>__ROWS__</tbody></table></div>
<h2>道路专项：从平片到结构</h2><p>车道与明确过街面保持0.32米，普通人行面抬到0.47米；材质和近景铺装接缝分别处理。桥上、禁步行道路不再机械铺两侧人行道。149段路缘按横道位置裁开，斑马线贴近路面。</p><p>桥梁补有厚度的桥板与桥底、3,001段护栏、232根避让下层道路的支撑。74个不安全支撑候选跳过。桥高仍按layer×7米推断，78处名义高程连接、天桥楼梯和过街缓坡仍需解决。</p>
<h2>独立子代理：与原版还差在哪里</h2><p>逐图复核原版存档和v0.3，核实作者公开说明，再对完成的v0.4截图复评。观察事实、代码诊断与实现推测分别记录。</p><div class="table-wrap"><table><thead><tr><th>重点</th><th>本轮覆盖</th><th>下一步应验收什么</th></tr></thead><tbody>__AUDITS__</tbody></table></div><p class="links"><a href="visual-gap-audit.md">完整差异审计与证据链接</a><a href="visual-gap-validation.md">独立截图复核</a><a href="https://oyasumi-gamedev.com/tools/rokehan/">原作者说明</a></p>
<details><summary>原版街景参考（2026-10-29，同地段、不同机位）</summary><img loading="lazy" src="original/04-street-eye-ink.jpg" alt="原版Location Scout街景"><p class="muted">仅作研究证据，不参与本项目建模或渲染。</p></details>
<h2>验收与开销</h2><ul>__CHECKS__</ul><div class="table-wrap"><table><thead><tr><th>机位</th><th>旧版总三角形</th><th>新版总三角形</th><th>实体近窗实例</th></tr></thead><tbody>__BUDGET__</tbody></table></div><p class="muted">几何数为视锥裁剪前、单场景遍次的总量；不含阴影与后处理，不是GPU帧率。共享布局增加顶点属性内存，近窗修复也增加局部几何。完整记录见<a href="geometry-budget.json">预算JSON</a>。</p>
<p class="warning">窗格、反光、枝叶仍为程序示意。共墙与临街入口、树叶疏密、近区高精度阴影、细竖肋混叠和地形仍有缺口。桥板/护栏/支撑已补，但仍有78处名义高程不一致的连接点，天桥楼梯与过街缓坡未补齐。路缘开口不等于完成无障碍坡道。本轮没有扩展地图、增加地标专用规则或宣称照片级还原。</p>
<h2>专项检查</h2><div class="gallery"><a href="extra/shadow-on.png"><img loading="lazy" src="extra/shadow-on.png" alt="投影开启"><span>投影开启</span></a><a href="extra/shadow-off.png"><img loading="lazy" src="extra/shadow-off.png" alt="投影关闭"><span>同机位关闭投影</span></a><a href="extra/lines.png"><img loading="lazy" src="extra/lines.png" alt="线稿"><span>线稿模式</span></a><a href="extra/clay.png"><img loading="lazy" src="extra/clay.png" alt="白模"><span>白模模式</span></a><a href="extra/glass-control.png"><img loading="lazy" src="extra/glass-control.png" alt="玻璃参数"><span>玻璃参数保存与重载</span></a><a href="extra/export.png"><img loading="lazy" src="extra/export.png" alt="PNG导出"><span>PNG实际导出</span></a></div>
<h2>全部新版截图</h2><div class="gallery">__GALLERY__</div><details><summary>本轮Git提交记录</summary><ul>__COMMITS__</ul></details><footer>地图 © OpenStreetMap contributors / ODbL · 本地独立实现 · 截图保留界面与版本标记 · <a href="manifest.json">证据SHA-256清单</a></footer>
</main><script>
const view=document.querySelector('#view'),slider=document.querySelector('#slider'),wipe=document.querySelector('#wipe'),swap=document.querySelector('#swap');
function move(){wipe.style.setProperty('--cut',slider.value+'%');swap.textContent=slider.value==='0'?'返回前后对照':'单看新版';document.querySelector('.badge.left').hidden=slider.value==='0';document.querySelector('.badge.right').hidden=slider.value==='100';}
view.addEventListener('change',()=>{for(const [id,dir]of [['old','before'],['new','after']]){document.getElementById(id).src=dir+'/'+view.value+'.png';document.getElementById(id+'Link').href=dir+'/'+view.value+'.png';}});slider.addEventListener('input',move);swap.onclick=()=>{slider.value=slider.value==='0'?50:0;move();};
</script></body></html>'''
for name,value in {'OPTIONS':options,'OLD':f'{old:.1f}','NEW':f'{new:.1f}','ROWS':rows,'CHECKS':checks,'AUDITS':audits,'BUDGET':budget_rows,'GALLERY':gallery,'COMMITS':commits}.items():
    page=page.replace('__'+name+'__',value)
(root/'report.html').write_text(page,encoding='utf-8')
manifest=[]
for folder in ['before','after','extra','original']:
    for p in sorted((root/folder).glob('*')):
        if p.is_file() and not p.name.startswith('iteration-'):
            manifest.append({'path':p.relative_to(root).as_posix(),'bytes':p.stat().st_size,'sha256':hashlib.sha256(p.read_bytes()).hexdigest()})
(root/'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2),encoding='utf-8')
print(f'Built {root / "report.html"}; {len(manifest)} evidence files; score {old:.2f} -> {new:.2f}')
