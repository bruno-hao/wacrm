"""Simula orçamentos no modelo M Vision a partir de orçamentos reais do ssOtica.

Uso: python gerar_simulacao.py orc5.json
Gera simulacao/orcamento-<nº>.html + .pdf (Edge headless) e simulacao/orcamentos-simulados.pdf.
"""
import base64, html, json, os, re, subprocess, sys

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "simulacao")
os.makedirs(OUT, exist_ok=True)
EDGE = r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
LOWER = {"de", "da", "do", "das", "dos", "e"}


def esc(s):
    return html.escape(str(s), quote=False)


def money(v):
    return "R$ " + f"{v:,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")


def title_name(n):
    ws = n.lower().split()
    return " ".join(w if (i and w in LOWER) else w[:1].upper() + w[1:] for i, w in enumerate(ws))


def two_words(n):
    return " ".join(title_name(n).split()[:2])



# ---------------- características das lentes (catálogo definido pela M Vision) ----------------
# (fabricante, palavra-chave no nome da lente, título, texto)
CATALOG = [
    ("essilor", r"varilux", "Varilux (XR, Physio e Comfort)", "Lentes progressivas com otimização binocular e redução do efeito de flutuação (swim effect), com campos visuais amplos e transição dióptrica suave."),
    ("essilor", r"eyezen", "Eyezen (Grau Simples)", "Lentes monofocais com suporte acomodativo na zona inferior e filtro seletivo, para reduzir a fadiga do músculo ciliar no uso de telas."),
    ("essilor", r"stellest", "Stellest (Miopia Infantil)", "Constelação de microlentes invisíveis que criam um volume de sinal na retina, clinicamente comprovadas para retardar o alongamento do globo ocular."),
    ("essilor", r"kodak", "Lentes Kodak", "Designs esféricos e asféricos padronizados, com correção óptica precisa e a chancela de controle de qualidade do grupo Essilor."),
    ("hoya", r"hoyalux\s*id|myself|mystyle", "Hoyalux iD (MySelf / MyStyle)", "Progressivos com Surfaçagem Dupla Face, distribuindo o grau entre as faces interna e externa para maximizar campos e minimizar aberrações."),
    ("hoya", r"lifestyle", "Hoyalux LifeStyle", "Progressivos com perfis de design pré-configurados, baseados na distribuição ergonômica de uso (visão de longe ou intermediária/perto)."),
    ("hoya", r"balansis|daynamic", "Hoyalux Balansis / Daynamic", "Designs progressivos focados na estabilidade de imagem e na redução do astigmatismo periférico, com conforto dinâmico em movimento."),
    ("hoya", r"argos|wide", "Hoyalux Argos / Wide", "Progressivo de entrada com surfaçagem otimizada, progressão de grau balanceada e corredores visuais bem definidos."),
    ("hoya", r"\bsync\b", "Sync (Grau Simples)", "Monofocal com zona de reforço positivo na parte inferior, auxiliando a acomodação do cristalino em tarefas contínuas de perto."),
    ("segment", r"multifocal.*blue\s*diamond|blue\s*diamond", "Multifocal Blue Diamond", "Progressivo premium com tecnologia Free-Form de precisão pontual, calculando a progressão dióptrica com base nos parâmetros de montagem do usuário."),
    ("segment", r"multifocal.*red\s*diamond|red\s*diamond", "Multifocal Red Diamond", "Progressivas de alta performance com mapeamento digital que otimiza os campos intermediário e de perto, reduzindo zonas de aberração lateral."),
    ("segment", r"multifocal.*light\s*premium", "Multifocal Light Premium", "Progressivo Free-Form de entrada, com geometria de lente e melhor transição de grau do que os blocos progressivos convencionais."),
    ("segment", r"flex\s*form", "Multifocal Flex Form HD", "Multifocal digital com preço de convencional, ótima para leitores assíduos e profissionais que trabalham ao computador; o melhor custo-benefício da categoria, com qualidade e conforto a baixo custo."),
    ("segment", r"bic[oô]ncava", "Bicôncava (alta miopia)", "Tecnologia para altas miopias: a bicôncava atende de −18,00 a −38,00 dioptrias, reduzindo a espessura da lente e garantindo qualidade visual."),
    ("espace", r"espace\s*plus", "Espace Plus (Brasilor)", "Multifocal digital da Brasilor (grupo Essilor): campos de visão amplos para longe, intermediário e perto, boa visão periférica e fácil adaptação; adição até 3,50."),
    ("segment", r"vis[aã]o\s*simples|surfa", "Visão Simples Freeform (Grau Simples)", "Monofocal produzida com surfaçagem digital para compensar aberrações ópticas periféricas, ideal para altas dioptrias ou astigmatismos."),
]

