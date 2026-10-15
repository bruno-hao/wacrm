#!/usr/bin/env python3
"""
Leitura (somente leitura) dos orçamentos do ssOtica pela mesma tela web.

A API Consultiva do ssOtica não tem endpoint de orçamentos; a tela
https://app.ssotica.com.br/orcamentos carrega a lista de /graphql com a
sessão do usuário. Este script faz exatamente isso: entra com usuário e
senha (variáveis de ambiente, nunca na linha de comando), consulta
GetPaginatedOrcamentos e imprime um resumo. Serve para validar o login e a
leitura; o CRM faz o mesmo em src/lib/ssotica/web.ts.

Uso (PowerShell):
  $env:SSOTICA_USER = "crm.mvision"; $env:SSOTICA_PASS = "..."
  python scripts/ssotica_quotes.py --dias 15 --empresa LzBQZm

Só biblioteca padrão (urllib). Nenhuma escrita no ssOtica.
"""
import argparse
import http.cookiejar
import json
import os
import re
import sys
import urllib.parse
import urllib.request
from datetime import datetime, timedelta

BASE = "https://app.ssotica.com.br"
UA = "Mozilla/5.0 (compatible; WACRM-ssOtica-sync)"

QUERY = """query O($empresa:String,$busca:String,$funcionario:String,$situacao:[String],
$periodo_inicio:String,$periodo_fim:String,$page:Int,$per_page:Int){
GetPaginatedOrcamentos(empresa:$empresa,busca:$busca,funcionario:$funcionario,situacao:$situacao,
periodo_inicio:$periodo_inicio,periodo_fim:$periodo_fim,page:$page,per_page:$per_page){
total last_page current_page data{hashed_id numero total vencimento data_orcamento status
cliente_nome cliente_telefone cliente_DDI funcionario{nome}
itens{quantidade valor produto{descricao_completa}} venda_hashed_id os_hashed_id}}}"""


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *a, **k):
        return None


def make_opener():
    jar = http.cookiejar.CookieJar()
    opener = urllib.request.build_opener(
        urllib.request.HTTPCookieProcessor(jar), NoRedirect
    )
    opener.addheaders = [("User-Agent", UA)]
    return opener, jar


def open_url(opener, req):
    try:
        return opener.open(req, timeout=30)
    except urllib.error.HTTPError as e:  # 3xx/4xx come as errors with NoRedirect
        return e


def parse_login_form(html):
    for form in re.findall(r"<form[\s\S]*?</form>", html, re.I):
        inputs = re.findall(r"<input\b[^>]*>", form, re.I)

        def attr(tag, name):
            m = re.search(name + r'\s*=\s*"([^"]*)"', tag, re.I) or re.search(
                name + r"\s*=\s*'([^']*)'", tag, re.I
            )
            return m.group(1) if m else None

        pwd = next((i for i in inputs if (attr(i, "type") or "").lower() == "password"), None)
        if not pwd:
            continue
        user = next(
            (i for i in inputs if (attr(i, "type") or "text").lower() in ("text", "email") and attr(i, "name")),
            None,
        )
        if not user:
            continue
        hidden = {
            attr(i, "name"): attr(i, "value") or ""
            for i in inputs
            if (attr(i, "type") or "").lower() == "hidden" and attr(i, "name")
        }
        m = re.search(r'<form\b[^>]*\baction\s*=\s*"([^"]*)"', form, re.I)
        return (m.group(1) if m else "/login"), attr(user, "name"), attr(pwd, "name"), hidden
    return None


def login(opener, user, password):
    page = open_url(opener, urllib.request.Request(BASE + "/login", headers={"Accept": "text/html"}))
    html = page.read().decode("utf-8", "ignore")
    if re.search(r"g-recaptcha|hcaptcha|cf-turnstile", html, re.I):
        sys.exit("O login do ssOtica pede captcha: não é possível automatizar.")
    form = parse_login_form(html)
    if not form:
        sys.exit("Formulário de login não reconhecido.")
    action, user_field, pass_field, hidden = form
    print(f"[login] campos: usuário='{user_field}', senha='{pass_field}', ocultos={list(hidden)}")
    data = urllib.parse.urlencode({**hidden, user_field: user, pass_field: password}).encode()
    path = urllib.parse.urlparse(action).path or "/login"
    req = urllib.request.Request(
        BASE + path,
        data=data,
        headers={"Content-Type": "application/x-www-form-urlencoded", "Referer": BASE + "/login"},
    )
    res = open_url(opener, req)
    loc = res.headers.get("Location", "")
    print(f"[login] resposta HTTP {res.status}, redireciona para: {loc or '(sem redirecionamento)'}")
    if 300 <= res.status < 400 and "/login" not in loc:
        return True
    if res.status == 200 and not re.search(r'name=["\']password["\']', res.read().decode("utf-8", "ignore")):
        return True
    return False


def xsrf(jar):
    for c in jar:
        if c.name == "XSRF-TOKEN":
            return urllib.parse.unquote(c.value)
    return ""


def fetch(opener, jar, empresa, dias):
    fim = datetime.now()
    ini = fim - timedelta(days=dias)
    fmt = lambda d: d.strftime("%d/%m/%Y")
    out, page = [], 1
    while True:
        body = json.dumps(
            {
                "query": QUERY,
                "variables": {
                    "empresa": empresa, "busca": "", "funcionario": None, "page": page, "per_page": 50,
                    "periodo_inicio": fmt(ini), "periodo_fim": fmt(fim),
                    "situacao": ["ATIVO", "CONVERTIDO", "CANCELADO", "EXPIRADO"],
                },
            }
        ).encode()
        req = urllib.request.Request(
            BASE + "/graphql", data=body,
            headers={"Content-Type": "application/json", "Accept": "application/json",
                     "X-Requested-With": "XMLHttpRequest", "X-XSRF-TOKEN": xsrf(jar)},
        )
        res = open_url(opener, req)
        if res.status != 200:
            sys.exit(f"GraphQL respondeu HTTP {res.status}")
        block = json.loads(res.read())["data"]["GetPaginatedOrcamentos"]
        out += block["data"]
        if page >= (block.get("last_page") or 1):
            return out
        page += 1


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--empresa", default="LzBQZm", help="código da loja (hash) do ssOtica")
    ap.add_argument("--dias", type=int, default=15)
    args = ap.parse_args()
    user, password = os.environ.get("SSOTICA_USER"), os.environ.get("SSOTICA_PASS")
    if not user or not password:
        sys.exit("Defina SSOTICA_USER e SSOTICA_PASS no ambiente.")
    opener, jar = make_opener()
    if not login(opener, user, password):
        sys.exit("Login recusado pelo ssOtica.")
    quotes = fetch(opener, jar, args.empresa, args.dias)
    print(f"\n{len(quotes)} orçamento(s) nos últimos {args.dias} dias:")
    for q in quotes:
        print(
            f"  #{q['numero']:>5}  {q['status']:<10}  R$ {q['total']!s:>10}  "
            f"{(q.get('data_orcamento') or '')[:10]}  venc {(q.get('vencimento') or '')[:10]}  "
            f"vendedor={((q.get('funcionario') or {}).get('nome') or '-').split(' ')[0]}  "
            f"itens={len(q.get('itens') or [])}  tel={'ok' if q.get('cliente_telefone') else '-'}"
        )


if __name__ == "__main__":
    main()
