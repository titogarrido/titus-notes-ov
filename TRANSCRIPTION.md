# Transcrição Local - Documentação Técnica

## Visão Geral

O Titus Notes implementa transcrição de áudio local usando o modelo **Parakeet TDT 0.6b v3** (ONNX, int8) da NVIDIA, executado completamente offline no dispositivo do usuário. A transcrição processa arquivos MP3 de gravações de reuniões e gera texto com timestamps.

## Arquitetura

### Backend (Rust)

A implementação está em [`src-tauri/src/transcriber.rs`](src-tauri/src/transcriber.rs:1) e segue uma arquitetura assíncrona baseada em eventos:

```
┌─────────────────┐
│   Frontend      │
│   (React)       │
└────────┬────────┘
         │ invoke("transcribe_audio")
         ▼
┌─────────────────┐
│  Tauri Command  │
│  (Thread Main)  │
└────────┬────────┘
         │ spawn worker thread
         ▼
┌─────────────────┐      ┌──────────────────┐
│ Worker Thread   │─────▶│  Eventos Globais │
│ (Transcrição)   │      │  - progress      │
└─────────────────┘      │  - finished      │
                         │  - error         │
                         └──────────────────┘
```

### Componentes Principais

#### 1. **Estado Global** ([`TranscriberState`](src-tauri/src/transcriber.rs:39-54))

```rust
pub struct TranscriberState {
    pub active: Mutex<Option<ActiveTranscription>>,
    pub cancel: AtomicBool,
    pub downloading: AtomicBool,
    pub cancel_download: AtomicBool,
}
```

Gerencia:
- Job de transcrição ativo
- Flags de cancelamento
- Estado de download do modelo

#### 2. **Modelo de IA**

**Modelo:** Parakeet TDT 0.6b v3 (ONNX, int8)
- **Tamanho:** ~670 MB
- **Fonte:** HuggingFace (`istupakov/parakeet-tdt-0.6b-v3-onnx`)
- **Arquivos:** 4 arquivos ONNX + vocabulário
- **Localização:** `<app_data>/models/parakeet-tdt-0.6b-v3-int8/`

**Arquivos do modelo:**
1. `encoder-model.int8.onnx` - Encoder do modelo
2. `decoder_joint-model.int8.onnx` - Decoder
3. `nemo128.onnx` - Tokenizador
4. `vocab.txt` - Vocabulário

#### 3. **Download do Modelo** ([`download_transcription_model`](src-tauri/src/transcriber.rs:159-193))

- Download sob demanda do HuggingFace
- Progresso em tempo real via eventos
- Suporte a cancelamento
- Verificação de integridade (tamanho de arquivo)
- Download incremental (pula arquivos já baixados)

#### 4. **Processamento de Áudio**

##### Decodificação ([`decode_to_16k_mono`](src-tauri/src/transcriber.rs:535-625))

Usa a biblioteca **Symphonia** para decodificar MP3/WAV:

```rust
MP3/WAV → Symphonia → PCM multicanal → Mono → Resample 16kHz → Vec<f32>
```

**Características:**
- Suporta MP3 e WAV
- Converte para mono (média dos canais)
- Reamostra para 16 kHz (taxa esperada pelo modelo)
- Progresso em tempo real durante decodificação
- Tratamento robusto de erros (frames corrompidos são pulados)

##### Fatiamento Inteligente ([`transcribe_samples_chunked`](src-tauri/src/transcriber.rs:422-465))

Para reuniões longas, o áudio é dividido em chunks de ~60 segundos:

```
Áudio completo → Chunks de 60s → Transcrição por chunk → Texto final
```

**Algoritmo de corte inteligente** ([`find_quiet_split`](src-tauri/src/transcriber.rs:498-515)):
- Procura o ponto de menor energia (RMS) em uma janela de ±5s ao redor do alvo
- Analisa frames de 30ms (480 amostras @ 16kHz)
- Corta em pausas naturais, não no meio de palavras

