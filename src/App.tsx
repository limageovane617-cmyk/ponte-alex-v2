import React, { useState, useEffect, useRef } from 'react';
import { 
  FileCode, 
  Play, 
  Download, 
  CheckCircle2, 
  XCircle,
  HardDrive, 
  Terminal, 
  RefreshCw, 
  Copy, 
  ShieldCheck,
  Check,
  FileCheck,
  Cpu,
  Layers,
  ArrowRight,
  UploadCloud,
  FilePlus,
  Sliders,
  History,
  Sparkles,
  AlertTriangle,
  Code,
  FileText,
  Webhook,
  Send,
  Radio,
  Server,
  TerminalSquare,
  Network,
  Globe,
  KeyRound,
  ExternalLink,
  Lock,
  Unlock,
  CheckCheck
} from 'lucide-react';

interface FileDetails {
  exists: boolean;
  filename: string;
  filePath: string;
  size?: number;
  lines?: number;
  sha256?: string;
  modifiedAt?: string;
  content?: string;
}

interface ExecutionResult {
  success: boolean;
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
  executedCommand: string;
}

interface PonteProcessResult {
  success: boolean;
  ponteVersion?: string;
  status?: string;
  testPassed: boolean;
  testMessage: string;
  compileCheck: { passed: boolean; error?: string; message?: string };
  execution: {
    exitCode: number;
    stdout: string;
    stderr: string;
    durationMs: number;
  };
  originalFile: {
    filename: string;
    size: number;
    lines: number;
    sha256: string;
    savedPath: string;
    untouched: boolean;
  };
  processedFile: {
    filename: string;
    size: number;
    lines: number;
    sha256: string;
    content: string;
    downloadUrl: string;
  };
  instruction: string;
  transformSummary: string;
  neverOverwritten: boolean;
  timestamp?: number;
  error?: string;
  authRequired?: boolean;
}

interface HistoryItem {
  filename: string;
  size: number;
  modifiedAt: string;
  downloadUrl: string;
}

interface ApiPingResponse {
  status: string;
  ponte: string;
  version: string;
  message: string;
  authConfigured?: boolean;
  authHeaderName?: string;
  pythonRuntime?: string;
  timestamp: number;
  uptimeSeconds: number;
  security?: {
    isolatedStorage: boolean;
    directoryTraversalProtected: boolean;
    externalApiFree: boolean;
    apiKeysRequired: boolean;
    overwriteOriginalProtected: boolean;
    authConfigured?: boolean;
  };
  endpoints?: Record<string, string>;
}