# Tratamentos: palavra-chave -> (nome, descrição curta)
TREATMENTS = [
    (r"crizal", "Crizal (antirreflexo)", "Multicamadas de alta transmitância; hidrofóbico, lipofóbico, antiestático e alto bloqueio UV."),
    (r"transitions|gen\s*s\b", "Transitions GEN S", "Fotocromática: adapta a transmitância de luz da lente conforme a radiação UV."),
    (r"optifog", "Optifog", "Hidrofílico: espalha as gotas em película uniforme e impede o embaçamento."),
    (r"longlife|no[-\s]?risk", "LongLife / No-Risk", "Alta densidade estrutural: maior resistência a riscos."),
]
TREAT_DESC = {
    "Filtro Blue Cut": "Corte da luz azul-violeta (415–455 nm).",
    "Antirreflexo": "Deposição a vácuo em camadas: menos reflexos.",
    **{n: d for _, n, d in TREATMENTS},
}


def catalog_lookup(maker, text):
    low = text.lower()
    for mk, pat, title, desc in CATALOG:
        if mk == maker.lower() and re.search(pat, low):
            return {"title": title, "text": desc}
    return None


# ---------------- logomarcas dos fabricantes (logos/<fabricante>.png|svg|jpg|webp) ----------------
MAKER_ALIAS = {"espace": "Brasilor"}      # a linha Espace é da Brasilor
DARK_LOGOS = set()                        # (sem tarja: as logos ficam sem fundo)


def logos_tag(maker):
    """Uma ou mais logos (ex.: "Essilor / Kodak"), alinhadas à direita da linha do fabricante."""
    tags = [t for t in (logo_tag(m.strip()) for m in maker.split("/")) if t]
    return f'<div class="logos">{"".join(tags)}</div>' if tags else ""


def logo_tag(maker):
    key = re.sub(r"[^a-z0-9]+", "", maker.lower())
    for ext, mime in (("svg", "image/svg+xml"), ("png", "image/png"), ("jpg", "image/jpeg"), ("webp", "image/webp")):
        f = os.path.join(HERE, "logos", f"{key}.{ext}")
        if os.path.exists(f):
            data = base64.b64encode(open(f, "rb").read()).decode()
            cls = "maker-logo on-dark" if key in DARK_LOGOS else "maker-logo"
            return f'<img class="{cls}" src="data:{mime};base64,{data}" alt="{esc(maker)}">'
    return ""


# ---------------- leitura dos itens do ssOtica ----------------
def parse_item(it):
    desc = (it["produto"] or {}).get("descricao_completa", "")
    parts = [p.strip() for p in re.split(r"\s-\s", desc)]
    # "P - código - UN - nome - faixa"
    body = parts[3:] if len(parts) > 3 else parts
    name = body[0] if body else desc
    rng = body[1] if len(body) > 1 else ""
    price = float(it["valor"]) * float(it.get("quantidade") or 1)
    low = desc.lower()
    kind = ("lens" if re.search(r"\blente\b", low)
            else "extra" if re.search(r"adicional|servi[cç]o|prisma|montagem|limpeza|estojo", low)
            else "frame")
    return {"name": name, "range": rng, "price": price, "kind": kind, "code": parts[1] if len(parts) > 1 else ""}


