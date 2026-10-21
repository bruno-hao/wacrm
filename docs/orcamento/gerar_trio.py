"""Simula um orçamento com três fabricantes (Segment, Essilor / Kodak e Hoya).

Opção 1 = lente real do orçamento ssOtica informado; opções 2 e 3 = ILUSTRATIVAS
(textos do catálogo da M Vision; preços inventados só para a simulação).
Uso: python gerar_trio.py orc5.json 0172
"""
import json, os, sys
import gerar_simulacao as g

quotes = json.load(open(sys.argv[1], encoding="utf-8"))
num = sys.argv[2] if len(sys.argv) > 2 else None
q = next(x for x in quotes if str(x["numero"]).zfill(4) == str(num).zfill(4)) if num else quotes[0]

o1, _, _ = g.build_options(q)
frame = o1["frame"] or 0.0


def cat(maker, text):
    return g.catalog_lookup(maker, text)["text"]


o2 = {"n": 2, "name": "Eyezen Orma Crizal", "maker": "Essilor / Kodak",
      "tipo": "Visão Simples | Resina Orma (Índice 1.50)",
      "treats": ["Crizal (antirreflexo)", "Filtro Blue Cut"], "chip": None,
      "indic": cat("essilor", "eyezen"), "diff": cat("essilor", "eyezen"), "rec": True,
      "lens": 890.0, "lens_disc": 90.0, "frame": frame, "frame_disc": None, "frame_name": o1.get("frame_name")}
o3 = {"n": 3, "name": "Hoyalux Sync", "maker": "Hoya",
      "tipo": "Visão Simples | Resina (Índice 1.50)",
      "treats": ["LongLife / No-Risk", "Antirreflexo"], "chip": None,
      "indic": cat("hoya", "sync"), "diff": None, "rec": False,
      "lens": 1150.0, "lens_disc": None, "frame": frame, "frame_disc": None, "frame_name": o1.get("frame_name")}
o1["chip"] = None
for o in (o1, o2, o3):
    o["total"] = (o["lens"] or 0) - (o["lens_disc"] or 0) + (o["frame"] or 0) - (o["frame_disc"] or 0)
    o["save"] = (o["lens_disc"] or 0) + (o["frame_disc"] or 0)

template = open(os.path.join(g.HERE, "modelo-orcamento.html"), encoding="utf-8").read()
note = "Opção 1 real; opções 2 e 3 ilustrativas (Essilor / Kodak e Hoya)"
page, n = g.render(template, q, o1, o2, note, o3)
out = os.path.join(g.OUT, "orcamento-3-fabricantes")
open(out + ".html", "w", encoding="utf-8").write(page)
print("ok", out)
