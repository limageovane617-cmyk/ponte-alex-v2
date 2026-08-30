import express from 'express';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { execFile } from 'child_process';
import { createServer as createViteServer } from 'vite';
import os from 'os';

async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT || 3000);

  // ============================================================
  // CONFIGURAÇÃO GERAL
  // ============================================================

  app.disable('x-powered-by');

  // CORS
  app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header(
      'Access-Control-Allow-Methods',
      'GET, POST, PUT, DELETE, OPTIONS'
    );
    res.header(
      'Access-Control-Allow-Headers',
      'Origin, X-Requested-With, Content-Type, Accept, Authorization, x-api-secret'
    );

    if (req.method === 'OPTIONS') {
      return res.sendStatus(200);
    }

    next();
  });

  // Limite máximo do JSON recebido.
  app.use(express.json({ limit: '50mb' }));

  // ============================================================
  // DIRETÓRIOS DA PONTE
  // ============================================================

  const storageDir = path.join(process.cwd(), 'storage');
  const originalsDir = path.join(storageDir, 'originals');
  const processedDir = path.join(storageDir, 'processed');

  fs.mkdirSync(storageDir, { recursive: true });
  fs.mkdirSync(originalsDir, { recursive: true });
  fs.mkdirSync(processedDir, { recursive: true });

  // ============================================================
  // CONFIGURAÇÕES DE SEGURANÇA
  // ============================================================

  const PYTHON_COMMAND = process.env.PYTHON_COMMAND || 'python3';

  const COMPILE_TIMEOUT_MS = 8_000;
  const EXECUTION_TIMEOUT_MS = 10_000;

  // ============================================================
  // UTILITÁRIOS
  // ============================================================

  function formatBytes(bytes: number): string {
    if (!Number.isFinite(bytes) || bytes < 0) {
      return '0 B';
    }

    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let size = bytes;
    let index = 0;

    while (size >= 1024 && index < units.length - 1) {
      size /= 1024;
      index++;
    }

    return `${size.toFixed(2)} ${units[index]}`;
  }

  function calculateDirectorySize(
    dirPath: string
  ): {
    totalSize: number;
    fileCount: number;
  } {
    let totalSize = 0;
    let fileCount = 0;

    try {
      if (!fs.existsSync(dirPath)) {
        return {
          totalSize: 0,
          fileCount: 0,
        };
      }

      const entries = fs.readdirSync(dirPath);

      for (const entry of entries) {
        const fullPath = path.join(dirPath, entry);

        try {
          const stat = fs.statSync(fullPath);

          if (stat.isFile()) {
            totalSize += stat.size;
            fileCount++;
          }
        } catch {
          // Ignora arquivos que não puderem ser lidos.
        }
      }
    } catch {
      // Retorna zero caso o diretório não possa ser lido.
    }

    return {
      totalSize,
      fileCount,
    };
  }

  function getNodeProcessMemory(): {
    rss: number;
    heapUsed: number;
    heapTotal: number;
    external: number;
    arrayBuffers: number;
  } {
    const memory = process.memoryUsage();

    return {
      rss: memory.rss,
      heapUsed: memory.heapUsed,
      heapTotal: memory.heapTotal,
      external: memory.external,
      arrayBuffers: memory.arrayBuffers,
    };
  }

  function getSystemMemoryInfo() {
    const totalBytes = os.totalmem();
    const availableBytes = os.freemem();
    const usedBytes = Math.max(0, totalBytes - availableBytes);

    return {
      totalBytes,
      usedBytes,
      availableBytes,
      usagePercentage:
        totalBytes > 0
          ? Number(((usedBytes / totalBytes) * 100).toFixed(2))
          : 0,
      totalFormatted: formatBytes(totalBytes),
      usedFormatted: formatBytes(usedBytes),
      availableFormatted: formatBytes(availableBytes),
    };
  }

  function getDiskInfo() {
    /*
     * Node.js não possui uma API portátil simples para obter
     * espaço de disco em todos os ambientes.
     *
     * Portanto, aqui informamos o tamanho dos arquivos armazenados
     * pela Ponte, sem fingir que isso representa o disco inteiro.
     */
    const originals = calculateDirectorySize(originalsDir);
    const processed = calculateDirectorySize(processedDir);

    const bridgeUsedBytes =
      originals.totalSize + processed.totalSize;

    return {
      bridgeStorageBytes: bridgeUsedBytes,
      bridgeStorageFormatted: formatBytes(bridgeUsedBytes),
      originalsBytes: originals.totalSize,
      originalsFormatted: formatBytes(originals.totalSize),
      processedBytes: processed.totalSize,
      processedFormatted: formatBytes(processed.totalSize),
    };
  }

  function sha256(content: string): string {
    return crypto
      .createHash('sha256')
      .update(content, 'utf8')
      .digest('hex');
  }

  function getFileStats(filename: string) {
    const safeFilename = path.basename(filename);
    const filePath = path.join(process.cwd(), safeFilename);

    if (!fs.existsSync(filePath)) {
      return {
        exists: false,
        filename: safeFilename,
        filePath,
      };
    }

    const stats = fs.statSync(filePath);
    const content = fs.readFileSync(filePath, 'utf8');

    return {
      exists: true,
      filename: safeFilename,
      filePath,
      size: stats.size,
      lines: content.split('\n').length,
      sha256: sha256(content),
      modifiedAt: stats.mtime.toISOString(),
      content,
    };
  }

  function sanitizeSafePythonFilename(
    rawName: unknown,
    fallbackPrefix: string
  ): string {
    const value =
      typeof rawName === 'string'
        ? rawName.trim()
        : '';

    const basename = path.basename(value);

    let clean = basename
      .replace(/[^a-zA-Z0-9._-]/g, '_')
      .replace(/^\.+/, '');

    if (!clean || clean === '.py') {
      clean = `${fallbackPrefix}_${Date.now()}.py`;
    }

    if (!clean.toLowerCase().endsWith('.py')) {
      clean += '.py';
    }

    return clean;
  }

  function getConfiguredSecret(): string {
    return (
      process.env.PONTE_API_SECRET ||
      process.env.ALEX_BRIDGE_SECRET ||
      ''
    ).trim();
  }

  function extractProvidedSecret(
    req: express.Request
  ): string | null {
    const headerSecret = req.headers['x-api-secret'];

    if (
      typeof headerSecret === 'string' &&
      headerSecret.trim()
    ) {
      return headerSecret.trim();
    }

    const authorization = req.headers.authorization;

    if (typeof authorization === 'string') {
      const value = authorization.trim();

      if (value.toLowerCase().startsWith('bearer ')) {
        return value.substring(7).trim();
      }

      if (value) {
        return value;
      }
    }

    const querySecret = req.query.secret;

    if (
      typeof querySecret === 'string' &&
      querySecret.trim()
    ) {
      return querySecret.trim();
    }

    const bodySecret = req.body?.secret;

    if (
      typeof bodySecret === 'string' &&
      bodySecret.trim()
    ) {
      return bodySecret.trim();
    }

    return null;
  }

  function requireAuthentication(
    req: express.Request,
    res: express.Response
  ): boolean {
    const configuredSecret = getConfiguredSecret();

    /*
     * Endpoints capazes de executar Python NÃO funcionam
     * sem Secret configurado.
     */
    if (!configuredSecret) {
      res.status(503).json({
        success: false,
        ponteVersion: 'v2',
        status: 'AUTHENTICATION_NOT_CONFIGURED',
        error:
          'A Ponte Alex v2 está protegida: configure PONTE_API_SECRET ou ALEX_BRIDGE_SECRET antes de executar arquivos.',
        authRequired: true,
        authHeaderName: 'x-api-secret',
      });

      return false;
    }

    const providedSecret = extractProvidedSecret(req);

    if (!providedSecret || providedSecret !== configuredSecret) {
      res.status(401).json({
        success: false,
        ponteVersion: 'v2',
        status: 'NAO_AUTORIZADO',
        testPassed: false,
        error:
          'Acesso não autorizado. Forneça o segredo correto no header x-api-secret ou Authorization: Bearer <SEU_SEGREDO>.',
        authRequired: true,
        authHeaderName: 'x-api-secret',
      });

      return false;
    }

    return true;
  }

  function isSafeStoredPythonFilename(
    filename: unknown
  ): filename is string {
    if (typeof filename !== 'string') {
      return false;
    }

    const clean = path.basename(filename);

    return (
      clean === filename &&
      clean.length > 0 &&
      clean.toLowerCase().endsWith('.py') &&
      !clean.includes('..')
    );
  }

  // ============================================================
  // TRANSFORMAÇÃO LOCAL DO PYTHON
  // ============================================================

  function applyLocalTransformation(
    originalContent: string,
    instruction: string,
    searchTarget?: unknown,
    replaceWith?: unknown
  ): {
    newContent: string;
    summary: string;
  } {
    let modified = originalContent;
    const summaryParts: string[] = [];

    // ----------------------------------------------------------
    // 1. Substituição direta
    // ----------------------------------------------------------

    if (
      typeof searchTarget === 'string' &&
      searchTarget.length > 0 &&
      typeof replaceWith === 'string'
    ) {
      if (modified.includes(searchTarget)) {
        modified = modified.split(searchTarget).join(replaceWith);

        summaryParts.push(
          `Substituição exata de "${searchTarget}" por "${replaceWith}".`
        );
      } else {
        summaryParts.push(
          `Aviso: o alvo "${searchTarget}" não foi encontrado.`
        );
      }
    }

    // ----------------------------------------------------------
    // 2. Substituir "X" por "Y"
    // ----------------------------------------------------------

    const replacePattern =
      /(?:substituir|trocar|mudar|alterar|replace)\s+["'`]([^"'`]+)["'`]\s+(?:por|para|with)\s+["'`]([^"'`]+)["'`]/gi;

    let match: RegExpExecArray | null;
    let replacedCount = 0;

    while ((match = replacePattern.exec(instruction)) !== null) {
      const fromText = match[1];
      const toText = match[2];

      if (modified.includes(fromText)) {
        modified = modified.split(fromText).join(toText);

        summaryParts.push(
          `Substituído "${fromText}" por "${toText}".`
        );

        replacedCount++;
      } else {
        summaryParts.push(
          `Trecho "${fromText}" não localizado.`
        );
      }
    }

    // ----------------------------------------------------------
    // 3. Alterar valor de variável
    // ----------------------------------------------------------

    const variableValuePattern =
      /(?:alterar|mudar|trocar|substituir)\s+(?:somente\s+)?(?:o\s+)?valor\s+da\s+vari[áa]vel\s+([a-zA-Z_][a-zA-Z0-9_]*)\s+de\s+(-?\d+(?:\.\d+)?)\s+para\s+(-?\d+(?:\.\d+)?)/i;

    const variableValueMatch =
      instruction.match(variableValuePattern);

    if (
      variableValueMatch &&
      replacedCount === 0 &&
      typeof searchTarget !== 'string'
    ) {
      const variableName = variableValueMatch[1];
      const fromValue = variableValueMatch[2];
      const toValue = variableValueMatch[3];

      const lines = modified.split('\n');

      const assignmentPattern = new RegExp(
        `^(\\s*${variableName}\\s*=\\s*)${fromValue}(\\s*(?:#.*)?)$`
      );

      let variableChanged = false;

      for (let i = 0; i < lines.length; i++) {
        if (assignmentPattern.test(lines[i])) {
          lines[i] = lines[i].replace(
            assignmentPattern,
            `$1${toValue}$2`
          );

          variableChanged = true;
          break;
        }
      }

      if (variableChanged) {
        modified = lines.join('\n');

        summaryParts.push(
          `Valor da variável "${variableName}" alterado de ${fromValue} para ${toValue}.`
        );
      } else {
        summaryParts.push(
          `Aviso: variável "${variableName}" com valor ${fromValue} não encontrada.`
        );
      }
    }

    // ----------------------------------------------------------
    // 4. Adicionar função
    // ----------------------------------------------------------

    const functionPattern =
      /(?:adicionar|criar)\s+fun[çc][ãa]o\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*(?::|\()?([\s\S]*)/i;

    const functionMatch =
      instruction.match(functionPattern);

    if (
      functionMatch &&
      replacedCount === 0 &&
      typeof searchTarget !== 'string'
    ) {
      const functionName = functionMatch[1];
      const functionDetails =
        functionMatch[2]?.trim() ||
        'Implementação automatizada';

      const newFunctionCode = `

def ${functionName}(*args, **kwargs):
    """Função adicionada pela Ponte Alex v2.
    
    Instrução:
    ${functionDetails.replace(/\*\//g, '')}
    """
    print("[Ponte Alex v2] Função ${functionName} executada.")
`;

      modified += newFunctionCode;

      summaryParts.push(
        `Nova função "def ${functionName}" adicionada.`
      );
    }

    // ----------------------------------------------------------
    // 5. Adicionar print
    // ----------------------------------------------------------

    const printPattern =
      /(?:adicionar|inserir|colocar)\s+(?:print|mensagem|log)[:\s]+["'`]([^"'`]+)["'`]/i;

    const printMatch =
      instruction.match(printPattern);

    if (
      printMatch &&
      replacedCount === 0 &&
      typeof searchTarget !== 'string'
    ) {
      const message = printMatch[1].replace(/\\/g, '\\\\').replace(/"/g, '\\"');

      modified += `\n\nprint("${message}")\n`;

      summaryParts.push(
        `Comando print("${printMatch[1]}") adicionado.`
      );
    }

    // ----------------------------------------------------------
    // 6. Adicionar no início
    // ----------------------------------------------------------

    const prependPattern =
      /(?:adicionar|inserir|prepend)\s+no\s+in[ií]cio[:\s]+([\s\S]+)/i;

    const prependMatch =
      instruction.match(prependPattern);

    if (prependMatch) {
      const code = prependMatch[1].trim();

      if (code) {
        modified = `${code}\n${modified}`;

        summaryParts.push(
          'Código adicionado ao início do arquivo.'
        );
      }
    }

    // ----------------------------------------------------------
    // 7. Adicionar no final
    // ----------------------------------------------------------

    const appendPattern =
      /(?:adicionar|inserir|append)\s+(?:no\s+final|ao\s+fim)[:\s]+([\s\S]+)/i;

    const appendMatch =
      instruction.match(appendPattern);

    if (appendMatch) {
      const code = appendMatch[1].trim();

      if (code) {
        modified += `\n\n${code}\n`;

        summaryParts.push(
          'Código adicionado ao final do arquivo.'
        );
      }
    }

    // ----------------------------------------------------------
    // 8. Nenhum padrão reconhecido
    // ----------------------------------------------------------

    if (summaryParts.length === 0) {
      const timestamp = new Date().toLocaleString('pt-BR');

      const banner =
        `# ========================================================\n` +
        `# [PONTE ALEX v2] Registro de alteração\n` +
        `# Instrução: ${instruction}\n` +
        `# Data: ${timestamp}\n` +
        `# ========================================================\n\n`;

      if (
        instruction.includes('\n') ||
        instruction.includes('def ') ||
        instruction.includes('print(') ||
        instruction.includes('=')
      ) {
        modified =
          banner +
          modified +
          `\n\n# --- Código anexado pela instrução ---\n` +
          instruction +
          '\n';

        summaryParts.push(
          'Instrução/código anexado ao arquivo.'
        );
      } else {
        const safeInstruction = instruction
          .replace(/\\/g, '\\\\')
          .replace(/"/g, '\\"');

        modified =
          banner +
          modified +
          `\n\nprint("[Ponte Alex v2] Modificação registrada: ${safeInstruction}")\n`;

        summaryParts.push(
          'Instrução registrada e comando de validação inserido.'
        );
      }
    }

    return {
      newContent: modified,
      summary: summaryParts.join(' '),
    };
  }

  // ============================================================
  // API DE STATUS DOS ARQUIVOS LEGADOS
  // ============================================================

  app.get('/api/status', (_req, res) => {
    try {
      const original = getFileStats('app_teste.py');
      const copia = getFileStats('app_teste_copia.py');
      const testeAlex = getFileStats('teste_alex.py');

      const areIdentical =
        original.exists &&
        copia.exists &&
        original.sha256 === copia.sha256;

      return res.json({
        success: true,
        files: {
          original,
          copia,
          testeAlex,
        },
        areIdentical,
      });
    } catch (error: any) {
      return res.status(500).json({
        success: false,
        error: error?.message || 'Erro ao verificar arquivos.',
      });
    }
  });

  // ============================================================
  // CRIAR CÓPIA
  // ============================================================

  app.post('/api/create-copy', (req, res) => {
    try {
      const srcPath = path.join(
        process.cwd(),
        'app_teste.py'
      );

      const dstPath = path.join(
        process.cwd(),
        'app_teste_copia.py'
      );

      if (!fs.existsSync(srcPath)) {
        return res.status(404).json({
          success: false,
          error: 'app_teste.py não encontrado na raiz.',
        });
      }

      fs.copyFileSync(srcPath, dstPath);

      const original = getFileStats('app_teste.py');
      const copia = getFileStats('app_teste_copia.py');

      return res.json({
        success: true,
        message:
          'Cópia física app_teste_copia.py criada com sucesso.',
        copia,
        isIdentical:
          original.exists &&
          copia.exists &&
          original.sha256 === copia.sha256,
      });
    } catch (error: any) {
      return res.status(500).json({
        success: false,
        error: error?.message || 'Erro ao criar cópia.',
      });
    }
  });

  // ============================================================
  // EXECUTAR CÓPIA
  // ============================================================

  app.post('/api/run-copia', (req, res) => {
    if (!requireAuthentication(req, res)) {
      return;
    }

    const filePath = path.join(
      process.cwd(),
      'app_teste_copia.py'
    );

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({
        success: false,
        error:
          'app_teste_copia.py não encontrado no disco.',
      });
    }

    const startTime = Date.now();

    execFile(
      PYTHON_COMMAND,
      [filePath],
      {
        timeout: EXECUTION_TIMEOUT_MS,
        maxBuffer: 10 * 1024 * 1024,
      },
      (error, stdout, stderr) => {
        const durationMs = Date.now() - startTime;

        return res.json({
          success: !error,
          exitCode: error
            ? typeof error.code === 'number'
              ? error.code
              : 1
            : 0,
          stdout: stdout || '',
          stderr: stderr || '',
          durationMs,
          executedCommand:
            `${PYTHON_COMMAND} app_teste_copia.py`,
        });
      }
    );
  });

  // ============================================================
  // TESTE DE ARQUIVO ALEX
  // ============================================================

  app.get('/api/check-file', (_req, res) => {
    return res.json(
      getFileStats('teste_alex.py')
    );
  });

  app.post('/api/create-file', (req, res) => {
    try {
      const targetFilePath = path.join(
        process.cwd(),
        'teste_alex.py'
      );

      const content =
        typeof req.body?.content === 'string'
          ? req.body.content
          : 'print("Olá, arquivo Alex!")\n';

      fs.writeFileSync(
        targetFilePath,
        content,
        'utf8'
      );

      const stats = fs.statSync(targetFilePath);

      return res.json({
        success: true,
        message:
          'Arquivo criado com sucesso no disco.',
        filename: 'teste_alex.py',
        filePath: targetFilePath,
        size: stats.size,
        modifiedAt: stats.mtime.toISOString(),
        content,
      });
    } catch (error: any) {
      return res.status(500).json({
        success: false,
        error:
          error?.message ||
          'Erro ao criar teste_alex.py.',
      });
    }
  });

  app.post('/api/run-python', (req, res) => {
    if (!requireAuthentication(req, res)) {
      return;
    }

    const targetFilePath = path.join(
      process.cwd(),
      'teste_alex.py'
    );

    if (!fs.existsSync(targetFilePath)) {
      return res.status(404).json({
        success: false,
        error:
          'teste_alex.py não encontrado.',
      });
    }

    const startTime = Date.now();

    execFile(
      PYTHON_COMMAND,
      [targetFilePath],
      {
        timeout: EXECUTION_TIMEOUT_MS,
        maxBuffer: 10 * 1024 * 1024,
      },
      (error, stdout, stderr) => {
        const durationMs = Date.now() - startTime;

        return res.json({
          success: !error,
          exitCode: error
            ? typeof error.code === 'number'
              ? error.code
              : 1
            : 0,
          stdout: stdout || '',
          stderr: stderr || '',
          durationMs,
          executedCommand:
            `${PYTHON_COMMAND} teste_alex.py`,
        });
      }
    );
  });

  // ============================================================
  // PONTE ALEX V1
  // ============================================================

  app.post('/api/ponte/processar', (req, res) => {
    if (!requireAuthentication(req, res)) {
      return;
    }

    try {
      const {
        filename = 'script_alex.py',
        fileContent,
        instruction,
        searchTarget,
        replaceWith,
      } = req.body || {};

      if (
        typeof fileContent !== 'string' ||
        !fileContent.length
      ) {
        return res.status(400).json({
          success: false,
          error:
            'Conteúdo do arquivo não fornecido ou inválido.',
        });
      }

      if (
        typeof instruction !== 'string' ||
        !instruction.trim()
      ) {
        return res.status(400).json({
          success: false,
          error:
            'Instrução de alteração não fornecida.',
        });
      }

      const timestamp = Date.now();

      const cleanBaseName = path
        .basename(
          String(filename),
          path.extname(String(filename))
        )
        .replace(/[^a-zA-Z0-9_-]/g, '_');

      const ext =
        path.extname(String(filename)) || '.py';

      const originalSaveFilename =
        `${cleanBaseName}_original_${timestamp}${ext}`;

      const originalSavePath =
        path.join(
          originalsDir,
          originalSaveFilename
        );

      fs.writeFileSync(
        originalSavePath,
        fileContent,
        'utf8'
      );

      const origStats =
        fs.statSync(originalSavePath);

      const origHash =
        sha256(fileContent);

      const transformation =
        applyLocalTransformation(
          fileContent,
          instruction,
          searchTarget,
          replaceWith
        );

      const processedFilename =
        `${cleanBaseName}_alex_v1_${timestamp}${ext}`;

      const processedFilePath =
        path.join(
          processedDir,
          processedFilename
        );

      fs.writeFileSync(
        processedFilePath,
        transformation.newContent,
        'utf8'
      );

      const procStats =
        fs.statSync(processedFilePath);

      const procHash =
        sha256(transformation.newContent);

      const startExecTime = Date.now();

      execFile(
        PYTHON_COMMAND,
        ['-m', 'py_compile', processedFilePath],
        {
          timeout: COMPILE_TIMEOUT_MS,
          maxBuffer: 10 * 1024 * 1024,
        },
        (compileErr, compileStdout, compileStderr) => {
          if (compileErr) {
            const durationMs =
              Date.now() - startExecTime;

            return res.json({
              success: false,
              testPassed: false,
              ponteVersion: 'v1',
              testMessage:
                '❌ Falha de sintaxe / compilação Python detectada.',

              compileCheck: {
                passed: false,
                error:
                  (
                    compileStderr ||
                    compileErr.message ||
                    'Erro de compilação.'
                  ).trim(),
              },

              execution: {
                exitCode:
                  typeof compileErr.code === 'number'
                    ? compileErr.code
                    : 1,
                stdout: compileStdout || '',
                stderr:
                  compileStderr ||
                  compileErr.message ||
                  '',
                durationMs,
              },

              originalFile: {
                filename:
                  originalSaveFilename,
                size: origStats.size,
                lines:
                  fileContent.split('\n').length,
                sha256: origHash,
                savedPath:
                  `storage/originals/${originalSaveFilename}`,
                untouched: true,
              },

              processedFile: {
                filename: processedFilename,
                size: procStats.size,
                lines:
                  transformation.newContent.split('\n').length,
                sha256: procHash,
                content:
                  transformation.newContent,
                downloadUrl:
                  `/api/download/processed/${processedFilename}`,
              },

              instruction,
              transformSummary:
                transformation.summary,
              neverOverwritten: true,
            });
          }

          execFile(
            PYTHON_COMMAND,
            [processedFilePath],
            {
              timeout:
                EXECUTION_TIMEOUT_MS,
              maxBuffer:
                10 * 1024 * 1024,
            },
            (execErr, execStdout, execStderr) => {
              const durationMs =
                Date.now() - startExecTime;

              const testPassed = !execErr;

              return res.json({
                success: true,
                testPassed,

                testMessage: testPassed
                  ? '✅ Teste de execução Python concluído com sucesso.'
                  : '⚠️ Erro durante a execução do novo arquivo.',

                compileCheck: {
                  passed: true,
                  message:
                    'Sintaxe Python OK',
                },

                execution: {
                  exitCode: execErr
                    ? typeof execErr.code === 'number'
                      ? execErr.code
                      : 1
                    : 0,
                  stdout:
                    execStdout || '',
                  stderr:
                    execStderr || '',
                  durationMs,
                },

                originalFile: {
                  filename:
                    originalSaveFilename,
                  size: origStats.size,
                  lines:
                    fileContent.split('\n').length,
                  sha256: origHash,
                  savedPath:
                    `storage/originals/${originalSaveFilename}`,
                  untouched: true,
                },

                processedFile: {
                  filename:
                    processedFilename,
                  size: procStats.size,
                  lines:
                    transformation.newContent.split('\n').length,
                  sha256: procHash,
                  content:
                    transformation.newContent,
                  downloadUrl:
                    `/api/download/processed/${processedFilename}`,
                },

                instruction,
                transformSummary:
                  transformation.summary,
                neverOverwritten: true,
              });
            }
          );
        }
      );
    } catch (error: any) {
      return res.status(500).json({
        success: false,
        error:
          `Erro ao processar arquivo: ${
            error?.message || 'erro desconhecido'
          }`,
      });
    }
  });

  // ============================================================
  // HISTÓRICO
  // ============================================================

  app.get('/api/ponte/history', (_req, res) => {
    try {
      if (!fs.existsSync(processedDir)) {
        return res.json({
          success: true,
          items: [],
        });
      }

      const files = fs
        .readdirSync(processedDir)
        .filter(
          (filename) =>
            filename.toLowerCase().endsWith('.py')
        );

      const items = files
        .map((filename) => {
          const filePath =
            path.join(processedDir, filename);

          const stats =
            fs.statSync(filePath);

          return {
            filename,
            size: stats.size,
            modifiedAt:
              stats.mtime.toISOString(),
            downloadUrl:
              `/api/download/processed/${filename}`,
          };
        })
        .sort(
          (a, b) =>
            new Date(b.modifiedAt).getTime() -
            new Date(a.modifiedAt).getTime()
        );

      return res.json({
        success: true,
        items,
      });
    } catch (error: any) {
      return res.status(500).json({
        success: false,
        error:
          error?.message ||
          'Erro ao consultar histórico.',
      });
    }
  });

  // ============================================================
  // EXECUTAR ARQUIVO PROCESSADO
  // ============================================================

  app.post('/api/ponte/run-test', (req, res) => {
    if (!requireAuthentication(req, res)) {
      return;
    }

    const { filename } = req.body || {};

    if (
      !isSafeStoredPythonFilename(filename)
    ) {
      return res.status(400).json({
        success: false,
        error:
          'Nome de arquivo Python inválido.',
      });
    }

    const safeName =
      path.basename(filename);

    const filePath =
      path.join(processedDir, safeName);

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({
        success: false,
        error:
          'Arquivo processado não encontrado.',
      });
    }

    const startTime = Date.now();

    execFile(
      PYTHON_COMMAND,
      [filePath],
      {
        timeout: EXECUTION_TIMEOUT_MS,
        maxBuffer: 10 * 1024 * 1024,
      },
      (error, stdout, stderr) => {
        const durationMs =
          Date.now() - startTime;

        return res.json({
          success: !error,
          exitCode: error
            ? typeof error.code === 'number'
              ? error.code
              : 1
            : 0,
          stdout: stdout || '',
          stderr: stderr || '',
          durationMs,
          executedCommand:
            `${PYTHON_COMMAND} ${safeName}`,
        });
      }
    );
  });

  // ============================================================
  // DOWNLOAD DOS ARQUIVOS PROCESSADOS
  // ============================================================

  app.get(
    '/api/download/processed/:filename',
    (req, res) => {
      const filename =
        path.basename(req.params.filename);

      if (
        !filename.toLowerCase().endsWith('.py')
      ) {
        return res.status(403).send(
          'Acesso negado ao arquivo solicitado.'
        );
      }

      const filePath =
        path.join(
          processedDir,
          filename
        );

      if (!fs.existsSync(filePath)) {
        return res.status(404).send(
          'Arquivo processado não encontrado.'
        );
      }

      return res.download(
        filePath,
        filename
      );
    }
  );

  // ============================================================
  // DOWNLOAD DOS ORIGINAIS
  // ============================================================

  app.get(
    '/api/download/originals/:filename',
    (req, res) => {
      const filename =
        path.basename(req.params.filename);

      if (
        !filename.toLowerCase().endsWith('.py')
      ) {
        return res.status(403).send(
          'Acesso negado ao arquivo solicitado.'
        );
      }

      const filePath =
        path.join(
          originalsDir,
          filename
        );

      if (!fs.existsSync(filePath)) {
        return res.status(404).send(
          'Arquivo original não encontrado.'
        );
      }

      return res.download(
        filePath,
        filename
      );
    }
  );

  // ============================================================
  // OPENAPI
  // ============================================================

  app.get(
    [
      '/ponte_alex_openapi_v2.yaml',
      '/api/openapi_v2.yaml',
      '/api/ponte/openapi_v2.yaml',
    ],
    (_req, res) => {
      const yamlPath =
        path.join(
          process.cwd(),
          'ponte_alex_openapi_v2.yaml'
        );

      if (!fs.existsSync(yamlPath)) {
        return res.status(404).send(
          'Arquivo OpenAPI v2 não encontrado.'
        );
      }

      res.setHeader(
        'Content-Type',
        'text/yaml; charset=utf-8'
      );

      res.setHeader(
        'Content-Disposition',
        'attachment; filename="ponte_alex_openapi_v2.yaml"'
      );

      return res.sendFile(yamlPath);
    }
  );

  app.get(
    [
      '/ponte_alex_openapi.yaml',
      '/api/openapi.yaml',
      '/api/ponte/openapi.yaml',
    ],
    (_req, res) => {
      const yamlPath =
        path.join(
          process.cwd(),
          'ponte_alex_openapi.yaml'
        );

      if (!fs.existsSync(yamlPath)) {
        return res.status(404).send(
          'Arquivo OpenAPI não encontrado.'
        );
      }

      res.setHeader(
        'Content-Type',
        'text/yaml; charset=utf-8'
      );

      res.setHeader(
        'Content-Disposition',
        'attachment; filename="ponte_alex_openapi.yaml"'
      );

      return res.sendFile(yamlPath);
    }
  );

  // ============================================================
  // CLIENTE PYTHON
  // ============================================================

  app.get(
    [
      '/cliente_ponte_alex.py',
      '/api/download/client/cliente_ponte_alex.py',
    ],
    (_req, res) => {
      const filePath =
        path.join(
          process.cwd(),
          'cliente_ponte_alex.py'
        );

      if (!fs.existsSync(filePath)) {
        return res.status(404).send(
          'Arquivo cliente_ponte_alex.py não encontrado.'
        );
      }

      res.setHeader(
        'Content-Type',
        'text/x-python; charset=utf-8'
      );

      res.setHeader(
        'Content-Disposition',
        'attachment; filename="cliente_ponte_alex.py"'
      );

      return res.sendFile(filePath);
    }
  );

  app.get(
    [
      '/teste_cliente_ponte.py',
      '/api/download/client/teste_cliente_ponte.py',
    ],
    (_req, res) => {
      const filePath =
        path.join(
          process.cwd(),
          'teste_cliente_ponte.py'
        );

      if (!fs.existsSync(filePath)) {
        return res.status(404).send(
          'Arquivo teste_cliente_ponte.py não encontrado.'
        );
      }

      res.setHeader(
        'Content-Type',
        'text/x-python; charset=utf-8'
      );

      res.setHeader(
        'Content-Disposition',
        'attachment; filename="teste_cliente_ponte.py"'
      );

      return res.sendFile(filePath);
    }
  );

  // ============================================================
  // DOWNLOAD DE ARQUIVOS LEGADOS
  // ============================================================

  app.get(
    '/api/download/:filename',
    (req, res) => {
      const filename =
        path.basename(req.params.filename);

      const allowed = [
        'app_teste_copia.py',
        'app_teste.py',
        'teste_alex.py',
      ];

      if (!allowed.includes(filename)) {
        return res.status(403).send(
          'Acesso negado ao arquivo solicitado.'
        );
      }

      const filePath =
        path.join(
          process.cwd(),
          filename
        );

      if (!fs.existsSync(filePath)) {
        return res.status(404).send(
          'Arquivo não encontrado no disco.'
        );
      }

      return res.download(
        filePath,
        filename
      );
    }
  );

  // ============================================================
  // PONTE ALEX v2
  // ============================================================

  app.all(
    [
      '/api/ponte/v2/ping',
      '/api/ponte/v2/status',
    ],
    (_req, res) => {
      try {
        const configuredSecret =
          getConfiguredSecret();

        execFile(
          PYTHON_COMMAND,
          ['--version'],
          {
            timeout: 5_000,
            maxBuffer: 1_000_000,
          },
          (error, stdout, stderr) => {
            const pyVer =
              (
                stdout ||
                stderr ||
                'Python não detectado'
              ).trim();

            return res.json({
              status: 'online',
              ponte: 'Ponte Alex v2',
              version: '2.0.0',

              authConfigured:
                configuredSecret.length > 0,

              authHeaderName:
                'x-api-secret',

              pythonRuntime:
                pyVer,

              timestamp:
                Date.now(),

              uptimeSeconds:
                Math.floor(
                  process.uptime()
                ),

              message:
                'Ponte Alex v2 online e preparada para integração externa segura via HTTPS.',

              security: {
                isolatedStorage: true,
                directoryTraversalProtected: true,
                externalApiFree: true,
                apiKeysRequired: false,
                executionAuthenticationRequired: true,
                overwriteOriginalProtected: true,
                authConfigured:
                  configuredSecret.length > 0,
              },

              endpoints: {
                ping:
                  'GET /api/ponte/v2/ping',

                processar:
                  'POST /api/ponte/v2/processar',

                history:
                  'GET /api/ponte/history',

                resources:
                  'GET /api/ponte/v2/resources',

                downloadProcessed:
                  'GET /api/download/processed/:filename',

                downloadOriginal:
                  'GET /api/download/originals/:filename',
              },
            });
          }
        );
      } catch (error: any) {
        return res.status(500).json({
          status: 'error',
          error:
            error?.message ||
            'Erro no ping.',
        });
      }
    }
  );

  // ============================================================
  // RECURSOS
  // ============================================================

  app.get(
    '/api/ponte/v2/resources',
    (_req, res) => {
      try {
        const memory =
          getNodeProcessMemory();

        const systemMemory =
          getSystemMemoryInfo();

        const disk =
          getDiskInfo();

        const originals =
          calculateDirectorySize(
            originalsDir
          );

        const processed =
          calculateDirectorySize(
            processedDir
          );

        return res.json({
          success: true,

          ponte:
            'Ponte Alex v2',

          timestamp:
            Date.now(),

          resources: {
            system: {
              memory: {
                totalBytes:
                  systemMemory.totalBytes,

                usedBytes:
                  systemMemory.usedBytes,

                availableBytes:
                  systemMemory.availableBytes,

                usagePercentage:
                  systemMemory.usagePercentage,

                totalFormatted:
                  systemMemory.totalFormatted,

                usedFormatted:
                  systemMemory.usedFormatted,

                availableFormatted:
                  systemMemory.availableFormatted,
              },

              storage: {
                bridgeStorageBytes:
                  disk.bridgeStorageBytes,

                bridgeStorageFormatted:
                  disk.bridgeStorageFormatted,

                originalsBytes:
                  disk.originalsBytes,

                originalsFormatted:
                  disk.originalsFormatted,

                processedBytes:
                  disk.processedBytes,

                processedFormatted:
                  disk.processedFormatted,
              },
            },

            nodeProcess: {
              memory: {
                rssBytes:
                  memory.rss,

                heapUsedBytes:
                  memory.heapUsed,

                heapTotalBytes:
                  memory.heapTotal,

                externalBytes:
                  memory.external,

                arrayBuffersBytes:
                  memory.arrayBuffers,

                rssFormatted:
                  formatBytes(memory.rss),

                heapUsedFormatted:
                  formatBytes(memory.heapUsed),

                heapTotalFormatted:
                  formatBytes(memory.heapTotal),

                externalFormatted:
                  formatBytes(memory.external),

                arrayBuffersFormatted:
                  formatBytes(
                    memory.arrayBuffers
                  ),
              },

              uptime: {
                uptimeSeconds:
                  Math.floor(
                    process.uptime()
                  ),

                uptimeFormatted:
                  `${Math.floor(
                    process.uptime() / 3600
                  )}h ${Math.floor(
                    (process.uptime() % 3600) / 60
                  )}m ${Math.floor(
                    process.uptime() % 60
                  )}s`,
              },
            },

            storage: {
              originals: {
                path:
                  'storage/originals',

                totalSizeBytes:
                  originals.totalSize,

                totalSizeFormatted:
                  formatBytes(
                    originals.totalSize
                  ),

                fileCount:
                  originals.fileCount,
              },

              processed: {
                path:
                  'storage/processed',

                totalSizeBytes:
                  processed.totalSize,

                totalSizeFormatted:
                  formatBytes(
                    processed.totalSize
                  ),

                fileCount:
                  processed.fileCount,
              },

              combined: {
                totalSizeBytes:
                  originals.totalSize +
                  processed.totalSize,

                totalSizeFormatted:
                  formatBytes(
                    originals.totalSize +
                    processed.totalSize
                  ),

                fileCount:
                  originals.fileCount +
                  processed.fileCount,
              },
            },
          },

          configuration: {
            maxJsonBodySizeLimit:
              '50MB',

            pythonCommand:
              PYTHON_COMMAND,

            pythonTimeoutSeconds:
              EXECUTION_TIMEOUT_MS / 1000,

            compilationTimeoutSeconds:
              COMPILE_TIMEOUT_MS / 1000,

            noFilesDeletedAutomatically:
              true,

            directoryTraversalProtected:
              true,

            originalFilesNeverOverwritten:
              true,

            executionRequiresAuthentication:
              true,
          },
        });
      } catch (error: any) {
        return res.status(500).json({
          success: false,
          error:
            `Erro ao obter diagnóstico de recursos: ${
              error?.message ||
              'erro desconhecido'
            }`,
        });
      }
    }
  );

  // ============================================================
  // PONTE ALEX v2 — PROCESSAMENTO PRINCIPAL
  // ============================================================

  app.post(
    '/api/ponte/v2/processar',
    (req, res) => {
      if (!requireAuthentication(req, res)) {
        return;
      }

      try {
        const body =
          req.body || {};

        const fileContent =
          body.fileContent ??
          body.codigo ??
          body.arquivo ??
          body.content;

        const instruction =
          body.instruction ??
          body.instrucao ??
          body.comando;

        const rawOriginalFilename =
          body.filename ??
          body.nome_original ??
          body.nomeOriginal ??
          'script_entrada.py';

        const rawOutputFilename =
          body.outputFilename ??
          body.nome_saida ??
          body.nomeSaida ??
          body.desiredOutputFilename;

        const searchTarget =
          body.searchTarget;

        const replaceWith =
          body.replaceWith;

        // ------------------------------------------------------
        // VALIDAÇÃO
        // ------------------------------------------------------

        if (
          typeof fileContent !== 'string' ||
          !fileContent.length
        ) {
          return res.status(400).json({
            success: false,
            ponteVersion: 'v2',
            error:
              'Campo obrigatório ausente: "fileContent" ou "codigo" deve conter o código Python.',
          });
        }

        if (
          typeof instruction !== 'string' ||
          !instruction.trim()
        ) {
          return res.status(400).json({
            success: false,
            ponteVersion: 'v2',
            error:
              'Campo obrigatório ausente: "instruction" ou "instrucao".',
          });
        }

        // ------------------------------------------------------
        // NOMES SEGUROS
        // ------------------------------------------------------

        const timestamp =
          Date.now();

        const safeOriginalName =
          sanitizeSafePythonFilename(
            rawOriginalFilename,
            'entrada'
          );

        const originalBase =
          path.basename(
            safeOriginalName,
            '.py'
          );

        let safeOutputName: string;

        if (
          typeof rawOutputFilename ===
            'string' &&
          rawOutputFilename.trim()
        ) {
          safeOutputName =
            sanitizeSafePythonFilename(
              rawOutputFilename,
              'saida_alex_v2'
            );
        } else {
          safeOutputName =
            `${originalBase}_alex_v2_${timestamp}.py`;
        }

        // ------------------------------------------------------
        // 1. PRESERVAR ORIGINAL
        // ------------------------------------------------------

        const originalSaveFilename =
          `${originalBase}_original_${timestamp}.py`;

        const originalSavePath =
          path.join(
            originalsDir,
            originalSaveFilename
          );

        fs.writeFileSync(
          originalSavePath,
          fileContent,
          'utf8'
        );

        const originalStats =
          fs.statSync(
            originalSavePath
          );

        const originalHash =
          sha256(fileContent);

        // ------------------------------------------------------
        // 2. ALTERAR LOCALMENTE
        // ------------------------------------------------------

        const transformation =
          applyLocalTransformation(
            fileContent,
            instruction,
            searchTarget,
            replaceWith
          );

        // ------------------------------------------------------
        // 3. SALVAR RESULTADO
        // ------------------------------------------------------

        let finalTargetFilename =
          safeOutputName;

        let processedFilePath =
          path.join(
            processedDir,
            finalTargetFilename
          );

        if (
          fs.existsSync(
            processedFilePath
          )
        ) {
          const namePart =
            path.basename(
              safeOutputName,
              '.py'
            );

          finalTargetFilename =
            `${namePart}_${timestamp}.py`;

          processedFilePath =
            path.join(
              processedDir,
              finalTargetFilename
            );
        }

        fs.writeFileSync(
          processedFilePath,
          transformation.newContent,
          'utf8'
        );

        const processedStats =
          fs.statSync(
            processedFilePath
          );

        const processedHash =
          sha256(
            transformation.newContent
          );

        // ------------------------------------------------------
        // 4. COMPILAÇÃO PYTHON
        // ------------------------------------------------------

        const startExecTime =
          Date.now();

        execFile(
          PYTHON_COMMAND,
          [
            '-m',
            'py_compile',
            processedFilePath,
          ],
          {
            timeout:
              COMPILE_TIMEOUT_MS,

            maxBuffer:
              10 * 1024 * 1024,
          },

          (compileErr, compileStdout, compileStderr) => {
            if (compileErr) {
              const durationMs =
                Date.now() -
                startExecTime;

              return res.json({
                success: false,

                ponteVersion:
                  'v2',

                status:
                  'ERRO_COMPILACAO_SINTAXE',

                testPassed:
                  false,

                testMessage:
                  '❌ Falha de sintaxe / compilação Python detectada no novo arquivo.',

                compileCheck: {
                  passed:
                    false,

                  error:
                    (
                      compileStderr ||
                      compileErr.message ||
                      'Erro de compilação.'
                    ).trim(),
                },

                execution: {
                  exitCode:
                    typeof compileErr.code ===
                    'number'
                      ? compileErr.code
                      : 1,

                  stdout:
                    compileStdout ||
                    '',

                  stderr:
                    compileStderr ||
                    compileErr.message ||
                    '',

                  durationMs,
                },

                originalFile: {
                  filename:
                    originalSaveFilename,

                  size:
                    originalStats.size,

                  lines:
                    fileContent.split(
                      '\n'
                    ).length,

                  sha256:
                    originalHash,

                  savedPath:
                    `storage/originals/${originalSaveFilename}`,

                  untouched:
                    true,
                },

                processedFile: {
                  filename:
                    finalTargetFilename,

                  size:
                    processedStats.size,

                  lines:
                    transformation
                      .newContent
                      .split('\n')
                      .length,

                  sha256:
                    processedHash,

                  content:
                    transformation
                      .newContent,

                  downloadUrl:
                    `/api/download/processed/${finalTargetFilename}`,
                },

                instruction,

                transformSummary:
                  transformation.summary,

                neverOverwritten:
                  true,

                timestamp,
              });
            }

            // --------------------------------------------------
            // 5. EXECUÇÃO RUNTIME
            // --------------------------------------------------

            execFile(
              PYTHON_COMMAND,
              [processedFilePath],
              {
                timeout:
                  EXECUTION_TIMEOUT_MS,

                maxBuffer:
                  10 * 1024 * 1024,
              },

              (
                execErr,
                execStdout,
                execStderr
              ) => {
                const durationMs =
                  Date.now() -
                  startExecTime;

                const testPassed =
                  !execErr;

                return res.json({
                  success:
                    true,

                  ponteVersion:
                    'v2',

                  status:
                    testPassed
                      ? 'TESTE_APROVADO'
                      : 'ERRO_EXECUCAO_RUNTIME',

                  testPassed,

                  testMessage:
                    testPassed
                      ? '✅ Teste de execução Python concluído com sucesso (Exit Code 0).'
                      : '⚠️ Erro durante a execução em runtime do novo arquivo.',

                  compileCheck: {
                    passed:
                      true,

                    message:
                      'Sintaxe Python OK',
                  },

                  execution: {
                    exitCode:
                      execErr
                        ? typeof execErr.code ===
                          'number'
                          ? execErr.code
                          : 1
                        : 0,

                    stdout:
                      execStdout ||
                      '',

                    stderr:
                      execStderr ||
                      '',

                    durationMs,
                  },

                  originalFile: {
                    filename:
                      originalSaveFilename,

                    size:
                      originalStats.size,

                    lines:
                      fileContent
                        .split('\n')
                        .length,

                    sha256:
                      originalHash,

                    savedPath:
                      `storage/originals/${originalSaveFilename}`,

                    untouched:
                      true,
                  },

                  processedFile: {
                    filename:
                      finalTargetFilename,

                    size:
                      processedStats.size,

                    lines:
                      transformation
                        .newContent
                        .split('\n')
                        .length,

                    sha256:
                      processedHash,

                    content:
                      transformation
                        .newContent,

                    downloadUrl:
                      `/api/download/processed/${finalTargetFilename}`,
                  },

                  instruction,

                  transformSummary:
                    transformation.summary,

                  neverOverwritten:
                    true,

                  timestamp,
                });
              }
            );
          }
        );
      } catch (error: any) {
        return res.status(500).json({
          success: false,
          ponteVersion: 'v2',
          error:
            `Erro ao processar requisição na Ponte Alex v2: ${
              error?.message ||
              'erro desconhecido'
            }`,
        });
      }
    }
  );

  // ============================================================
  // VITE / FRONTEND
  // ============================================================

  if (
    process.env.NODE_ENV !==
    'production'
  ) {
    const vite =
      await createViteServer({
        server: {
          middlewareMode: true,
        },

        appType: 'spa',
      });

    app.use(
      vite.middlewares
    );
  } else {
    const distPath =
      path.join(
        process.cwd(),
        'dist'
      );

    app.use(
      express.static(
        distPath
      )
    );

    /*
     * Fallback SPA.
     *
     * Usamos app.use em vez de app.get('*')
     * para evitar problemas de compatibilidade
     * com versões recentes do Express/path-to-regexp.
     */
    app.use(
      (_req, res) => {
        const indexPath =
          path.join(
            distPath,
            'index.html'
          );

        if (
          fs.existsSync(
            indexPath
          )
        ) {
          return res.sendFile(
            indexPath
          );
        }

        return res.status(404).send(
          'Frontend não encontrado.'
        );
      }
    );
  }

  // ============================================================
  // INICIALIZAÇÃO
  // ============================================================

  app.listen(
    PORT,
    '0.0.0.0',
    () => {
      console.log(
        `Ponte Alex v2 rodando na porta ${PORT}`
      );

      console.log(
        `Python configurado: ${PYTHON_COMMAND}`
      );

      console.log(
        `Autenticação configurada: ${
          getConfiguredSecret()
            ? 'SIM'
            : 'NÃO'
        }`
      );

      console.log(
        'Armazenamento original: storage/originals'
      );

      console.log(
        'Armazenamento processado: storage/processed'
      );
    }
  );
}

// ============================================================
// TRATAMENTO DE ERRO DE INICIALIZAÇÃO
// ============================================================

startServer().catch(
  (error) => {
    console.error(
      'Failed to start Ponte Alex v2:',
      error
    );

    process.exitCode = 1;
  }
);
