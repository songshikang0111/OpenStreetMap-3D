"""Package fixed-camera road/stair screenshots as a portable offline report."""
import hashlib
import html
import json
from pathlib import Path
from urllib.parse import quote
from PIL import Image, ImageDraw, ImageFont

root = Path(__file__).resolve().parents[1] / 'docs/evidence-road-grades'
views = json.loads((root / 'views.json').read_text(encoding='utf-8'))
names = ['机动车桥头坡道', '天桥与两翼楼梯', '楼梯接地近景', '立交层间匝道']
options = ''.join(f'<option value="{v["key"]}">{n}</option>' for v, n in zip(views, names))
links = {}
for v in views:
    state = dict(version=2, mode=v['mode'], seed=1, view='crossing', position=v['position'], target=v['target'], parameters={'lens':v['lens'],'sun-angle':135,'sun-height':45,'facade-detail':50,'glass-reflection':65}, toggles={'windows-toggle':True,'trees-toggle':True,'props-toggle':True,'shadows-toggle':True})
    links[v['key']] = 'http://127.0.0.1:5178/?view=road-grades#v=' + quote(json.dumps(state,separators=(',',':')))
page = '''<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>桥头坡道与天桥楼梯 · v0.4.1</title><style>
*{box-sizing:border-box}body{margin:0;background:#f4f1e9;color:#27473d;font:16px/1.75 system-ui,"Microsoft YaHei",sans-serif}main{max-width:1450px;margin:auto;padding:35px}h1{font-size:40px;margin:12px 0}h2{font-size:24px;margin-top:34px}.muted{color:#718178;font-size:14px}.lead{font-size:20px;max-width:1050px}.cards{display:grid;grid-template-columns:repeat(3,1fr);gap:14px;margin:25px 0}.card,details{background:white;border:1px solid #dce3d9;border-radius:10px;padding:20px}.card b{display:block;font-size:27px}.toolbar{display:flex;gap:20px;align-items:center;flex-wrap:wrap;padding:13px;background:#e3eade;border-radius:10px 10px 0 0}button,select{padding:8px 12px;font:inherit;border:1px solid #b9c8b9;border-radius:5px;background:white;color:inherit}.wipe{position:relative;aspect-ratio:1920/889;overflow:hidden;--cut:50%}.wipe img{position:absolute;width:100%;height:100%;inset:0}.old{clip-path:inset(0 calc(100% - var(--cut)) 0 0)}.divider{position:absolute;left:var(--cut);top:0;bottom:0;border-left:2px solid #ba8755}.label{position:absolute;top:12px;background:#274a3fe8;color:white;padding:3px 10px;border-radius:4px;font-size:13px}.left{left:12px}.right{right:12px}input{width:100%;accent-color:#a5754c}a{color:#326f5a}.links{display:flex;gap:22px;flex-wrap:wrap}table{width:100%;background:white;border-collapse:collapse}th,td{text-align:left;vertical-align:top;padding:12px;border-bottom:1px solid #d7dfd3}th{background:#e3eade}.warning{border-left:3px solid #b7824c;padding:18px;background:#ece6d8}details{margin-top:20px}summary{cursor:pointer}.gallery{display:grid;grid-template-columns:1fr 1fr;gap:15px}.gallery img{width:100%}footer{font-size:13px;color:#7a877c;margin-top:35px}@media(max-width:760px){main{padding:20px 13px}h1{font-size:30px}.cards,.gallery{grid-template-columns:1fr}td{min-width:110px}}
</style><main><div class="muted">BEIJING CITY INK / ROAD GRADES / 2026.10.30</div><h1>让桥接上道路，让楼梯接上地面。</h1><p class="lead">v0.4 → v0.4.1：沿OSM真实共享节点生成连续纵断面；桥板、护栏与标线随坡变化，已标注楼梯的路线生成踏步、平台和扶手。全部是通用引擎规则。</p>
<div class="cards"><div class="card"><b>78处</b>共享节点高程断层消除</div><div class="card"><b>28段</b>沿已有OSM路线生成楼梯</div><div class="card"><b>68 / 68</b>自动测试通过，4组同机位图审</div></div>
<div class="toolbar"><label>机位 <select id="view">__OPTIONS__</select></label><button id="solo">单看新版</button><a id="live" href="__LIVE__" target="_blank" rel="noopener">在3D预览中打开这个机位 ↗</a></div>
<div id="wipe" class="wipe"><img id="new" src="after/01-vehicle.png" alt="v0.4.1新版"><img id="old" class="old" src="before/01-vehicle.png" alt="v0.4旧版"><div class="divider"></div><span class="label left">v0.4 优化前</span><span class="label right">v0.4.1 优化后</span></div><input id="slider" type="range" min="0" max="100" value="50" aria-label="前后分界">
<div class="links"><a id="beforeLink" href="before/01-vehicle.png">完整旧版截图</a><a id="afterLink" href="after/01-vehicle.png">完整新版截图</a><a href="camera-checks.json">相机记录</a><a href="image-checks.json">图像与配准检查</a></div><p class="muted">四组1920×889截图，相机、FOV、画风、光照与种子一致。图库保留完整界面；实际运行参数可通过上方链接复现。</p>
<h2>本轮验收</h2><table><tr><th>需求</th><th>实现与证据</th><th>剩余边界</th></tr><tr><td>车行桥头与匝道</td><td>真实node身份建图，跨way、跨layer连接。机动车最大示意坡度10%，路面/标线/桥板/护栏共享高度。01、04图可见连续坡接。</td><td>缺少实测高程；66条原非桥机动车道路局部抬升，以满足连通和净空。</td></tr><tr><td>天桥上下通道</td><td>内部共享节点拆分两翼楼梯；28段、1054级踏步，含平台与扶手。02、03显示接地与桥台接口。</td><td>23条非台阶步道仍超过12%，最高35%；需要补楼梯/高程信息，不属于无障碍坡道。</td></tr><tr><td>附属物与避让</td><td>路缘、油漆随坡剪切，汽车贴坡；256件设施调整高度，移除73棵与抬高边铺/楼梯冲突的推断树。</td><td>真实OSM树保留；尚未完整求解建筑入口、路基、挡土墙与坡面地形。</td></tr><tr><td>跨越与可靠性</td><td>184处跨越、5578个实际重叠顶点独立验收。最低桥板底净空：车道4.974m，步道2.95m。输入倒序不改变结果。</td><td>这些是示意模型约束与回归检查，不是道路设计规范认证。</td></tr></table>
<p><b>道路专项人工评分：7.5 → 8.0 / 10。</b>独立复核四组截图支持上调；其他项目和总分本轮未重评。<a href="../road-grade-validation.md">查看独立图审</a>。</p>
<h2>引擎如何处理</h2><p>先保留裁剪后道路端点的真实OSM身份，再沿连接图分摊高差。平面相交只提供跨越净空约束，不会把上下层道路连接成路口。使用实际下层道路高度约束上层桥板，避免把短匝道挤成陡壁；若约束无法收敛，拒绝继续构造错误几何。</p><p>标记为steps的路线按最终端点高程生成台阶。普通步道使用单独坡度限制，不能将它们全部当作楼梯，也不能为了连接人行桥而不受约束地抬高机动车路。</p>
<div class="warning">模型仍使用平坦底座，没有DEM、河床或真实桥台工程尺寸。本轮290条道路对象调整高程，最高约15.08m；这是满足连接、坡度和净空的推断结果，不代表真实地形。桥台土体、局部路基悬空、建筑入口衔接及23条陡步道仍需继续处理。</div>
<h2>完整新版截图</h2><div class="gallery">__GALLERY__</div><details><summary>测试、开销与提交</summary><p>68项完整测试及生产构建通过，无检查到的浏览器错误。桥结构约269,590三角形，楼梯约68,764；道路/标线44,293。以上不等于GPU帧率，本轮没有帧率基准。</p><p>Git：c41fa8b 楼梯；8357371 附属物；8538289 共享纵断面；c241762 相对净空与步道；f7f05db 树冠避让。</p><div class="links"><a href="stats.json">生成统计</a><a href="tests.txt">完整测试日志</a><a href="build.txt">构建日志</a><a href="manifest.json">图像SHA-256清单</a></div></details><footer>地图 © OpenStreetMap contributors / ODbL · 独立程序实现 · 未扩大地图范围</footer></main>
<script>const liveLinks=__URLS__,view=document.querySelector('#view'),slider=document.querySelector('#slider'),wipe=document.querySelector('#wipe'),solo=document.querySelector('#solo');function move(){wipe.style.setProperty('--cut',slider.value+'%');document.querySelector('.left').hidden=slider.value==='0';document.querySelector('.right').hidden=slider.value==='100';solo.textContent=slider.value==='0'?'返回前后对照':'单看新版';}view.onchange=()=>{document.querySelector('#old').src='before/'+view.value+'.png';document.querySelector('#new').src='after/'+view.value+'.png';document.querySelector('#beforeLink').href='before/'+view.value+'.png';document.querySelector('#afterLink').href='after/'+view.value+'.png';document.querySelector('#live').href=liveLinks[view.value];};slider.oninput=move;solo.onclick=()=>{slider.value=slider.value==='0'?50:0;move();};</script></html>'''
gallery = ''.join(f'<a href="after/{v["key"]}.png"><img loading="lazy" src="after/{v["key"]}.png" alt="{n}">{n}</a>' for v,n in zip(views,names))
page = page.replace('__OPTIONS__',options).replace('__LIVE__',html.escape(links[views[0]['key']])).replace('__URLS__',json.dumps(links)).replace('__GALLERY__',gallery)
(root/'report.html').write_text(page,encoding='utf-8')
font=ImageFont.truetype('C:/Windows/Fonts/msyh.ttc',25)
rows=[]
for key, crop, label in [('01-vehicle',(850,350,1800,850),'车行桥头：断层 → 连续坡面'),('03-stairs-close',(780,365,1780,590),'天桥：悬空支路 → 踏步与平台')]:
    images=[Image.open(root/p/(key+'.png')).crop(crop) for p in ['before','after']]
    height=round(images[0].height/images[0].width*780)
    row=Image.new('RGB',(1580,height+52),'#f4f1e9');draw=ImageDraw.Draw(row);draw.text((12,8),label+'  |  左：旧版　右：新版',font=font,fill='#27473d')
    for i,im in enumerate(images):row.paste(im.resize((780,height),Image.Resampling.LANCZOS),(i*800,52))
    rows.append(row)
preview=Image.new('RGB',(1580,sum(r.height for r in rows)+16),'#f4f1e9');y=0
for row in rows:preview.paste(row,(0,y));y+=row.height+16
preview.save(root/'comparison.jpg',quality=93)
manifest=[dict(path=p.relative_to(root).as_posix(),bytes=p.stat().st_size,sha256=hashlib.sha256(p.read_bytes()).hexdigest()) for p in sorted(root.glob('*/*.png'))]
(root/'manifest.json').write_text(json.dumps(manifest,indent=2),encoding='utf-8')
print('Built report and comparison; 8 original screenshots hashed.')
