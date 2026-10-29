"""Package actual browser screenshots; no synthetic or repainted evidence."""
import hashlib
import html
import json
from pathlib import Path
from urllib.parse import quote
from PIL import Image, ImageChops, ImageStat, ImageDraw, ImageFont

root=Path(__file__).resolve().parents[1]/'docs/evidence-distance'
views=json.loads((root/'views.json').read_text(encoding='utf-8'))
names={'03-mid-ink':'中远景 · 建筑群','02-skyline-ink':'低角度 · 天际线','01-overview-ink':'全街区 · 俯瞰','04-far-ink':'极远景 · 简化','09-facade':'近景 · 掠角立面','05-overview-color':'彩色 · 材质回归'}
links={k:'http://127.0.0.1:5178/?view=distance-v042#v='+quote(json.dumps(views[k],separators=(',',':'))) for k in names}
checks=json.loads((root/'camera-checks.json').read_text(encoding='utf-8'))
latest={(c['phase'],c['key']):c for c in checks}
image_checks=[]
for k in names:
    a,b=[Image.open(root/p/(k+'.png')).convert('RGB') for p in ['before','after']]
    assert a.size==b.size==(1920,889)
    ca,cb=[latest[(p,k)] for p in ['before','after']]
    assert all(ca[x]==cb[x] for x in ['camera','lens','mode','size'])
    difference=ImageStat.Stat(ImageChops.difference(a.crop((320,150,1920,849)),b.crop((320,150,1920,849)))).mean
    assert max(difference)>.05
    image_checks.append(dict(key=k,dimensions=list(a.size),matched_camera=True,mean_absolute_rgb_difference=difference))