def lens_info(it):
    n = it["name"]
    low = n.lower()
    full = (n + " " + it["range"]).lower()  # "C/Ar" costuma vir junto da faixa de grau
    m = re.search(r"lente\s+(\S+)", n, re.I)
    raw_maker = m.group(1).title() if m else "—"
    maker = MAKER_ALIAS.get(raw_maker.lower(), raw_maker)
    idx = re.search(r"\b(1[.,]\d{2})\b", n)
    if "multifocal" in low or "espace plus" in low:
        tipo = "Multifocal"
    elif "visão simples" in low or "vis" in low and "simples" in low:
        tipo = "Visão Simples" + (" (Especial)" if "especial" in low else "")
    else:
        tipo = "Lente oftálmica"
    tipo += (" | Resina Orma" if "orma" in low else " | Resina") + (f" (Índice {idx.group(1).replace(',', '.')})" if idx else "")
    treats = []
    if re.search(r"blue\s*(cut|line)", low):
        treats.append("Filtro Blue Cut")
    if re.search(r"c/\s*ar\b", full):
        treats.append("Antirreflexo")
    for pat, tname, _ in TREATMENTS:
        if re.search(pat, full):
            treats.append(tname)
    lines = []
    for key, label in (("lightpremium", "Linha Lightpremium"), ("flex form", "Flex Form HD"),
                       ("surfa", "Surfaçada bicôncava"), ("orma digital", "Espace Plus Orma Digital")):
        if key in low:
            lines.append(label)
    rng = re.sub(r"c/\s*ar\b", "", it["range"], flags=re.I).replace("Esf.", "").strip()
    rng = re.sub(r"\s*A\s*", " a ", rng).replace(".", ",") if rng else ""
    if "multifocal" in low or "espace plus" in low:
        indic = "Correção para longe, intermediário e perto em uma única lente."
    elif "especial" in low or (idx and float(idx.group(1).replace(",", ".")) >= 1.67):
        indic = "Lente mais fina e leve, indicada para graus elevados."
    else:
        indic = "Correção óptica de alta nitidez para o uso diário."
    cat = catalog_lookup(raw_maker, n)
    if cat:
        indic = cat["text"]
    if rng:
        indic += f" Faixa de grau: {rng}."
    return {"cat": cat, "maker": maker, "tipo": tipo, "treats": treats, "chip": lines[0] if lines else None,
            "indic": indic, "blue": "Filtro Blue Cut" in treats}


def build_options(q):
    items = [parse_item(i) for i in q["itens"]]
    lenses = [i for i in items if i["kind"] == "lens"]
    frames = [i for i in items if i["kind"] == "frame"]
    extras = [i for i in items if i["kind"] == "extra"]
    frame_price = sum(f["price"] for f in frames) or None
    extras_price = sum(e["price"] for e in extras)
    note = ""

    def lens_opt(n, lens, fprice, name_prefix="", extra_treat=(), extra_price=0.0):
        li = lens_info(lens)
        treats = li["treats"] + [t for t in extra_treat if t not in li["treats"]]
        chip_name = li["chip"].replace("Linha ", "") if li["chip"] else ""
        name = chip_name if chip_name.lower().startswith(li["maker"].lower()) else f"{li['maker']} {chip_name}".strip()
        return {"n": n, "name": name,
                "maker": li["maker"], "tipo": li["tipo"], "treats": treats or ["Lente padrão"],
                "chip": li["chip"], "indic": li["indic"], "diff": None, "rec": False,
                "lens": lens["price"] + extra_price, "lens_disc": None, "frame": fprice, "frame_disc": None,
                "frame_name": frames[0]["name"] if frames else None}

    if len(lenses) >= 2:
        o1 = lens_opt(1, lenses[0], frame_price, extra_price=extras_price)
        o2 = lens_opt(2, lenses[1], frame_price)
        note = "Opções = as duas lentes do orçamento"
        o2["rec"] = True
        li2 = lens_info(lenses[1])
        o2["diff"] = (li2["cat"]["text"] if li2["cat"] else "Conforto visual contra telas e iluminação LED" if li2["blue"] else "Opção sugerida pelo consultor")
    elif len(lenses) == 1:
        # Uma única lente: orçamento de opção única, só com os dados do ssOtica.
        o1 = lens_opt(1, lenses[0], frame_price,
                      extra_treat=(["Prisma"] if any("prisma" in e["name"].lower() for e in extras) else []),
                      extra_price=extras_price)
        o2 = None
        note = "Opção única = dados do ssOtica"
    else:  # só armações
        def frame_opt(n, f):
            return {"n": n, "name": f["name"], "maker": "—", "tipo": "Somente armação", "treats": [f["name"]],
                    "chip": None, "indic": "Orçamento de armação, sem lentes.", "diff": None, "rec": False,
                    "lens": None, "lens_disc": None, "frame": f["price"], "frame_disc": None,
                    "frame_name": f["name"]}
        o1 = frame_opt(1, frames[0])
        if len(frames) > 1:
            o2 = frame_opt(2, frames[1])
            o2["rec"] = True
            o2["diff"] = "Opção sugerida pelo consultor"
            note = "Opções = as duas armações do orçamento"
        else:
            o2 = None
            note = "Opção única (somente armação) = dados do ssOtica"
    for o in (o1, o2):
        if o is None:
            continue
        parts = [o["lens"] or 0.0, -(o["lens_disc"] or 0.0), o["frame"] or 0.0, -(o["frame_disc"] or 0.0)]
        o["total"] = sum(parts)
        o["save"] = (o["lens_disc"] or 0.0) + (o["frame_disc"] or 0.0)
    return o1, o2, note


