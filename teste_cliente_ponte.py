#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
teste_cliente_ponte.py
Teste automatizado para o cliente oficial cliente_ponte_alex.py.

Valida:
1. Leitura segura do segredo de ambiente (sem nunca expô-lo).
2. Envio de arquivo Python via POST /api/ponte/v2/processar com header x-api-secret.
3. Transformação do código e validação de sintaxe.
4. Execução real no interpretador Python e verificação de exitCode 0.
5. Download automático do arquivo processado através da URL retornada.
6. Gravação local e verificação de integridade do arquivo recebido.
"""

import os
import sys
import subprocess
from pathlib import Path
from cliente_ponte_alex import ClientePonteAlex, ErroPonteAlex

def executar_teste_automatizado():
    print("=" * 65)
    print("🧪 INICIANDO TESTE AUTOMATIZADO: cliente_ponte_alex.py")
    print("=" * 65)

    # 1. Verifica se a variável PONTE_API_SECRET está configurada
    segredo_presente = bool(os.environ.get("PONTE_API_SECRET", "").strip())
    if not segredo_presente:
        print("❌ ERRO: PONTE_API_SECRET não está definida no ambiente.")
        sys.exit(1)
    print("✅ 1. Verificação de Ambiente: PONTE_API_SECRET configurado com sucesso (protegido).")

    # 2. Configura a URL base (usa local se estiver dentro do ambiente ou a URL configurada)
    url_teste = os.environ.get("PONTE_API_URL") or "http://localhost:3000"
    print(f"📡 2. Conectando à Ponte Alex v2 em: {url_teste}")

    cliente = ClientePonteAlex(base_url=url_teste)

    # 3. Teste de Ping
    print("\n🔍 3. Testando Health Check (GET /api/ponte/v2/ping)...")
    try:
        dados_ping = cliente.ping()
        print(f"   Status: {dados_ping.get('status')} | Versão: {dados_ping.get('version')} | Runtime: {dados_ping.get('pythonRuntime')}")
        assert dados_ping.get("status") == "online", "Status do ping deve ser 'online'"
        print("   ✅ Ping concluído com HTTP 200 OK.")
    except Exception as e:
        print(f"   ❌ Falha no ping: {e}")
        sys.exit(1)

    # 4. Cria arquivo temporário de entrada
    arquivo_entrada = Path("temp_script_teste_entrada.py")
    arquivo_saida_esperada = Path("temp_script_teste_saida.py")

    codigo_original = (
        'def executar():\n'
        '    status = "TESTE_ORIGINAL_PENDENTE"\n'
        '    print(f"EXECUCAO_CLIENTE: {status}")\n'
        '    return 0\n\n'
        'if __name__ == "__main__":\n'
        '    executar()\n'
    )

    with open(arquivo_entrada, "w", encoding="utf-8") as f:
        f.write(codigo_original)
    print(f"\n📝 4. Arquivo de teste gerado: {arquivo_entrada.name} ({arquivo_entrada.stat().st_size} bytes)")

    # 5. Executa envio, processamento e download via cliente oficial
    instrucao_transformacao = 'Substituir "TESTE_ORIGINAL_PENDENTE" por "TESTE_INTEGRACAO_CLIENTE_SUCESSO"'
    print(f"\n🚀 5. Enviando requisição para POST /api/ponte/v2/processar...")
    print(f"   Instrução: {instrucao_transformacao}")

    try:
        resultado = cliente.processar_arquivo(
            caminho_arquivo=str(arquivo_entrada),
            instrucao=instrucao_transformacao,
            arquivo_saida=str(arquivo_saida_esperada),
            destino_local=str(arquivo_saida_esperada)
        )

        print("\n📥 6. Resposta recebida da Ponte Alex v2:")
        print(f"   • HTTP Status: {resultado['status_http']}")
        print(f"   • Test Passed: {resultado['test_passed']}")
        print(f"   • Mensagem: {resultado['test_message']}")
        print(f"   • Exit Code Python: {resultado['execution'].get('exitCode')}")
        print(f"   • Stdout: {resultado['execution'].get('stdout', '').strip()}")
        print(f"   • Download URL: {resultado['download_url']}")
        print(f"   • Arquivo Salvo Localmente: {resultado['arquivo_salvo']}")
        print(f"   • Tamanho Salvo: {resultado['tamanho_bytes']} bytes")

        # 7. Validações de Asserção
        assert resultado["status_http"] == 200, f"HTTP deve ser 200, recebido {resultado['status_http']}"
        assert resultado["test_passed"] is True, "test_passed deve ser True"
        assert resultado["execution"].get("exitCode") == 0, "Exit Code do Python deve ser 0"
        assert "TESTE_INTEGRACAO_CLIENTE_SUCESSO" in resultado["execution"].get("stdout", ""), "Stdout deve conter o texto transformado"
        assert arquivo_saida_esperada.exists(), "O arquivo baixado deve existir no disco local"
        assert arquivo_saida_esperada.stat().st_size > 0, "O tamanho do arquivo baixado deve ser maior que zero"

        # 8. Executa localmente o arquivo baixado para confirmação extra
        conteudo_baixado = arquivo_saida_esperada.read_text(encoding="utf-8")
        assert "TESTE_INTEGRACAO_CLIENTE_SUCESSO" in conteudo_baixado, "O arquivo salvo deve conter o código alterado"

        proc_local = subprocess.run([sys.executable, str(arquivo_saida_esperada)], capture_output=True, text=True, timeout=5)
        assert proc_local.returncode == 0, "Execução local do script baixado deve retornar código 0"
        assert "TESTE_INTEGRACAO_CLIENTE_SUCESSO" in proc_local.stdout, "Saída da execução local deve conter a string alterada"

        print(f"\n🎉 7. Verificação e Execução Local do Arquivo Baixado: SUCESSO!")
        print(f"   Execução Local: Exit Code {proc_local.returncode} | Saída: '{proc_local.stdout.strip()}'")

    except ErroPonteAlex as e:
        print(f"\n❌ FALHA NO TESTE DA PONTE ALEX: {e}")
        if e.detalhes:
            print(f"Detalhes do erro: {e.detalhes}")
        sys.exit(1)
    except AssertionError as e:
        print(f"\n❌ FALHA DE ASSERÇÃO: {e}")
        sys.exit(1)
    finally:
        # Limpeza de arquivos temporários
        if arquivo_entrada.exists():
            arquivo_entrada.unlink()
        if arquivo_saida_esperada.exists():
            arquivo_saida_esperada.unlink()

    print("\n" + "=" * 65)
    print("🏆 TODOS OS TESTES DO CLIENTE OFICIAL FORAM APROVADOS COM SUCESSO!")
    print("=" * 65)

if __name__ == "__main__":
    executar_teste_automatizado()