(root/'image-checks.json').write_text(json.dumps(image_checks,indent=2),encoding='utf-8')
(root/'camera-checks-final.json').write_text(json.dumps([latest[(p,k)] for k in names for p in ['before','after']],ensure_ascii=False,indent=2),encoding='utf-8')
options=''.join(f'<option value="{k}">{name}</option>' for k,name in names.items())
gallery=''.join(f'<a href="after/{k}.png"><img loading="lazy" src="after/{k}.png" alt="{name}">{name}</a>' for k,name in names.items())
original=''.join(f'<a href="original/{k}.png"><img loading="lazy" src="original/{k}.png" alt="{name}">{name}</a>' for k,name in [('01-overview-on','原版 · 远景窗户开'),('02-overview-off','原版 · 同机位远景窗户关'),('03-wide-on','原版 · 广角远景'),('04-close-on','原版 · 较近街道俯视')])
page='''<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>远处的建筑，也保留性格 · v0.4.2</title><style>
*{box-sizing:border-box}body{margin:0;background:#f3f1eb;color:#28483c;font:16px/1.75 system-ui,"Microsoft YaHei",sans-serif}main{max-width:1500px;margin:auto;padding:34px}h1{font-size:40px;margin:12px 0}h2{font-size:23px;margin-top:35px}.muted{color:#738176;font-size:14px}.lead{font-size:20px;max-width:1100px}.cards{display:flex;gap:15px;margin:24px 0}.card{flex:1;background:white;padding:19px;border-radius:10px;border:1px solid #dbe1d5}.card b{display:block;font-size:27px}.toolbar{display:flex;flex-wrap:wrap;align-items:center;gap:18px;background:#dfe7db;padding:14px;border-radius:10px 10px 0 0}button,select{padding:8px;font:inherit;color:inherit;background:white;border:1px solid #b3c4b1;border-radius:5px}a{color:#2b7058}.wipe{position:relative;aspect-ratio:1920/889;overflow:hidden;--cut:50%}.wipe img{position:absolute;width:100%;height:100%;inset:0}.old{clip-path:inset(0 calc(100% - var(--cut)) 0 0)}.divider{position:absolute;left:var(--cut);top:0;bottom:0;border-left:2px solid #bb8657}.label{position:absolute;top:10px;background:#28493de8;color:white;padding:3px 10px;border-radius:4px;font-size:13px}.left{left:10px}.right{right:10px}input{width:100%;accent-color:#ab784b}.links{display:flex;gap:22px;flex-wrap:wrap}.gallery{display:grid;grid-template-columns:1fr 1fr;gap:16px}.gallery img{width:100%;border:1px solid #d6dfd4}.note{padding:17px 22px;border-left:3px solid #b58953;background:#eae6db}table{border-collapse:collapse;width:100%;background:white}th,td{padding:12px;text-align:left;border-bottom:1px solid #d9e1d3;vertical-align:top}th{background:#e1e8db}footer{margin-top:36px;color:#738176;font-size:13px}@media(max-width:750px){main{padding:18px 12px}h1{font-size:29px}.cards{display:block}.card{margin-bottom:10px}.gallery{grid-template-columns:1fr}}</style>
<main><div class="muted">BEIJING CITY INK / DISTANT FACADES / 2026.10.30</div><h1>远处的建筑，也保留自己的性格。</h1><p class="lead">v0.4.1 → v0.4.2：细窗、宽尺度窗带与材质明暗分开处理。拉远时，楼栋逐渐简化，而不是一起变成相同网点。改动属于通用渲染和放样能力。</p>
<div class="cards"><div class="card"><b>6组</b>同相机、同参数的新旧证据</div><div class="card"><b>70 / 70</b>测试通过，生产构建通过</div><div class="card"><b>现有6遍</b>复用光照通道，无新增几何或场景遍次</div></div>
<div class="toolbar"><label>视角 <select id="view">__OPTIONS__</select></label><button id="solo">单看新版</button><a id="live" href="__LIVE__" target="_blank" rel="noopener">打开这个3D机位 ↗</a></div>
<div id="wipe" class="wipe"><img id="new" src="after/03-mid-ink.png" alt="v0.4.2"><img id="old" class="old" src="before/03-mid-ink.png" alt="v0.4.1"><div class="divider"></div><span class="label left">v0.4.1 优化前</span><span class="label right">v0.4.2 优化后</span></div><input id="slider" type="range" min="0" max="100" value="50" aria-label="新旧分界">
<div class="links"><a id="oldLink" href="before/03-mid-ink.png">完整旧版</a><a id="newLink" href="after/03-mid-ink.png">完整新版</a><a href="camera-checks-final.json">相机记录</a><a href="image-checks.json">画幅与配准检查</a><a href="../distance-facade-validation.md">独立图审与评分</a></div>
<p class="muted">本地新旧均为1920×889截图，机位、FOV、种子、光照一致。原版仅作视觉机制参考，未与本地精确配准。主视图可切换，中间滑杆可拖动。</p>
<h2>为什么原来会“一楼一纹”变成“所有楼一个纹”</h2><p>旧版在细窗缩小时将整份立面墨色一起淡掉，后处理又做一次阈值过滤。彩色画面仍保留平均玻璃覆盖，漫画却只剩中性光照与网点。同朝向的不同材质最终被画成相近灰面。</p>
<table><tr><th>需求</th><th>引擎改动</th><th>验收范围</th></tr><tr><td>远楼保留身份</td><td>独立传递细节墨线与平均玻璃灰度。白墙、玻璃、反射与稳定的建筑变体继续影响远景。</td><td>中景、天际线与极远景；很小的体块只保留明暗，不承诺单窗可见。</td></tr><tr><td>横带与竖向组带</td><td>横纵轴各自过滤；宽材质组带共享同一布局，并在接近网点单元大小时连续退回平均材质。</td><td>保留方向节奏，减轻细窗与屏幕网点叠加。不是实测立面。</td></tr><tr><td>曲面竖纹连续</td><td>放样各层共享参考周长，避免收腰/外扩时重新计算窗格数量造成纹理扭转。</td><td>通用放样单元测试验证相邻层UV完全接合；现有中国尊模型作为实际实例。</td></tr><tr><td>交互与兼容</td><td>窗户开关、材质参数与网点大小共用实时状态，重估种子后重新关联。</td><td>漫画、线稿、彩色、白模和PNG导出；保留OSM来源标注。</td></tr></table>
<h2>独立人工评分</h2><p>只评价本次立面专项；不是实景还原率，也不重算历史总分。完整依据见<a href="../distance-facade-validation.md">独立验收</a>。</p><table><tr><th>维度</th><th>v0.4.1</th><th>v0.4.2</th></tr><tr><td>拉远后的立面类型辨识</td><td>2 / 10</td><td>7.5 / 10</td></tr><tr><td>细窗消失后的大节奏</td><td>2 / 10</td><td>7.5 / 10</td></tr><tr><td>玻璃与实体墙明暗层次</td><td>3 / 10</td><td>7 / 10</td></tr><tr><td>细碎纹理的克制程度</td><td>7.5 / 10</td><td>6.5 / 10</td></tr><tr><td>近景窗格与窗框可读性</td><td>8 / 10</td><td>8 / 10</td></tr></table><p class="muted">旧版虽丢失类型但更安静，因此噪声项明确扣分；增加细节不等于每一项都变好。</p><h2>原版的直接证据</h2><p>本轮重新访问<a href="https://tools.oyasumi-gamedev.com/rokehan/#ll=39.909500%2C116.460500&s=1000&far=2&n=Beijing+CBD">原版北京国贸</a>。它的 <b>Distant windows</b> 开关说明为保留远处小玻璃矩形。下列前两张是同机位开关实验：关掉后，远楼的窗格和材质差异显著减弱。这个观察支持分层处理，但不能证明其内部采用了我们的着色算法。</p><div class="gallery">__ORIGINAL__</div>
<h2>还有差距</h2><p class="note">部分中远景板楼仍有颗粒感，原版整面明暗、留白与建筑类型变化更丰富。极远小体块只能分辨深浅。当前为固定机位静态验收，不能据此宣称连续运动完全无闪烁；没有GPU帧率基准。原有几何不增量，但着色计算仍有成本。新增窗带、玻璃亮区都是程序化示意，没有读取卫星图或街景。</p>
<h2>交互回归</h2><p>线稿、白模、关闭窗户、重估种子后重新开启窗户均留图；PNG已实际下载并检查，尺寸2400×1211，包含OSM标注。<a href="checks/06-export-2400.png">查看导出图片</a> · <a href="ui-checks.json">浏览器状态与错误检查</a>。这不等于所有DPR或动态运动已验收。</p><h2>完整截图</h2><div class="gallery">__GALLERY__</div><footer>地图：© OpenStreetMap contributors · ODbL。原版界面截图仅用于本地比较研究。<a href="manifest.json">截图SHA-256清单</a> · <a href="tests.txt">测试记录</a> · <a href="build.txt">构建记录</a></footer></main>
<script>const links=__LINKS__,view=document.querySelector('#view'),slider=document.querySelector('#slider'),wipe=document.querySelector('#wipe');function move(){wipe.style.setProperty('--cut',slider.value+'%');document.querySelector('.left').hidden=slider.value==='0';document.querySelector('.right').hidden=slider.value==='100';document.querySelector('#solo').textContent=slider.value==='0'?'返回前后对照':'单看新版';}view.onchange=()=>{for(const [id,folder]of [['old','before'],['new','after']]){document.querySelector('#'+id).src=folder+'/'+view.value+'.png';document.querySelector('#'+id+'Link').href=folder+'/'+view.value+'.png';}document.querySelector('#live').href=links[view.value];};slider.oninput=move;document.querySelector('#solo').onclick=()=>{slider.value=slider.value==='0'?50:0;move();};</script></html>'''
page=page.replace('__OPTIONS__',options).replace('__LIVE__',html.escape(links['03-mid-ink'])).replace('__GALLERY__',gallery).replace('__ORIGINAL__',original).replace('__LINKS__',json.dumps(links))
(root/'report.html').write_text(page,encoding='utf-8')
font=ImageFont.truetype('C:/Windows/Fonts/msyh.ttc',23)
rows=[]
for key,rect,label in [('03-mid-ink',(500,190,1700,800),'中远景：细窗退场后，保留材质与宽组带'),('02-skyline-ink',(400,220,1600,670),'天际线：横向窗带与连续竖向立面')]:
    imgs=[Image.open(root/p/(key+'.png')).crop(rect) for p in ['before','after']]
    h=round(imgs[0].height/imgs[0].width*760)
    row=Image.new('RGB',(1540,h+50),'#f3f1eb');draw=ImageDraw.Draw(row)
    draw.text((10,8),label+'　|　左：旧版　右：新版',font=font,fill='#28483c')
    for i,im in enumerate(imgs):row.paste(im.resize((760,h),Image.Resampling.LANCZOS),(i*780,50))
    rows.append(row)
preview=Image.new('RGB',(1540,sum(r.height for r in rows)+12),'#f3f1eb');y=0
for row in rows:preview.paste(row,(0,y));y+=row.height+12
preview.save(root/'comparison.jpg',quality=94)
manifest=[dict(path=p.relative_to(root).as_posix(),bytes=p.stat().st_size,sha256=hashlib.sha256(p.read_bytes()).hexdigest()) for p in sorted(root.glob('*/*.png'))]
(root/'manifest.json').write_text(json.dumps(manifest,indent=2),encoding='utf-8')
print('Built six-camera report, image checks and screenshot hashes.')
