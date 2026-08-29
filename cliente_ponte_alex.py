#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
cliente_ponte_alex.py
Cliente Oficial da Ponte Alex v2 para integração externa segura via HTTPS.

Permite enviar scripts Python para a Ponte Alex v2, aplicar transformações,
validar a sintaxe, executar no interpretador Python e baixar o arquivo resultante.

Uso via Linha de Comando:
    python3 cliente_ponte_alex.py <arquivo.py> --instruction "<instrução>" [--output <saida.py>]

Uso via Módulo Python:
    from cliente_ponte_alex import ClientePonteAlex
    cliente = ClientePonteAlex()
    resultado = cliente.processar_arquivo(
        caminho_arquivo="meu_script.py",
        instrucao="Substituir '[TESTE]' por '[PRODUCAO]'",
        arquivo_saida="meu_script_processado.py"
    )
"""

import os
import sys
import json
import urllib.request
import urllib.error
import urllib.parse
from pathlib import Path
from typing import Dict, Any, Optional

DEFAULT_PONTE_URL = "https://ponte-alex-v2.dockhosting.dev"

class ErroPonteAlex(Exception):
    """Exceção base para erros de comunicação ou processamento na Ponte Alex v2."""
    def __init__(self, mensagem: str, status_http: Optional[int] = None, detalhes: Optional[Dict[str, Any]] = None):
        super().__init__(mensagem)
        self.status_http = status_http
        self.detalhes = detalhes or {}


class ClientePonteAlex:
    """
    Cliente oficial para integração com a API HTTPS da Ponte Alex v2.
    """

    def __init__(self, base_url: Optional[str] = None):
        """
        Inicializa o cliente da Ponte Alex v2.
        
        A URL base pode ser fornecida diretamente ou lida da variável PONTE_API_URL.
        O segredo de autenticação é lido estritamente de PONTE_API_SECRET.
        """
        # Determina a URL base da Ponte Alex v2
        self.base_url = (base_url or os.environ.get("PONTE_API_URL") or DEFAULT_PONTE_URL).rstrip("/")

        # Valida a presença do segredo no ambiente sem nunca exibir seu conteúdo
        self._secret = os.environ.get("PONTE_API_SECRET", "").strip()

    def _obter_headers(self) -> Dict[str, str]:
        """Gera os cabeçalhos HTTP necessários sem expor o segredo."""
        if not self._secret:
            raise ErroPonteAlex(
                "Segredo de autenticação PONTE_API_SECRET não foi encontrado nas variáveis de ambiente. "
                "Configure a variável PONTE_API_SECRET antes de executar o cliente."
            )
        return {
            "Content-Type": "application/json; charset=utf-8",
            "x-api-secret": self._secret,
            "User-Agent": "ClientePonteAlex/2.0"
        }

    def ping(self) -> Dict[str, Any]:
        """
        Executa verificação de status e saúde (health check) na Ponte Alex v2.
        Endpoint público GET /api/ponte/v2/ping.
        """
        url = f"{self.base_url}/api/ponte/v2/ping"
        req = urllib.request.Request(url, headers={"User-Agent": "ClientePonteAlex/2.0"}, method="GET")
        try:
            with urllib.request.urlopen(req, timeout=15) as response:
                dados = json.loads(response.read().decode("utf-8"))
                return dados
        except urllib.error.HTTPError as e:
            corpo = e.read().decode("utf-8", errors="replace")
            raise ErroPonteAlex(f"Erro HTTP {e.code} no ping: {e.reason}", status_http=e.code)
        except urllib.error.URLError as e:
            raise ErroPonteAlex(f"Falha de conexão com a Ponte Alex v2 ({url}): {e.reason}")

    def processar_codigo(
        self,
        conteudo_codigo: str,
        instrucao: str,
        nome_arquivo: str = "script.py",
        nome_saida: Optional[str] = None,
        destino_local: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Envia código Python diretamente para processamento, execução e download do resultado.
        """
        if not conteudo_codigo.strip():
            raise ErroPonteAlex("O conteúdo do código Python não pode estar vazio.")

        if not nome_saida:
            nome_puro = Path(nome_arquivo).stem
            nome_saida = f"{nome_puro}_processado.py"

        url_processar = f"{self.base_url}/api/ponte/v2/processar"
        payload = {
            "filename": nome_arquivo,
            "outputFilename": nome_saida,
            "instruction": instrucao,
            "fileContent": conteudo_codigo
        }

        headers = self._obter_headers()
        dados_envio = json.dumps(payload).encode("utf-8")

        req = urllib.request.Request(url_processar, data=dados_envio, headers=headers, method="POST")

        try:
            with urllib.request.urlopen(req, timeout=30) as response:
                status_code = response.getcode()
                corpo_resposta = response.read().decode("utf-8")
                resultado_json = json.loads(corpo_resposta)
        except urllib.error.HTTPError as e:
            status_code = e.code
            corpo_erro = e.read().decode("utf-8", errors="replace")
            detalhes = {}
            try:
                detalhes = json.loads(corpo_erro)
            except Exception:
                detalhes = {"raw_error": corpo_erro}

            if status_code == 400:
                msg = detalhes.get("error") or detalhes.get("testMessage") or "Requisição inválida ou erro de sintaxe Python."
                raise ErroPonteAlex(f"Erro HTTP 400 (Bad Request): {msg}", status_http=400, detalhes=detalhes)
            elif status_code == 401:
                raise ErroPonteAlex(
                    "Erro HTTP 401 (Não Autorizado): O segredo x-api-secret fornecido foi rejeitado ou está incorreto.",
                    status_http=401,
                    detalhes=detalhes
                )
            elif status_code == 500:
                msg = detalhes.get("error") or "Erro interno no servidor da Ponte Alex v2."
                raise ErroPonteAlex(f"Erro HTTP 500 (Internal Server Error): {msg}", status_http=500, detalhes=detalhes)
            else:
                raise ErroPonteAlex(f"Erro HTTP {status_code}: {e.reason}", status_http=status_code, detalhes=detalhes)
        except urllib.error.URLError as e:
            raise ErroPonteAlex(f"Falha de rede ao conectar a {url_processar}: {e.reason}")

        # Validações de integridade do retorno
        if not resultado_json.get("success"):
            raise ErroPonteAlex(
                f"A operação não foi bem sucedida: {resultado_json.get('testMessage', 'Sem mensagem')}",
                detalhes=resultado_json
            )

        processed_file_info = resultado_json.get("processedFile", {})
        download_url_relativa = processed_file_info.get("downloadUrl", "")

        if not download_url_relativa:
            raise ErroPonteAlex("A Ponte Alex v2 não retornou um downloadUrl válido para o arquivo processado.")

        # Constrói URL completa de download
        if download_url_relativa.startswith("http://") or download_url_relativa.startswith("https://"):
            url_download_completa = download_url_relativa
        else:
            url_download_completa = urllib.parse.urljoin(self.base_url, download_url_relativa)

        # Realiza o download do arquivo processado
        caminho_salvar = Path(destino_local or nome_saida)
        caminho_salvar.parent.mkdir(parents=True, exist_ok=True)

        req_download = urllib.request.Request(
            url_download_completa,
            headers={"User-Agent": "ClientePonteAlex/2.0"},
            method="GET"
        )

        try:
            with urllib.request.urlopen(req_download, timeout=30) as resp_down:
                conteudo_baixado = resp_down.read()
                with open(caminho_salvar, "wb") as f_out:
                    f_out.write(conteudo_baixado)
        except urllib.error.HTTPError as e:
            raise ErroPonteAlex(f"Falha ao baixar arquivo processado ({url_download_completa}): HTTP {e.code}", status_http=e.code)
        except urllib.error.URLError as e:
            raise ErroPonteAlex(f"Falha de conexão ao baixar o arquivo: {e.reason}")

        tamanho_salvo = caminho_salvar.stat().st_size

        return {
            "status_http": status_code,
            "arquivo_salvo": str(caminho_salvar.resolve()),
            "nome_arquivo": caminho_salvar.name,
            "tamanho_bytes": tamanho_salvo,
            "download_url": url_download_completa,
            "test_passed": resultado_json.get("testPassed", False),
            "test_message": resultado_json.get("testMessage", ""),
            "compile_check": resultado_json.get("compileCheck", {}),
            "execution": resultado_json.get("execution", {}),
            "original_sha256": resultado_json.get("originalFile", {}).get("sha256", ""),
            "processed_sha256": processed_file_info.get("sha256", ""),
            "resposta_completa": resultado_json
        }

    def processar_arquivo(
        self,
        caminho_arquivo: str,
        instrucao: str,
        arquivo_saida: Optional[str] = None,
        destino_local: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Lê um arquivo Python local e envia para a Ponte Alex v2.
        """
        caminho = Path(caminho_arquivo)
        if not caminho.exists():
            raise FileNotFoundError(f"Arquivo de entrada '{caminho_arquivo}' não encontrado.")

        if not caminho.is_file():
            raise ValueError(f"O caminho '{caminho_arquivo}' não é um arquivo regular.")

        with open(caminho, "r", encoding="utf-8", errors="replace") as f:
            conteudo = f.read()

        nome_saida = arquivo_saida or f"{caminho.stem}_processado.py"
        destino = destino_local or nome_saida

        return self.processar_codigo(
            conteudo_codigo=conteudo,
            instrucao=instrucao,
            nome_arquivo=caminho.name,
            nome_saida=nome_saida,
            destino_local=destino
        )


def main():
    import argparse

    parser = argparse.ArgumentParser(
        description="Cliente Oficial da Ponte Alex v2 - Processamento e Execução Segura de Scripts Python"
    )
    parser.add_argument("arquivo", help="Caminho do arquivo Python de entrada a ser processado")
    parser.add_argument("--instruction", "-i", required=True, help="Instrução de modificação para a Ponte Alex v2")
    parser.add_argument("--output", "-o", default=None, help="Nome do arquivo de saída gerado")
    parser.add_argument("--url", "-u", default=None, help=f"URL base da Ponte Alex v2 (padrão: {DEFAULT_PONTE_URL})")
    parser.add_argument("--ping", action="store_true", help="Apenas testa a conectividade e status com a API")

    args = parser.parse_args()

    try:
        cliente = ClientePonteAlex(base_url=args.url)

        if args.ping:
            print("Executando ping na Ponte Alex v2...")
            res_ping = cliente.ping()
            print(f"Status: {res_ping.get('status')}")
            print(f"Ponte: {res_ping.get('ponte')} (v{res_ping.get('version')})")
            print(f"Runtime: {res_ping.get('pythonRuntime')}")
            return 0

        print("=" * 60)
        print("🚀 PONTE ALEX v2 - CLIENTE OFICIAL DE INTEGRAÇÃO")
        print("=" * 60)
        print(f"Arquivo de Entrada: {args.arquivo}")
        print(f"Instrução: {args.instruction}")
        print(f"Servidor: {cliente.base_url}")
        print(f"Autenticação: x-api-secret configurado no ambiente")
        print("-" * 60)

        resultado = cliente.processar_arquivo(
            caminho_arquivo=args.arquivo,
            instrucao=args.instruction,
            arquivo_saida=args.output
        )

        print("\n✅ PROCESSAMENTO E EXECUÇÃO CONCLUÍDOS COM SUCESSO!")
        print(f"• Arquivo Local Salvo: {resultado['arquivo_salvo']}")
        print(f"• Tamanho do Arquivo: {resultado['tamanho_bytes']} bytes")
        print(f"• Teste Python: {'APROVADO (Exit Code 0)' if resultado['test_passed'] else 'REPROVADO'}")
        print(f"• Mensagem: {resultado['test_message']}")
        
        exec_info = resultado.get("execution", {})
        if exec_info.get("stdout"):
            print("\n[Saída stdout da execução Python]:")
            print(exec_info['stdout'].strip())

        print("=" * 60)
        return 0

    except ErroPonteAlex as e:
        print(f"\n❌ ERRO NA PONTE ALEX v2: {e}", file=sys.stderr)
        if e.detalhes:
            print(f"Detalhes: {json.dumps(e.detalhes, indent=2)}", file=sys.stderr)
        return 1
    except Exception as e:
        print(f"\n❌ ERRO INESPERADO: {e}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