**Constantes:**
```rust
const CHUNK_SECS: f32 = 60.0;           // Tamanho alvo do chunk
const SPLIT_SEARCH_SECS: f32 = 5.0;     // Janela de busca
const ENERGY_FRAME: usize = 480;        // Frame de análise (30ms)
```

##### Inferência

Usa a biblioteca [`transcribe-rs`](src-tauri/Cargo.toml:37) com backend ONNX:

```rust
let mut model = ParakeetModel::load(model_dir, &Quantization::Int8)?;
let result = model.transcribe_with(&chunk, &ParakeetParams::default())?;
```

#### 5. **Formato de Saída**

O texto transcrito inclui timestamps por parágrafo:

```
[0:00] Primeiro parágrafo da transcrição...

[1:23] Segundo parágrafo após 1 minuto e 23 segundos...

[15:47] Continuação da reunião...
```

Formato do timestamp ([`format_timestamp`](src-tauri/src/transcriber.rs:517-527)):
- `M:SS` para < 1 hora
- `H:MM:SS` para ≥ 1 hora

### Frontend (React/TypeScript)

#### Integração no Editor ([`RichTextEditor.tsx`](src/components/RichTextEditor.tsx:153-155))

O componente gerencia:
1. **Estado local** do job de transcrição
2. **Listeners de eventos** globais
3. **UI de progresso** (barra + indicadores)
4. **Controles** (iniciar/cancelar)

**Eventos escutados:**
- `transcription-progress` - Atualiza barra de progresso
- `transcription-finished` - Recebe texto transcrito
- `transcription-error` - Exibe erros
- `transcription-model-progress` - Download do modelo
- `transcription-model-finished` - Download completo
- `transcription-model-error` - Erro no download

#### Persistência ([`AppContext.tsx`](src/context/AppContext.tsx:395-397))

O contexto global escuta `transcription-finished` e:
1. Salva o texto transcrito na nota
2. Atualiza o estado da aplicação
3. Persiste no arquivo JSON

#### Configurações ([`SettingsView.tsx`](src/views/SettingsView.tsx:995-997))

Painel de gerenciamento do modelo:
- Status do modelo (pronto/faltando arquivos)
- Botão de download
- Progresso do download
- Botão de exclusão
- Informações de tamanho

## Fluxo de Execução

### 1. Download do Modelo (Primeira Vez)

```
Usuário clica "Baixar modelo"
    ↓
Frontend: invoke("download_transcription_model")
    ↓
Backend: Valida estado → Spawn async task
    ↓
Download de 4 arquivos do HuggingFace
    ↓
Eventos de progresso a cada 150ms
    ↓
Frontend: Atualiza barra de progresso
    ↓
Evento "transcription-model-finished"
    ↓
Frontend: Atualiza status do modelo
```

### 2. Transcrição de Áudio

```
Usuário clica botão de transcrição
    ↓
Frontend: invoke("transcribe_audio", { noteId, filename })
    ↓
Backend: Valida modelo e arquivo → Spawn worker thread
    ↓
Fase 1: DECODIFICAÇÃO
    ├─ Lê MP3 com Symphonia
    ├─ Converte para mono 16kHz
    └─ Eventos de progresso a cada 500ms
    ↓
Fase 2: TRANSCRIÇÃO
    ├─ Carrega modelo Parakeet (~2-3s)
    ├─ Fatia áudio em chunks de 60s
    ├─ Transcreve cada chunk
    ├─ Adiciona timestamps
    └─ Eventos de progresso após cada chunk
    ↓
Evento "transcription-finished" com texto completo
    ↓
Frontend: Salva texto na nota
```

### 3. Cancelamento

```
Usuário clica "Cancelar"
    ↓
Frontend: invoke("cancel_transcription")
    ↓
Backend: Define flag cancel = true
    ↓
Worker thread: Verifica flag periodicamente
    ↓
Worker: Interrompe e retorna erro
    ↓
Evento "transcription-error"
    ↓
Frontend: Limpa estado
```

## Otimizações

### 1. **Build Otimizado** ([`Cargo.toml`](src-tauri/Cargo.toml:43-50))