# ---------------- HTML ----------------
def row(label, val, disc=False):
    v = "—" if val is None else (("− " if disc else "") + money(val))
    cls = "row disc" if (disc and val) else "row"
    return f'<div class="{cls}"><span>{label}</span><b>{v}</b></div>'


def card(o, solo=False):
    """Cartão de uma opção: dados em coluna à esquerda, valores alinhados à direita."""
    rec = o["rec"] and not solo
    tag = '<span class="tag">Recomendada</span>' if rec else ""
    label = "Opção única" if solo else f'Opção {o["n"]}'
    def li(t):
        d = TREAT_DESC.get(t)
        return f"<li><span>{esc(t)}" + (f"<small>{esc(d)}</small>" if d else "") + "</span></li>"
    checks = "".join(li(t) for t in o["treats"])
    chip = f'<div class="chip">{esc(o["chip"])}</div>' if o["chip"] else ""
    fields = ""
    if o["lens"] is not None:
        fields += (
            f'<div class="makerrow"><div class="field"><div class="label">Fabricante da lente</div><div class="value">{esc(o["maker"])}</div></div>{logos_tag(o["maker"])}</div>'
            f'<div class="field"><div class="label">Tipo de lente &amp; material</div><div class="value">{esc(o["tipo"])}</div></div>'
            f'<div class="field"><div class="label">Tratamentos inclusos</div><ul class="checks">{checks}</ul>{chip}</div>'
        )
    if solo and o.get("frame_name"):
        fields += f'<div class="field"><div class="label">Armação</div><div class="value">{esc(o["frame_name"])}</div></div>'
    if rec and o["diff"]:
        fields += f'<div class="field"><div class="label">Diferencial &amp; benefício</div><div class="chip hot">{esc(o["diff"])}</div></div>'
    else:
        fields += f'<div class="field"><div class="label">Indicação principal</div><div class="value soft">{esc(o["indic"])}</div></div>'
    if solo:
        # opção única: só as linhas que existem
        rows = ""
        if o["lens"] is not None:
            rows += row("Valor das lentes", o["lens"])
            if o["lens_disc"]:
                rows += row("Desconto na lente", o["lens_disc"], True)
        if o["frame"] is not None:
            rows += row("Valor da armação", o["frame"])
            if o["frame_disc"]:
                rows += row("Desconto na armação", o["frame_disc"], True)
    else:
        # duas opções: as mesmas 4 linhas nos dois cartões, para os valores ficarem alinhados
        rows = (row("Valor das lentes", o["lens"]) + row("Desconto na lente", o["lens_disc"], True)
                + row("Valor da armação", o["frame"]) + row("Desconto na armação", o["frame_disc"], True))
    save = f'<span class="save">Economia total {money(o["save"])}</span>' if o["save"] else ""
    return f'''    <article class="card{' rec' if rec else ''}">
      <div class="card-head"><div class="top"><small>{label}</small>{tag}</div><h2>{esc(o["name"])}</h2></div>
      <div class="card-body">
        {fields}
      </div>
      <div class="prices">
        {rows}
        <div class="total"><div class="head-row"><span class="label">Investimento</span>{save}</div><span class="amount">{money(o["total"])}</span></div>
      </div>
    </article>
'''


TRIPLE_CSS = """
  .options.triple { gap: 8px; }
  .options.triple .card { grid-template-columns: minmax(0, 1fr) 245px; }
  .options.triple .card-head { padding: 5px 14px 6px; }
  .options.triple .card-head .top { min-height: 14px; }
  .options.triple .card-head h2 { font-size: 14px; margin: 0; }
  .options.triple .card-body { display: grid; grid-template-columns: 1fr 1fr; column-gap: 18px; row-gap: 4px; padding: 7px 14px; align-content: center; }
  .options.triple .card-body > :nth-child(1) { grid-column: 1; grid-row: 1; }
  .options.triple .card-body > :nth-child(2) { grid-column: 1; grid-row: 2; }
  .options.triple .card-body > :nth-child(3) { grid-column: 2; grid-row: 1 / span 2; }
  .options.triple .card-body > :nth-child(4) { grid-column: 1 / -1; grid-row: 3; }
  .options.triple .field .value { font-size: 11.6px; }
  .options.triple .field .value.soft { font-size: 11px; }
  .options.triple .checks { margin-top: 2px; gap: 2px; }
  .options.triple .checks li { font-size: 11.6px; }
  .options.triple .checks li::before { width: 14px; height: 14px; font-size: 8px; line-height: 14px; }
  .options.triple .checks li small { font-size: 9px; }
  .options.triple .prices { padding: 6px 14px 8px; }
  .options.triple .row { padding: 1px 0; font-size: 10.8px; }
  .options.triple .total { margin-top: 4px; padding-top: 5px; }
  .options.triple .total .head-row { min-height: 17px; }
  .options.triple .total .amount { font-size: 22px; }
  .options.triple .save { font-size: 9.6px; padding: 2px 8px; }
  .options.triple .maker-logo { height: 22px; }
  .options.triple .chip.hot { font-size: 10.6px; padding: 4px 8px; }
"""


