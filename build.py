"""把 src/ 底下的原始檔組成網站用的 index.html（單一檔案）。

用法（在 repo 根目錄）：
  python build.py            重新產生 index.html
  python build.py --check    只檢查 index.html 是不是由目前的 src/ 產生（GitHub 健檢會跑這個）
  python build.py --preview 路徑   另外輸出一份不含 <head> 外殼的預覽版（給 Claude 預覽用）

src/ 的組成順序：head.html → style.css → body.html → js-*.js（依檔名排序，全部放在同一個函式裡）。
JS 各檔共用同一個作用域，所以後面的檔可以直接用前面檔定義的東西；頂層 const 要在用到之前定義。"""
import pathlib, sys

ROOT = pathlib.Path(__file__).resolve().parent
SRC = ROOT / "src"
SITE_URL = "https://xiaozhouzhoufly.github.io/ranger-kichiku/"

HEAD = ('<!doctype html>\n<html lang="zh-Hant">\n<head>\n<meta charset="utf-8">\n'
        '<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">\n'
        '<meta name="robots" content="noindex, nofollow">\n'
        '<meta name="description" content="LR 角色動畫惡搞工坊：播放技能動作、剪成惡搞影片，或讓兩隻角色上場對打。打開網頁就能用。">\n'
        '<meta name="theme-color" content="#1b2038">\n'
        '<meta property="og:type" content="website">\n'
        '<meta property="og:site_name" content="Ranger 惡搞工坊">\n'
        '<meta property="og:title" content="Ranger 惡搞工坊">\n'
        '<meta property="og:description" content="LR 角色動畫惡搞剪輯・雙人對戰模擬。播放技能、剪成惡搞影片，或讓兩隻角色上場對打。">\n'
        f'<meta property="og:url" content="{SITE_URL}">\n'
        f'<meta property="og:image" content="{SITE_URL}assets/og.png">\n'
        '<meta property="og:image:width" content="1200">\n<meta property="og:image:height" content="630">\n'
        '<meta property="og:image:alt" content="Ranger 惡搞工坊：兩隻角色對戰的畫面">\n'
        '<meta name="twitter:card" content="summary_large_image">\n'
        '<link rel="manifest" href="assets/manifest.webmanifest">\n'
        '<link rel="icon" type="image/png" href="assets/icon-192.png">\n'
        '<link rel="apple-touch-icon" href="assets/icon-180.png">\n'
        '<meta name="apple-mobile-web-app-title" content="惡搞工坊">\n')


def read(name):
    return (SRC / name).read_text(encoding="utf-8")


def page_parts():
    js_files = sorted(p.name for p in SRC.glob("js-*.js"))
    if not js_files:
        raise SystemExit("src/ 裡找不到 js-*.js")
    js = "".join(read(n) for n in js_files)
    top = read("head.html") + "<style>\n" + read("style.css") + "</style>"
    rest = "\n" + read("body.html") + '<script>\n(() => {\n  "use strict";\n' + js + "})();\n</script>\n\n"
    return top, rest


def build_preview():
    top, rest = page_parts()
    return top + rest


def build_site():
    top, rest = page_parts()
    return (HEAD + top + '\n<style>:root{padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}'
            'body{margin:0}img{max-width:100%}</style>\n</head>\n<body>' + rest + '\n</body>\n</html>\n')


def main(argv):
    out = ROOT / "index.html"
    html = build_site()
    if "--check" in argv:
        cur = out.read_text(encoding="utf-8") if out.exists() else ""
        if cur != html:
            print("index.html 跟 src/ 不一致：請在電腦上跑 python build.py 後，把新的 index.html 一起上傳。")
            return 1
        print("index.html 與 src/ 一致")
        return 0
    out.write_text(html, encoding="utf-8")
    if "--preview" in argv:
        p = pathlib.Path(argv[argv.index("--preview") + 1])
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(build_preview(), encoding="utf-8")
    print("built")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
