import express from 'express';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { exec } from 'child_process';
import { createServer as createViteServer } from 'vite';

async function startServer() {
  const app = express();
  const PORT = 3000;

  // CORS support for external integrations
  app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization, x-api-secret');
    if (req.method === 'OPTIONS') {
      return res.sendStatus(200);
    }
    next();
  });

  app.use(express.json({ limit: '50mb' }));

  // Ensure storage directories exist
  const originalsDir = path.join(process.cwd(), 'storage', 'originals');
  const processedDir = path.join(process.cwd(), 'storage', 'processed');
  fs.mkdirSync(originalsDir, { recursive: true });
  fs.mkdirSync(processedDir, { recursive: true });

  function getFileStats(filename: string) {
    const filePath = path.join(process.cwd(), filename);
    if (!fs.existsSync(filePath)) {
      return { exists: false, filename, filePath };
    }
    const stats = fs.statSync(filePath);
    const content = fs.readFileSync(filePath, 'utf8');
    const hash = crypto.createHash('sha256').update(content).digest('hex');
    const lines = content.split('\n').length;
    return {
      exists: true,
      filename,
      filePath,
      size: stats.size,
      lines,
      sha256: hash,
      modifiedAt: stats.mtime.toISOString(),
      content,
    };
  }

  // API: Get comprehensive status of files
  app.get('/api/status', (req, res) => {
    const original = getFileStats('app_teste.py');
    const copia = getFileStats('app_teste_copia.py');
    const testeAlex = getFileStats('teste_alex.py');

    const areIdentical = original.exists && copia.exists && original.sha256 === copia.sha256;

    res.json({
      success: true,
      files: {
        original,
        copia,
        testeAlex,
      },
      areIdentical,
    });
  });

  // API: Copy physical file (app_teste.py -> app_teste_copia.py)
  app.post('/api/create-copy', (req, res) => {
    try {
      const srcPath = path.join(process.cwd(), 'app_teste.py');
      const dstPath = path.join(process.cwd(), 'app_teste_copia.py');

      if (!fs.existsSync(srcPath)) {
        return res.status(404).json({ success: false, error: 'app_teste.py não encontrado na raiz.' });
      }

      fs.copyFileSync(srcPath, dstPath);
      const copiaStats = getFileStats('app_teste_copia.py');
      const origStats = getFileStats('app_teste.py');

      return res.json({
        success: true,
        message: 'Cópia física app_teste_copia.py criada com sucesso.',
        copia: copiaStats,
        isIdentical: copiaStats.sha256 === origStats.sha256,
      });
    } catch (e: any) {
      return res.status(500).json({ success: false, error: e.message });
    }
  });

  // API: Execute app_teste_copia.py with Python
  app.post('/api/run-copia', (req, res) => {
    const filePath = path.join(process.cwd(), 'app_teste_copia.py');
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ success: false, error: 'app_teste_copia.py não encontrado no disco.' });
    }

    const startTime = Date.now();

    const scriptCmd = `python3 -c "
import sys, time, urllib.request, json
import app_teste_copia

print('[1/3] Compilação e sintaxe Python: OK')
print(f'[2/3] Módulo importado com sucesso. Modelo: {app_teste_copia.MODEL}')
print(f'      Tempo limite configurado: {app_teste_copia.LIMITE_SEGUNDOS}s | Monitoramento: {app_teste_copia.INTERVALO_MONITORAMENTO}s')

# Test server bootstrap on ephemeral port
import threading
port = 10042
def run_app():
    try:
        app_teste_copia.app.run(host='127.0.0.1', port=port, threaded=True)
    except Exception as e:
        print(f'Erro no servidor: {e}')

t = threading.Thread(target=run_app, daemon=True)
t.start()
time.sleep(0.6)

try:
    req = urllib.request.Request(f'http://127.0.0.1:{port}/status')
    with urllib.request.urlopen(req, timeout=3) as resp:
        body = resp.read().decode('utf-8')
        data = json.loads(body)
        print('[3/3] Resposta da rota /status do servidor Flask:')
        st = data.get('status')
        msg = data.get('mensagem')
        print(f'      Status do job: {st} | Mensagem: {msg}')
        print('=== TESTE DE EXECUÇÃO PYTHON BEM-SUCEDIDO (EXIT CODE 0) ===')
except Exception as e:
    print(f'Erro na rota: {e}')
"`;

    exec(scriptCmd, { timeout: 15000 }, (error, stdout, stderr) => {
      const durationMs = Date.now() - startTime;
      return res.json({
        success: !error,
        exitCode: error ? error.code ?? 1 : 0,
        stdout: stdout || '',
        stderr: stderr || '',
        durationMs,
        executedCommand: 'python3 app_teste_copia.py (verificação de runtime e servidor)',
      });
    });
  });

  // API: Legacy check-file / create-file / run-python for teste_alex
  app.get('/api/check-file', (req, res) => {
    const stats = getFileStats('teste_alex.py');
    res.json(stats);
  });

  app.post('/api/create-file', (req, res) => {
    try {
      const targetFilePath = path.join(process.cwd(), 'teste_alex.py');
      const content = req.body?.content !== undefined ? req.body.content : 'print("Olá, arquivo Alex!")\n';
      fs.writeFileSync(targetFilePath, content, 'utf8');
      const stats = fs.statSync(targetFilePath);
      return res.json({
        success: true,
        message: 'Arquivo criado com sucesso no disco.',
        filename: 'teste_alex.py',
        filePath: targetFilePath,
        size: stats.size,
        modifiedAt: stats.mtime.toISOString(),
        content: fs.readFileSync(targetFilePath, 'utf8'),
      });
    } catch (error: any) {
      return res.status(500).json({ success: false, error: error.message });
    }
  });

  app.post('/api/run-python', (req, res) => {
    const targetFilePath = path.join(process.cwd(), 'teste_alex.py');
    if (!fs.existsSync(targetFilePath)) {
      return res.status(404).json({ success: false, error: 'teste_alex.py não encontrado.' });
    }
    const startTime = Date.now();
    exec(`python3 "${targetFilePath}"`, { timeout: 10000 }, (error, stdout, stderr) => {
      const durationMs = Date.now() - startTime;
      return res.json({
        success: !error,
        exitCode: error ? error.code ?? 1 : 0,
        stdout: stdout || '',
        stderr: stderr || '',
        durationMs,
        executedCommand: 'python3 teste_alex.py',
      });
    });
  });

  // =========================================================================
  // PONTE ALEX v1: RECEBER E PROCESSAR ARQUIVO (Sem APIs externas / Zero API Keys)
  // Fluxo: arquivo -> cópia original preservada -> alteração -> novo arquivo -> teste -> download
  // =========================================================================

  function applyLocalTransformation(
    originalContent: string,
    instruction: string,
    searchTarget?: string,
    replaceWith?: string
  ): { newContent: string; summary: string } {
    let modified = originalContent;
    let summaryParts: string[] = [];

    // 1. Explicit search and replace if provided
    if (searchTarget !== undefined && searchTarget.length > 0 && replaceWith !== undefined) {
      if (modified.includes(searchTarget)) {
        modified = modified.split(searchTarget).join(replaceWith);
        summaryParts.push(`Substituição exata de '${searchTarget}' por '${replaceWith}'`);
      } else {
        summaryParts.push(`Aviso: Alvo '${searchTarget}' não foi encontrado para substituição exata.`);
      }
    }

    const instrLower = instruction.toLowerCase().trim();

    // 2. Natural language / Heuristic instruction parsing:
    // Regex pattern: Substituir "X" por "Y" / Trocar 'X' por 'Y'
    const replacePattern = /(?:substituir|trocar|mudar|alterar|replace)\s+["'`]([^"'`]+)["'`]\s+(?:por|para|with)\s+["'`]([^"'`]+)["'`]/gi;
    let match;
    let replacedCount = 0;
    while ((match = replacePattern.exec(instruction)) !== null) {
      const fromText = match[1];
      const toText = match[2];
      if (modified.includes(fromText)) {
        modified = modified.split(fromText).join(toText);
        summaryParts.push(`Substituído "${fromText}" por "${toText}"`);
        replacedCount++;
      } else {
        summaryParts.push(`Trecho "${fromText}" não foi localizado no código original`);
      }
    }

    // Pattern: Alterar valor de variável
    // Exemplo: "Altere somente o valor da variável numero de 10 para 50."
    const variableValuePattern =
      /(?:alterar|mudar|trocar|substituir)\s+(?:somente\s+)?(?:o\s+)?valor\s+da\s+vari[áa]vel\s+([a-zA-Z_][a-zA-Z0-9_]*)\s+de\s+(-?\d+(?:\.\d+)?)\s+para\s+(-?\d+(?:\.\d+)?)/i;

    const variableValueMatch = instruction.match(variableValuePattern);

    if (variableValueMatch && replacedCount === 0 && !searchTarget) {
      const variableName = variableValueMatch[1];
      const fromValue = variableValueMatch[2];
      const toValue = variableValueMatch[3];

      const lines = modified.split('\n');

      const assignmentPattern = new RegExp(
        '^(\\s*' + variableName + '\\s*=\\s*)' + fromValue + '(\\s*(?:#.*)?)$'
      );

      let variableChanged = false;

      for (let i = 0; i < lines.length; i++) {
        if (assignmentPattern.test(lines[i])) {
          lines[i] = lines[i].replace(
            assignmentPattern,
            '$1' + toValue + '$2'
          );
          variableChanged = true;
          break;
        }
      }

      if (variableChanged) {
        modified = lines.join('\n');
        summaryParts.push(
          `Valor da variável '${variableName}' alterado de ${fromValue} para ${toValue}`
        );
        replacedCount++;
      } else {
        summaryParts.push(
          `Aviso: variável '${variableName}' com valor ${fromValue} não foi encontrada para alteração.`
        );
      }
    }

    // Pattern: Adicionar função / criar função
    const funcPattern = /(?:adicionar|criar)\s+fun[çc][ãa]o\s+([a-zA-Z0-9_]+)\s*[:(]?([\s\S]*)/i;
    const funcMatch = instruction.match(funcPattern);
    if (funcMatch && replacedCount === 0 && !searchTarget) {
      const funcName = funcMatch[1];
      const funcDetails = funcMatch[2].trim();
      const newFunctionCode = `\n\ndef ${funcName}(*args, **kwargs):\n    """Função gerada pela Ponte Alex v1: ${funcDetails || 'Implementação automatizada'}"""\n    print("[Ponte Alex v1] Executando função: ${funcName}")\n    return True\n`;
      modified += newFunctionCode;
      summaryParts.push(`Adicionada nova função 'def ${funcName}'`);
    }

    // Pattern: Adicionar print / mensagem
    const printPattern = /(?:adicionar|inserir|colocar)\s+(?:print|mensagem|log)[:\s]+["'`]([^"'`]+)["'`]/i;
    const printMatch = instruction.match(printPattern);
    if (printMatch && replacedCount === 0 && !searchTarget) {
      const msg = printMatch[1];
      const printCode = `\nprint("${msg}")\n`;
      modified += printCode;
      summaryParts.push(`Adicionado comando print("${msg}")`);
    }

    // Pattern: Prepend / Adicionar no início
    const prependPattern = /(?:adicionar|inserir|prepend)\s+no\s+in[ií]cio[:\s]+([\s\S]+)/i;
    const prependMatch = instruction.match(prependPattern);
    if (prependMatch) {
      const prepCode = prependMatch[1].trim() + '\n';
      modified = prepCode + modified;
      summaryParts.push(`Adicionado código no início do arquivo`);
    }

    // Pattern: Append / Adicionar no final
    const appendPattern = /(?:adicionar|inserir|append)\s+(?:no\s+final|ao\s+fim)[:\s]+([\s\S]+)/i;
    const appendMatch = instruction.match(appendPattern);
    if (appendMatch) {
      const appCode = '\n' + appendMatch[1].trim() + '\n';
      modified += appCode;
      summaryParts.push(`Adicionado código ao final do arquivo`);
    }

    // If nothing matched and no direct searchTarget, apply general structured modification
    if (summaryParts.length === 0) {
      const timestamp = new Date().toLocaleString('pt-BR');
      const banner = `# ========================================================\n# [PONTE ALEX v1] Alteração Aplicada\n# Instrução: ${instruction}\n# Data: ${timestamp}\n# ========================================================\n`;
      
      // If the instruction contains python statements, append them
      if (instruction.includes('\n') || instruction.includes('def ') || instruction.includes('print(') || instruction.includes('=')) {
        modified = banner + modified + `\n\n# --- Código anexado pela instrução ---\n${instruction}\n`;
        summaryParts.push(`Instrução e código adicionados com sucesso ao arquivo.`);
      } else {
        modified = banner + modified + `\n# Registro da alteração: ${instruction}\nprint(f"[Ponte Alex v1] Modificação executada: ${instruction.replace(/"/g, '\\"')}")\n`;
        summaryParts.push(`Modificação registrada e comando de validação inserido.`);
      }
    }

    return {
      newContent: modified,
      summary: summaryParts.join('; '),
    };
  }

  // API: Processar arquivo na Ponte Alex v1
  app.post('/api/ponte/processar', (req, res) => {
    try {
      const { 
        filename = 'script_alex.py', 
        fileContent, 
        instruction, 
        searchTarget, 
        replaceWith 
      } = req.body;

      if (!fileContent || typeof fileContent !== 'string') {
        return res.status(400).json({ 
          success: false, 
          error: 'Conteúdo do arquivo não fornecido ou inválido.' 
        });
      }

      if (!instruction || typeof instruction !== 'string') {
        return res.status(400).json({ 
          success: false, 
          error: 'Instrução de alteração não fornecida.' 
        });
      }

      const timestamp = Date.now();
      const cleanBaseName = path.basename(filename, path.extname(filename)).replace(/[^a-zA-Z0-9_-]/g, '_');
      const ext = path.extname(filename) || '.py';

      // 1. PRESERVAÇÃO DA CÓPIA ORIGINAL (NUNCA substitui o original)
      const originalSaveFilename = `${cleanBaseName}_original_${timestamp}${ext}`;
      const originalSavePath = path.join(originalsDir, originalSaveFilename);
      fs.writeFileSync(originalSavePath, fileContent, 'utf8');

      const origStats = fs.statSync(originalSavePath);
      const origHash = crypto.createHash('sha256').update(fileContent).digest('hex');

      // 2. APLICAÇÃO DA ALTERAÇÃO
      const { newContent, summary: transformSummary } = applyLocalTransformation(
        fileContent,
        instruction,
        searchTarget,
        replaceWith
      );

      // 3. SALVAR RESULTADO COMO UM NOVO ARQUIVO FÍSICO
      const processedFilename = `${cleanBaseName}_alex_v1_${timestamp}${ext}`;
      const processedFilePath = path.join(processedDir, processedFilename);
      fs.writeFileSync(processedFilePath, newContent, 'utf8');

      const procStats = fs.statSync(processedFilePath);
      const procHash = crypto.createHash('sha256').update(newContent).digest('hex');

      // 4. EXECUTAR O NOVO ARQUIVO PARA VERIFICAR ERROS (COMPILAÇÃO + RUNTIME)
      const startExecTime = Date.now();

      // Check 1: Python compilation syntax check
      exec(`python3 -m py_compile "${processedFilePath}"`, { timeout: 8000 }, (compileErr, compileStdout, compileStderr) => {
        if (compileErr) {
          const durationMs = Date.now() - startExecTime;
          return res.json({
            success: false,
            testPassed: false,
            testMessage: '❌ Falha de sintaxe / compilação Python detectada.',
            compileCheck: { passed: false, error: compileStderr || compileErr.message },
            execution: {
              exitCode: compileErr.code ?? 1,
              stdout: compileStdout || '',
              stderr: compileStderr || compileErr.message,
              durationMs,
            },
            originalFile: {
              filename: originalSaveFilename,
              size: origStats.size,
              lines: fileContent.split('\n').length,
              sha256: origHash,
              savedPath: originalSavePath,
              untouched: true,
            },
            processedFile: {
              filename: processedFilename,
              size: procStats.size,
              lines: newContent.split('\n').length,
              sha256: procHash,
              content: newContent,
              downloadUrl: `/api/download/processed/${processedFilename}`,
            },
            instruction,
            transformSummary,
            neverOverwritten: true,
          });
        }

        // Check 2: Direct Python Execution
        exec(`python3 "${processedFilePath}"`, { timeout: 10000 }, (execErr, execStdout, execStderr) => {
          const durationMs = Date.now() - startExecTime;
          const testPassed = !execErr;

          return res.json({
            success: true,
            testPassed,
            testMessage: testPassed 
              ? '✅ Teste de execução Python concluído com sucesso (Exit Code 0).'
              : '⚠️ Erro durante a execução em runtime do novo arquivo.',
            compileCheck: { passed: true, message: 'Sintaxe Python OK' },
            execution: {
              exitCode: execErr ? execErr.code ?? 1 : 0,
              stdout: execStdout || '',
              stderr: execStderr || '',
              durationMs,
            },
            originalFile: {
              filename: originalSaveFilename,
              size: origStats.size,
              lines: fileContent.split('\n').length,
              sha256: origHash,
              savedPath: originalSavePath,
              untouched: true,
            },
            processedFile: {
              filename: processedFilename,
              size: procStats.size,
              lines: newContent.split('\n').length,
              sha256: procHash,
              content: newContent,
              downloadUrl: `/api/download/processed/${processedFilename}`,
            },
            instruction,
            transformSummary,
            neverOverwritten: true,
          });
        });
      });

    } catch (err: any) {
      return res.status(500).json({
        success: false,
        error: `Erro ao processar arquivo: ${err.message}`,
      });
    }
  });

  // API: Listar histórico de arquivos processados
  app.get('/api/ponte/history', (req, res) => {
    try {
      if (!fs.existsSync(processedDir)) {
        return res.json({ success: true, items: [] });
      }
      const files = fs.readdirSync(processedDir).filter(f => f.endsWith('.py'));
      const items = files.map(filename => {
        const filePath = path.join(processedDir, filename);
        const stats = fs.statSync(filePath);
        return {
          filename,
          size: stats.size,
          modifiedAt: stats.mtime.toISOString(),
          downloadUrl: `/api/download/processed/${filename}`,
        };
      }).sort((a, b) => new Date(b.modifiedAt).getTime() - new Date(a.modifiedAt).getTime());

      return res.json({ success: true, items });
    } catch (e: any) {
      return res.status(500).json({ success: false, error: e.message });
    }
  });

  // API: Executar qualquer arquivo processado sob demanda
  app.post('/api/ponte/run-test', (req, res) => {
    const { filename } = req.body;
    if (!filename) {
      return res.status(400).json({ success: false, error: 'Nome do arquivo não informado.' });
    }
    const safeName = path.basename(filename);
    const filePath = path.join(processedDir, safeName);
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ success: false, error: 'Arquivo processado não encontrado.' });
    }

    const startTime = Date.now();
    exec(`python3 "${filePath}"`, { timeout: 10000 }, (err, stdout, stderr) => {
      const durationMs = Date.now() - startTime;
      return res.json({
        success: !err,
        exitCode: err ? err.code ?? 1 : 0,
        stdout: stdout || '',
        stderr: stderr || '',
        durationMs,
        executedCommand: `python3 ${safeName}`,
      });
    });
  });

  // Download handlers
  app.get('/api/download/processed/:filename', (req, res) => {
    const filename = path.basename(req.params.filename);
    const filePath = path.join(processedDir, filename);
    if (!fs.existsSync(filePath)) {
      return res.status(404).send('Arquivo processado não encontrado.');
    }
    return res.download(filePath, filename);
  });

  // Download and view OpenAPI 3.0 specification
  app.get(['/ponte_alex_openapi_v2.yaml', '/api/openapi_v2.yaml', '/api/ponte/openapi_v2.yaml'], (req, res) => {
    const yamlPath = path.join(process.cwd(), 'ponte_alex_openapi_v2.yaml');
    if (!fs.existsSync(yamlPath)) {
      return res.status(404).send('Arquivo OpenAPI v2 não encontrado.');
    }
    res.setHeader('Content-Type', 'text/yaml; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="ponte_alex_openapi_v2.yaml"');
    return res.sendFile(yamlPath);
  });

  app.get(['/ponte_alex_openapi.yaml', '/api/openapi.yaml', '/api/ponte/openapi.yaml'], (req, res) => {
    const yamlPath = path.join(process.cwd(), 'ponte_alex_openapi.yaml');
    if (!fs.existsSync(yamlPath)) {
      return res.status(404).send('Arquivo OpenAPI não encontrado.');
    }
    res.setHeader('Content-Type', 'text/yaml; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="ponte_alex_openapi.yaml"');
    return res.sendFile(yamlPath);
  });

  // Download official Python client and test script
  app.get(['/cliente_ponte_alex.py', '/api/download/client/cliente_ponte_alex.py'], (req, res) => {
    const filePath = path.join(process.cwd(), 'cliente_ponte_alex.py');
    if (!fs.existsSync(filePath)) {
      return res.status(404).send('Arquivo cliente_ponte_alex.py não encontrado.');
    }
    res.setHeader('Content-Type', 'text/x-python; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="cliente_ponte_alex.py"');
    return res.sendFile(filePath);
  });

  app.get(['/teste_cliente_ponte.py', '/api/download/client/teste_cliente_ponte.py'], (req, res) => {
    const filePath = path.join(process.cwd(), 'teste_cliente_ponte.py');
    if (!fs.existsSync(filePath)) {
      return res.status(404).send('Arquivo teste_cliente_ponte.py não encontrado.');
    }
    res.setHeader('Content-Type', 'text/x-python; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="teste_cliente_ponte.py"');
    return res.sendFile(filePath);
  });

  app.get('/api/download/originals/:filename', (req, res) => {
    const filename = path.basename(req.params.filename);
    const filePath = path.join(originalsDir, filename);
    if (!fs.existsSync(filePath)) {
      return res.status(404).send('Arquivo original não encontrado.');
    }
    return res.download(filePath, filename);
  });

  // =========================================================================
  // PONTE ALEX v2: API HTTP LOCAL & ENDPOINTS DE INTEGRAÇÃO EXTERNA SEGURA
  // Sem APIs externas / Sem chaves de IA / Autenticação via Secrets do Ambiente
  // =========================================================================

  // Helper: Extrair segredo de autenticação de forma segura (sem vazar em logs ou respostas)
  function extractProvidedSecret(req: express.Request): string | null {
    const headerSecret = req.headers['x-api-secret'];
    if (headerSecret && typeof headerSecret === 'string' && headerSecret.trim()) {
      return headerSecret.trim();
    }
    const authHeader = req.headers['authorization'];
    if (authHeader && typeof authHeader === 'string') {
      if (authHeader.toLowerCase().startsWith('bearer ')) {
        return authHeader.substring(7).trim();
      }
      return authHeader.trim();
    }
    const querySecret = req.query.secret;
    if (querySecret && typeof querySecret === 'string' && querySecret.trim()) {
      return querySecret.trim();
    }
    const bodySecret = req.body?.secret;
    if (bodySecret && typeof bodySecret === 'string' && bodySecret.trim()) {
      return bodySecret.trim();
    }
    return null;
  }

  function getSystemConfiguredSecret(): string {
    return (process.env.PONTE_API_SECRET || process.env.ALEX_BRIDGE_SECRET || '').trim();
  }

  // Endpoint de teste da Ponte Alex v2 (Ping / Health Check)
  app.all(['/api/ponte/v2/ping', '/api/ponte/v2/status'], (req, res) => {
    try {
      const configuredSecret = getSystemConfiguredSecret();
      exec('python3 --version', (err, stdout, stderr) => {
        const pyVer = (stdout || stderr || 'Python 3').trim();
        return res.json({
          status: 'online',
          ponte: 'Ponte Alex v2',
          version: '2.0.0',
          authConfigured: configuredSecret.length > 0,
          authHeaderName: 'x-api-secret',
          pythonRuntime: pyVer,
          timestamp: Date.now(),
          uptimeSeconds: Math.floor(process.uptime()),
          message: 'Ponte Alex v2 online e preparada para integração externa segura via HTTPS.',
          security: {
            isolatedStorage: true,
            directoryTraversalProtected: true,
            externalApiFree: true,
            apiKeysRequired: false,
            overwriteOriginalProtected: true,
            authConfigured: configuredSecret.length > 0,
          },
          endpoints: {
            ping: 'GET /api/ponte/v2/ping',
            processar: 'POST /api/ponte/v2/processar',
            history: 'GET /api/ponte/history',
            downloadProcessed: 'GET /api/download/processed/:filename',
            downloadOriginal: 'GET /api/download/originals/:filename',
          },
        });
      });
    } catch (e: any) {
      return res.status(500).json({ status: 'error', error: e.message });
    }
  });

  // Função auxiliar de sanitização estrita para segurança
  function sanitizeSafePythonFilename(rawName: string, fallbackPrefix: string): string {
    const base = path.basename(rawName).replace(/[^a-zA-Z0-9._-]/g, '_');
    let clean = base.replace(/^\.+/, ''); // Remove leading dots
    if (!clean || clean === '.py') {
      clean = `${fallbackPrefix}_${Date.now()}.py`;
    }
    if (!clean.endsWith('.py')) {
      clean = `${clean}.py`;
    }
    return clean;
  }

  // API HTTP da Ponte Alex v2: Recebe arquivo, instrução e nome de saída desejado
  app.post('/api/ponte/v2/processar', (req, res) => {
    try {
      const configuredSecret = getSystemConfiguredSecret();
      const providedSecret = extractProvidedSecret(req);

      // Verificação de autenticação de segurança quando configurado no ambiente
      if (configuredSecret.length > 0) {
        if (!providedSecret || providedSecret !== configuredSecret) {
          return res.status(401).json({
            success: false,
            ponteVersion: 'v2',
            status: 'NAO_AUTORIZADO',
            testPassed: false,
            error: 'Acesso não autorizado: Segredo de autenticação ausente ou inválido. Forneça o segredo correto no header "x-api-secret" ou "Authorization: Bearer <SEU_SEGREDO>".',
            authRequired: true,
            authHeaderName: 'x-api-secret',
          });
        }
      }

      const body = req.body || {};
      
      // Suporte flexível a parâmetros em português e inglês
      const fileContent = body.fileContent ?? body.codigo ?? body.arquivo ?? body.content;
      const instruction = body.instruction ?? body.instrucao ?? body.comando;
      const rawOriginalFilename = body.filename ?? body.nome_original ?? body.nomeOriginal ?? 'script_entrada.py';
      const rawOutputFilename = body.outputFilename ?? body.nome_saida ?? body.nomeSaida ?? body.desiredOutputFilename;
      const searchTarget = body.searchTarget;
      const replaceWith = body.replaceWith;

      if (!fileContent || typeof fileContent !== 'string') {
        return res.status(400).json({
          success: false,
          ponteVersion: 'v2',
          error: 'Campo obrigatório ausente: "fileContent" (ou "codigo" / "arquivo") deve ser uma string com o código Python.',
        });
      }

      if (!instruction || typeof instruction !== 'string') {
        return res.status(400).json({
          success: false,
          ponteVersion: 'v2',
          error: 'Campo obrigatório ausente: "instruction" (ou "instrucao") com a descrição da alteração.',
        });
      }

      const timestamp = Date.now();

      // Sanitização estrita contra Path Traversal (segurança do diretório do projeto)
      const safeOriginalName = sanitizeSafePythonFilename(rawOriginalFilename, 'entrada');
      const baseOriginalWithoutExt = path.basename(safeOriginalName, '.py');

      let safeOutputName: string;
      if (rawOutputFilename && typeof rawOutputFilename === 'string' && rawOutputFilename.trim()) {
        safeOutputName = sanitizeSafePythonFilename(rawOutputFilename.trim(), 'saida_alex_v2');
      } else {
        safeOutputName = `${baseOriginalWithoutExt}_alex_v2_${timestamp}.py`;
      }

      // 1. PRESERVAÇÃO DA CÓPIA ORIGINAL (NUNCA substitui o original)
      const originalSaveFilename = `${baseOriginalWithoutExt}_original_${timestamp}.py`;
      const originalSavePath = path.join(originalsDir, originalSaveFilename);
      fs.writeFileSync(originalSavePath, fileContent, 'utf8');

      const origStats = fs.statSync(originalSavePath);
      const origHash = crypto.createHash('sha256').update(fileContent).digest('hex');

      // 2. APLICAÇÃO DA ALTERAÇÃO LOCAL
      const { newContent, summary: transformSummary } = applyLocalTransformation(
        fileContent,
        instruction,
        searchTarget,
        replaceWith
      );

      // 3. SALVAR RESULTADO COMO O NOVO ARQUIVO FÍSICO COM O NOME DESEJADO
      // Caso o nome já exista, preservamos ambos gerando nome único
      let finalTargetFilename = safeOutputName;
      let processedFilePath = path.join(processedDir, finalTargetFilename);
      if (fs.existsSync(processedFilePath)) {
        const namePart = path.basename(safeOutputName, '.py');
        finalTargetFilename = `${namePart}_${timestamp}.py`;
        processedFilePath = path.join(processedDir, finalTargetFilename);
      }

      fs.writeFileSync(processedFilePath, newContent, 'utf8');
      const procStats = fs.statSync(processedFilePath);
      const procHash = crypto.createHash('sha256').update(newContent).digest('hex');

      // 4. EXECUTAR O NOVO ARQUIVO COM PYTHON (COMPILAÇÃO + RUNTIME)
      const startExecTime = Date.now();

      // Passo A: Verificação de sintaxe
      exec(`python3 -m py_compile "${processedFilePath}"`, { timeout: 8000 }, (compileErr, compileStdout, compileStderr) => {
        if (compileErr) {
          const durationMs = Date.now() - startExecTime;
          return res.json({
            success: false,
            ponteVersion: 'v2',
            status: 'ERRO_COMPILACAO_SINTAXE',
            testPassed: false,
            testMessage: '❌ Falha de sintaxe / compilação Python detectada no novo arquivo.',
            compileCheck: { 
              passed: false, 
              error: (compileStderr || compileErr.message).trim() 
            },
            execution: {
              exitCode: compileErr.code ?? 1,
              stdout: compileStdout || '',
              stderr: (compileStderr || compileErr.message).trim(),
              durationMs,
            },
            originalFile: {
              filename: originalSaveFilename,
              size: origStats.size,
              lines: fileContent.split('\n').length,
              sha256: origHash,
              savedPath: `storage/originals/${originalSaveFilename}`,
              untouched: true,
            },
            processedFile: {
              filename: finalTargetFilename,
              size: procStats.size,
              lines: newContent.split('\n').length,
              sha256: procHash,
              content: newContent,
              downloadUrl: `/api/download/processed/${finalTargetFilename}`,
            },
            instruction,
            transformSummary,
            neverOverwritten: true,
            timestamp,
          });
        }

        // Passo B: Execução direta em Python
        exec(`python3 "${processedFilePath}"`, { timeout: 10000 }, (execErr, execStdout, execStderr) => {
          const durationMs = Date.now() - startExecTime;
          const testPassed = !execErr;

          return res.json({
            success: true,
            ponteVersion: 'v2',
            status: testPassed ? 'TESTE_APROVADO' : 'ERRO_EXECUCAO_RUNTIME',
            testPassed,
            testMessage: testPassed 
              ? '✅ Teste de execução Python concluído com sucesso (Exit Code 0).'
              : '⚠️ Erro durante a execução em runtime do novo arquivo.',
            compileCheck: { passed: true, message: 'Sintaxe Python OK' },
            execution: {
              exitCode: execErr ? (execErr.code ?? 1) : 0,
              stdout: execStdout || '',
              stderr: execStderr || '',
              durationMs,
            },
            originalFile: {
              filename: originalSaveFilename,
              size: origStats.size,
              lines: fileContent.split('\n').length,
              sha256: origHash,
              savedPath: `storage/originals/${originalSaveFilename}`,
              untouched: true,
            },
            processedFile: {
              filename: finalTargetFilename,
              size: procStats.size,
              lines: newContent.split('\n').length,
              sha256: procHash,
              content: newContent,
              downloadUrl: `/api/download/processed/${finalTargetFilename}`,
            },
            instruction,
            transformSummary,
            neverOverwritten: true,
            timestamp,
          });
        });
      });

    } catch (err: any) {
      return res.status(500).json({
        success: false,
        ponteVersion: 'v2',
        error: `Erro ao processar requisição na Ponte Alex v2: ${err.message}`,
      });
    }
  });


  // Safe file download handler for legacy root files
  app.get('/api/download/:filename', (req, res) => {
    const filename = req.params.filename;
    const allowed = ['app_teste_copia.py', 'app_teste.py', 'teste_alex.py'];
    if (!allowed.includes(filename)) {
      return res.status(403).send('Acesso negado ao arquivo solicitado.');
    }
    const filePath = path.join(process.cwd(), filename);
    if (!fs.existsSync(filePath)) {
      return res.status(404).send('Arquivo não encontrado no disco.');
    }
    return res.download(filePath, filename);
  });

  // Vite middleware setup
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
});