def render(template, q, o1, o2, note, o3=None):
    num = str(int(q["numero"])).zfill(4)
    date = (q["data_orcamento"] or "")[:10]
    seller = two_words((q.get("funcionario") or {}).get("nome") or "—")
    info = f'''<section class="info" aria-label="Dados do orçamento">
    <div><div class="label">Cliente</div><div class="value">{esc(title_name(q["cliente_nome"].strip()))}</div></div>
    <div><div class="label">Orçamento Nº</div><div class="value">{num}</div></div>
    <div><div class="label">Data de emissão</div><div class="value">{esc(date)}</div></div>
    <div><div class="label">Consultor(a)</div><div class="value">{esc(seller)}</div></div>
  </section>'''
    if o3 is not None:
        options = ('<section class="options triple" aria-label="Opções de lentes">\n\n'
                   + card(o1) + "\n" + card(o2) + "\n" + card(o3) + "\n  </section>")
    elif o2 is None:
        options = '<section class="options single" aria-label="Opção de lente">\n\n' + card(o1, solo=True) + "\n  </section>"
    else:
        options = '<section class="options" aria-label="Opções de lentes">\n\n' + card(o1) + "\n" + card(o2) + "\n  </section>"
    foot = (f'<footer class="foot"><span>SIMULAÇÃO · dados do ssOtica nº {num} · {esc(note)}</span>'
            f'<span>Válido por 30 dias</span></footer>')
    out = template
    if o3 is not None:
        out = out.replace("</style>", TRIPLE_CSS + "</style>", 1)
    if o2 is None and o3 is None:
        # opção única: cartão compacto no alto; garantias, contato e rodapé ficam ancorados embaixo
        out = out.replace("</style>", """
  .options.single { flex: 0 0 auto; }
  .options.single .card { flex: 0 0 auto; min-height: 480px; }
  .options.single ~ .section-title { margin-top: auto; }
</style>""", 1)
    a = out.index('<section class="info"'); b = out.index("</section>", a) + len("</section>")
    out = out[:a] + info + out[b:]
    a = out.index('<section class="options"'); b = out.index('<h2 class="section-title">')
    out = out[:a] + options + "\n\n  " + out[b:]
    a = out.index('<footer class="foot">'); b = out.index("</footer>", a) + len("</footer>")
    out = out[:a] + foot + out[b:]
    return out, num


def main():
    quotes = json.load(open(sys.argv[1], encoding="utf-8"))
    merge_only = len(sys.argv) > 2 and sys.argv[2] == "--merge"
    template = open(os.path.join(HERE, "modelo-orcamento.html"), encoding="utf-8").read()
    pdfs = []
    for q in quotes:
        o1, o2, note = build_options(q)
        page, num = render(template, q, o1, o2, note)
        hp = os.path.join(OUT, f"orcamento-{num}.html")
        pp = os.path.join(OUT, f"orcamento-{num}.pdf")
        if not merge_only:
            open(hp, "w", encoding="utf-8").write(page)
        pdfs.append(pp)
        print(num, "ok", note)
    if not merge_only:
        return
    import pymupdf
    merged = pymupdf.open()
    for p in pdfs:
        d = pymupdf.open(p)
        print(os.path.basename(p), "páginas:", len(d))
        merged.insert_pdf(d)
    merged.save(os.path.join(OUT, "orcamentos-simulados.pdf"))
    for i, pg in enumerate(merged):
        pg.get_pixmap(dpi=80).save(os.path.join(os.environ.get("TEMP", "."), f"sim_{i + 1}.png"))


if __name__ == "__main__":
    main()