export default function App() {
  // Navigation tabs
  const [activeMainTab, setActiveMainTab] = useState<'v2_api' | 'ponte_v1' | 'copia_lab' | 'alex_lab'>('v2_api');

  // Dynamic host detection for external documentation
  const [currentOrigin, setCurrentOrigin] = useState<string>('http://localhost:3000');

  useEffect(() => {
    if (typeof window !== 'undefined' && window.location?.origin) {
      setCurrentOrigin(window.location.origin);
    }
  }, []);

  // =========================================================================
  // PONTE ALEX v2 (API HTTP & INTEGRAÇÃO EXTERNA) STATE
  // =========================================================================
  const [apiStatus, setApiStatus] = useState<ApiPingResponse | null>(null);
  const [pingLoading, setPingLoading] = useState<boolean>(false);
  
  // v2 API interactive request parameters
  const [v2InputFile, setV2InputFile] = useState<string>('meu_modulo.py');
  const [v2FileContent, setV2FileContent] = useState<string>(
`# Script Python para envio via API HTTP da Ponte Alex v2
def executar_rotina():
    print("[v1] Iniciando rotina operacional local...")
    return {"status": "ok", "codigo": 100}

if __name__ == "__main__":
    resultado = executar_rotina()
    print(f"Resultado: {resultado}")
`
  );
  const [v2Instruction, setV2Instruction] = useState<string>(
    'Substituir "[v1] Iniciando rotina operacional local..." por "🚀 [Ponte Alex v2] API HTTP: Rotina executada e validada com sucesso!"'
  );
  const [v2DesiredOutputName, setV2DesiredOutputName] = useState<string>('modulo_saida_alex_v2.py');
  const [v2CustomSecret, setV2CustomSecret] = useState<string>('');
  const [v2Processing, setV2Processing] = useState<boolean>(false);
  const [v2Result, setV2Result] = useState<PonteProcessResult | null>(null);
  const [v2RawResponse, setV2RawResponse] = useState<string>('');
  const [copiedCurl, setCopiedCurl] = useState<boolean>(false);
  const [copiedPythonReq, setCopiedPythonReq] = useState<boolean>(false);
  const [copiedUrl, setCopiedUrl] = useState<boolean>(false);

  // =========================================================================
  // PONTE ALEX v1 (UI UPLOAD) STATE
  // =========================================================================
  const [uploadedFileName, setUploadedFileName] = useState<string>('meu_script.py');
  const [fileContent, setFileContent] = useState<string>(
`# Script de exemplo para a Ponte Alex
def saudacao():
    print("Olá! Executando script de teste inicial.")

if __name__ == "__main__":
    saudacao()
    print("Processamento base concluído com sucesso.")
`
  );
  const [instruction, setInstruction] = useState<string>(
    'Substituir "Olá! Executando script de teste inicial." por "🚀 Ponte Alex: Código transformado e testado com sucesso!"'
  );
  const [searchTarget, setSearchTarget] = useState<string>('');
  const [replaceWith, setReplaceWith] = useState<string>('');
  const [showAdvancedReplace, setShowAdvancedReplace] = useState<boolean>(false);
  const [processing, setProcessing] = useState<boolean>(false);
  const [ponteResult, setPonteResult] = useState<PonteProcessResult | null>(null);
  const [historyItems, setHistoryItems] = useState<HistoryItem[]>([]);
  const [copiedPonteCode, setCopiedPonteCode] = useState<boolean>(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // =========================================================================
  // LABS (app_teste_copia.py & teste_alex.py) STATE
  // =========================================================================
  const [files, setFiles] = useState<{
    original?: FileDetails;
    copia?: FileDetails;
    testeAlex?: FileDetails;
  }>({});
  const [areIdentical, setAreIdentical] = useState<boolean>(false);
  const [executionCopia, setExecutionCopia] = useState<ExecutionResult | null>(null);
  const [loadingRunCopia, setLoadingRunCopia] = useState(false);
  const [activeViewerTab, setActiveViewerTab] = useState<'app_teste_copia' | 'app_teste' | 'teste_alex'>('app_teste_copia');

  const [alexExecution, setAlexExecution] = useState<ExecutionResult | null>(null);
  const [loadingAlexRun, setLoadingAlexRun] = useState(false);

  // Ping endpoint of Ponte Alex v2
  const checkApiPing = async () => {
    setPingLoading(true);
    try {
      const res = await fetch('/api/ponte/v2/ping');
      if (res.ok) {
        const data = await res.json();
        setApiStatus(data);
      }
    } catch (e) {
      console.error('Erro no ping da API v2:', e);
    } finally {
      setPingLoading(false);
    }
  };

  // Fetch status of files
  const fetchStatus = async () => {
    try {
      const res = await fetch('/api/status');
      if (res.ok) {
        const data = await res.json();
        setFiles(data.files);
        setAreIdentical(data.areIdentical);
      }
    } catch (e) {
      console.error('Erro ao buscar status:', e);
    }
  };

  const fetchHistory = async () => {
    try {
      const res = await fetch('/api/ponte/history');
      if (res.ok) {
        const data = await res.json();
        if (data.items) {
          setHistoryItems(data.items);
        }
      }
    } catch (e) {
      console.error('Erro ao buscar histórico:', e);
    }
  };

  useEffect(() => {
    checkApiPing();
    fetchStatus();
    fetchHistory();
  }, []);

  // Send request via Ponte Alex v2 HTTP API
  const handleCallV2Api = async () => {
    if (!v2FileContent.trim()) {
      alert('Por favor, informe o conteúdo do arquivo Python.');
      return;
    }
    if (!v2Instruction.trim()) {
      alert('Por favor, informe a instrução de alteração.');
      return;
    }

    setV2Processing(true);
    setV2Result(null);
    setV2RawResponse('');

    try {
      const payload = {
        filename: v2InputFile,
        fileContent: v2FileContent,
        instruction: v2Instruction,
        outputFilename: v2DesiredOutputName,
      };

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };

      if (v2CustomSecret.trim()) {
        headers['x-api-secret'] = v2CustomSecret.trim();
      }

      const res = await fetch('/api/ponte/v2/processar', {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
      });

      const rawText = await res.text();
      setV2RawResponse(rawText);

      try {
        const data: PonteProcessResult = JSON.parse(rawText);
        setV2Result(data);
      } catch (parseErr) {
        console.error('Erro ao parsear JSON:', parseErr);
      }

      await fetchHistory();
      await fetchStatus();
    } catch (e: any) {
      alert(`Erro na requisição à API v2: ${e.message}`);
    } finally {
      setV2Processing(false);
    }
  };

  // Handle file upload for v1
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setUploadedFileName(file.name);
      const reader = new FileReader();
      reader.onload = (event) => {
        const content = event.target?.result as string;
        setFileContent(content || '');
      };
      reader.readAsText(file);
    }
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (file) {
      setUploadedFileName(file.name);
      const reader = new FileReader();
      reader.onload = (event) => {
        const content = event.target?.result as string;
        setFileContent(content || '');
      };
      reader.readAsText(file);
    }
  };

  // Process file in Ponte Alex v1
  const handleProcessPonteV1 = async () => {
    if (!fileContent.trim()) {
      alert('Por favor, informe o conteúdo do arquivo Python.');
      return;
    }
    if (!instruction.trim()) {
      alert('Por favor, informe a instrução de alteração.');
      return;
    }

    setProcessing(true);
    setPonteResult(null);

    try {
      const res = await fetch('/api/ponte/processar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filename: uploadedFileName,
          fileContent,
          instruction,
          searchTarget: showAdvancedReplace ? searchTarget : undefined,
          replaceWith: showAdvancedReplace ? replaceWith : undefined,
        }),
      });

      const data = await res.json();
      setPonteResult(data);
      await fetchHistory();
      await fetchStatus();
    } catch (e: any) {
      alert(`Erro na requisição: ${e.message}`);
    } finally {
      setProcessing(false);
    }
  };

  // Run app_teste_copia.py
  const handleRunCopia = async () => {
    setLoadingRunCopia(true);
    try {
      const res = await fetch('/api/run-copia', { method: 'POST' });
      const data = await res.json();
      setExecutionCopia(data);
    } catch (e: any) {
      setExecutionCopia({
        success: false,
        exitCode: 1,
        stdout: '',
        stderr: e.message || 'Falha na execução',
        durationMs: 0,
        executedCommand: 'python3 app_teste_copia.py',
      });
    } finally {
      setLoadingRunCopia(false);
    }
  };

  // Run teste_alex.py
  const handleRunAlex = async () => {
    setLoadingAlexRun(true);
    try {
      const res = await fetch('/api/run-python', { method: 'POST' });
      const data = await res.json();
      setAlexExecution(data);
    } catch (e: any) {
      setAlexExecution({
        success: false,
        exitCode: 1,
        stdout: '',
        stderr: e.message || 'Falha na execução',
        durationMs: 0,
        executedCommand: 'python3 teste_alex.py',
      });
    } finally {
      setLoadingAlexRun(false);
    }
  };

  const copyCode = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedPonteCode(true);
    setTimeout(() => setCopiedPonteCode(false), 2000);
  };

  const curlExample = `curl -X POST ${currentOrigin}/api/ponte/v2/processar \\
  -H "Content-Type: application/json" \\
  -H "x-api-secret: \${PONTE_API_SECRET}" \\
  -d '{
    "filename": "${v2InputFile}",
    "outputFilename": "${v2DesiredOutputName}",
    "instruction": "${v2Instruction.replace(/"/g, '\\"')}",
    "fileContent": ${JSON.stringify(v2FileContent)}
  }'`;

  const pythonReqExample = `import os
import requests

# URL pública da sua Ponte Alex v2 publicada
BASE_URL = "${currentOrigin}"
SECRET = os.getenv("PONTE_API_SECRET", "seu_segredo_configurado_aqui")

headers = {
    "Content-Type": "application/json",
    "x-api-secret": SECRET
}

payload = {
    "filename": "${v2InputFile}",
    "outputFilename": "${v2DesiredOutputName}",
    "instruction": "${v2Instruction.replace(/"/g, '\\"')}",
    "fileContent": """${v2FileContent.replace(/"""/g, '\\"\\"\\"')}"""
}

# Envio da solicitação para a Ponte Alex v2
response = requests.post(f"{BASE_URL}/api/ponte/v2/processar", json=payload, headers=headers)
resultado = response.json()

print(f"Status: {resultado.get('status')}")
print(f"Teste Aprovado: {resultado.get('testPassed')}")
print(f"Mensagem: {resultado.get('testMessage')}")
print(f"Saída Python:\\n{resultado.get('execution', {}).get('stdout')}")

if resultado.get("processedFile", {}).get("downloadUrl"):
    download_url = f"{BASE_URL}{resultado['processedFile']['downloadUrl']}"
    print(f"URL de Download do Arquivo Final: {download_url}")
`;

  const currentViewerFile = activeViewerTab === 'app_teste_copia' 
    ? files.copia 
    : activeViewerTab === 'app_teste' 
    ? files.original 
    : files.testeAlex;

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col items-center p-4 sm:p-8 font-sans selection:bg-emerald-500/30 selection:text-emerald-200">
      
      {/* Header */}
      <header className="w-full max-w-5xl mb-6 text-center space-y-3">
        <div className="inline-flex items-center gap-2 px-3.5 py-1 rounded-full bg-emerald-950/90 border border-emerald-700/70 text-emerald-300 text-xs font-mono uppercase tracking-wider shadow-sm">
          <ShieldCheck className="w-3.5 h-3.5" />
          Ponte Alex v2 • Preparada para Integração Externa Segura via HTTPS
        </div>
        <h1 className="text-3xl sm:text-4xl font-bold tracking-tight text-white flex items-center justify-center gap-3">
          <span>Ponte Alex</span>
          <span className="px-2.5 py-0.5 rounded-lg bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 text-2xl font-mono">v2</span>
        </h1>
        <p className="text-slate-400 text-sm sm:text-base max-w-2xl mx-auto">
          Plataforma e API HTTP para recebimento seguro de arquivos Python, preservação do original, execução em runtime e download para programas externos.
        </p>

        {/* Real-Time Status Indicators */}
        <div className="flex flex-wrap items-center justify-center gap-2.5 pt-1">
          <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-xl bg-slate-900 border border-slate-800 text-xs font-mono">
            <span className={`w-2.5 h-2.5 rounded-full ${apiStatus?.status === 'online' ? 'bg-emerald-400 animate-pulse' : 'bg-amber-400'}`} />
            <span className="text-slate-300 font-semibold">API:</span>
            <span className={apiStatus?.status === 'online' ? 'text-emerald-400' : 'text-amber-400'}>
              {apiStatus?.status === 'online' ? 'ONLINE (Pronta)' : 'Verificando...'}
            </span>
          </div>

          <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-xl bg-slate-900 border border-slate-800 text-xs font-mono">
            {apiStatus?.authConfigured ? (
              <>
                <Lock className="w-3.5 h-3.5 text-emerald-400" />
                <span className="text-emerald-400 font-semibold">Autenticação por Secret: ATIVA</span>
              </>
            ) : (
              <>
                <Unlock className="w-3.5 h-3.5 text-amber-400" />
                <span className="text-amber-300">Modo Dev (Configure PONTE_API_SECRET)</span>
              </>
            )}
          </div>

          <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-xl bg-slate-900 border border-slate-800 text-xs font-mono text-slate-300">
            <Cpu className="w-3.5 h-3.5 text-blue-400" />
            <span>{apiStatus?.pythonRuntime || 'Python 3'}</span>
          </div>

          <button
            onClick={checkApiPing}
            disabled={pingLoading}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-300 hover:text-white text-xs font-mono transition-colors cursor-pointer"
          >
            <RefreshCw className={`w-3 h-3 ${pingLoading ? 'animate-spin' : ''}`} />
            Ping
          </button>
        </div>
      </header>

      {/* Main Navigation Tabs */}
      <div className="w-full max-w-5xl mb-6 flex flex-wrap items-center justify-center gap-2 border-b border-slate-800 pb-3">
        <button
          id="nav-tab-v2-api"
          onClick={() => setActiveMainTab('v2_api')}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-xl font-medium text-sm transition-all cursor-pointer ${
            activeMainTab === 'v2_api'
              ? 'bg-emerald-600 text-white shadow-lg shadow-emerald-900/30 border border-emerald-500'
              : 'bg-slate-900/80 hover:bg-slate-800 text-slate-300 border border-slate-800'
          }`}
        >
          <Webhook className="w-4 h-4 text-emerald-300" />
          <span>API HTTP & Integração Externa (Ponte Alex v2)</span>
        </button>

        <button
          id="nav-tab-ponte-v1"
          onClick={() => setActiveMainTab('ponte_v1')}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-xl font-medium text-sm transition-all cursor-pointer ${
            activeMainTab === 'ponte_v1'
              ? 'bg-emerald-700 text-white shadow-lg shadow-emerald-900/30 border border-emerald-600'
              : 'bg-slate-900/80 hover:bg-slate-800 text-slate-300 border border-slate-800'
          }`}
        >
          <Layers className="w-4 h-4 text-emerald-300" />
          <span>Fluxo Gráfico (Ponte v1)</span>
        </button>

        <button
          id="nav-tab-copia"
          onClick={() => setActiveMainTab('copia_lab')}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-xl font-medium text-sm transition-all cursor-pointer ${
            activeMainTab === 'copia_lab'
              ? 'bg-blue-600 text-white shadow-lg shadow-blue-900/30 border border-blue-500'
              : 'bg-slate-900/80 hover:bg-slate-800 text-slate-300 border border-slate-800'
          }`}
        >
          <FileCheck className="w-4 h-4 text-blue-300" />
          <span>Laboratório app_teste_copia.py</span>
        </button>

        <button
          id="nav-tab-alex"
          onClick={() => setActiveMainTab('alex_lab')}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-xl font-medium text-sm transition-all cursor-pointer ${
            activeMainTab === 'alex_lab'
              ? 'bg-purple-600 text-white shadow-lg shadow-purple-900/30 border border-purple-500'
              : 'bg-slate-900/80 hover:bg-slate-800 text-slate-300 border border-slate-800'
          }`}
        >
          <Cpu className="w-4 h-4 text-purple-300" />
          <span>Laboratório teste_alex.py</span>
        </button>
      </div>

      {/* Main Content Area */}
      <main className="w-full max-w-5xl space-y-6">

        {/* ================================================================= */}
        {/* TAB 1: PONTE ALEX v2 (API HTTP & INTEGRAÇÃO EXTERNA)              */}
        {/* ================================================================= */}
        {activeMainTab === 'v2_api' && (
          <div className="space-y-6">

            {/* Documentation: External HTTPS URL & Endpoints */}
            <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-5 sm:p-6 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 pb-3">
                <div className="flex items-center gap-2.5">
                  <Globe className="w-5 h-5 text-emerald-400 shrink-0" />
                  <div>
                    <h2 className="text-base font-bold text-white">Guia de Integração Externa (HTTPS)</h2>
                    <p className="text-xs text-slate-400">Endpoints e parâmetros para conectar outro programa à Ponte Alex v2.</p>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <span className="text-xs font-mono px-3 py-1 rounded-lg bg-slate-950 border border-slate-800 text-slate-300">
                    URL Base: <strong className="text-emerald-400">{currentOrigin}</strong>
                  </span>
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText(currentOrigin);
                      setCopiedUrl(true);
                      setTimeout(() => setCopiedUrl(false), 2000);
                    }}
                    className="p-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg text-xs transition-colors cursor-pointer"
                    title="Copiar URL Base"
                  >
                    {copiedUrl ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                  </button>
                </div>
              </div>

              {/* Endpoints Table */}
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs font-mono">
                  <thead>
                    <tr className="border-b border-slate-800 text-slate-400">
                      <th className="pb-2 font-semibold">Método</th>
                      <th className="pb-2 font-semibold">Endpoint Público</th>
                      <th className="pb-2 font-semibold">Autenticação</th>
                      <th className="pb-2 font-semibold">Descrição</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60 text-slate-300">
                    <tr>
                      <td className="py-2.5"><span className="px-2 py-0.5 rounded bg-blue-950 border border-blue-800 text-blue-300 font-bold">GET</span></td>
                      <td className="py-2.5 text-emerald-400 font-bold">/api/ponte/v2/ping</td>
                      <td className="py-2.5 text-slate-400">Pública</td>
                      <td className="py-2.5 text-slate-400">Health check simples. Confirma que a API está online e pronta.</td>
                    </tr>
                    <tr>
                      <td className="py-2.5"><span className="px-2 py-0.5 rounded bg-emerald-950 border border-emerald-800 text-emerald-300 font-bold">POST</span></td>
                      <td className="py-2.5 text-emerald-400 font-bold">/api/ponte/v2/processar</td>
                      <td className="py-2.5">
                        <span className="px-2 py-0.5 rounded bg-slate-950 border border-slate-700 text-amber-300 text-[11px]">
                          Header x-api-secret
                        </span>
                      </td>
                      <td className="py-2.5 text-slate-400">Recebe arquivo Python, preserva cópia original, aplica alteração, executa no Python e retorna resultado.</td>
                    </tr>
                    <tr>
                      <td className="py-2.5"><span className="px-2 py-0.5 rounded bg-blue-950 border border-blue-800 text-blue-300 font-bold">GET</span></td>
                      <td className="py-2.5 text-emerald-400 font-bold">/api/download/processed/:filename</td>
                      <td className="py-2.5 text-slate-400">Direta</td>
                      <td className="py-2.5 text-slate-400">Download direto do arquivo Python resultante processado.</td>
                    </tr>
                    <tr>
                      <td className="py-2.5"><span className="px-2 py-0.5 rounded bg-purple-950 border border-purple-800 text-purple-300 font-bold">GET</span></td>
                      <td className="py-2.5 text-purple-300 font-bold">/ponte_alex_openapi_v2.yaml</td>
                      <td className="py-2.5 text-slate-400">Pública</td>
                      <td className="py-2.5 text-slate-400">Especificação OpenAPI 3.0.3 corrigida da Ponte Alex v2 (YAML).</td>
                    </tr>
                  </tbody>
                </table>
              </div>

              {/* OpenAPI 3.0 Download & Specification Banner */}
              <div className="p-4 rounded-xl bg-slate-950 border border-purple-900/40 text-xs flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2.5">
                  <Code className="w-5 h-5 text-purple-400 shrink-0" />
                  <div>
                    <span className="font-bold text-white text-sm">Especificação OpenAPI 3.0.3 Oficial (v2)</span>
                    <p className="text-slate-400 text-xs mt-0.5">Arquivo <code className="text-purple-300 font-mono">ponte_alex_openapi_v2.yaml</code> (UTF-8, ApiKeyAuth obrigatório via <code className="text-amber-300 font-mono">x-api-secret</code>).</p>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <a
                    id="btn-download-openapi-yaml-v2"
                    href="/ponte_alex_openapi_v2.yaml"
                    download="ponte_alex_openapi_v2.yaml"
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-purple-600 hover:bg-purple-500 text-white font-medium text-xs transition-colors cursor-pointer shadow-sm"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>Baixar ponte_alex_openapi_v2.yaml</span>
                  </a>
                  <a
                    id="btn-view-openapi-yaml-v2"
                    href="/ponte_alex_openapi_v2.yaml"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white font-medium text-xs transition-colors cursor-pointer border border-slate-700"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                    <span>Visualizar</span>
                  </a>
                </div>
              </div>

              {/* Official Python Client Download Banner */}
              <div className="p-4 rounded-xl bg-slate-950 border border-sky-900/40 text-xs flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2.5">
                  <Terminal className="w-5 h-5 text-sky-400 shrink-0" />
                  <div>
                    <span className="font-bold text-white text-sm">Cliente Oficial Python & Testes Automatizados</span>
                    <p className="text-slate-400 text-xs mt-0.5">Scripts <code className="text-sky-300 font-mono">cliente_ponte_alex.py</code> e <code className="text-sky-300 font-mono">teste_cliente_ponte.py</code> prontos para integração externa.</p>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <a
                    id="btn-download-client-py"
                    href="/cliente_ponte_alex.py"
                    download="cliente_ponte_alex.py"
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-sky-600 hover:bg-sky-500 text-white font-medium text-xs transition-colors cursor-pointer shadow-sm"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>Baixar cliente_ponte_alex.py</span>
                  </a>
                  <a
                    id="btn-download-test-client-py"
                    href="/teste_cliente_ponte.py"
                    download="teste_cliente_ponte.py"
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white font-medium text-xs transition-colors cursor-pointer border border-slate-700"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>Baixar teste_cliente_ponte.py</span>
                  </a>
                </div>
              </div>

              {/* Secrets Security Callout */}
              <div className="p-3.5 rounded-xl bg-slate-950/70 border border-slate-800/90 text-xs space-y-1.5">
                <div className="flex items-center gap-2 text-emerald-300 font-semibold">
                  <KeyRound className="w-4 h-4 text-emerald-400" />
                  <span>Segurança & Autenticação via Secrets do Ambiente</span>
                </div>
                <p className="text-slate-400 leading-relaxed">
                  Para autenticar chamadas externas com total segurança após publicação, configure a variável de segredo <code className="text-emerald-400 font-mono">PONTE_API_SECRET</code> no menu de <strong>Secrets</strong> do ambiente.
                  O programa externo deverá enviar este segredo através do cabeçalho HTTP <code className="text-emerald-300 font-mono">x-api-secret</code> ou <code className="text-emerald-300 font-mono">Authorization: Bearer &lt;SEU_SEGREDO&gt;</code>.
                </p>
              </div>
            </div>
            
            {/* 5-Step Pipeline Indicator */}
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 p-3 bg-slate-900/90 rounded-2xl border border-slate-800 text-xs font-mono">
              <div className={`p-2.5 rounded-xl border flex flex-col items-center text-center gap-1 ${
                apiStatus?.status === 'online' ? 'bg-emerald-950/40 border-emerald-700/60 text-emerald-300' : 'bg-slate-950 border-slate-800 text-slate-400'
              }`}>
                <Radio className="w-4 h-4" />
                <span className="font-bold text-[11px]">API FUNCIONANDO</span>
                <span className="text-[10px] opacity-75">/ping Respondendo</span>
              </div>

              <div className={`p-2.5 rounded-xl border flex flex-col items-center text-center gap-1 ${
                v2Result ? 'bg-emerald-950/40 border-emerald-700/60 text-emerald-300' : 'bg-slate-950 border-slate-800 text-slate-400'
              }`}>
                <UploadCloud className="w-4 h-4" />
                <span className="font-bold text-[11px]">ARQUIVO RECEBIDO</span>
                <span className="text-[10px] opacity-75">Cópia original salva</span>
              </div>

              <div className={`p-2.5 rounded-xl border flex flex-col items-center text-center gap-1 ${
                v2Result ? 'bg-emerald-950/40 border-emerald-700/60 text-emerald-300' : 'bg-slate-950 border-slate-800 text-slate-400'
              }`}>
                <Sparkles className="w-4 h-4" />
                <span className="font-bold text-[11px]">ARQUIVO PROCESSADO</span>
                <span className="text-[10px] opacity-75">Instrução aplicada</span>
              </div>

              <div className={`p-2.5 rounded-xl border flex flex-col items-center text-center gap-1 ${
                v2Result?.execution ? 'bg-emerald-950/40 border-emerald-700/60 text-emerald-300' : 'bg-slate-950 border-slate-800 text-slate-400'
              }`}>
                <TerminalSquare className="w-4 h-4" />
                <span className="font-bold text-[11px]">PYTHON EXECUTADO</span>
                <span className="text-[10px] opacity-75">Exit Code + Saída</span>
              </div>

              <div className={`p-2.5 rounded-xl border flex flex-col items-center text-center gap-1 col-span-2 sm:col-span-1 ${
                v2Result ? 'bg-emerald-950/40 border-emerald-700/60 text-emerald-300' : 'bg-slate-950 border-slate-800 text-slate-400'
              }`}>
                <Download className="w-4 h-4" />
                <span className="font-bold text-[11px]">RESULTADO RETORNADO</span>
                <span className="text-[10px] opacity-75">JSON + Download</span>
              </div>
            </div>

            {/* Interactive API Request Builder */}
            <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-5 sm:p-6 space-y-5">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 pb-4">
                <div>
                  <h2 className="text-lg font-bold text-white flex items-center gap-2">
                    <Webhook className="w-5 h-5 text-emerald-400" />
                    Testador da API HTTP da Ponte Alex v2
                  </h2>
                  <p className="text-xs text-slate-400 mt-0.5">
                    Permite testar o envio de código, instrução, nome de saída e autenticação por cabeçalho.
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  <span className="text-xs font-mono px-2.5 py-1 rounded bg-slate-950 border border-slate-800 text-slate-400">
                    POST /api/ponte/v2/processar
                  </span>
                </div>
              </div>

              {/* Form Grid */}
              <div className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-slate-300 mb-1">
                      Nome do Arquivo Original (opcional):
                    </label>
                    <input
                      type="text"
                      value={v2InputFile}
                      onChange={(e) => setV2InputFile(e.target.value)}
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-xs text-slate-200 font-mono focus:outline-none focus:border-emerald-500"
                      placeholder="ex: script_entrada.py"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-300 mb-1">
                      Nome Desejado para o Arquivo de Saída:
                    </label>
                    <input
                      type="text"
                      value={v2DesiredOutputName}
                      onChange={(e) => setV2DesiredOutputName(e.target.value)}
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-xs text-emerald-400 font-mono focus:outline-none focus:border-emerald-500"
                      placeholder="ex: modulo_saida_alex_v2.py"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-300 mb-1 flex items-center justify-between">
                      <span>Header x-api-secret (opcional para teste):</span>
                    </label>
                    <input
                      type="password"
                      value={v2CustomSecret}
                      onChange={(e) => setV2CustomSecret(e.target.value)}
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-xs text-slate-200 font-mono focus:outline-none focus:border-emerald-500"
                      placeholder="Deixe vazio ou digite segredo"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">
                    Instrução de Alteração:
                  </label>
                  <textarea
                    value={v2Instruction}
                    onChange={(e) => setV2Instruction(e.target.value)}
                    rows={2}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl p-2.5 text-xs text-slate-200 focus:outline-none focus:border-emerald-500"
                    placeholder="Instrução a ser processada pela Ponte..."
                  />
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-xs font-semibold text-slate-300">
                      Arquivo Python (<code className="text-emerald-400 font-mono">fileContent</code>):
                    </label>
                    <span className="text-[11px] text-slate-500 font-mono">{v2FileContent.split('\n').length} linhas</span>
                  </div>
                  <textarea
                    value={v2FileContent}
                    onChange={(e) => setV2FileContent(e.target.value)}
                    rows={8}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 font-mono text-xs text-slate-200 focus:outline-none focus:border-emerald-500 resize-y leading-relaxed"
                  />
                </div>

                {/* Submit Action */}
                <div className="flex flex-wrap items-center gap-3">
                  <button
                    id="btn-call-v2-api"
                    onClick={handleCallV2Api}
                    disabled={v2Processing || !v2FileContent.trim() || !v2Instruction.trim()}
                    className="flex-1 py-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-bold text-sm transition-all shadow-lg shadow-emerald-950 flex items-center justify-center gap-2 cursor-pointer"
                  >
                    {v2Processing ? (
                      <>
                        <RefreshCw className="w-4 h-4 animate-spin" />
                        <span>Enviando solicitação à API v2 e Executando Python...</span>
                      </>
                    ) : (
                      <>
                        <Send className="w-4 h-4" />
                        <span>Enviar Solicitação à API HTTP (POST /api/ponte/v2/processar)</span>
                      </>
                    )}
                  </button>

                  <button
                    onClick={checkApiPing}
                    className="px-4 py-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-medium text-xs font-mono transition-colors cursor-pointer border border-slate-700 flex items-center gap-1.5"
                  >
                    <Radio className="w-3.5 h-3.5 text-emerald-400" />
                    Ping (GET /api/ponte/v2/ping)
                  </button>
                </div>
              </div>
            </div>

            {/* API Response Display */}
            {v2Result && (
              <div id="v2-results-container" className="space-y-6">
                
                {/* Status Hero Card */}
                <div className={`p-5 rounded-2xl border ${
                  v2Result.testPassed
                    ? 'bg-emerald-950/30 border-emerald-500/40 text-emerald-300'
                    : 'bg-rose-950/30 border-rose-500/40 text-rose-300'
                } space-y-3`}>
                  
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-center gap-3">
                      {v2Result.testPassed ? (
                        <CheckCircle2 className="w-8 h-8 text-emerald-400 shrink-0" />
                      ) : (
                        <XCircle className="w-8 h-8 text-rose-400 shrink-0" />
                      )}
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="px-2 py-0.5 rounded bg-slate-900 border border-slate-700 text-[11px] font-mono text-emerald-400">
                            Ponte Alex v2
                          </span>
                          <span className="text-xs font-mono text-slate-400">Status: {v2Result.status || (v2Result.success ? 'SUCESSO' : 'ERRO')}</span>
                        </div>
                        <h3 className="text-lg font-bold text-white mt-1">
                          {v2Result.testPassed 
                            ? 'TESTE APROVADO • EXECUÇÃO PYTHON COM SUCESSO' 
                            : (v2Result.error ? `ERRO NA REQUISIÇÃO: ${v2Result.error}` : 'TESTE FALHOU NA EXECUÇÃO PYTHON')}
                        </h3>
                        <p className="text-xs opacity-90">{v2Result.testMessage || v2Result.error}</p>
                      </div>
                    </div>

                    {v2Result.execution && (
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-mono px-3 py-1 rounded-full bg-slate-900 border border-slate-700 text-slate-200">
                          Exit Code: {v2Result.execution.exitCode}
                        </span>
                        <span className="text-xs font-mono px-3 py-1 rounded-full bg-slate-900 border border-slate-700 text-slate-200">
                          {v2Result.execution.durationMs}ms
                        </span>
                      </div>
                    )}
                  </div>

                  {/* Summary row */}
                  {v2Result.originalFile && v2Result.processedFile && (
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 pt-2 border-t border-slate-800/80 text-xs font-mono text-slate-300">
                      <div>
                        <span className="text-slate-500">Arquivo Original:</span> <code className="text-emerald-400">Preservado Intacto</code>
                      </div>
                      <div>
                        <span className="text-slate-500">Arquivo de Saída:</span> <code className="text-emerald-400">{v2Result.processedFile.filename}</code>
                      </div>
                      <div>
                        <span className="text-slate-500">Segurança:</span> <code className="text-emerald-400">Diretório Protegido</code>
                      </div>
                    </div>
                  )}
                </div>

                {/* 2-Column: Comparison and Download */}
                {v2Result.originalFile && v2Result.processedFile && (
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 text-xs font-mono">
                    
                    {/* Left: Original Preserved */}
                    <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-4 space-y-2">
                      <div className="flex items-center justify-between text-slate-300 pb-2 border-b border-slate-800">
                        <span className="font-bold flex items-center gap-1.5 text-slate-200">
                          <ShieldCheck className="w-4 h-4 text-emerald-400" />
                          Arquivo Original Preservado
                        </span>
                        <span className="text-[11px] text-emerald-400 bg-emerald-950 px-2 py-0.5 rounded border border-emerald-800">
                          NÃO SOBRESCRITO
                        </span>
                      </div>
                      <div className="space-y-1 text-slate-400 pt-1">
                        <div><span className="text-slate-500">Nome físico:</span> {v2Result.originalFile.filename}</div>
                        <div><span className="text-slate-500">Tamanho:</span> {v2Result.originalFile.size} bytes ({v2Result.originalFile.lines} linhas)</div>
                        <div className="truncate"><span className="text-slate-500">SHA-256:</span> {v2Result.originalFile.sha256}</div>
                        <div><span className="text-slate-500">Caminho isolado:</span> <code className="text-slate-300 text-[11px]">storage/originals/</code></div>
                      </div>
                    </div>

                    {/* Right: New Processed File */}
                    <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-4 space-y-2">
                      <div className="flex items-center justify-between text-slate-300 pb-2 border-b border-slate-800">
                        <span className="font-bold flex items-center gap-1.5 text-emerald-400">
                          <FileCode className="w-4 h-4 text-emerald-400" />
                          Novo Arquivo Gerado (Saída)
                        </span>
                        <a
                          id="btn-download-v2-processed"
                          href={v2Result.processedFile.downloadUrl}
                          download={v2Result.processedFile.filename}
                          className="inline-flex items-center gap-1.5 px-3 py-1 rounded bg-emerald-600 hover:bg-emerald-500 text-white font-sans font-medium text-xs transition-colors cursor-pointer"
                        >
                          <Download className="w-3.5 h-3.5" />
                          Download Final
                        </a>
                      </div>
                      <div className="space-y-1 text-slate-400 pt-1">
                        <div><span className="text-slate-500">Nome final:</span> <span className="text-emerald-300 font-bold">{v2Result.processedFile.filename}</span></div>
                        <div><span className="text-slate-500">Tamanho:</span> {v2Result.processedFile.size} bytes ({v2Result.processedFile.lines} linhas)</div>
                        <div className="truncate"><span className="text-slate-500">SHA-256:</span> {v2Result.processedFile.sha256}</div>
                        <div><span className="text-slate-500">Download URL:</span> <code className="text-emerald-400 text-[11px]">{v2Result.processedFile.downloadUrl}</code></div>
                      </div>
                    </div>

                  </div>
                )}

                {/* Python Execution Terminal */}
                {v2Result.execution && (
                  <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-5 space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2 text-white font-semibold text-sm">
                        <Terminal className="w-4 h-4 text-emerald-400" />
                        <span>Saída do Interpretador Python (python3 {v2Result.processedFile?.filename})</span>
                      </div>
                      <span className="text-xs font-mono text-emerald-400 bg-emerald-950 px-2 py-0.5 rounded border border-emerald-800">
                        Execução Concluída
                      </span>
                    </div>

                    <div className="bg-slate-950 rounded-xl border border-slate-800 p-4 font-mono text-xs space-y-2">
                      {v2Result.execution.stdout && (
                        <div className="space-y-1">
                          <div className="text-slate-500 text-[11px]">--- Saída Padrão (stdout) ---</div>
                          <pre className="text-emerald-400 whitespace-pre-wrap bg-emerald-950/20 p-3 rounded border-l-2 border-emerald-500 leading-relaxed">
                            {v2Result.execution.stdout}
                          </pre>
                        </div>
                      )}

                      {v2Result.execution.stderr && (
                        <div className="space-y-1">
                          <div className="text-rose-400 text-[11px]">--- Saída de Erro (stderr) ---</div>
                          <pre className="text-rose-400 whitespace-pre-wrap bg-rose-950/20 p-3 rounded border-l-2 border-rose-500 leading-relaxed">
                            {v2Result.execution.stderr}
                          </pre>
                        </div>
                      )}

                      {!v2Result.execution.stdout && !v2Result.execution.stderr && (
                        <div className="text-slate-500 italic">[Sem mensagens no stdout/stderr durante a execução]</div>
                      )}
                    </div>
                  </div>
                )}

                {/* Formatted JSON Response from the API */}
                <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-5 space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 text-white font-semibold text-sm">
                      <Code className="w-4 h-4 text-blue-400" />
                      <span>Resposta JSON Retornada pela API HTTP</span>
                    </div>
                    <button
                      onClick={() => copyCode(v2RawResponse)}
                      className="inline-flex items-center gap-1 px-3 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs transition-colors cursor-pointer font-mono"
                    >
                      {copiedPonteCode ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                      Copiar JSON
                    </button>
                  </div>

                  <pre className="bg-slate-950 border border-slate-800 rounded-xl p-4 font-mono text-xs text-blue-300 max-h-72 overflow-y-auto leading-relaxed">
                    {v2RawResponse ? JSON.stringify(JSON.parse(v2RawResponse), null, 2) : 'Aguardando...'}
                  </pre>
                </div>

              </div>
            )}

            {/* Integration Guides for other programs */}
            <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-5 sm:p-6 space-y-4">
              <div className="border-b border-slate-800 pb-3">
                <h3 className="text-sm font-bold text-white flex items-center gap-2">
                  <Network className="w-4 h-4 text-emerald-400" />
                  Código de Exemplo para Integração Externa (HTTPS)
                </h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  Copie o modelo abaixo no seu programa ou terminal para enviar solicitações com autenticação segura.
                </p>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 text-xs font-mono">
                {/* cURL */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-slate-300">
                    <span className="font-semibold text-emerald-400">1. Chamada via cURL (Terminal / Bash)</span>
                    <button
                      onClick={() => {
                        navigator.clipboard.writeText(curlExample);
                        setCopiedCurl(true);
                        setTimeout(() => setCopiedCurl(false), 2000);
                      }}
                      className="text-[11px] text-slate-400 hover:text-white flex items-center gap-1 cursor-pointer"
                    >
                      {copiedCurl ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                      {copiedCurl ? 'Copiado!' : 'Copiar'}
                    </button>
                  </div>
                  <pre className="bg-slate-950 border border-slate-800 rounded-xl p-3 text-slate-300 overflow-x-auto max-h-52 leading-relaxed text-[11px]">
                    {curlExample}
                  </pre>
                </div>

                {/* Python requests */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-slate-300">
                    <span className="font-semibold text-blue-400">2. Chamada via Python (requests)</span>
                    <button
                      onClick={() => {
                        navigator.clipboard.writeText(pythonReqExample);
                        setCopiedPythonReq(true);
                        setTimeout(() => setCopiedPythonReq(false), 2000);
                      }}
                      className="text-[11px] text-slate-400 hover:text-white flex items-center gap-1 cursor-pointer"
                    >
                      {copiedPythonReq ? <Check className="w-3 h-3 text-blue-400" /> : <Copy className="w-3 h-3" />}
                      {copiedPythonReq ? 'Copiado!' : 'Copiar'}
                    </button>
                  </div>
                  <pre className="bg-slate-950 border border-slate-800 rounded-xl p-3 text-slate-300 overflow-x-auto max-h-52 leading-relaxed text-[11px]">
                    {pythonReqExample}
                  </pre>
                </div>
              </div>
            </div>

          </div>
        )}

        {/* ================================================================= */}
        {/* TAB 2: PONTE ALEX v1 (INTERFACE GRÁFICA / UPLOAD)                 */}
        {/* ================================================================= */}
        {activeMainTab === 'ponte_v1' && (
          <div className="space-y-6">
            
            {/* Step Workflow Guide Bar */}
            <div className="p-4 rounded-2xl bg-slate-900/80 border border-slate-800 flex flex-wrap items-center justify-between gap-3 text-xs font-mono">
              <div className="flex items-center gap-2 text-slate-300">
                <span className="w-5 h-5 rounded-full bg-emerald-950 border border-emerald-600 text-emerald-400 flex items-center justify-center font-bold">1</span>
                <span>Arquivo Enviado</span>
              </div>
              <ArrowRight className="w-3.5 h-3.5 text-slate-600 hidden sm:inline" />
              <div className="flex items-center gap-2 text-slate-300">
                <span className="w-5 h-5 rounded-full bg-emerald-950 border border-emerald-600 text-emerald-400 flex items-center justify-center font-bold">2</span>
                <span>Original Preservado</span>
              </div>
              <ArrowRight className="w-3.5 h-3.5 text-slate-600 hidden sm:inline" />
              <div className="flex items-center gap-2 text-slate-300">
                <span className="w-5 h-5 rounded-full bg-emerald-950 border border-emerald-600 text-emerald-400 flex items-center justify-center font-bold">3</span>
                <span>Alteração Local</span>
              </div>
              <ArrowRight className="w-3.5 h-3.5 text-slate-600 hidden sm:inline" />
              <div className="flex items-center gap-2 text-slate-300">
                <span className="w-5 h-5 rounded-full bg-emerald-950 border border-emerald-600 text-emerald-400 flex items-center justify-center font-bold">4</span>
                <span>Teste Python</span>
              </div>
              <ArrowRight className="w-3.5 h-3.5 text-slate-600 hidden sm:inline" />
              <div className="flex items-center gap-2 text-slate-300">
                <span className="w-5 h-5 rounded-full bg-emerald-950 border border-emerald-600 text-emerald-400 flex items-center justify-center font-bold">5</span>
                <span>Novo Arquivo & Download</span>
              </div>
            </div>

            {/* Input & Configuration Card */}
            <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-5 sm:p-6 space-y-5">
              
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 pb-4">
                <div>
                  <h2 className="text-lg font-bold text-white flex items-center gap-2">
                    <FileCode className="w-5 h-5 text-emerald-400" />
                    Enviar Arquivo Python & Fornecer Instrução
                  </h2>
                  <p className="text-xs text-slate-400 mt-0.5">
                    O arquivo original é armazenado intacto e protegido contra sobreescrita automática.
                  </p>
                </div>
              </div>

              {/* Drag & Drop Upload Zone */}
              <div
                onDragOver={(e) => e.preventDefault()}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
                className="border-2 border-dashed border-slate-700 hover:border-emerald-500 rounded-xl p-4 text-center bg-slate-950/50 hover:bg-slate-950 transition-colors cursor-pointer group"
              >
                <input
                  type="file"
                  ref={fileInputRef}
                  onChange={handleFileUpload}
                  accept=".py,text/plain"
                  className="hidden"
                />
                <div className="flex flex-col items-center justify-center gap-2">
                  <UploadCloud className="w-7 h-7 text-slate-400 group-hover:text-emerald-400 transition-colors" />
                  <div className="text-sm font-medium text-slate-200">
                    Clique ou arraste um arquivo Python (<code className="text-emerald-400 font-mono">.py</code>)
                  </div>
                  <div className="text-xs text-slate-400">
                    Arquivo ativo: <span className="font-mono text-white font-bold">{uploadedFileName}</span> ({fileContent.split('\n').length} linhas)
                  </div>
                </div>
              </div>

              {/* Editor + Instruction Grid */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                
                {/* File Code Editor */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-xs text-slate-400">
                    <span className="font-semibold text-slate-300">Conteúdo do Arquivo:</span>
                    <span className="font-mono">{uploadedFileName}</span>
                  </div>
                  <textarea
                    value={fileContent}
                    onChange={(e) => setFileContent(e.target.value)}
                    rows={10}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 font-mono text-xs text-slate-200 focus:outline-none focus:border-emerald-500 resize-y leading-relaxed"
                    placeholder="Cole ou edite o código Python aqui..."
                  />
                </div>

                {/* Instruction Input */}
                <div className="space-y-3 flex flex-col justify-between">
                  <div className="space-y-2">
                    <label className="block text-xs font-semibold text-slate-300">
                      Instrução de Alteração:
                    </label>
                    <textarea
                      value={instruction}
                      onChange={(e) => setInstruction(e.target.value)}
                      rows={4}
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-xs text-slate-200 focus:outline-none focus:border-emerald-500 leading-relaxed"
                      placeholder="Ex: Substituir 'texto_antigo' por 'texto_novo'"
                    />
                  </div>

                  {/* Advanced Search & Replace Toggle */}
                  <div>
                    <button
                      type="button"
                      onClick={() => setShowAdvancedReplace(!showAdvancedReplace)}
                      className="text-xs text-emerald-400 hover:text-emerald-300 inline-flex items-center gap-1.5 cursor-pointer"
                    >
                      <Sliders className="w-3.5 h-3.5" />
                      {showAdvancedReplace ? 'Ocultar campos exatos de substituição' : 'Configurar campos exatos de substituição'}
                    </button>

                    {showAdvancedReplace && (
                      <div className="grid grid-cols-2 gap-2 mt-2 p-3 bg-slate-950 rounded-xl border border-slate-800 text-xs">
                        <div>
                          <label className="text-slate-400 block mb-1">Localizar exatamente:</label>
                          <input
                            type="text"
                            value={searchTarget}
                            onChange={(e) => setSearchTarget(e.target.value)}
                            placeholder="Trecho a substituir"
                            className="w-full bg-slate-900 border border-slate-700 rounded p-1.5 text-xs text-slate-200 font-mono"
                          />
                        </div>
                        <div>
                          <label className="text-slate-400 block mb-1">Substituir por:</label>
                          <input
                            type="text"
                            value={replaceWith}
                            onChange={(e) => setReplaceWith(e.target.value)}
                            placeholder="Novo trecho"
                            className="w-full bg-slate-900 border border-slate-700 rounded p-1.5 text-xs text-slate-200 font-mono"
                          />
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Action Button */}
                  <button
                    onClick={handleProcessPonteV1}
                    disabled={processing || !fileContent.trim() || !instruction.trim()}
                    className="w-full py-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-bold text-sm transition-all shadow-lg shadow-emerald-950 flex items-center justify-center gap-2 cursor-pointer"
                  >
                    {processing ? (
                      <>
                        <RefreshCw className="w-4 h-4 animate-spin" />
                        <span>Processando e Executando Teste Python...</span>
                      </>
                    ) : (
                      <>
                        <Play className="w-4 h-4 fill-white" />
                        <span>Processar, Testar e Gerar Novo Arquivo</span>
                      </>
                    )}
                  </button>
                </div>

              </div>
            </div>

            {/* Results Section */}
            {ponteResult && (
              <div className="space-y-6">
                
                {/* Result Hero Header */}
                <div className={`p-5 rounded-2xl border ${
                  ponteResult.testPassed 
                    ? 'bg-emerald-950/30 border-emerald-500/40 text-emerald-300' 
                    : 'bg-rose-950/30 border-rose-500/40 text-rose-300'
                } space-y-3`}>
                  
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-center gap-3">
                      {ponteResult.testPassed ? (
                        <CheckCircle2 className="w-8 h-8 text-emerald-400 shrink-0" />
                      ) : (
                        <XCircle className="w-8 h-8 text-rose-400 shrink-0" />
                      )}
                      <div>
                        <h3 className="text-lg font-bold text-white">
                          {ponteResult.testPassed ? 'TESTE PASSOU COM SUCESSO' : 'TESTE FALHOU NA EXECUÇÃO'}
                        </h3>
                        <p className="text-xs opacity-90">{ponteResult.testMessage}</p>
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <span className="text-xs font-mono px-3 py-1 rounded-full bg-slate-900 border border-slate-700 text-slate-200">
                        Exit Code: {ponteResult.execution.exitCode}
                      </span>
                      <span className="text-xs font-mono px-3 py-1 rounded-full bg-slate-900 border border-slate-700 text-slate-200">
                        {ponteResult.execution.durationMs}ms
                      </span>
                    </div>
                  </div>

                  {/* Transformation info */}
                  <div className="pt-2 border-t border-slate-800 text-xs text-slate-300">
                    <span className="text-slate-400">Resumo da alteração:</span> {ponteResult.transformSummary}
                  </div>
                </div>

                {/* File comparison box */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs font-mono">
                  
                  {/* Original preserved */}
                  <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-4 space-y-2">
                    <div className="flex items-center justify-between text-slate-300 pb-2 border-b border-slate-800">
                      <span className="font-bold flex items-center gap-1.5 text-slate-200">
                        <ShieldCheck className="w-4 h-4 text-emerald-400" />
                        Arquivo Original Preservado
                      </span>
                      <span className="text-[11px] text-emerald-400 bg-emerald-950 px-2 py-0.5 rounded border border-emerald-800">
                        INTACTO
                      </span>
                    </div>
                    <div className="space-y-1 text-slate-400 pt-1">
                      <div><span className="text-slate-500">Salvo como:</span> {ponteResult.originalFile.filename}</div>
                      <div><span className="text-slate-500">Tamanho:</span> {ponteResult.originalFile.size} bytes ({ponteResult.originalFile.lines} linhas)</div>
                      <div className="truncate"><span className="text-slate-500">SHA-256:</span> {ponteResult.originalFile.sha256}</div>
                      <div><span className="text-slate-500">Garantia:</span> <span className="text-emerald-300 font-bold">Nunca sobrescreve</span></div>
                    </div>
                  </div>

                  {/* Processed file */}
                  <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-4 space-y-2">
                    <div className="flex items-center justify-between text-slate-300 pb-2 border-b border-slate-800">
                      <span className="font-bold flex items-center gap-1.5 text-emerald-400">
                        <FileCode className="w-4 h-4 text-emerald-400" />
                        Novo Arquivo Gerado
                      </span>
                      <a
                        href={ponteResult.processedFile.downloadUrl}
                        download={ponteResult.processedFile.filename}
                        className="inline-flex items-center gap-1.5 px-3 py-1 rounded bg-emerald-600 hover:bg-emerald-500 text-white font-sans font-medium text-xs transition-colors cursor-pointer"
                      >
                        <Download className="w-3.5 h-3.5" />
                        Baixar Arquivo
                      </a>
                    </div>
                    <div className="space-y-1 text-slate-400 pt-1">
                      <div><span className="text-slate-500">Nome:</span> <span className="text-emerald-300 font-bold">{ponteResult.processedFile.filename}</span></div>
                      <div><span className="text-slate-500">Tamanho:</span> {ponteResult.processedFile.size} bytes ({ponteResult.processedFile.lines} linhas)</div>
                      <div className="truncate"><span className="text-slate-500">SHA-256:</span> {ponteResult.processedFile.sha256}</div>
                      <div><span className="text-slate-500">Download direto:</span> <code className="text-emerald-400 text-[11px]">{ponteResult.processedFile.downloadUrl}</code></div>
                    </div>
                  </div>

                </div>

                {/* Execution Output Console */}
                <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-5 space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 text-white font-semibold text-sm">
                      <Terminal className="w-4 h-4 text-emerald-400" />
                      <span>Console de Execução do Python</span>
                    </div>
                    <span className="text-xs font-mono text-slate-400">
                      Comando: python3 {ponteResult.processedFile.filename}
                    </span>
                  </div>

                  <div className="bg-slate-950 rounded-xl border border-slate-800 p-4 font-mono text-xs space-y-2">
                    {ponteResult.execution.stdout && (
                      <div className="space-y-1">
                        <div className="text-slate-500 text-[11px]">--- Saída Padrão (stdout) ---</div>
                        <pre className="text-emerald-400 whitespace-pre-wrap bg-emerald-950/20 p-3 rounded border-l-2 border-emerald-500 leading-relaxed">
                          {ponteResult.execution.stdout}
                        </pre>
                      </div>
                    )}

                    {ponteResult.execution.stderr && (
                      <div className="space-y-1">
                        <div className="text-rose-400 text-[11px]">--- Saída de Erro (stderr) ---</div>
                        <pre className="text-rose-400 whitespace-pre-wrap bg-rose-950/20 p-3 rounded border-l-2 border-rose-500 leading-relaxed">
                          {ponteResult.execution.stderr}
                        </pre>
                      </div>
                    )}

                    {!ponteResult.execution.stdout && !ponteResult.execution.stderr && (
                      <div className="text-slate-500 italic">[Sem mensagens no stdout/stderr durante a execução]</div>
                    )}
                  </div>
                </div>

                {/* Code Preview of the processed file */}
                <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-5 space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 text-white font-semibold text-sm">
                      <Code className="w-4 h-4 text-emerald-400" />
                      <span>Código do Novo Arquivo Gerado</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => copyCode(ponteResult.processedFile.content)}
                        className="inline-flex items-center gap-1 px-3 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs transition-colors cursor-pointer"
                      >
                        {copiedPonteCode ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                        Copiar Código
                      </button>
                      <a
                        href={ponteResult.processedFile.downloadUrl}
                        download={ponteResult.processedFile.filename}
                        className="inline-flex items-center gap-1 px-3 py-1 rounded bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-medium transition-colors cursor-pointer"
                      >
                        <Download className="w-3.5 h-3.5" />
                        Baixar
                      </a>
                    </div>
                  </div>

                  <pre className="bg-slate-950 border border-slate-800 rounded-xl p-4 font-mono text-xs text-slate-200 max-h-72 overflow-y-auto leading-relaxed">
                    {ponteResult.processedFile.content}
                  </pre>
                </div>

              </div>
            )}

            {/* History of Processed Files */}
            {historyItems.length > 0 && (
              <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-5 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-white font-semibold text-sm">
                    <History className="w-4 h-4 text-slate-400" />
                    <span>Histórico de Arquivos Processados no Servidor ({historyItems.length})</span>
                  </div>
                  <button
                    onClick={fetchHistory}
                    className="text-xs text-slate-400 hover:text-white flex items-center gap-1 cursor-pointer"
                  >
                    <RefreshCw className="w-3 h-3" />
                    Atualizar
                  </button>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2.5 max-h-48 overflow-y-auto">
                  {historyItems.map((item, idx) => (
                    <div
                      key={idx}
                      className="p-3 bg-slate-950 rounded-xl border border-slate-800/80 flex items-center justify-between text-xs font-mono"
                    >
                      <div className="truncate mr-2">
                        <div className="text-slate-200 truncate font-semibold">{item.filename}</div>
                        <div className="text-[10px] text-slate-500">{item.size} bytes</div>
                      </div>
                      <a
                        href={item.downloadUrl}
                        download={item.filename}
                        className="p-1.5 rounded bg-slate-800 hover:bg-emerald-600 text-slate-300 hover:text-white transition-colors shrink-0 cursor-pointer"
                        title="Baixar este arquivo"
                      >
                        <Download className="w-3.5 h-3.5" />
                      </a>
                    </div>
                  ))}
                </div>
              </div>
            )}

          </div>
        )}

        {/* ================================================================= */}
        {/* TAB 3: LABORATÓRIO APP_TESTE_COPIA.PY                             */}
        {/* ================================================================= */}
        {activeMainTab === 'copia_lab' && (
          <div className="space-y-6">
            
            {/* Status Card */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              
              {/* app_teste.py */}
              <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-5 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <FileCode className="w-4 h-4 text-slate-400" />
                    <span className="font-bold text-slate-200 text-sm">app_teste.py</span>
                  </div>
                  <span className={`text-[11px] font-mono px-2 py-0.5 rounded ${files.original?.exists ? 'bg-emerald-950 text-emerald-400 border border-emerald-800' : 'bg-rose-950 text-rose-400'}`}>
                    {files.original?.exists ? 'Original Preservado' : 'Ausente'}
                  </span>
                </div>
                <div className="text-xs font-mono text-slate-400 space-y-1">
                  <div>Tamanho: {files.original?.size || 0} bytes ({files.original?.lines || 0} linhas)</div>
                  <div className="truncate">SHA-256: {files.original?.sha256 || 'N/A'}</div>
                </div>
              </div>

              {/* app_teste_copia.py */}
              <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-5 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <FileCheck className="w-4 h-4 text-blue-400" />
                    <span className="font-bold text-blue-300 text-sm">app_teste_copia.py</span>
                  </div>
                  <span className={`text-[11px] font-mono px-2 py-0.5 rounded ${files.copia?.exists ? 'bg-blue-950 text-blue-400 border border-blue-800' : 'bg-rose-950 text-rose-400'}`}>
                    {files.copia?.exists ? 'Cópia Física Pronta' : 'Não Gerada'}
                  </span>
                </div>
                <div className="text-xs font-mono text-slate-400 space-y-1">
                  <div>Tamanho: {files.copia?.size || 0} bytes ({files.copia?.lines || 0} linhas)</div>
                  <div className="truncate">SHA-256: {files.copia?.sha256 || 'N/A'}</div>
                </div>
              </div>

            </div>

            {/* Actions & Runner */}
            <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-5 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 pb-3">
                <div>
                  <h3 className="text-sm font-bold text-white flex items-center gap-2">
                    <Cpu className="w-4 h-4 text-blue-400" />
                    Executar app_teste_copia.py com Python
                  </h3>
                  <p className="text-xs text-slate-400 mt-0.5">
                    Verifica a sintaxe, importa o módulo e testa as rotas internas no runtime Python.
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  <a
                    href="/api/download/app_teste_copia.py"
                    download="app_teste_copia.py"
                    className="inline-flex items-center gap-1 px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium transition-colors cursor-pointer"
                  >
                    <Download className="w-3.5 h-3.5" />
                    Baixar app_teste_copia.py
                  </a>
                  
                  <button
                    onClick={handleRunCopia}
                    disabled={loadingRunCopia}
                    className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold transition-all shadow-md cursor-pointer disabled:opacity-50"
                  >
                    <Play className={`w-3.5 h-3.5 fill-white ${loadingRunCopia ? 'animate-spin' : ''}`} />
                    <span>{loadingRunCopia ? 'Executando Python...' : 'Executar Teste Completo'}</span>
                  </button>
                </div>
              </div>

              {/* Execution output */}
              {executionCopia && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-mono text-slate-400">{executionCopia.executedCommand}</span>
                    <span className={`font-mono font-bold ${executionCopia.exitCode === 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                      Exit Code: {executionCopia.exitCode} ({executionCopia.durationMs}ms)
                    </span>
                  </div>

                  <pre className="p-4 bg-slate-950 rounded-xl border border-slate-800 font-mono text-xs text-blue-300 whitespace-pre-wrap leading-relaxed">
                    {executionCopia.stdout || executionCopia.stderr || '[Sem saída gerada]'}
                  </pre>
                </div>
              )}
            </div>

          </div>
        )}

        {/* ================================================================= */}
        {/* TAB 4: LABORATÓRIO TESTE_ALEX.PY                                  */}
        {/* ================================================================= */}
        {activeMainTab === 'alex_lab' && (
          <div className="space-y-6">
            
            {/* Info Card */}
            <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-5 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 pb-3">
                <div>
                  <h3 className="text-sm font-bold text-white flex items-center gap-2">
                    <FileCode className="w-4 h-4 text-purple-400" />
                    Arquivo: teste_alex.py
                  </h3>
                  <p className="text-xs text-slate-400 mt-0.5">
                    Script Python dedicado para validação direta de execução no servidor.
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  <a
                    href="/api/download/teste_alex.py"
                    download="teste_alex.py"
                    className="inline-flex items-center gap-1 px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium transition-colors cursor-pointer"
                  >
                    <Download className="w-3.5 h-3.5" />
                    Baixar teste_alex.py
                  </a>

                  <button
                    onClick={handleRunAlex}
                    disabled={loadingAlexRun}
                    className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-purple-600 hover:bg-purple-500 text-white text-xs font-bold transition-all shadow-md cursor-pointer disabled:opacity-50"
                  >
                    <Play className={`w-3.5 h-3.5 fill-white ${loadingAlexRun ? 'animate-spin' : ''}`} />
                    <span>{loadingAlexRun ? 'Executando...' : 'Executar teste_alex.py'}</span>
                  </button>
                </div>
              </div>

              {/* Execution output */}
              {alexExecution && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-mono text-slate-400">{alexExecution.executedCommand}</span>
                    <span className={`font-mono font-bold ${alexExecution.exitCode === 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                      Exit Code: {alexExecution.exitCode} ({alexExecution.durationMs}ms)
                    </span>
                  </div>

                  <pre className="p-4 bg-slate-950 rounded-xl border border-slate-800 font-mono text-xs text-purple-300 whitespace-pre-wrap leading-relaxed">
                    {alexExecution.stdout || alexExecution.stderr || '[Sem saída gerada]'}
                  </pre>
                </div>
              )}

              {/* Code viewer */}
              {files.testeAlex?.content && (
                <div className="space-y-2 pt-2">
                  <span className="text-xs font-semibold text-slate-400">Código-Fonte de teste_alex.py:</span>
                  <pre className="p-4 bg-slate-950 rounded-xl border border-slate-800 font-mono text-xs text-slate-300 whitespace-pre-wrap leading-relaxed">
                    {files.testeAlex.content}
                  </pre>
                </div>
              )}
            </div>

          </div>
        )}

      </main>

      {/* Footer */}
      <footer className="w-full max-w-5xl mt-10 pt-4 border-t border-slate-800/80 text-center text-xs text-slate-500 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <ShieldCheck className="w-4 h-4 text-emerald-400" />
          <span>Ponte Alex v2 • Preparada para integração externa segura via HTTPS</span>
        </div>
        <div className="font-mono text-slate-400">
          Status: <span className="text-emerald-400">Pronta para Conexão Externa</span>
        </div>
      </footer>

    </div>
  );
}
