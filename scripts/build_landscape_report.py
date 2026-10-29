"""Build the offline landscape comparison from captured, matched browser views."""
from pathlib import Path
import hashlib, html, json
from urllib.parse import quote
from PIL import Image, ImageDraw, ImageFont

repo=Path(__file__).resolve().parents[1]
root=repo/'docs/evidence-landscape'
views=json.loads((root/'views.json').read_text(encoding='utf-8-sig'))
metrics=json.loads((root/'metrics.json').read_text(encoding='utf-8-sig'))
land=metrics['landscape']
scores=json.loads((root/'scores.json').read_text(encoding='utf-8-sig'))
labels={'01-overview-color':'全区彩色鸟瞰','02-mid-ink':'漫画中景','03-court-color':'楼前与大空隙近景','04-top-color':'正上方布局'}
links={key:'http://127.0.0.1:5178/?landscape-report=1#v='+quote(json.dumps(value,separators=(',',':'))) for key,value in views.items()}
options=''.join(f'<option value="{key}" {"selected" if key=="03-court-color" else ""}>{label}</option>' for key,label in labels.items())
rows=''.join(f'<tr><td>{html.escape(row["dimension"])}</td><td>{row["before"]}</td><td>{row["after"]}</td><td>{html.escape(row["evidence"])}</td></tr>' for row in scores)
gallery=''.join(f'<figure><a href="after/{key}.png"><img loading="lazy" src="after/{key}.png"></a><figcaption>{label} · <a href="before/{key}.png">旧版</a> / <a href="after/{key}.png">新版</a></figcaption></figure>' for key,label in labels.items())
page='''<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>空地景观补全 · v0.5.0 对照验收</title>
<style>*{box-sizing:border-box}body{margin:0;background:#f7f6f0;color:#263d34;font:16px/1.75 system-ui,"Microsoft YaHei",sans-serif}main{max-width:1480px;margin:auto;padding:36px}h1{font-size:34px;margin:.2em 0}h2{font-size:24px;margin-top:38px}p{max-width:1100px}.eyebrow{font-size:12px;letter-spacing:3px;color:#65826c}.muted{color:#6c776d;font-size:14px}a{color:#306854}a:hover{text-decoration-thickness:2px}.tools{display:flex;gap:12px;align-items:center;flex-wrap:wrap;margin:18px 0}button,select,.pill{font:inherit;border:1px solid #bac9b8;padding:9px 14px;border-radius:7px;background:#fff;color:#315441}.metrics{display:flex;gap:20px;flex-wrap:wrap;margin:25px 0}.metric{flex:1;min-width:210px;background:white;border:1px solid #dedfd2;padding:18px 23px;border-radius:12px}.metric strong{display:block;font-size:28px}.wipe{position:relative;aspect-ratio:1920/889;background:white;--cut:50%;border:1px solid #d8ddcf}.wipe img{position:absolute;inset:0;width:100%;height:100%}.wipe #new{clip-path:inset(0 0 0 var(--cut))}.wipe .label{position:absolute;top:12px;background:#203c32de;color:white;padding:3px 12px;border-radius:5px;font-size:13px}.old-label{left:14px}.new-label{right:14px}input[type=range]{width:100%;accent-color:#527a60}table{border-collapse:collapse;width:100%;background:#fff;font-size:14px}td,th{text-align:left;padding:12px 14px;border-bottom:1px solid #dde3d8}th{background:#e4ebdf}.gallery{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:20px}figure{margin:0}figure img{width:100%;border:1px solid #d9ddce}figcaption{font-size:14px}.note{background:#ececdb;border-left:4px solid #8e9b71;padding:14px 20px}.reference{max-width:750px}footer{font-size:13px;color:#6b766d;margin-top:40px}@media(max-width:750px){main{padding:18px}.gallery{grid-template-columns:1fr}h1{font-size:27px}table{font-size:12px}td,th{padding:7px}}</style>
<main><div class="eyebrow">BEIJING CITY INK / LANDSCAPE ENGINE</div><h1>从空白地面，到有层次的城市场地。</h1>
<p>本轮在同一北京 CBD 范围补足场地：先恢复 OSM 已有用途，再用四类通用模板处理缺数据的空间。照片用于判断草坪、树阵、铺装的比例；新增布局是规则示意。</p>
<div class="metrics"><div class="metric"><span>OSM 补充对象</span><strong>48 个</strong><small>其中 23 个明确场地对象；另有用途背景与喷泉</small></div><div class="metric"><span>规则场地 / 大空隙庭园</span><strong>__SITES__ / __COMMONS__</strong><small>入口留白、绿带、草坪与座椅</small></div><div class="metric"><span>未覆盖采样估计</span><strong>__BEFORE__% → __AFTER__%</strong><small>同一补充数据下，约12米采样；非像素空白率</small></div></div>
<div class="tools"><select id="view" aria-label="对照机位">__OPTIONS__</select><button id="solo">单看新版</button><a class="pill" id="live" href="__LIVE__">打开同机位互动预览</a><a href="../landscape-engine.md">规则与换区方法</a></div>
<div class="wipe" id="wipe"><img id="old" src="before/03-court-color.png" alt="旧版场地"><img id="new" src="after/03-court-color.png" alt="新版场地"><span class="label old-label">v0.4.2</span><span class="label new-label">v0.5.0</span></div><input aria-label="前后对照滑杆" id="slider" type="range" value="50" min="0" max="100"><p class="muted">4 组前后截图使用相同机位、FOV、种子、光照与1920×889画幅。旧版来自冻结的v0.4.2生产构建；新版包含补充OSM数据和场地引擎。指标的46.5%基线则已加载补充OSM，二者口径不同。</p>
<h2>OSM 有数据，也有遗漏</h2><p>恢复 4 处原本被解析器忽略的步行广场；扩展查询增加停车场、运动场、树林、花坛、公园与施工地等。商业用地只提供环境语境，不整块铺草。69个场地多边形经建筑、道路等裁切后，51个场地面仍有可见片段。<a href="../landscape-osm-audit.md">查看抓取与语义审计</a>。</p>
<h2>从真实鸟瞰提取的规则</h2><p><a href="https://news.bjd.com.cn/2024/10/23/10944711.shtml">北京日报2024年10月23日报道（CBD管委会供图）</a>的实景显示：草坪被宽步道分割，两侧乔灌木与楼前硬地形成层次。因此模板保留开敞铺装，用低灌木和疏树组织空间。没有把照片作为纹理或通过遥感生成地面边界。</p><figure class="reference"><a href="references/cbd-plaza-aerial.png"><img loading="lazy" src="references/cbd-plaza-aerial.png"></a><figcaption>实际查看的鸟瞰照片截图；来源与拍摄时期见原报道。只用于分析，不是本项目生成画面。</figcaption></figure>
<table><tr><th>空间类型</th><th>模板处理</th><th>约束</th></tr><tr><td>办公楼前场</td><td>宽铺装、单侧/双侧/错位草坪、低灌木、座椅</td><td>建筑退界与中央示意通道</td></tr><tr><td>楼间庭院</td><td>沿外墙定向的长草坪与疏树</td><td>保留孔洞，避免小碎片及相互重叠</td></tr><tr><td>道路退界</td><td>线性绿带与步行边带</td><td>避让道路、桥梯与已有场地</td></tr><tr><td>较大空隙</td><td>倒角边界、宽步道、斜支路与不对称草坪</td><td>只在有足够净空的残余区域生成，不渲染棋盘网格</td></tr></table>
<h2>独立评分与剩余差距</h2><p>10分制专项人工评分，比较旧版与本轮，不代表实景还原率。完整解释见<a href="../landscape-validation.md">独立验收</a>。</p><table><tr><th>维度</th><th>旧版</th><th>本轮</th><th>依据</th></tr>__SCORES__</table>
<p class="note">仍能看出规则化景观设计，漫画地面线条也比旧版更密。入口是预留示意通道，不是实际门位；树木检查覆盖中心和部分净空，不能当作完整树冠碰撞验收。未覆盖区域没有强制种满。照片与OSM时间不同，已知施工地按地图保留。尚未实现自动卫星识别、真实高程或屋顶绿化。</p>
<h2>工程与交互验收</h2><p>88项测试通过，生产构建通过；检查闭合环/水面孔洞、入口与长椅完整占地、道路和已知用地避让、非北京坐标平移旋转、预算与种子。球场标线采用同平面嵌入并共用宿主边界身份，避免细线叠面和双黑边。<a href="tests.txt">测试记录</a> · <a href="build.txt">构建记录</a> · <a href="metrics.json">指标</a> · <a href="review-checks.json">独立净空抽查</a>。</p>
<p>「空地景观补全」关闭后保留OSM地表，移除本轮推断模板与内部示意线。开关、恢复和PNG导出已实际检查：<a href="ui-checks.json">交互记录</a> · <a href="checks/export.png">导出PNG</a>。CPU单次场景构建约__TIME__秒（本机）；不等于交互帧率，未做GPU性能基准。</p>
<h2>完整图证</h2><div class="gallery">__GALLERY__</div><footer>地图 © OpenStreetMap contributors / ODbL。<a href="manifest.json">图像SHA-256与画幅</a> · <a href="camera-checks.json">相机核对</a> · <a href="views.json">复现参数</a>。主预览保持 http://127.0.0.1:5178/。</footer></main>
<script>const links=__LINKS__,view=document.querySelector('#view'),slider=document.querySelector('#slider'),wipe=document.querySelector('#wipe');function move(){wipe.style.setProperty('--cut',slider.value+'%');document.querySelector('.old-label').hidden=slider.value==='0';document.querySelector('.new-label').hidden=slider.value==='100';document.querySelector('#solo').textContent=slider.value==='0'?'返回前后对照':'单看新版';}view.onchange=()=>{for(const[id,folder]of [['old','before'],['new','after']])document.querySelector('#'+id).src=folder+'/'+view.value+'.png';document.querySelector('#live').href=links[view.value];};slider.oninput=move;document.querySelector('#solo').onclick=()=>{slider.value=slider.value==='0'?50:0;move();};</script></html>'''
replace={'__SITES__':land['inferredSites'],'__COMMONS__':land['templates']['pocket-common'],'__BEFORE__':f"{land['unfilledBeforeFraction']*100:.1f}",'__AFTER__':f"{land['unfilledAfterFraction']*100:.1f}",'__OPTIONS__':options,'__LIVE__':html.escape(links['03-court-color']),'__SCORES__':rows,'__GALLERY__':gallery,'__LINKS__':json.dumps(links),'__TIME__':f"{metrics['cpuBuildMs']/1000:.1f}"}
for key,value in replace.items():page=page.replace(key,str(value))
(root/'report.html').write_text(page,encoding='utf-8')
font=ImageFont.truetype('C:/Windows/Fonts/msyh.ttc',24)
rect=(480,280,1570,840)
images=[Image.open(root/folder/'03-court-color.png').crop(rect) for folder in ['before','after']]
canvas=Image.new('RGB',(images[0].width*2,images[0].height+64),'#f7f6f0')
draw=ImageDraw.Draw(canvas)
for i,im in enumerate(images):canvas.paste(im,(i*im.width,64));draw.text((i*im.width+20,17),['v0.4.2 · 空白地面','v0.5.0 · 场地规则补全'][i],font=font,fill='#2d513b')
canvas.save(root/'comparison.jpg',quality=92)
manifest=[]
for p in sorted(root.rglob('*')):
    if p.suffix.lower() not in ['.png','.jpg']:continue
    im=Image.open(p);manifest.append({'file':p.relative_to(root).as_posix(),'size':list(im.size),'sha256':hashlib.sha256(p.read_bytes()).hexdigest()})
(root/'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2),encoding='utf-8')
print('report.html, comparison.jpg and manifest.json generated')
