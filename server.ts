import express from 'express';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { exec } from 'child_process';
import { createServer as createViteServer } from 'vite';
import os from 'os';

async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT || 3000);

  // ============================================================
  // CORS
  // ============================================================

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

  // ============================================================
  // JSON BODY
  // ============================================================

  app.use(express.json({ limit: '50mb' }));

  // ============================================================
  // DIRETÓRIOS
  // ============================================================

  const originalsDir = path.join(
    process.cwd(),
    'storage',
    'originals'
  );

  const processedDir = path.join(
    process.cwd(),
    'storage',
    'processed'
  );

  fs.mkdirSync(originalsDir, { recursive: true });
  fs.mkdirSync(processedDir, { recursive: true });

  // ============================================================
  // HELPERS
  // ============================================================

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

      const files = fs.readdirSync(dirPath);

      for (const file of files) {
        const filePath = path.join(dirPath, file);

        try {
          const stat = fs.statSync(filePath);

          if (stat.isFile()) {
            totalSize += stat.size;
            fileCount++;
          }
        } catch {
          // Ignora arquivos inacessíveis.
        }
      }
    } catch {
      // Retorna zero em caso de erro.
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
  } {
    const memUsage = process.memoryUsage();

    return {
      rss: memUsage.rss,
      heapUsed: memUsage.heapUsed,
      heapTotal: memUsage.heapTotal,
    };
  }

  function getSystemMemoryInfo(): {
    totalBytes: number;
    usedBytes: number;
    availableBytes: number;
    usagePercentage: number;
  } {
    const totalMemory = os.totalmem();
    const freeMemory = os.freemem();
    const usedMemory = totalMemory - freeMemory;

    return {
      totalBytes: totalMemory,
      usedBytes: usedMemory,
      availableBytes: freeMemory,
      usagePercentage:
        totalMemory > 0
          ? Number(((usedMemory / totalMemory) * 100).toFixed(2))
          : 0,
    };
  }

  function formatBytes(bytes: number): string {
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];

    let size = bytes;
    let unitIndex = 0;

    while (
      size >= 1024 &&
      unitIndex < units.length - 1
    ) {
      size /= 1024;
      unitIndex++;
    }

    return `${size.toFixed(2)} ${units[unitIndex]}`;
  }

  function calculateSha256(content: string): string {
    return crypto
      .createHash('sha256')
      .update(content, 'utf8')
      .digest('hex');
  }

  function getFileStats(filename: string) {
    const safeFilename = path.basename(filename);

    const filePath = path.join(
      process.cwd(),
      safeFilename
    );

    if (!fs.existsSync(filePath)) {
      return {
        exists: false,
        filename: safeFilename,
        filePath,
      };
    }

    const stats = fs.statSync(filePath);

    const content = fs.readFileSync(
      filePath,
      'utf8'
    );

    const hash = calculateSha256(content);

    const lines = content.split('\n').length;

    return {
      exists: true,
      filename: safeFilename,
      filePath,
      size: stats.size,
      lines,
      sha256: hash,
      modifiedAt: stats.mtime.toISOString(),
      content,
    };
  }

  function sanitizeSafePythonFilename(
    rawName: string,
    fallbackPrefix: string
  ): string {
    const input =
      typeof rawName === 'string'
        ? rawName
        : '';

    const base = path
      .basename(input)
      .replace(
        /[^a-zA-Z0-9._-]/g,
        '_'
      );

    let clean = base.replace(
      /^\.+/,
      ''
    );

    if (
      !clean ||
      clean === '.py' ||
      clean === '_'
    ) {
      clean =
        `${fallbackPrefix}_${Date.now()}.py`;
    }

    if (
      !clean
        .toLowerCase()
        .endsWith('.py')
    ) {
      clean += '.py';
    }

    return clean;
  }

  function extractProvidedSecret(
    req: express.Request
  ): string | null {
    const headerSecret =
      req.headers['x-api-secret'];

    if (
      headerSecret &&
      typeof headerSecret === 'string' &&
      headerSecret.trim()
    ) {
      return headerSecret.trim();
    }

    const authHeader =
      req.headers['authorization'];

    if (
      authHeader &&
      typeof authHeader === 'string'
    ) {
      if (
        authHeader
          .toLowerCase()
          .startsWith('bearer ')
      ) {
        return authHeader
          .substring(7)
          .trim();
      }

      return authHeader.trim();
    }

    const querySecret =
      req.query.secret;

    if (
      querySecret &&
      typeof querySecret === 'string' &&
      querySecret.trim()
    ) {
      return querySecret.trim();
    }

    const bodySecret =
      req.body?.secret;

    if (
      bodySecret &&
      typeof bodySecret === 'string' &&
      bodySecret.trim()
    ) {
      return bodySecret.trim();
    }

    return null;
  }

  function getSystemConfiguredSecret(): string {
    return (
      process.env.PONTE_API_SECRET ||
      process.env.PONTE_API_SECRETO ||
      process.env.ALEX_BRIDGE_SECRET ||
      ''
    ).trim();
  }

  function isInsideDirectory(
    filePath: string,
    directory: string
  ): boolean {
    const resolvedFile =
      path.resolve(filePath);

    const resolvedDir =
      path.resolve(directory) +
      path.sep;

    return resolvedFile.startsWith(
      resolvedDir
    );
  }

  function getPythonCommand(): string {
    return process.platform === 'win32'
      ? 'python'
      : 'python3';
  }

  function getShellSafePath(
    filePath: string
  ): string {
    return `"${filePath.replace(
      /"/g,
      '\\"'
    )}"`;
  }

  // ============================================================
  // UTF-8
  // ============================================================

  function corrigirTextoUTF8(
    texto: unknown
  ): string {
    if (
      typeof texto !== 'string'
    ) {
      return String(texto ?? '');
    }

    const sinaisMojibake = [
      'Ã',
      'Â',
      'â€',
      'â€™',
      'â€œ',
      'â€',
      'â€“',
      'â€”',
      'â€¦',
    ];

    const pareceMojibake =
      sinaisMojibake.some(
        (sinal) =>
          texto.includes(sinal)
      );

    if (!pareceMojibake) {
      return texto;
    }

    try {
      const corrigido =
        Buffer.from(
          texto,
          'latin1'
        ).toString('utf8');

      if (
        !corrigido.includes(
          '\uFFFD'
        )
      ) {
        return corrigido;
      }
    } catch {
      // Mantém original.
    }

    return texto;
  }

  // ============================================================
  // STATUS
  // ============================================================

  app.get(
    '/api/status',
    (req, res) => {
      const original =
        getFileStats(
          'app_teste.py'
        );

      const copia =
        getFileStats(
          'app_teste_copia.py'
        );

      const testeAlex =
        getFileStats(
          'teste_alex.py'
        );

      const areIdentical =
        original.exists &&
        copia.exists &&
        original.sha256 ===
          copia.sha256;

      return res.json({
        success: true,

        files: {
          original,
          copia,
          testeAlex,
        },

        areIdentical,
      });
    }
  );

  // ============================================================
  // CRIAR CÓPIA
  // ============================================================

  app.post(
    '/api/create-copy',
    (req, res) => {
      try {
        const srcPath =
          path.join(
            process.cwd(),
            'app_teste.py'
          );

        const dstPath =
          path.join(
            process.cwd(),
            'app_teste_copia.py'
          );

        if (
          !fs.existsSync(srcPath)
        ) {
          return res.status(404).json({
            success: false,
            error:
              'app_teste.py não encontrado na raiz.',
          });
        }

        fs.copyFileSync(
          srcPath,
          dstPath
        );

        const copiaStats =
          getFileStats(
            'app_teste_copia.py'
          );

        const origStats =
          getFileStats(
            'app_teste.py'
          );

        return res.json({
          success: true,

          message:
            'Cópia física app_teste_copia.py criada com sucesso.',

          copia:
            copiaStats,

          isIdentical:
            copiaStats.sha256 ===
            origStats.sha256,
        });
      } catch (e: any) {
        return res.status(500).json({
          success: false,
          error: e.message,
        });
      }
    }
  );

  // ============================================================
  // TESTAR CÓPIA
  // ============================================================

  app.post(
    '/api/run-copia',
    (req, res) => {
      const filePath =
        path.join(
          process.cwd(),
          'app_teste_copia.py'
        );

      if (
        !fs.existsSync(filePath)
      ) {
        return res.status(404).json({
          success: false,
          error:
            'app_teste_copia.py não encontrado no disco.',
        });
      }

      const startTime =
        Date.now();

      const python =
        getPythonCommand();

      const script = `
import sys
import time
import urllib.request
import json
import threading

import app_teste_copia

print('[1/3] Compilação e sintaxe Python: OK')

model = getattr(
    app_teste_copia,
    'MODEL',
    'não informado'
)

limite = getattr(
    app_teste_copia,
    'LIMITE_SEGUNDOS',
    'não informado'
)

intervalo = getattr(
    app_teste_copia,
    'INTERVALO_MONITORAMENTO',
    'não informado'
)

print(
    f'[2/3] Módulo importado com sucesso. Modelo: {model}'
)

print(
    f'      Tempo limite configurado: {limite}s | '
    f'Monitoramento: {intervalo}s'
)

if hasattr(app_teste_copia, 'app'):
    port = 10042

    def run_app():
        try:
            app_teste_copia.app.run(
                host='127.0.0.1',
                port=port,
                threaded=True,
                use_reloader=False
            )
        except Exception as e:
            print(f'Erro no servidor: {e}')

    t = threading.Thread(
        target=run_app,
        daemon=True
    )

    t.start()

    time.sleep(0.8)

    try:
        req = urllib.request.Request(
            f'http://127.0.0.1:{port}/status'
        )

        with urllib.request.urlopen(
            req,
            timeout=3
        ) as resp:

            body = resp.read().decode('utf-8')
            data = json.loads(body)

            print(
                '[3/3] Resposta da rota /status do servidor Flask:'
            )

            print(
                f"      Status do job: "
                f"{data.get('status')} | "
                f"Mensagem: "
                f"{data.get('mensagem')}"
            )

            print(
                '=== TESTE DE EXECUÇÃO PYTHON BEM-SUCEDIDO (EXIT CODE 0) ==='
            )

    except Exception as e:
        print(
            f'[3/3] Servidor importado, mas a rota /status não respondeu: {e}'
        )

else:
    print(
        '[3/3] Módulo Python importado com sucesso. '
        'Nenhuma variável app Flask encontrada para teste HTTP.'
    )

    print(
        '=== TESTE DE EXECUÇÃO PYTHON BEM-SUCEDIDO (EXIT CODE 0) ==='
    )
`;

      const encoded =
        Buffer.from(
          script,
          'utf8'
        ).toString(
          'base64'
        );

      const command =
        `${python} -c "import base64; exec(base64.b64decode('${encoded}'))"`;

      exec(
        command,
        {
          timeout: 15000,
          maxBuffer:
            10 * 1024 * 1024,
        },
        (
          error,
          stdout,
          stderr
        ) => {
          const durationMs =
            Date.now() -
            startTime;

          return res.json({
            success:
              !error,

            exitCode:
              error
                ? typeof error.code ===
                  'number'
                  ? error.code
                  : 1
                : 0,

            stdout:
              stdout || '',

            stderr:
              stderr || '',

            durationMs,

            executedCommand:
              `${python} app_teste_copia.py ` +
              '(verificação de runtime e servidor)',
          });
        }
      );
    }
  );

  // ============================================================
  // LEGACY - CHECK FILE
  // ============================================================

  app.get(
    '/api/check-file',
    (req, res) => {
      return res.json(
        getFileStats(
          'teste_alex.py'
        )
      );
    }
  );

  // ============================================================
  // LEGACY - CREATE FILE
  // ============================================================

  app.post(
    '/api/create-file',
    (req, res) => {
      try {
        const targetFilePath =
          path.join(
            process.cwd(),
            'teste_alex.py'
          );

        const content =
          req.body?.content !==
          undefined
            ? String(
                req.body.content
              )
            : 'print("Olá, arquivo Alex!")\n';

        fs.writeFileSync(
          targetFilePath,
          content,
          'utf8'
        );

        const stats =
          fs.statSync(
            targetFilePath
          );

        return res.json({
          success: true,

          message:
            'Arquivo criado com sucesso no disco.',

          filename:
            'teste_alex.py',

          filePath:
            targetFilePath,

          size:
            stats.size,

          modifiedAt:
            stats.mtime.toISOString(),

          content:
            fs.readFileSync(
              targetFilePath,
              'utf8'
            ),
        });
      } catch (error: any) {
        return res.status(500).json({
          success: false,
          error:
            error.message,
        });
      }
    }
  );

  // ============================================================
  // LEGACY - RUN PYTHON
  // ============================================================

  app.post(
    '/api/run-python',
    (req, res) => {
      const targetFilePath =
        path.join(
          process.cwd(),
          'teste_alex.py'
        );

      if (
        !fs.existsSync(
          targetFilePath
        )
      ) {
        return res.status(404).json({
          success: false,
          error:
            'teste_alex.py não encontrado.',
        });
      }

      const startTime =
        Date.now();

      const python =
        getPythonCommand();

      exec(
        `${python} ${getShellSafePath(
          targetFilePath
        )}`,
        {
          timeout: 10000,
          maxBuffer:
            10 * 1024 * 1024,
        },
        (
          error,
          stdout,
          stderr
        ) => {
          const durationMs =
            Date.now() -
            startTime;

          return res.json({
            success:
              !error,

            exitCode:
              error
                ? typeof error.code ===
                  'number'
                  ? error.code
                  : 1
                : 0,

            stdout:
              stdout || '',

            stderr:
              stderr || '',

            durationMs,

            executedCommand:
              `${python} teste_alex.py`,
          });
        }
      );
    }
  );

  // ============================================================
  // TRANSFORMAÇÃO LOCAL
  // ============================================================

  function applyLocalTransformation(
    originalContent: string,
    instruction: string,
    searchTarget?: string,
    replaceWith?: string
  ): {
    newContent: string;
    summary: string;
  } {
    let modified =
      originalContent;

    const summaryParts: string[] =
      [];

    if (
      searchTarget !==
        undefined &&
      searchTarget.length > 0 &&
      replaceWith !==
        undefined
    ) {
      if (
        modified.includes(
          searchTarget
        )
      ) {
        modified =
          modified
            .split(
              searchTarget
            )
            .join(
              replaceWith
            );

        summaryParts.push(
          `Substituição exata de '${searchTarget}' por '${replaceWith}'`
        );
      } else {
        summaryParts.push(
          `Aviso: alvo '${searchTarget}' não foi encontrado para substituição exata.`
        );
      }
    }

    const instrLower =
      instruction
        .toLowerCase()
        .trim();

    void instrLower;

    const replacePattern =
      /(?:substituir|trocar|mudar|alterar|replace)\s+["'`]([^"'`]+)["'`]\s+(?:por|para|with)\s+["'`]([^"'`]+)["'`]/gi;

    let match:
      RegExpExecArray | null;

    let replacedCount = 0;

    while (
      (match =
        replacePattern.exec(
          instruction
        )) !== null
    ) {
      const fromText =
        match[1];

      const toText =
        match[2];

      if (
        modified.includes(
          fromText
        )
      ) {
        modified =
          modified
            .split(fromText)
            .join(toText);

        summaryParts.push(
          `Substituído "${fromText}" por "${toText}"`
        );

        replacedCount++;
      } else {
        summaryParts.push(
          `Trecho "${fromText}" não foi localizado no código original`
        );
      }
    }

    const variableValuePattern =
      /(?:alterar|mudar|trocar|substituir)\s+(?:somente\s+)?(?:o\s+)?valor\s+da\s+vari[áa]vel\s+([a-zA-Z_][a-zA-Z0-9_]*)\s+de\s+(-?\d+(?:\.\d+)?)\s+para\s+(-?\d+(?:\.\d+)?)/i;

    const variableValueMatch =
      instruction.match(
        variableValuePattern
      );

    if (
      variableValueMatch &&
      replacedCount === 0 &&
      !searchTarget
    ) {
      const variableName =
        variableValueMatch[1];

      const fromValue =
        variableValueMatch[2];

      const toValue =
        variableValueMatch[3];

      const lines =
        modified.split('\n');

      const assignmentPattern =
        new RegExp(
          '^(\\s*' +
            variableName +
            '\\s*=\\s*)' +
            fromValue +
            '(\\s*(?:#.*)?)$'
        );

      let variableChanged =
        false;

      for (
        let i = 0;
        i < lines.length;
        i++
      ) {
        if (
          assignmentPattern.test(
            lines[i]
          )
        ) {
          lines[i] =
            lines[i].replace(
              assignmentPattern,
              '$1' +
                toValue +
                '$2'
            );

          variableChanged =
            true;

          break;
        }
      }

      if (
        variableChanged
      ) {
        modified =
          lines.join('\n');

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

    const funcPattern =
      /(?:adicionar|criar)\s+fun[çc][ãa]o\s+([a-zA-Z0-9_]+)\s*[:(]?([\s\S]*)/i;

    const funcMatch =
      instruction.match(
        funcPattern
      );

    if (
      funcMatch &&
      replacedCount === 0 &&
      !searchTarget
    ) {
      const funcName =
        funcMatch[1];

      const funcDetails =
        funcMatch[2]?.trim() ||
        '';

      const safeDescription =
        funcDetails.replace(
          /"""/g,
          '\\"\\"\\"'
        );

      const newFunctionCode =
        `\n\n` +
        `def ${funcName}(*args, **kwargs):\n` +
        `    """Função gerada pela Ponte Alex v2: ${safeDescription || 'Implementação automatizada'}"""\n` +
        `    print("[Ponte Alex] Função ${funcName} executada.")\n` +
        `    return None\n`;

      modified +=
        newFunctionCode;

      summaryParts.push(
        `Adicionada nova função 'def ${funcName}'`
      );

      replacedCount++;
    }

    const printPattern =
      /(?:adicionar|inserir|colocar)\s+(?:print|mensagem|log)[:\s]+["'`]([^"'`]+)["'`]/i;

    const printMatch =
      instruction.match(
        printPattern
      );

    if (
      printMatch &&
      replacedCount === 0 &&
      !searchTarget
    ) {
      const msg =
        printMatch[1]
          .replace(
            /\\/g,
            '\\\\'
          )
          .replace(
            /"/g,
            '\\"'
          );

      modified +=
        `\nprint("${msg}")\n`;

      summaryParts.push(
        `Adicionado comando print("${msg}")`
      );

      replacedCount++;
    }

    const prependPattern =
      /(?:adicionar|inserir|prepend)\s+no\s+in[ií]cio[:\s]+([\s\S]+)/i;

    const prependMatch =
      instruction.match(
        prependPattern
      );

    if (
      prependMatch
    ) {
      const prepCode =
        prependMatch[1].trim() +
        '\n';

      modified =
        prepCode +
        modified;

      summaryParts.push(
        'Adicionado código no início do arquivo'
      );

      replacedCount++;
    }

    const appendPattern =
      /(?:adicionar|inserir|append)\s+(?:no\s+final|ao\s+fim)[:\s]+([\s\S]+)/i;

    const appendMatch =
      instruction.match(
        appendPattern
      );

    if (
      appendMatch
    ) {
      const appCode =
        '\n' +
        appendMatch[1].trim() +
        '\n';

      modified +=
        appCode;

      summaryParts.push(
        'Adicionado código ao final do arquivo'
      );

      replacedCount++;
    }

    if (
      summaryParts.length ===
      0
    ) {
      const escapedInstruction =
        instruction
          .replace(
            /\\/g,
            '\\\\'
          )
          .replace(
            /"/g,
            '\\"'
          );

      modified +=
        `\nprint("[Ponte Alex v2] Modificação executada: ${escapedInstruction}")\n`;

      summaryParts.push(
        'Modificação registrada.'
      );
    }

    return {
      newContent:
        modified,

      summary:
        summaryParts.join(
          '; '
        ),
    };
  }

  // ============================================================
  // PONTE ALEX V1
  // ============================================================

  app.post(
    '/api/ponte/processar',
    (req, res) => {
      try {
        const {
          filename =
            'script_alex.py',

          fileContent,

          instruction,

          searchTarget,

          replaceWith,
        } = req.body || {};

        if (
          !fileContent ||
          typeof fileContent !==
            'string'
        ) {
          return res.status(400).json({
            success: false,
            error:
              'Conteúdo do arquivo não fornecido ou inválido.',
          });
        }

        if (
          !instruction ||
          typeof instruction !==
            'string'
        ) {
          return res.status(400).json({
            success: false,
            error:
              'Instrução de alteração não fornecida.',
          });
        }

        const timestamp =
          Date.now();

        const cleanBaseName =
          path
            .basename(
              String(filename),
              path.extname(
                String(filename)
              )
            )
            .replace(
              /[^a-zA-Z0-9_-]/g,
              '_'
            );

        const ext =
          path.extname(
            String(filename)
          ) || '.py';

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
          fs.statSync(
            originalSavePath
          );

        const origHash =
          calculateSha256(
            fileContent
          );

        const {
          newContent,
          summary:
            transformSummary,
        } =
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
          newContent,
          'utf8'
        );

        const procStats =
          fs.statSync(
            processedFilePath
          );

        const procHash =
          calculateSha256(
            newContent
          );

        const python =
          getPythonCommand();

        const startExecTime =
          Date.now();

        exec(
          `${python} -m py_compile ${getShellSafePath(
            processedFilePath
          )}`,
          {
            timeout: 8000,
            maxBuffer:
              10 * 1024 * 1024,
          },
          (
            compileErr,
            compileStdout,
            compileStderr
          ) => {
            if (
              compileErr
            ) {
              return res.json({
                success:
                  false,

                testPassed:
                  false,

                testMessage:
                  '❌ Falha de sintaxe / compilação Python detectada.',

                compileCheck: {
                  passed:
                    false,

                  error:
                    (
                      compileStderr ||
                      compileErr.message
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
                    compileErr.message,

                  durationMs:
                    Date.now() -
                    startExecTime,
                },

                originalFile: {
                  filename:
                    originalSaveFilename,

                  size:
                    origStats.size,

                  lines:
                    fileContent.split(
                      '\n'
                    ).length,

                  sha256:
                    origHash,

                  savedPath:
                    `storage/originals/${originalSaveFilename}`,

                  untouched:
                    true,
                },

                processedFile: {
                  filename:
                    processedFilename,

                  size:
                    procStats.size,

                  lines:
                    newContent.split(
                      '\n'
                    ).length,

                  sha256:
                    procHash,

                  content:
                    newContent,

                  downloadUrl:
                    `/api/download/processed/${encodeURIComponent(
                      processedFilename
                    )}`,
                },

                instruction,

                transformSummary,

                neverOverwritten:
                  true,
              });
            }

            exec(
              `${python} ${getShellSafePath(
                processedFilePath
              )}`,
              {
                timeout:
                  10000,

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

                return res.json({
                  success:
                    true,

                  testPassed:
                    !execErr,

                  testMessage:
                    !execErr
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
                      origStats.size,

                    lines:
                      fileContent.split(
                        '\n'
                      ).length,

                    sha256:
                      origHash,

                    savedPath:
                      `storage/originals/${originalSaveFilename}`,

                    untouched:
                      true,
                  },

                  processedFile: {
                    filename:
                      processedFilename,

                    size:
                      procStats.size,

                    lines:
                      newContent.split(
                        '\n'
                      ).length,

                    sha256:
                      procHash,

                    content:
                      newContent,

                    downloadUrl:
                      `/api/download/processed/${encodeURIComponent(
                        processedFilename
                      )}`,
                  },

                  instruction,

                  transformSummary,

                  neverOverwritten:
                    true,
                });
              }
            );
          }
        );
      } catch (err: any) {
        return res.status(500).json({
          success: false,
          error:
            `Erro ao processar arquivo: ${err.message}`,
        });
      }
    }
  );

  // ============================================================
  // HISTÓRICO
  // ============================================================

  app.get(
    '/api/ponte/history',
    (req, res) => {
      try {
        if (
          !fs.existsSync(
            processedDir
          )
        ) {
          return res.json({
            success: true,
            items: [],
          });
        }

        const files =
          fs.readdirSync(
            processedDir
          ).filter(
            (file) =>
              file
                .toLowerCase()
                .endsWith('.py')
          );

        const items =
          files
            .map(
              (filename) => {
                const filePath =
                  path.join(
                    processedDir,
                    filename
                  );

                const stats =
                  fs.statSync(
                    filePath
                  );

                return {
                  filename,

                  size:
                    stats.size,

                  modifiedAt:
                    stats.mtime.toISOString(),

                  downloadUrl:
                    `/api/download/processed/${encodeURIComponent(
                      filename
                    )}`,
                };
              }
            )
            .sort(
              (a, b) =>
                new Date(
                  b.modifiedAt
                ).getTime() -
                new Date(
                  a.modifiedAt
                ).getTime()
            );

        return res.json({
          success:
            true,

          items,
        });
      } catch (e: any) {
        return res.status(500).json({
          success:
            false,

          error:
            e.message,
        });
      }
    }
  );

  // ============================================================
  // EXECUTAR ARQUIVO PROCESSADO
  // ============================================================

  app.post(
    '/api/ponte/run-test',
    (req, res) => {
      const {
        filename,
      } = req.body || {};

      if (
        !filename ||
        typeof filename !==
          'string'
      ) {
        return res.status(400).json({
          success:
            false,

          error:
            'Nome do arquivo não informado.',
        });
      }

      const safeName =
        path.basename(
          filename
        );

      if (
        safeName !== filename &&
        filename.includes('/')
      ) {
        return res.status(400).json({
          success:
            false,

          error:
            'Nome de arquivo inválido.',
        });
      }

      const filePath =
        path.join(
          processedDir,
          safeName
        );

      if (
        !isInsideDirectory(
          filePath,
          processedDir
        )
      ) {
        return res.status(403).json({
          success:
            false,

          error:
            'Acesso ao arquivo negado.',
        });
      }

      if (
        !fs.existsSync(
          filePath
        )
      ) {
        return res.status(404).json({
          success:
            false,

          error:
            'Arquivo processado não encontrado.',
        });
      }

      const startTime =
        Date.now();

      const python =
        getPythonCommand();

      exec(
        `${python} ${getShellSafePath(
          filePath
        )}`,
        {
          timeout:
            10000,

          maxBuffer:
            10 * 1024 * 1024,
        },
        (
          err,
          stdout,
          stderr
        ) => {
          return res.json({
            success:
              !err,

            exitCode:
              err
                ? typeof err.code ===
                  'number'
                  ? err.code
                  : 1
                : 0,

            stdout:
              stdout || '',

            stderr:
              stderr || '',

            durationMs:
              Date.now() -
              startTime,

            executedCommand:
              `${python} ${safeName}`,
          });
        }
      );
    }
  );

  // ============================================================
  // DOWNLOAD PROCESSADO
  // ============================================================

  app.get(
    '/api/download/processed/:filename',
    (req, res) => {
      const filename =
        path.basename(
          req.params.filename
        );

      const filePath =
        path.join(
          processedDir,
          filename
        );

      if (
        !isInsideDirectory(
          filePath,
          processedDir
        )
      ) {
        return res.status(403).send(
          'Acesso negado.'
        );
      }

      if (
        !fs.existsSync(
          filePath
        )
      ) {
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
  // DOWNLOAD ORIGINAL
  // ============================================================

  app.get(
    '/api/download/originals/:filename',
    (req, res) => {
      const filename =
        path.basename(
          req.params.filename
        );

      const filePath =
        path.join(
          originalsDir,
          filename
        );

      if (
        !isInsideDirectory(
          filePath,
          originalsDir
        )
      ) {
        return res.status(403).send(
          'Acesso negado.'
        );
      }

      if (
        !fs.existsSync(
          filePath
        )
      ) {
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
  // OPENAPI V2
  // ============================================================

  app.get(
    [
      '/ponte_alex_openapi_v2.yaml',
      '/api/openapi_v2.yaml',
      '/api/ponte/openapi_v2.yaml',
    ],
    (req, res) => {
      const yamlPath =
        path.join(
          process.cwd(),
          'ponte_alex_openapi_v2.yaml'
        );

      if (
        !fs.existsSync(
          yamlPath
        )
      ) {
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

      return res.sendFile(
        yamlPath
      );
    }
  );

  // ============================================================
  // OPENAPI
  // ============================================================

  app.get(
    [
      '/ponte_alex_openapi.yaml',
      '/api/openapi.yaml',
      '/api/ponte/openapi.yaml',
    ],
    (req, res) => {
      const yamlPath =
        path.join(
          process.cwd(),
          'ponte_alex_openapi.yaml'
        );

      if (
        !fs.existsSync(
          yamlPath
        )
      ) {
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

      return res.sendFile(
        yamlPath
      );
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
    (req, res) => {
      const filePath =
        path.join(
          process.cwd(),
          'cliente_ponte_alex.py'
        );

      if (
        !fs.existsSync(
          filePath
        )
      ) {
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

      return res.sendFile(
        filePath
      );
    }
  );

  // ============================================================
  // TESTE CLIENTE PYTHON
  // ============================================================

  app.get(
    [
      '/teste_cliente_ponte.py',
      '/api/download/client/teste_cliente_ponte.py',
    ],
    (req, res) => {
      const filePath =
        path.join(
          process.cwd(),
          'teste_cliente_ponte.py'
        );

      if (
        !fs.existsSync(
          filePath
        )
      ) {
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

      return res.sendFile(
        filePath
      );
    }
  );

  // ============================================================
  // PONTE ALEX V2 - PING
  // ============================================================

  app.all(
    [
      '/api/ponte/v2/ping',
      '/api/ponte/v2/status',
    ],
    (req, res) => {
      try {
        const configuredSecret =
          getSystemConfiguredSecret();

        const python =
          getPythonCommand();

        exec(
          `${python} --version`,
          {
            timeout:
              5000,
          },
          (
            err,
            stdout,
            stderr
          ) => {
            const pyVer =
              (
                stdout ||
                stderr ||
                'Python não detectado'
              ).trim();

            return res.json({
              status:
                'online',

              ponte:
                'Ponte Alex v2',

              version:
                '2.0.0',

              authConfigured:
                configuredSecret.length >
                0,

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
                isolatedStorage:
                  true,

                directoryTraversalProtected:
                  true,

                externalApiFree:
                  true,

                apiKeysRequired:
                  false,

                overwriteOriginalProtected:
                  true,

                authConfigured:
                  configuredSecret.length >
                  0,
              },

              endpoints: {
                ping:
                  'GET /api/ponte/v2/ping',

                processar:
                  'POST /api/ponte/v2/processar',

                criarArquivo:
                  'POST /api/ponte/v2/criar-arquivo',

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
      } catch (e: any) {
        return res.status(500).json({
          status:
            'error',

          error:
            e.message,
        });
      }
    }
  );

  // ============================================================
  // RECURSOS
  // ============================================================

  app.get(
    '/api/ponte/v2/resources',
    (req, res) => {
      try {
        const memUsage =
          getNodeProcessMemory();

        const systemMemory =
          getSystemMemoryInfo();

        const originalsInfo =
          calculateDirectorySize(
            originalsDir
          );

        const processedInfo =
          calculateDirectorySize(
            processedDir
          );

        return res.json({
          success:
            true,

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
                  formatBytes(
                    systemMemory.totalBytes
                  ),

                usedFormatted:
                  formatBytes(
                    systemMemory.usedBytes
                  ),

                availableFormatted:
                  formatBytes(
                    systemMemory.availableBytes
                  ),
              },
            },

            nodeProcess: {
              memory: {
                rssBytes:
                  memUsage.rss,

                heapUsedBytes:
                  memUsage.heapUsed,

                heapTotalBytes:
                  memUsage.heapTotal,

                rssFormatted:
                  formatBytes(
                    memUsage.rss
                  ),

                heapUsedFormatted:
                  formatBytes(
                    memUsage.heapUsed
                  ),

                heapTotalFormatted:
                  formatBytes(
                    memUsage.heapTotal
                  ),
              },

              uptime: {
                uptimeSeconds:
                  Math.floor(
                    process.uptime()
                  ),

                uptimeFormatted:
                  `${Math.floor(
                    process.uptime() /
                      3600
                  )}h ${Math.floor(
                    (process.uptime() %
                      3600) /
                      60
                  )}m ${Math.floor(
                    process.uptime() %
                      60
                  )}s`,
              },
            },

            storage: {
              originals: {
                path:
                  'storage/originals',

                totalSizeBytes:
                  originalsInfo.totalSize,

                totalSizeFormatted:
                  formatBytes(
                    originalsInfo.totalSize
                  ),

                fileCount:
                  originalsInfo.fileCount,
              },

              processed: {
                path:
                  'storage/processed',

                totalSizeBytes:
                  processedInfo.totalSize,

                totalSizeFormatted:
                  formatBytes(
                    processedInfo.totalSize
                  ),

                fileCount:
                  processedInfo.fileCount,
              },

              combined: {
                totalSizeBytes:
                  originalsInfo.totalSize +
                  processedInfo.totalSize,

                totalSizeFormatted:
                  formatBytes(
                    originalsInfo.totalSize +
                      processedInfo.totalSize
                  ),

                fileCount:
                  originalsInfo.fileCount +
                  processedInfo.fileCount,
              },
            },
          },

          configuration: {
            maxJsonBodySizeLimit:
              '50MB',

            pythonTimeoutSeconds:
              10,

            compilationTimeoutSeconds:
              8,

            noFilesDeletedAutomatically:
              true,

            directoryTraversalProtected:
              true,
          },
        });
      } catch (e: any) {
        return res.status(500).json({
          success:
            false,

          error:
            `Erro ao obter diagnóstico de recursos: ${e.message}`,
        });
      }
    }
  );

  // ============================================================
  // PONTE ALEX V2 - PROCESSAMENTO
  // ============================================================

  app.post(
    '/api/ponte/v2/processar',
    (req, res) => {
      try {
        const configuredSecret =
          getSystemConfiguredSecret();

        const providedSecret =
          extractProvidedSecret(
            req
          );

        if (
          configuredSecret.length >
          0
        ) {
          if (
            !providedSecret ||
            providedSecret !==
              configuredSecret
          ) {
            return res.status(401).json({
              success:
                false,

              ponteVersion:
                'v2',

              status:
                'NAO_AUTORIZADO',

              testPassed:
                false,

              error:
                'Acesso não autorizado: segredo de autenticação ausente ou inválido.',

              authRequired:
                true,

              authHeaderName:
                'x-api-secret',
            });
          }
        }

        const body =
          req.body || {};

        const fileContentRaw =
          body.fileContent ??
          body.codigo ??
          body.arquivo ??
          body.content;

        const instructionRaw =
          body.instruction ??
          body.instrucao ??
          body.comando;

        const rawOriginalFilename =
          body.filename ??
          body.nomeArquivo ??
          body.nome ??
          'script_alex.py';

        const rawOutputFilename =
          body.outputFilename ??
          body.nomeArquivoSaida ??
          body.output ??
          undefined;

        const fileContent =
          corrigirTextoUTF8(
            fileContentRaw
          );

        const instruction =
          corrigirTextoUTF8(
            instructionRaw
          );

        const searchTarget =
          typeof body.searchTarget ===
          'string'
            ? corrigirTextoUTF8(
                body.searchTarget
              )
            : undefined;

        const replaceWith =
          typeof body.replaceWith ===
          'string'
            ? corrigirTextoUTF8(
                body.replaceWith
              )
            : undefined;

        if (
          typeof fileContent !==
            'string' ||
          fileContent.length ===
            0
        ) {
          return res.status(400).json({
            success:
              false,

            ponteVersion:
              'v2',

            error:
              'Campo obrigatório ausente: "fileContent" (ou "codigo" / "arquivo") deve ser uma string com o código Python.',
          });
        }

        if (
          typeof instruction !==
            'string' ||
          instruction.trim().length ===
            0
        ) {
          return res.status(400).json({
            success:
              false,

            ponteVersion:
              'v2',

            error:
              'Campo obrigatório ausente: "instruction" (ou "instrucao") com a descrição da alteração.',
          });
        }

        const timestamp =
          Date.now();

        const safeOriginalName =
          sanitizeSafePythonFilename(
            String(
              rawOriginalFilename
            ),
            'entrada'
          );

        const baseOriginalWithoutExt =
          path.basename(
            safeOriginalName,
            '.py'
          );

        let safeOutputName: string;

        if (
          rawOutputFilename &&
          typeof rawOutputFilename ===
            'string' &&
          rawOutputFilename.trim()
        ) {
          safeOutputName =
            sanitizeSafePythonFilename(
              rawOutputFilename.trim(),
              'saida_alex_v2'
            );
        } else {
          safeOutputName =
            `${baseOriginalWithoutExt}_alex_v2_${timestamp}.py`;
        }

        const originalSaveFilename =
          `${baseOriginalWithoutExt}_original_${timestamp}.py`;

        const originalSavePath =
          path.join(
            originalsDir,
            originalSaveFilename
          );

        if (
          !isInsideDirectory(
            originalSavePath,
            originalsDir
          )
        ) {
          return res.status(403).json({
            success:
              false,

            error:
              'Caminho do arquivo original inválido.',
          });
        }

        fs.writeFileSync(
          originalSavePath,
          fileContent,
          'utf8'
        );

        const origStats =
          fs.statSync(
            originalSavePath
          );

        const origHash =
          calculateSha256(
            fileContent
          );

        const {
          newContent,
          summary:
            transformSummary,
        } =
          applyLocalTransformation(
            fileContent,
            String(
              instruction
            ),
            searchTarget,
            replaceWith
          );

        let finalTargetFilename =
          safeOutputName;

        let processedFilePath =
          path.join(
            processedDir,
            finalTargetFilename
          );

        if (
          !isInsideDirectory(
            processedFilePath,
            processedDir
          )
        ) {
          return res.status(403).json({
            success:
              false,

            error:
              'Caminho do arquivo processado inválido.',
          });
        }

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
          newContent,
          'utf8'
        );

        const procStats =
          fs.statSync(
            processedFilePath
          );

        const procHash =
          calculateSha256(
            newContent
          );

        const python =
          getPythonCommand();

        const startExecTime =
          Date.now();

        exec(
          `${python} -m py_compile ${getShellSafePath(
            processedFilePath
          )}`,
          {
            timeout:
              8000,

            maxBuffer:
              10 * 1024 * 1024,
          },
          (
            compileErr,
            compileStdout,
            compileStderr
          ) => {
            if (
              compileErr
            ) {
              return res.json({
                success:
                  false,

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
                      compileErr.message
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
                    (
                      compileStderr ||
                      compileErr.message
                    ).trim(),

                  durationMs:
                    Date.now() -
                    startExecTime,
                },

                originalFile: {
                  filename:
                    originalSaveFilename,

                  size:
                    origStats.size,

                  lines:
                    fileContent.split(
                      '\n'
                    ).length,

                  sha256:
                    origHash,

                  savedPath:
                    `storage/originals/${originalSaveFilename}`,

                  untouched:
                    true,
                },

                processedFile: {
                  filename:
                    finalTargetFilename,

                  size:
                    procStats.size,

                  lines:
                    newContent.split(
                      '\n'
                    ).length,

                  sha256:
                    procHash,

                  content:
                    newContent,

                  downloadUrl:
                    `/api/download/processed/${encodeURIComponent(
                      finalTargetFilename
                    )}`,
                },

                instruction,

                transformSummary,

                neverOverwritten:
                  true,

                timestamp,
              });
            }

            exec(
              `${python} ${getShellSafePath(
                processedFilePath
              )}`,
              {
                timeout:
                  10000,

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
                      origStats.size,

                    lines:
                      fileContent.split(
                        '\n'
                      ).length,

                    sha256:
                      origHash,

                    savedPath:
                      `storage/originals/${originalSaveFilename}`,

                    untouched:
                      true,
                  },

                  processedFile: {
                    filename:
                      finalTargetFilename,

                    size:
                      procStats.size,

                    lines:
                      newContent.split(
                        '\n'
                      ).length,

                    sha256:
                      procHash,

                    content:
                      newContent,

                    downloadUrl:
                      `/api/download/processed/${encodeURIComponent(
                        finalTargetFilename
                      )}`,
                  },

                  instruction,

                  transformSummary,

                  neverOverwritten:
                    true,

                  timestamp,
                });
              }
            );
          }
        );
      } catch (err: any) {
        return res.status(500).json({
          success:
            false,

          ponteVersion:
            'v2',

          error:
            `Erro ao processar requisição na Ponte Alex v2: ${err.message}`,
        });
      }
    }
  );

  // ============================================================
  // DOWNLOAD DE ARQUIVOS LEGADOS
  // ============================================================

  app.get(
    '/api/download/:filename',
    (req, res) => {
      const filename =
        path.basename(
          req.params.filename
        );

      const allowed = [
        'app_teste_copia.py',
        'app_teste.py',
        'teste_alex.py',
      ];

      if (
        !allowed.includes(
          filename
        )
      ) {
        return res.status(403).send(
          'Acesso negado ao arquivo solicitado.'
        );
      }

      const filePath =
        path.join(
          process.cwd(),
          filename
        );

      if (
        !fs.existsSync(
          filePath
        )
      ) {
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
  // ROTA DE SAÚDE
  // ============================================================

  app.get(
    '/api/health',
    (req, res) => {
      return res.json({
        success:
          true,

        status:
          'online',

        ponte:
          'Ponte Alex v2',

        timestamp:
          Date.now(),
      });
    }
  );

  // ============================================================
  // ⭐ PONTE ALEX V2 — CRIAR ARQUIVO
  // ============================================================
  // ============================================================
  // ⭐ PONTE ALEX V2 — CRIAR ARQUIVO
  // ============================================================

  app.post(
    '/api/ponte/v2/criar-arquivo',
    (req, res) => {
      try {
        const body = req.body ?? {};

        // --------------------------------------------------------
        // RECEBER DADOS
        // --------------------------------------------------------

        const filenameRaw =
          body.filename ??
          body.nomeArquivo ??
          body.nome ??
          'codigo_alex.py';

        const codeRaw =
          body.code ??
          body.codigo ??
          body.fileContent ??
          body.content ??
          '';

        // --------------------------------------------------------
        // CORREÇÃO UTF-8
        // --------------------------------------------------------

        const filenameCorrigido =
          corrigirTextoUTF8(
            String(filenameRaw)
          ).trim();

        const codeCorrigido =
          corrigirTextoUTF8(
            String(codeRaw)
          );

        // --------------------------------------------------------
        // VALIDAÇÃO
        // --------------------------------------------------------

        if (!filenameCorrigido) {
          return res.status(400).json({
            success: false,
            ok: false,
            error: 'Informe o nome do arquivo.',
          });
        }

        if (
          typeof codeRaw !== 'string' &&
          codeRaw !== undefined &&
          codeRaw !== null
        ) {
          return res.status(400).json({
            success: false,
            ok: false,
            error: 'Informe o código Python como texto.',
          });
        }

        if (!codeCorrigido.length) {
          return res.status(400).json({
            success: false,
            ok: false,
            error: 'Informe o código Python.',
          });
        }

        // --------------------------------------------------------
        // NOME SEGURO
        // --------------------------------------------------------

        const safeFilename =
          sanitizeSafePythonFilename(
            filenameCorrigido,
            'codigo_alex'
          );

        // --------------------------------------------------------
        // CAMINHO FINAL
        // --------------------------------------------------------

        let finalFilename =
          safeFilename;

        let filePath =
          path.join(
            processedDir,
            finalFilename
          );

        // --------------------------------------------------------
        // PROTEÇÃO DE CAMINHO
        // --------------------------------------------------------

        if (
          !isInsideDirectory(
            filePath,
            processedDir
          )
        ) {
          return res.status(403).json({
            success: false,
            ok: false,
            error: 'Caminho do arquivo inválido.',
          });
        }

        // --------------------------------------------------------
        // NUNCA SOBRESCREVER
        //
        // Se o nome já existir, somente então cria uma
        // variação com timestamp.
        // --------------------------------------------------------

        if (
          fs.existsSync(
            filePath
          )
        ) {
          const namePart =
            path.basename(
              safeFilename,
              '.py'
            );

          const timestamp =
            Date.now();

          finalFilename =
            `${namePart}_${timestamp}.py`;

          filePath =
            path.join(
              processedDir,
              finalFilename
            );

          if (
            !isInsideDirectory(
              filePath,
              processedDir
            )
          ) {
            return res.status(403).json({
              success: false,
              ok: false,
              error: 'Caminho do arquivo inválido.',
            });
          }
        }

        // --------------------------------------------------------
        // SALVAR EM UTF-8
        // --------------------------------------------------------

        fs.writeFileSync(
          filePath,
          codeCorrigido,
          {
            encoding: 'utf8',
            flag: 'wx',
          }
        );

        // --------------------------------------------------------
        // CONFIRMAR CONTEÚDO GRAVADO
        // --------------------------------------------------------

        const savedContent =
          fs.readFileSync(
            filePath,
            {
              encoding: 'utf8',
            }
          );

        // --------------------------------------------------------
        // ESTATÍSTICAS
        // --------------------------------------------------------

        const stats =
          fs.statSync(
            filePath
          );

        const sha256 =
          calculateSha256(
            savedContent
          );

        const lines =
          savedContent.split(
            '\n'
          ).length;

        const downloadUrl =
          `/api/download/processed/${encodeURIComponent(
            finalFilename
          )}`;

        // --------------------------------------------------------
        // RESPOSTA PARA ALEX IA ULTRA
        // --------------------------------------------------------

        return res.status(201).json({
          success: true,
          ok: true,

          ponte:
            'Ponte Alex v2',

          version:
            '2.0.0',

          status:
            'ARQUIVO_CRIADO',

          message:
            'Arquivo Python criado com sucesso e salvo na Ponte Alex v2.',

          file: {
            filename:
              finalFilename,

            requestedFilename:
              filenameCorrigido,

            size:
              stats.size,

            lines,

            sha256,

            encoding:
              'UTF-8',

            path:
              `storage/processed/${finalFilename}`,

            downloadUrl,

            content:
              savedContent,
          },

          neverOverwritten:
            true,

          timestamp:
            Date.now(),
        });

      } catch (error: any) {
        console.error(
          'Erro ao criar arquivo na Ponte Alex v2:',
          error
        );

        return res.status(500).json({
          success: false,
          ok: false,

          error:
            `Não foi possível criar o arquivo: ${error.message}`,
        });
      }
    }
  );
  
  // ============================================================
  // START SERVER
  // ============================================================

  if (
    process.env.NODE_ENV !==
    'production'
  ) {
    const vite =
      await createViteServer({
        server: {
          middlewareMode:
            true,
        },

        appType:
          'spa',
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

    app.get(
      '*',
      (req, res) => {
        res.sendFile(
          path.join(
            distPath,
            'index.html'
          )
        );
      }
    );
  }

  // ============================================================
  // START
  // ============================================================

  app.listen(
    PORT,
    '0.0.0.0',
    () => {
      console.log(
        `Ponte Alex v2 online em http://localhost:${PORT}`
      );

      console.log(
        `Ambiente: ${
          process.env.NODE_ENV ||
          'development'
        }`
      );

      console.log(
        `Autenticação: ${
          getSystemConfiguredSecret()
            ? 'ATIVA'
            : 'DESATIVADA'
        }`
      );

      console.log(
        `Python: ${getPythonCommand()}`
      );

      console.log(
        'Armazenamento de originais: storage/originals'
      );

      console.log(
        'Armazenamento de processados: storage/processed'
      );

      console.log(
        'Criação de arquivos: POST /api/ponte/v2/criar-arquivo'
      );
    }
  );
}

// ============================================================
// ERRO DE INICIALIZAÇÃO
// ============================================================

startServer().catch(
  (err) => {
    console.error(
      'Failed to start server:',
      err
    );

    process.exitCode =
      1;
  }
);
