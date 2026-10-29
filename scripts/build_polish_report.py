"""Package the reviewed v0.2/v0.3 screenshots into an offline comparison page."""
import argparse
import hashlib
import html
import json
from pathlib import Path

parser = argparse.ArgumentParser()
parser.add_argument('directory', type=Path)
args = parser.parse_args()
root = args.directory
review = json.loads((root / 'review.json').read_text(encoding='utf-8'))
keys = [('03-street-ink', '街道 · 漫画'), ('07-citic', '中国尊 · 远窗'), ('11-crossing', '路口 · 标线'), ('04-street-color', '街道 · 彩色'), ('01-overview-ink', '俯瞰 · 漫画'), ('02-skyline-ink', '天际线'), ('05-overview-color', '俯瞰 · 彩色'), ('06-top-ink', '正上方'), ('08-cctv', '央视总部'), ('09-facade', '近看立面'), ('10-roof', '屋顶与街树')]
options = ''.join(f'<option value="{k}">{n}</option>' for k, n in keys)
rows = ''.join(f'<tr><td>{r["id"]} · {html.escape(r["name"])}</td><td>{r["weight"]}%</td><td>{r["before"]}</td><td><b>{r["after"]}</b></td><td>{html.escape(r["result"])}</td></tr>' for r in review['scores'])
checks = ''.join(f'<li>{html.escape(s)}</li>' for s in review['checks'])
commits = ''.join(f'<li><code>{c["hash"]}</code> {html.escape(c["summary"])}</li>' for c in review['commits'])
gallery = ''.join(f'<a href="after/{k}.png" target="_blank"><img loading="lazy" src="after/{k}.png" alt="{n}"><span>{n}</span></a>' for k,n in keys)
old = sum(r['before']*r['weight']/10 for r in review['scores'])
new = sum(r['after']*r['weight']/10 for r in review['scores'])
page = '''<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>京城线境 · 第二轮渲染验收</title><style>
*{box-sizing:border-box}body{margin:0;background:#f5f3ed;color:#263b36;font:16px/1.7 system-ui,"Microsoft YaHei",sans-serif}main{max-width:1440px;margin:auto;padding:38px 36px 80px}h1{font-size:42px;line-height:1.2;margin:12px 0 18px}h2{margin:42px 0 14px;font-size:25px}p{max-width:1000px}.eyebrow{font-size:12px;letter-spacing:3px;color:#627d70}.lede{font-size:19px;color:#566b61}.cards{display:grid;grid-template-columns:repeat(3,1fr);gap:16px;margin:26px 0}.card{background:white;border:1px solid #d9dfd6;padding:22px;border-radius:12px}.card b{display:block;font-size:22px}.muted{color:#77877f;font-size:14px}.score{font-size:32px}.toolbar{display:flex;align-items:center;gap:18px;flex-wrap:wrap;background:#e5ebe3;padding:14px;border-radius:10px 10px 0 0}select,button{border:1px solid #c9d1c8;background:white;color:inherit;border-radius:6px;padding:9px 14px;font:inherit}.wipe{position:relative;overflow:hidden;border:1px solid #cbd5ca;background:white;aspect-ratio:1920/945;--cut:50%}.wipe img{position:absolute;width:100%;height:100%;object-fit:contain;inset:0}.wipe .old{clip-path:inset(0 calc(100% - var(--cut)) 0 0)}.divider{position:absolute;top:0;bottom:0;left:var(--cut);border-left:2px solid #d57246;pointer-events:none}.badge{position:absolute;top:15px;padding:4px 10px;border-radius:5px;background:#23483de8;color:white;font-size:13px;pointer-events:none}.badge.left{left:16px}.badge.right{right:16px}.slider{width:100%;accent-color:#c96d42}.table-wrap{overflow:auto}table{width:100%;border-collapse:collapse;background:white}td,th{padding:13px 14px;border-bottom:1px solid #dbe1d9;text-align:left}td:first-child{min-width:175px}td:nth-child(5){min-width:430px;font-size:14px}th{background:#e5ebe3}.gallery{display:grid;grid-template-columns:repeat(3,1fr);gap:15px}.gallery a{background:white;color:inherit;text-decoration:none;border:1px solid #d6ded3;border-radius:6px;overflow:hidden}.gallery img{width:100%;display:block}.gallery span{padding:8px 14px;display:block}.reference img{width:100%;max-width:960px;border-radius:10px}a{color:#346f5d}code{background:#e8ede5;padding:2px 6px}details{background:white;border:1px solid #dae0d7;border-radius:8px;padding:16px;margin:16px 0}li{margin:6px 0}.warning{border-left:3px solid #c7774e;padding:10px 20px;background:#eeeae0}.full-links{display:flex;gap:22px;font-size:14px}footer{margin-top:50px;color:#7b877f;font-size:13px}@media(max-width:760px){main{padding:22px 16px}h1{font-size:31px}.cards{grid-template-columns:1fr}.gallery{grid-template-columns:1fr 1fr}.wipe{margin:0 -8px}.score{font-size:25px}}
</style></head><body><main>
<div class="eyebrow">BEIJING CITY INK / RENDER STUDY 02 / 2026.10.30</div><h1>让城市的细节更清楚。</h1><p class="lede">同一份国贸 OSM、同一组机位和画幅，比较 v0.2 → v0.3。重点打磨远景窗格、漫画明暗、树冠和道路交口。</p>
<div class="cards"><div class="card"><b>更干净的远景</b><p>按像素大小过滤窗格；光照独立于玻璃与路面材质。新增远景窗格保留滑杆。</p></div><div class="card"><b>更自然的树冠</b><p>不规则叶簇、世界坐标叶片纹理和近远层级；保留原来的 2,473 个程序树位。</p></div><div class="card"><b>更连续的路口</b><p>同层路面不重叠，转角连接连续；虚线避开交口与横道，路缘避让相接车道。</p></div></div>
<h2>滑动对照</h2><div class="toolbar"><label>机位 <select id="view">__OPTIONS__</select></label><span class="muted">固定机位 / 1920 × 945 / 相同光照与种子</span><button id="swap">单看新版</button></div><div class="wipe" id="wipe"><img id="new" src="after/03-street-ink.png" alt="v0.3"><img id="old" class="old" src="before/03-street-ink.png" alt="v0.2"><div class="divider"></div><span class="badge left">v0.2 优化前</span><span class="badge right">v0.3 优化后</span></div><input class="slider" id="slider" type="range" min="0" max="100" value="50" aria-label="前后对照分界"><div class="full-links"><a id="oldLink" href="before/03-street-ink.png" target="_blank">打开完整旧版截图</a><a id="newLink" href="after/03-street-ink.png" target="_blank">打开完整新版截图</a><a href="camera-checks.json">机位与参数记录</a></div>
<h2>逐项复评 <span class="score">__OLD__ → __NEW__ / 100</span></h2><p class="muted">沿用上一轮 R1–R7 权重。0–10 为人工工程评分，不是实景还原百分比；未改进的需求不加分。原版参考来自上一轮同区域截图，未与原版做像素配准。</p><div class="table-wrap"><table><thead><tr><th>需求</th><th>权重</th><th>v0.2</th><th>v0.3</th><th>本次证据判断与剩余差距</th></tr></thead><tbody>__ROWS__</tbody></table></div>
<h2>改的是引擎能力</h2><p>窗格过滤与光照适用于全部建筑，树冠规则适用于全部树木，道路裁剪与标线避让适用于整份路网。没有按截图或机位修改画面，也没有在此次渲染代码中新增国贸坐标判断。唯一的地标专属调整是央视既有斜网格材质的结构尺度；它与细窗分开过滤，形体仍沿用已有参数化地标规则。</p>
<h2>原版参考仍显示的差距</h2><p>原版近树有更细密的叶缘与疏密关系，建筑家族、窗台、空调和店铺信息也更丰富。本轮没有新增建筑实测信息、卫星图片或新的地标生成器。</p><details class="reference"><summary>查看上一轮原版街景参考（2026-10-29，同地段但不同机位）</summary><img src="original/04-street-eye-ink.jpg" alt="Rokehan原版街景参考"><p class="muted">截图仅用于比较研究。原版 <a href="https://tools.oyasumi-gamedev.com/rokehan/#ll=39.909500%2C116.460500&s=1000&far=2&n=Beijing+CBD">Location Scout</a> · 不作为本项目渲染素材。</p></details>
<h2>验收与开销</h2><ul>__CHECKS__</ul><p class="warning">远处窗格会被主动简化；细节滑杆可调整取舍。树冠仍是实体叶簇，切换层级时仍可能发生跳变。桥梁支撑、地形、更多建筑语法尚未补齐。新增光照通道和叶片纹理有渲染成本，本次没有多设备 GPU 帧率基准。</p><p><a href="geometry-budget.json">完整几何预算</a> · <a href="review.json">评分记录</a> · <a href="extra/12-lines.png">线稿模式</a> · <a href="extra/13-clay.png">白模模式</a> · <a href="extra/14-detail-control.png">新增参数</a> · <a href="exports/city-v03.png">高分辨率 PNG 导出</a></p>
<h2>全部新版截图</h2><div class="gallery">__GALLERY__</div><details><summary>本轮 Git 提交记录</summary><ul>__COMMITS__</ul></details><footer>地图 © OpenStreetMap contributors / ODbL · 本地独立实现 · 比较截图保留原 UI、参数与版本标记。旧验收报告继续保留于 ../comparison/report.html。</footer>
</main><script>
const view=document.querySelector('#view'),slider=document.querySelector('#slider'),wipe=document.querySelector('#wipe'),swap=document.querySelector('#swap');
function move(){wipe.style.setProperty('--cut',slider.value+'%');swap.textContent=slider.value==='0'?'返回前后对照':'单看新版';document.querySelector('.badge.left').hidden=slider.value==='0';document.querySelector('.badge.right').hidden=slider.value==='100';}
view.addEventListener('change',()=>{for(const [id,dir]of [['old','before'],['new','after']]){document.getElementById(id).src=dir+'/'+view.value+'.png';document.getElementById(id+'Link').href=dir+'/'+view.value+'.png';}});
slider.addEventListener('input',move);swap.onclick=()=>{slider.value=slider.value==='0'?50:0;move();};
</script></body></html>'''
for key,value in {'OPTIONS':options,'ROWS':rows,'OLD':f'{old:.1f}','NEW':f'{new:.1f}','CHECKS':checks,'COMMITS':commits,'GALLERY':gallery}.items():
    page=page.replace('__'+key+'__',value)
(root/'report.html').write_text(page,encoding='utf-8')
manifest=[]
for folder in ['before','after','extra','original','exports']:
    for p in sorted((root/folder).glob('*')):
        if p.is_file() and not p.name.startswith('iteration-'):
            manifest.append({'path':p.relative_to(root).as_posix(),'bytes':p.stat().st_size,'sha256':hashlib.sha256(p.read_bytes()).hexdigest()})
(root/'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2),encoding='utf-8')
print(f'Built {root / "report.html"}; {len(manifest)} evidence files; weighted score {old:.2f} -> {new:.2f}')