```toml
[profile.dev.package.symphonia]
opt-level = 3
```

Decodificação MP3 em modo dev:
- Sem otimização: ~40s para 30min de áudio
- Com opt-level 3: poucos segundos

### 2. **Gerenciamento de Memória**

- Modelo carregado apenas durante transcrição
- RAM liberada ao final do job
- Chunks processados sequencialmente (não em paralelo)

### 3. **Localização do Modelo**

Modelos sempre em `<app_data>/models/`, **nunca** na pasta de dados customizada:
- Evita sincronização desnecessária (670 MB)
- Separação entre dados do usuário e assets do sistema

### 4. **Arquitetura Assíncrona**

- Comandos retornam imediatamente
- Trabalho pesado em threads separadas
- Eventos permitem UI responsiva
- Usuário pode trocar de tela sem perder progresso

## Comandos Tauri

| Comando | Descrição |
|---------|-----------|
| [`transcription_model_status`](src-tauri/src/transcriber.rs:108-114) | Retorna status do modelo (pronto, faltando arquivos, tamanho) |
| [`transcription_status`](src-tauri/src/transcriber.rs:117-121) | Retorna job ativo ou null |
| [`download_transcription_model`](src-tauri/src/transcriber.rs:159-193) | Inicia download do modelo |
| [`cancel_transcription_model_download`](src-tauri/src/transcriber.rs:130-135) | Cancela download em andamento |
| [`delete_transcription_model`](src-tauri/src/transcriber.rs:138-153) | Remove modelo do disco |
| [`transcribe_audio`](src-tauri/src/transcriber.rs:294-366) | Inicia transcrição de um arquivo |
| [`cancel_transcription`](src-tauri/src/transcriber.rs:124-127) | Cancela transcrição em andamento |

## Eventos Globais

### Transcrição

- **`transcription-progress`**
  ```typescript
  {
    noteId: string,
    filename: string,
    phase: "decoding" | "transcribing",
    processedSecs: number,
    totalSecs: number
  }
  ```

- **`transcription-finished`**
  ```typescript
  {
    noteId: string,
    filename: string,
    text: string
  }
  ```

- **`transcription-error`**
  ```typescript
  {
    noteId: string,
    filename: string,
    message: string
  }
  ```

### Download do Modelo

- **`transcription-model-progress`**
  ```typescript
  {
    file: string,
    fileIndex: number,
    fileCount: number,
    fileDownloaded: number,
    fileTotal: number,
    overallDownloaded: number,
    overallTotal: number
  }
  ```

- **`transcription-model-finished`** (sem payload)

- **`transcription-model-error`**
  ```typescript
  {
    message: string
  }
  ```

## Dependências

### Rust

- **`transcribe-rs`** (0.3.11) - Wrapper para modelos ONNX de transcrição
- **`symphonia`** (0.5) - Decodificação de áudio (MP3/WAV)
- **`reqwest`** (0.11) - Download HTTP do modelo
- **`futures-util`** (0.3) - Streaming de download

### Frontend

- **Tauri IPC** - Comunicação com backend
- **React hooks** - Gerenciamento de estado
- **Event listeners** - Recepção de eventos globais

## Teste Manual

Um exemplo de teste está disponível em [`transcribe_smoke.rs`](src-tauri/examples/transcribe_smoke.rs:1-53):

```bash
cargo run --example transcribe_smoke -- <model_dir> <audio.mp3> [segundos]
```

Testa:
- Decodificação MP3
- Carregamento do modelo
- Transcrição dos primeiros N segundos
- Performance (tempo real vs tempo de processamento)

## Limitações e Considerações

1. **Modelo único**: Apenas Parakeet TDT 0.6b v3 suportado
2. **Idioma**: Parakeet TDT 0.6b **v3** é multilíngue (25 idiomas europeus, incluindo português) com detecção automática de idioma — não é necessário configurar o idioma
3. **Hardware**: Requer ~1GB RAM durante transcrição
4. **Performance**: ~0.5-1x tempo real em hardware moderno
5. **Qualidade**: Melhor com áudio limpo (16kHz, mono)
6. **Offline**: Funciona completamente sem internet (após download)

