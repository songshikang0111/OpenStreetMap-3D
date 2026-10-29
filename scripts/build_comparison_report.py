"""Build an offline evidence report. Scores are never inferred from screenshots.

Usage:
  python scripts/build_comparison_report.py
  python scripts/build_comparison_report.py --scores PATH --output PATH/report.html

Images remain relative files beside the report, so share the comparison/ directory.
The score schema and audit rules are documented in docs/comparison-report.md.
"""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path


DEFAULT_OUTPUT = Path(r"C:\Users\宋世康\Documents\Codex\2026-10-29\https-tools-oyasumi-gamedev-com-rokehan\outputs\comparison\report.html")
PROJECT = Path(__file__).resolve().parents[1]

REQUIREMENTS = [
    {"id": "R1", "weight": 20, "title": "地标轮廓", "criterion": "中国尊收腰扩顶、央视倾斜双塔与连接体；保持 OSM 定位与总高。", "views": ["07", "08", "02"]},
    {"id": "R2", "weight": 20, "title": "立面家族", "criterion": "幕墙、住宅、商业/低层有不同开间与楼层节奏；刷新结果稳定。", "views": ["09", "04", "05"]},
    {"id": "R3", "weight": 10, "title": "建筑实体细节", "criterion": "近看有窗框、女儿墙和屋顶设备深度；设备避开庭院并控制几何成本。", "views": ["10", "09", "06"]},
    {"id": "R4", "weight": 15, "title": "街道尺度", "criterion": "树与人避开建筑和行车道；道路设施有来源区分，支持关闭。", "views": ["11", "03", "04"]},
    {"id": "R5", "weight": 10, "title": "植被形态", "criterion": "至少两种树形、枝干与近处团簇；漫画叶冠抑制内部碎线。", "views": ["03", "04", "11"]},
    {"id": "R6", "weight": 20, "title": "漫画层次", "criterion": "留白、网点、实黑有层次；外形与内部线分级，远景降噪，参数有效。", "views": ["01", "02", "03", "09"]},
    {"id": "R7", "weight": 5, "title": "可复现与数据诚实", "criterion": "机位与参数可重现；真实轮廓/高度与推测细节明确区分。", "views": ["01", "06"]},
]

VIEWS = [
    ("01", "街区俯瞰", "整体体块与空间密度", "01-overview-ink.jpg", "同时检查楼栋轮廓、树阵和远景线条；不要拿建筑数量差直接算还原率。"),
    ("02", "天际线", "地标轮廓与距离层次", "02-wide-ink.jpg", "原版使用广域机位作参考；检查曲面/退台是否改善辨识度，不能视为同外参配准。"),
    ("03", "街道人眼 · 漫画", "树冠、立面与地面留白", "04-street-eye-ink.jpg", "观察上方树冠是否遮挡过多，窗框是否糊成黑墙，路面是否保留亮部。"),
    ("04", "街道人眼 · 彩色", "区分几何与后处理贡献", "05-street-eye-color.jpg", "彩色模式用于判断窗框、枝叶、路缘是真几何还是漫画描边效果。"),
    ("05", "街区俯瞰 · 彩色", "材质家族与建筑分部", "09-overview-color.jpg", "看材质差异和地标形体；色彩变化不应掩盖定位或楼高错误。"),
    ("06", "正上方", "轮廓、道路和补植分布", "08-top-ink.jpg", "检查补树是否沿路与绿地、庭院是否被设备填满、道路接缝是否过重。"),
    ("07", "中国尊", "收腰、圆角与顶部扩展", "10-landmark-wide-20mm.jpg", "原版是地标广角参考，非独立近景外参；重点检查轮廓机制，不宣称测绘级还原。"),
    ("08", "央视总部", "双塔倾斜与空中连接", "10-landmark-wide-20mm.jpg", "对照空洞与连接关系；地标近似模型的参数来源必须另行说明。"),
    ("09", "立面近景", "开间、分层和首层入口", "05-street-eye-color.jpg", "原版采用街道彩色参考；本地版本之间使用匹配近景来衡量具体改动。"),
    ("10", "屋顶细节", "女儿墙、设备与退台", "03-street-high-ink.jpg", "原版仅有中高俯视参考；屋顶需求主要用本地匹配机位检查几何与放置规则。"),
    ("11", "道路交叉口", "标线、信号与人的尺度", "07-crossing-ink.jpg", "查看斑马线与实际道路的关系；规则补充的灯、车、人不能标成实测对象。"),
]


def image_record(path: Path | None, directory: Path):
    if path is None or not path.exists():
        return None
    content = path.read_bytes()
    return {"src": path.relative_to(directory).as_posix(), "bytes": len(content), "sha256": hashlib.sha256(content).hexdigest()}


def find_image(folder: Path, prefix: str, preferred: str | None = None):
    if preferred and (folder / preferred).is_file():
        return folder / preferred
    files = sorted(p for p in folder.glob(f"{prefix}*") if p.suffix.lower() in {".jpg", ".jpeg", ".png", ".webp"})
    return files[0] if files else None


def load_scores(path: Path):
    if not path.is_file():
        return {"status": "draft", "scores": [], "checks": [], "commits": []}
    data = json.loads(path.read_text(encoding="utf-8-sig"))
    if not isinstance(data, dict):
        raise ValueError("scores.json 必须是 JSON 对象")
    rows = data.get("scores", [])
    if isinstance(rows, dict):
        rows = [dict(value, id=key) for key, value in rows.items()]
    allowed = {r["id"] for r in REQUIREMENTS}
    seen = set()
    for row in rows:
        if row.get("id") not in allowed or row["id"] in seen:
            raise ValueError(f"未知或重复需求 ID: {row.get('id')}")
        seen.add(row["id"])
        for key in ("before", "after"):
            value = row.get(key)
            if value is not None and (isinstance(value, bool) or not isinstance(value, (int, float)) or not 0 <= value <= 10):
                raise ValueError(f"{row['id']}.{key} 必须为空或 0–10 的数值")
    data["scores"] = rows
    return data


def build_data(output: Path, scores_path: Path):
    directory = output.parent
    scores = load_scores(scores_path)
    views = []
    for key, title, subtitle, original, note in VIEWS:
        after_path = find_image(directory / "after", key)
        preferred = after_path.name if after_path else None
        matched_path = find_image(directory / "matched-before", key, preferred)
        before_path = matched_path or find_image(directory / "before", key)
        views.append({"id": key, "title": title, "subtitle": subtitle, "note": note,
                      "original": image_record(directory / "original" / original, directory),
                      "before": image_record(before_path, directory), "after": image_record(after_path, directory),
                      "matched": matched_path is not None})
    archive = [image_record(p, directory) for p in sorted((directory / "original").glob("*")) if p.suffix.lower() in {".jpg", ".png", ".jpeg", ".webp"}]
    requirement_file = PROJECT / "docs" / "comparison-requirements.md"
    return {"generated": datetime.now(timezone.utc).isoformat(timespec="seconds"), "date": "2026-10-29", "views": views,
            "requirements": REQUIREMENTS, "review": scores, "originalArchive": archive,
            "requirementsSha256": hashlib.sha256(requirement_file.read_bytes()).hexdigest(),
            "scoreFile": scores_path.name if scores_path.exists() else None,
            "originalUrl": "https://tools.oyasumi-gamedev.com/rokehan/#ll=39.909500%2C116.460500&s=1000&far=2&n=Beijing+CBD"}