## Diarização de gravações finalizadas

Na aba **Transcrição**, o botão **Diarizar** processa o áudio anexado localmente.
A primeira utilização oferece o download do **Nemotron 3 Core ML INT8** (~102 MB);
o modelo Parakeet também precisa estar instalado. Se já existir transcrição, a UI
solicita a substituição antes de começar. Erros e cancelamento preservam o texto anterior.

O fluxo usa `src-tauri/src/diarizer.rs`:

1. Symphonia decodifica o áudio em PCM mono de 16 kHz.
2. Um helper Swift/Core ML identifica os intervalos de até oito interlocutores.
3. O helper termina e libera o modelo antes de carregar o Parakeet.
4. Parakeet transcreve em janelas delimitadas pelo início dos turnos, com contexto
   nas bordas, normalização de volume por janela e timestamps por palavra. Janelas
   longas são cortadas em pausas (~60 s). O áudio inteiro continua coberto, e as
   palavras do contexto pertencem a uma única janela. Os intervalos de voz são
   alinhados a essas palavras. Sobreposições recebem os dois rótulos;
   palavras sem atribuição permanecem como **Não identificado**.
5. `diarization-finished` persiste `note.diarization` e o texto no AppContext,
   inclusive ao navegar para outra nota. Resultados de um áudio substituído são descartados.

O painel permite ouvir até oito segundos de uma voz, editar seu nome ou escolher
uma pessoa cadastrada. A seleção de pessoa também a adiciona aos participantes.
Alterações atualizam apenas os cabeçalhos conhecidos, preservando o texto editado
manualmente. **Sou eu** gera a transcrição própria para os itens de ação, excluindo
falas sobrepostas. As identidades são locais a cada gravação; não há reconhecimento
automático de nomes entre reuniões. A diarização melhora a atribuição de falas,
sem prometer corrigir palavras reconhecidas incorretamente ou separar áudio sobreposto.

O helper é compilado por `src-tauri/build.rs` e embutido no binário do app; usuários
do app instalado não precisam de Xcode, Python, MLX ou programas externos. O código
Core ML foi adaptado do [speech-swift](https://github.com/soniqo/speech-swift), com
revisão e licença preservadas em `src-tauri/diarization/vendor/NOTICE` e `LICENSE`.
Os pesos vêm do [bundle Core ML](https://huggingface.co/aufklarer/Nemotron-3-Diarization-100M-CoreML-INT8);
`model-manifest.json` fixa a revisão e os tamanhos. Downloads são temporários e
só substituem arquivos completos; o PCM temporário é removido ao terminar ou cancelar.

Comandos novos: `diarization_model_status`, `download_diarization_model`,
`cancel_diarization_model_download`, `diarize_audio`. O job compartilha o bloqueio
de transcrição e usa `transcription-progress` (fase `diarizing`) e
`cancel_transcription`. Download usa eventos `diarization-model-*`.

Verificação: `npm test`, `npm run build`, `cargo test --offline diarizer::tests --lib`.
O teste de inferência `coreml_and_parakeet_align_real_audio` é ignorado por padrão:
para executá-lo, defina `TITUS_DIARIZATION_TEST_MODEL` (pasta dos pesos Core ML),
`TITUS_PARAKEET_TEST_MODEL` (pasta Parakeet) e `TITUS_DIARIZATION_TEST_PCM` (fixture
com duas vozes, Float32 little-endian, mono, 16 kHz), e passe `-- --include-ignored`.

## Melhorias Futuras

- [ ] Suporte a múltiplos modelos/idiomas
- [ ] Detecção automática de idioma
- [x] Identificação de speakers (diarização)
- [ ] Cache do modelo em memória entre transcrições
- [ ] Processamento em GPU (CUDA/Metal)
- [ ] Transcrição em tempo real durante gravação
- [ ] Edição manual de timestamps
- [ ] Exportação de legendas (SRT/VTT)