HTML = r'''<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>北京国贸 · 原版对照与改进验收</title>
<style>
:root{--paper:#f5f2e9;--card:#fffdf7;--ink:#203a34;--muted:#6e7970;--line:#d9ddd1;--green:#315e50;--mint:#e4ecdf;--amber:#a36532;--cream:#f4e9d5;--radius:15px}*{box-sizing:border-box}html{scroll-behavior:smooth}body{margin:0;background:var(--paper);color:var(--ink);font:15px/1.7 system-ui,-apple-system,"Microsoft YaHei",sans-serif}a{color:var(--green);text-underline-offset:3px}button,select{font:inherit}button{cursor:pointer}button:focus-visible,a:focus-visible,select:focus-visible{outline:3px solid #c79564;outline-offset:3px}.shell{width:min(1500px,94vw);margin:auto}header{border-bottom:1px solid var(--line);background:#f9f7f0;position:sticky;top:0;z-index:5}header .shell{height:65px;display:flex;align-items:center;justify-content:space-between;gap:20px}.brand{display:flex;align-items:center;gap:13px;font-weight:700;letter-spacing:1px}.seal{display:grid;place-items:center;background:var(--green);color:white;width:35px;height:35px;border-radius:8px;font:22px Georgia,serif}.nav{display:flex;gap:24px;font-size:13px}.nav a{text-decoration:none;color:var(--muted)}.hero{padding:56px 0 30px;display:grid;grid-template-columns:1.35fr 1fr;gap:44px;align-items:end}.eyebrow{font:11px/1.5 ui-monospace,monospace;letter-spacing:2.5px;color:var(--muted)}h1{font-size:clamp(30px,3.2vw,49px);line-height:1.25;letter-spacing:-1.6px;margin:15px 0 18px;font-weight:650}h2{font-size:25px;line-height:1.35;margin:0}h3{font-size:17px;margin:0 0 9px}.lead{font-size:16px;max-width:780px;color:#516057;margin:0}.hero-side{border-left:1px solid var(--line);padding-left:28px}.status{display:inline-flex;align-items:center;gap:8px;background:var(--cream);color:#8d5b30;border-radius:30px;font-size:12px;padding:5px 12px}.status::before{content:"";width:6px;height:6px;border-radius:50%;background:currentColor}.status.reviewed{background:var(--mint);color:var(--green)}.hero-side p{font-size:13px;color:var(--muted);margin:15px 0 0}.coordinate{font:12px/1.8 ui-monospace,monospace;margin-top:18px}.facts{display:grid;grid-template-columns:repeat(3,1fr);gap:13px;margin:10px 0 36px}.fact{border:1px solid var(--line);background:var(--card);padding:21px 23px;border-radius:var(--radius)}.fact .num{font-size:29px;font-weight:600;letter-spacing:-1px}.fact small{color:var(--muted);display:block;font-size:12px;margin-top:4px}.fact p{font-size:13px;margin:8px 0 0}.section{margin:42px 0;scroll-margin-top:90px}.section-head{display:flex;align-items:end;justify-content:space-between;gap:22px;margin:0 0 20px}.section-head p{color:var(--muted);font-size:13px;max-width:650px;margin:7px 0 0}.label{font:11px ui-monospace,monospace;letter-spacing:2px;color:var(--muted);margin-bottom:9px}.boundary{display:flex;gap:13px;border-left:3px solid #bd9668;background:#f1e9da;padding:15px 20px;font-size:13px;border-radius:0 9px 9px 0}.boundary strong{white-space:nowrap}.gallery{border:1px solid var(--line);border-radius:var(--radius);overflow:hidden;background:var(--card)}.gallery-top{padding:15px 18px;border-bottom:1px solid var(--line);display:flex;gap:20px;justify-content:space-between;align-items:center;flex-wrap:wrap}.view-select{display:flex;align-items:center;gap:12px}.view-select label{font-size:12px;color:var(--muted)}select{border:1px solid var(--line);padding:8px 36px 8px 12px;border-radius:8px;background:var(--card);color:var(--ink);max-width:100%}.versions{display:flex;gap:4px;padding:4px;background:#edf0e8;border-radius:9px}.versions button{border:0;color:var(--muted);background:transparent;border-radius:6px;padding:7px 12px;font-size:12px;white-space:nowrap}.versions button.active{background:var(--green);color:white}.versions button:disabled{opacity:.45;cursor:default}.frame-header{display:flex;justify-content:space-between;align-items:center;padding:13px 20px;font-size:12px;background:#fbfaf4;border-bottom:1px solid var(--line)}.frame-header strong{font-size:14px}.frame-header span{color:var(--muted)}.screen{background:#e9ece3;min-height:310px;display:grid;place-items:center;position:relative}.screen img{width:100%;height:auto;display:block}.screen .missing{text-align:center;padding:95px 25px;max-width:600px;color:var(--muted)}.missing strong{display:block;font-size:18px;color:var(--ink);margin-bottom:8px}.screen-grid{display:grid;grid-template-columns:1fr 1fr}.screen-grid figure{margin:0;min-width:0;background:#eef0e8}.screen-grid figure+figure{border-left:1px solid var(--line)}.screen-grid figcaption{padding:10px 17px;font-size:12px;color:var(--muted)}.gallery-note{padding:15px 20px;border-top:1px solid var(--line);font-size:13px;color:var(--muted);display:grid;grid-template-columns:1fr auto;gap:20px}.gallery-note a{font-size:12px}.view-grid{padding:16px;display:grid;grid-template-columns:repeat(6,1fr);gap:8px;border-top:1px solid var(--line)}.view-grid button{text-align:left;padding:11px;border:1px solid transparent;background:#f2f3ec;border-radius:8px;color:var(--muted);font-size:12px;line-height:1.4;min-height:62px}.view-grid button.active{border-color:var(--green);background:#e7eee2;color:var(--green)}.view-grid button b{display:block;font:10px ui-monospace,monospace;letter-spacing:1px;margin-bottom:5px}.score-wrap{overflow-x:auto;border:1px solid var(--line);border-radius:var(--radius);background:var(--card)}table{border-collapse:collapse;width:100%;font-size:13px}thead{background:#e9eee3;text-align:left}th{font-size:12px;color:#5f7063;font-weight:600;padding:14px 16px;white-space:nowrap}td{padding:17px 16px;border-top:1px solid var(--line);vertical-align:top}td.id{font-family:ui-monospace,monospace;color:var(--muted);width:60px}td.requirement{min-width:250px;width:27%}.criterion{color:var(--muted);font-size:12px;margin-top:5px}.score{font:25px/1.2 ui-monospace,monospace;white-space:nowrap}.score small{font:11px system-ui;color:var(--muted)}.bar{width:75px;height:4px;background:#e8eade;border-radius:6px;margin-top:9px;overflow:hidden}.bar i{display:block;height:100%;background:#a4b39a}.after .bar i{background:var(--green)}.score.pending{font:12px system-ui;color:var(--muted);padding-top:5px}.assessment{min-width:300px}.assessment p{margin:0 0 5px}.assessment .remaining{color:var(--muted);font-size:12px}.evidence-link{border:0;background:transparent;color:var(--green);text-decoration:underline;padding:0;font-size:12px}.total{display:flex;justify-content:space-between;align-items:center;gap:22px;background:#e2eadc;border:1px solid #c9d6c2;border-radius:var(--radius);padding:20px 24px;margin-top:15px}.total p{font-size:12px;margin:5px 0 0;color:#5f715f}.total-number{font:32px ui-monospace,monospace;white-space:nowrap}.total-number small{font:12px system-ui;color:var(--muted)}.rubric{font-size:12px;color:var(--muted);margin-top:14px}.mechanisms{display:grid;grid-template-columns:repeat(2,1fr);gap:15px}.mechanism{background:var(--card);border:1px solid var(--line);border-radius:var(--radius);padding:25px}.badge{display:inline-block;background:var(--mint);color:var(--green);padding:3px 8px;border-radius:5px;font-size:10px;margin-bottom:12px}.badge.limit{background:var(--cream);color:var(--amber)}.mechanism p{font-size:13px;color:#617064;margin:0}.mechanism .source{display:block;margin-top:13px;font-size:11px;color:var(--muted)}.pipeline{display:flex;gap:9px;flex-wrap:wrap;padding:24px 0 0;align-items:center}.pipeline span{background:#e7ece1;border:1px solid #d3ddcb;border-radius:7px;padding:8px 13px;font-size:12px}.pipeline b{color:#8d9b8b;font-weight:400}.audit{display:grid;grid-template-columns:1fr 1fr;gap:16px}.audit-card{border:1px solid var(--line);border-radius:var(--radius);padding:24px;background:var(--card)}.audit ul{list-style:none;margin:0;padding:0}.audit li{padding:10px 0;border-bottom:1px solid #e7eadd;font-size:13px}.audit li:last-child{border:0}.audit li small{display:block;color:var(--muted);font-size:12px}.pill{display:inline-block;padding:2px 7px;font-size:10px;line-height:1.5;border-radius:4px;margin-right:9px;background:#e7eee2;color:var(--green)}.pill.pending{background:var(--cream);color:var(--amber)}.muted{color:var(--muted);font-size:13px}.limitations{background:#273f37;color:#f0f2e7;padding:28px;border-radius:var(--radius);display:grid;grid-template-columns:1fr 2fr;gap:25px}.limitations h3{font-size:19px}.limitations p{margin:0;color:#c3d0bf;font-size:13px}.limits-list{display:grid;grid-template-columns:1fr 1fr;gap:20px}.limits-list b{display:block;font-size:13px;margin-bottom:5px}.original-strip{display:grid;grid-template-columns:repeat(5,1fr);gap:10px}.original-strip a{display:block;border:1px solid var(--line);border-radius:8px;overflow:hidden;text-decoration:none;background:var(--card);color:var(--muted);font-size:10px}.original-strip img{width:100%;display:block}.original-strip span{display:block;padding:7px 9px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}details{border:1px solid var(--line);border-radius:10px;margin:15px 0;padding:13px 17px;font-size:12px;background:#faf9f3}summary{cursor:pointer;color:var(--muted)}pre{white-space:pre-wrap;word-break:break-word;font:11px/1.7 ui-monospace,monospace;background:#edf0e7;padding:15px;border-radius:6px;max-height:350px;overflow:auto}.footer{border-top:1px solid var(--line);padding:25px 0 36px;color:var(--muted);font-size:11px;display:flex;justify-content:space-between;gap:25px}.footer a{color:var(--muted)}@media(max-width:1000px){.hero{grid-template-columns:1fr;gap:25px;padding-top:35px}.hero-side{border-left:0;border-top:1px solid var(--line);padding:20px 0 0}.view-grid{grid-template-columns:repeat(4,1fr)}.original-strip{grid-template-columns:repeat(3,1fr)}.limits-list{grid-template-columns:1fr}}@media(max-width:680px){body{font-size:14px}.nav{gap:13px}.nav a:last-child{display:none}.facts,.mechanisms,.audit,.limitations{grid-template-columns:1fr}.hero{padding-top:28px}.facts{gap:8px}.fact{padding:15px 19px}.section{margin:30px 0}.section-head{display:block}.view-grid{grid-template-columns:repeat(3,1fr)}.gallery-top{padding:12px;gap:12px}.versions{width:100%;justify-content:space-between}.versions button{padding:7px 9px}.frame-header{display:block}.frame-header span{display:block;margin-top:4px}.screen-grid{grid-template-columns:1fr}.screen-grid figure+figure{border-left:0;border-top:1px solid var(--line)}.gallery-note{grid-template-columns:1fr;gap:6px}.boundary{display:block}.boundary strong{display:block;margin-bottom:5px}.original-strip{grid-template-columns:repeat(2,1fr)}.footer{display:block}.total{align-items:start}.total-number{font-size:23px}}@media print{header{position:static}.versions,.view-select,.view-grid,.nav{display:none}.shell{width:100%}.section{break-inside:avoid}.screen img{max-height:440px;object-fit:contain}.original-strip{grid-template-columns:repeat(3,1fr)}body{background:white}.hero{padding-top:18px}a{color:inherit}.score-wrap{overflow:visible}th,td{padding:9px;font-size:11px}.assessment{min-width:0}}
</style></head><body>
<header><div class="shell"><div class="brand"><span class="seal">京</span>国贸对照实验</div><nav class="nav"><a href="#evidence">截图证据</a><a href="#acceptance">需求评分</a><a href="#mechanism">生成机制</a><a href="#audit">验证记录</a></nav></div></header>
<main class="shell">
<section class="hero"><div><div class="eyebrow">BEIJING CITY INK · COMPARATIVE REVIEW</div><h1>北京国贸<br>原版对照与改进验收</h1><p class="lead">先用同区域、多角度证据解释“为什么像方块”，再按形体、立面、街道与漫画层次逐项改进。让实现结果与仍然存在的差距一起可见。</p></div><aside class="hero-side"><span class="status" id="review-status">待截图验收</span><p id="review-summary">报告框架已生成。评分需由人工完成截图验收后填写；文件存在不等于需求通过。</p><div class="coordinate">39.90950° N / 116.46050° E<br>WGS84 · 北京国贸 CBD · 2026-10-29</div></aside></section>
<div class="facts"><div class="fact"><div class="num" id="evidence-count">—</div><small>截图文件 · 原版 / 基线 / 改进版</small><p>固定证据保留完整界面，支持打开原图核对。</p></div><div class="fact"><div class="num">7 <span style="font-size:14px;font-weight:400">项需求</span></div><small>独立打分 · 权重合计 100</small><p>评价视觉机制接近度，不评价测绘精度。</p></div><div class="fact"><div class="num">3 <span style="font-size:14px;font-weight:400">层来源</span></div><small>地图事实 / 程序补充 / 渲染表达</small><p>真实位置和轮廓，不等于真实门窗与设施。</p></div></div>
<div class="boundary"><strong>比较边界</strong><span>原版近区 1 km、远景 2 km；本地固定数据约 2.0 × 1.8 km。原版是同区域、同类机位参考，未取得相机外参，不能进行像素配准。只有标记为“匹配机位”的本地 v0.1 / v0.2 截图用于严格版本对照。</span></div>

<section class="section" id="evidence"><div class="section-head"><div><div class="label">01 / EVIDENCE</div><h2>从总览到一扇窗</h2><p>切换机位，再切换版本。原版参考与本地对照始终保留各自的比较条件。</p></div><a id="original-url" href="#" target="_blank" rel="noopener">打开原版同区域 ↗</a></div><div class="gallery"><div class="gallery-top"><div class="view-select"><label for="view-select">观察机位</label><select id="view-select"></select></div><div class="versions" role="group" aria-label="证据版本"><button data-version="original">原版参考</button><button data-version="before">v0.1 基线</button><button data-version="after" class="active">v0.2 改进</button><button data-version="pair">本地并排</button></div></div><div class="frame-header"><strong id="frame-title"></strong><span id="frame-meta"></span></div><div id="screen"></div><div class="gallery-note"><span id="view-note"></span><span id="file-link"></span></div><div class="view-grid" id="view-grid"></div></div></section>

<section class="section" id="acceptance"><div class="section-head"><div><div class="label">02 / ACCEPTANCE</div><h2>实现了什么，距离原版还有多远</h2><p>每项需要对应截图、实现结果与剩余差距。未完成人工验收的项目保持空白，不自动打分。</p></div><span class="muted" id="reviewed-at"></span></div><div class="score-wrap"><table><thead><tr><th>ID</th><th>需求与验收标准</th><th>权重</th><th>v0.1</th><th>v0.2</th><th>验收证据与剩余差距</th></tr></thead><tbody id="score-body"></tbody></table></div><div class="total"><div><strong>加权工程评分</strong><p>Σ（单项评分 ÷ 10 × 权重）。这是人工量表，不是图像相似度百分比。</p></div><div class="total-number" id="total">待验收 <small>/ 100</small></div></div><p class="rubric">评分锚点：0 缺失 · 3 基本占位 · 5 功能成立但差异大 · 7 主要形态与层次接近 · 9 多数样本接近 · 10 此次样本无明显差异。完成代码或通过自动测试不直接等于高视觉评分。</p></section>

<section class="section" id="mechanism"><div class="section-head"><div><div class="label">03 / FINDINGS</div><h2>原版为什么更有建筑感</h2><p>结论来自作者说明、公开客户端机制和截图观察；下面不把尚未证实的猜测当成事实。</p></div></div><div class="mechanisms"><article class="mechanism"><span class="badge">已证实 · 公开客户端</span><h3>地标拥有单独的形体规则</h3><p>中国尊和央视总部存在专门生成分支：高度变化的截面、偏移塔身和空中连接，并非所有楼都只做垂直挤出。这个差别首先体现在天际线轮廓。</p><span class="source">证据锚点：RKCN / citic / cctv；具体触发效果仍以截图为准。</span></article><article class="mechanism"><span class="badge">已证实 · 作者说明与客户端</span><h3>普通楼也有不同的建筑语法</h3><p>用途、楼高、地区和临街关系决定开间、窗型、阳台、首层与冠部；种子控制局部变化。近处升级为凹窗与阳台几何，远处简化为窗格和楼层线。</p><span class="source">本地目标：先恢复“首层—中段—顶部”的节奏，再增加细节数量。</span></article><article class="mechanism"><span class="badge">已证实 · 空间生成规则</span><h3>树木和街道设施包含推测补充</h3><p>树点、树行、道路人行道和绿地是不同的生成来源；树种与形态带地区规则。不是把所有绿地随机塞满，也不是每个细节都有真实地图记录。</p><span class="source">本地记录来源、净距与去重；车辆和行人作为规则生成的尺度参照。</span></article><article class="mechanism"><span class="badge">已证实 · 渲染管线</span><h3>漫画效果依赖分层表达</h3><p>法线、深度与物体编号提取边界；固有色、朝光面和落影控制网点。外轮廓、内部细线、叶冠和玻璃分别处理，才有留白、网点与实黑的层级。</p><span class="source">本地目标：减少远景碎线，保住近处结构，避免全场统一铺网点。</span></article><article class="mechanism"><span class="badge">已证实 · 俯视图绘制</span><h3>彩色俯视图是矢量场景预览</h3><p>原版小地图直接绘制道路、建筑、地面多边形和树。其颜色来自对象类型和显示规则，不是卫星照片贴图。</p><span class="source">证据锚点：RKMini 的 Canvas 绘制链。</span></article><article class="mechanism"><span class="badge limit">未发现证据 · 保留边界</span><h3>不能推断它依赖卫星照片重建</h3><p>已检查的输入为 OSM、远景矢量瓦片与高程数据，没有发现卫星 RGB 驱动几何恢复的链路。这不证明作者设计地标规则时从未人工参考建筑照片。</p><span class="source">同样，“程序化”不等于没有人工建筑知识，规则本身就是知识编码。</span></article></div><div class="pipeline"><span>OSM 轮廓与标签</span><b>→</b><span>语义 / 地区 / 地标规则</span><b>→</b><span>几何与 LOD</span><b>→</b><span>受约束的环境补充</span><b>→</b><span>分类漫画渲染</span></div></section>

<section class="section" id="audit"><div class="section-head"><div><div class="label">04 / AUDIT TRAIL</div><h2>验证与提交记录</h2><p>这里仅显示验收文件中明确记录的检查结果，不从文件名推断测试通过。</p></div></div><div class="audit"><article class="audit-card"><h3>检查记录</h3><ul id="checks"></ul></article><article class="audit-card"><h3>按需求提交</h3><ul id="commits"></ul></article></div><details><summary>原图清单与 SHA-256 校验</summary><pre id="manifest"></pre></details></section>

<section class="section limitations"><div><div class="label" style="color:#a8baa6">REMAINING LIMITS</div><h3>保留明确的差距</h3><p>本轮目标是解释并缩小可见差异，不能把一个局部原型说成完整复刻。</p></div><div class="limits-list"><div><b>真实细节仍有限</b><p>地标曲面属于独立程序近似；门窗、设备和补植未从实景恢复。</p></div><div><b>地图与机位不完全一致</b><p>OSM 快照、范围和分部计数不同；原版参考不是像素级 A/B。</p></div><div><b>系统范围仍有差距</b><p>完整 DEM、全球流式地图、夜景、全部地区规则与漫画特效不在本轮完成范围。</p></div><div><b>评分具有主观性</b><p>分数用于组织工程验收；原图、参数与剩余问题比单个总分更重要。</p></div></div></section>

<section class="section"><div class="section-head"><div><div class="label">05 / ORIGINAL ARCHIVE</div><h2>原版截图索引</h2><p>完整截图与原始参数快照保留在本地。研究证据不作为本项目的建模或贴图素材。</p></div><a href="original/ui-controls.json" target="_blank">查看参数快照 JSON ↗</a></div><div class="original-strip" id="original-strip"></div></section>
<footer class="footer"><span>© OpenStreetMap contributors · 地图数据 ODbL。原版界面/截图归原作者，用于比较研究。<br>本地实现独立编写，与 Location Scout 无隶属关系。</span><span><a href="https://oyasumi-gamedev.com/tools/rokehan/" target="_blank" rel="noopener">作者说明与实现笔记</a> · <a href="https://oyasumi-gamedev.com/tools/terms/" target="_blank" rel="noopener">原版条款</a><br><span id="generated"></span></span></footer>
</main>
<script id="report-data" type="application/json">__REPORT_DATA__</script>
<script>
const D=JSON.parse(document.getElementById('report-data').textContent),$=id=>document.getElementById(id);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let selected=D.views[0].id,version='after';const reviewed=['reviewed','final','accepted'].includes(D.review.status);
const fileList=new Map();for(const v of D.views)for(const k of ['original','before','after'])if(v[k])fileList.set(v[k].src,v[k]);for(const f of D.originalArchive)fileList.set(f.src,f);
$('evidence-count').textContent=fileList.size;$('original-url').href=D.originalUrl;
if(reviewed){$('review-status').textContent='已人工验收';$('review-status').classList.add('reviewed');$('review-summary').textContent=D.review.summary||'评分已由验收者填写。请结合具体截图、剩余差距与比较边界理解结果。';}
if(D.review.reviewed_at)$('reviewed-at').textContent='验收记录：'+D.review.reviewed_at;
$('view-select').innerHTML=D.views.map(v=>`<option value="${v.id}">${v.id} · ${esc(v.title)}</option>`).join('');
$('view-grid').innerHTML=D.views.map(v=>`<button data-view="${v.id}"><b>VIEW ${v.id}</b>${esc(v.title)}</button>`).join('');
function screen(v,k){const image=v[k];return image?`<div class="screen"><a href="${esc(image.src)}" target="_blank" title="打开完整原图"><img src="${esc(image.src)}" alt="${esc(v.title)} · ${k==='original'?'原版参考':k==='before'?'v0.1 基线':'v0.2 改进'}"></a></div>`:`<div class="screen"><div class="missing"><strong>该证据尚未归档</strong>${k==='after'?'等待最终截图，当前不会用迭代图片代替验收结果。':k==='before'?'该近景的基线截图尚未归档，不能据此声称完成严格前后对照。':'此机位尚无原版参考。'}</div></div>`;}
function renderGallery(){const v=D.views.find(x=>x.id===selected);$('view-select').value=selected;$('frame-title').textContent=v.title+' / '+v.subtitle;
  $('frame-meta').textContent=version==='original'?'原版 · 同区域参考，未配准外参':version==='pair'?(v.matched?'本地 v0.1 / v0.2 · 匹配机位':'本地版本并排 · 基线机位未配准'):version==='before'?(v.matched?'v0.1 · 匹配机位基线':'v0.1 · 历史截图，机位未配准'):'v0.2 · 改进版截图';
  $('screen').innerHTML=version==='pair'?`<div class="screen-grid"><figure>${screen(v,'before')}<figcaption>v0.1 · ${v.matched?'匹配机位基线':'历史截图未配准'}</figcaption></figure><figure>${screen(v,'after')}<figcaption>v0.2 · 改进版</figcaption></figure></div>`:screen(v,version);
  $('view-note').textContent=v.note;$('file-link').innerHTML=version==='pair'?['before','after'].filter(k=>v[k]).map(k=>`<a href="${esc(v[k].src)}" target="_blank">${k==='before'?'基线':'改进'}原图 ↗</a>`).join('　'):v[version]?`<a href="${esc(v[version].src)}" target="_blank">打开完整原图 ↗</a>`:'';
  document.querySelectorAll('[data-version]').forEach(b=>{b.classList.toggle('active',b.dataset.version===version);b.setAttribute('aria-pressed',b.dataset.version===version?'true':'false');});document.querySelectorAll('[data-view]').forEach(b=>{b.classList.toggle('active',b.dataset.view===selected);b.setAttribute('aria-pressed',b.dataset.view===selected?'true':'false');});}
$('view-select').addEventListener('change',e=>{selected=e.target.value;renderGallery();});document.querySelectorAll('[data-version]').forEach(b=>b.addEventListener('click',()=>{version=b.dataset.version;renderGallery();}));document.querySelectorAll('[data-view]').forEach(b=>b.addEventListener('click',()=>{selected=b.dataset.view;renderGallery();}));
function scoreCell(n,isAfter){return reviewed&&Number.isFinite(n)?`<div class="score">${n.toFixed(1)} <small>/ 10</small></div><div class="bar"><i style="width:${n*10}%"></i></div>`:'<div class="score pending">待验收</div>';}
const rows=new Map((D.review.scores||[]).map(r=>[r.id,r]));
$('score-body').innerHTML=D.requirements.map(r=>{const s=rows.get(r.id)||{};return `<tr><td class="id">${r.id}</td><td class="requirement"><strong>${esc(r.title)}</strong><div class="criterion">${esc(r.criterion)}</div></td><td>${r.weight}%</td><td>${scoreCell(s.before,false)}</td><td class="after">${scoreCell(s.after,true)}</td><td class="assessment"><p>${esc(s.result||'尚待人工截图验收。')}</p><p class="remaining">${esc(s.remaining||'剩余差距将在验收后记录。')}</p><button class="evidence-link" data-inspect="${r.views[0]}">查看相关机位 ${r.views.join(' / ')} ↗</button>${(s.evidence||[]).map(f=>` · <a class="evidence-link" href="${esc(f)}" target="_blank">证据原图</a>`).join('')}</td></tr>`;}).join('');
document.querySelectorAll('[data-inspect]').forEach(b=>b.addEventListener('click',()=>{selected=b.dataset.inspect;version='pair';renderGallery();$('evidence').scrollIntoView({behavior:'smooth'});}));
const complete=reviewed&&D.requirements.every(r=>Number.isFinite(rows.get(r.id)?.before)&&Number.isFinite(rows.get(r.id)?.after));
if(complete){const sum=k=>D.requirements.reduce((s,r)=>s+rows.get(r.id)[k]*r.weight/10,0);$('total').innerHTML=`${sum('before').toFixed(1)} <small>→</small> ${sum('after').toFixed(1)} <small>/ 100</small>`;}
else if(reviewed)$('total').innerHTML='部分待验收 <small>/ 100</small>';
const checks=D.review.checks||[];$('checks').innerHTML=checks.length?checks.map(c=>`<li><span class="pill ${c.status==='passed'?'':'pending'}">${esc(c.status==='passed'?'通过':c.status==='failed'?'未通过':'待验证')}</span>${esc(c.name)}<small>${esc(c.detail||'')}</small></li>`).join(''):'<li class="muted">尚未录入最终检查记录。</li>';
const commits=D.review.commits||[];$('commits').innerHTML=commits.length?commits.map(c=>`<li><code>${esc(c.hash||'')}</code>　${esc(c.requirement||c.title||'')}<small>${esc(c.detail||'')}</small></li>`).join(''):'<li class="muted">尚未录入需求提交记录。</li>';
$('original-strip').innerHTML=D.originalArchive.map(f=>`<a href="${esc(f.src)}" target="_blank"><img loading="lazy" src="${esc(f.src)}" alt="${esc(f.src)}"><span>${esc(f.src.split('/').pop())}</span></a>`).join('');
$('manifest').textContent=JSON.stringify({generated:D.generated,requirementsSha256:D.requirementsSha256,scoreFile:D.scoreFile,images:[...fileList.values()]},null,2);$('generated').textContent='报告生成：'+D.generated.replace('T',' ').replace('+00:00',' UTC');renderGallery();
</script></body></html>'''


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--scores", type=Path, default=None)
    args = parser.parse_args()
    output = args.output.resolve()
    output.parent.mkdir(parents=True, exist_ok=True)
    scores = args.scores or output.parent / "scores.json"
    data = build_data(output, scores)
    payload = json.dumps(data, ensure_ascii=False).replace("<", "\\u003c")
    output.write_text(HTML.replace("__REPORT_DATA__", payload), encoding="utf-8")
    (output.parent / "report-manifest.json").write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({"output": str(output), "status": data["review"].get("status", "draft"), "viewpoints": len(data["views"]), "after_images": sum(v["after"] is not None for v in data["views"]), "matched_baselines": sum(v["matched"] for v in data["views"])}, ensure_ascii=False))


if __name__ == "__main__":
    main()
