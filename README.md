<div align="center">

<img src="src-tauri/icons/128x128@2x.png" alt="Titus Notes" width="120" height="120" />

# Titus Notes

**Notas de reunião com gravação, transcrição local e IA — para macOS (Apple Silicon).**

Aplicativo desktop mono-usuário para organizar reuniões, projetos, pessoas e tarefas.
Seus dados ficam no seu Mac; os recursos de rede são opcionais e explícitos.

</div>

---

## 🎯 Visão geral

Titus Notes é um app desktop (Tauri 2 + React) para quem vive de reuniões. Você grava o
áudio do encontro (microfone **e** áudio do sistema), transcreve localmente, gera resumos
com IA local (Ollama) e mantém tudo conectado a projetos, pessoas e tarefas — sem login e
sem servidor.

## ✨ Funcionalidades

### 📝 Notas de reunião
- Editor de texto rico (Lexical): negrito, itálico, listas, títulos, código, citações
- Menções a pessoas com `@` e comandos rápidos com `/`
- Associação a projetos e marcação de participantes
- Painel lateral com índice de títulos e referências
- Salvamento imediato ao mudar data, projeto ou pessoas

### 🎙️ Gravação e transcrição
- Captura simultânea de **microfone + áudio do sistema** (mixados num MP3 mono
  16 kHz / 32 kbps para ouvir, e em **canais separados** durante a gravação)
- **Transcrição 100% local** com Parakeet v3 (`parakeet-tdt-0.6b-v3`, ONNX) — o modelo é
  baixado uma única vez sob demanda
- **Modo de transcrição configurável** (Configurações → Transcrição local):
  **lote** (padrão; pós-gravação, com canais separados e mais preciso) ou **ao vivo**
  (preenche o transcript em tempo real durante a reunião, em janelas)
- **Transcrição por canais com rótulo de locutor**: o seu microfone e o áudio do sistema
  são transcritos **separadamente** (cada um no nível nativo, sem o desbalanceamento da
  mistura) e mesclados por tempo, marcando **(Você)** e **(Outros)**. Isso garante que a
  voz remota apareça no texto e dá atribuição de quem falou de graça
- Limpeza automática de áudios antigos (por idade, agendável)

### 🤖 IA local (Ollama)
- Resumos de notas e projetos com **templates** personalizáveis
- **Itens de ação**: extrai os próximos passos da reunião (anotações + transcrição +
  sumários) e cria **tarefas** já vinculadas ao projeto, responsável e vencimento
- **Separa os SEUS itens de ação**: usa a transcrição rotulada por canal (o que **você**
  falou vs. **outros**) e seus nome/apelidos do perfil para marcar o que ficou com você —
  "deixa comigo" dito por você vira tarefa sua com certeza. Filtro **"Somente meus"** no painel
- Chat contextual sobre uma nota ou um projeto
- Perfis de pessoas gerados por IA
- Tudo roda na sua máquina via Ollama (modelo e idioma configuráveis — PT/EN/ES/FR)

### 👥 Pessoas e organograma
- Cadastro de perfis com avatar, cargo, departamento, empresa e contato
- **Organograma** hierárquico com busca que destaca/rola e zoom para árvores largas
- Notas e projetos relacionados a cada pessoa

### 📁 Projetos e tarefas
- Projetos com descrição em Markdown, status, pessoas e notas vinculadas
- Resumo do projeto por IA e chat dedicado
- Tarefas com responsável, projeto, vencimento e filtros

### 🗂️ Produtividade
- **Painel** com visão geral, notas recentes e tarefas pendentes
- **Calendário** integrado a notas e tarefas
- **Busca global** (`⌘K`) em notas (incluindo **corpo de transcrições e resumos**),
  pessoas, projetos e tarefas — com trecho de contexto e termo destacado
- **Tags** em notas, projetos e tarefas — eixo de organização transversal, com
  autocomplete, chips coloridos, busca por tag e filtro por tag na lista de notas

### 🔄 Dados, backup e atualizações
- Banco de dados local em JSON (pasta configurável)
- Exportação de todos os dados em `.zip`
- **Backup remoto opcional em S3** (credenciais suas, agendamento e retenção)
- **Importação do Hyprnote** (automática ou manual)
- **Auto-atualização assinada** (minisign) via releases do GitHub

## 🔒 Privacidade

Por padrão tudo é local. Os únicos acessos de rede são **opcionais e explícitos**:

| Recurso | Quando acessa a rede |
|---|---|
| Transcrição | Download único do modelo Parakeet (HuggingFace) |
| IA / resumos | Servidor Ollama local (`localhost`) que você controla |
| Backup S3 | Apenas se você configurar credenciais |
| Atualizações | Verificação no GitHub Releases |

Nenhum dado de reunião é enviado a terceiros sem ação sua.

## 🛠️ Tecnologias

**Frontend:** Tauri 2 · React 19 · TypeScript · Lexical · Vite · Lucide
**Backend (Rust):** `cpal` e `screencapturekit` (áudio) · `mp3lame-encoder` · `transcribe-rs` (ONNX) · `symphonia` · `rust-s3` · `reqwest` · `tokio`

## 🚀 Como executar

### Pré-requisitos
- **macOS Apple Silicon** (arm64)
- **Node.js 24 LTS** e **Rust** (toolchain estável)
- Para compilar a captura de áudio do sistema é necessário um macOS recente com o
  **SDK do macOS 26** (Xcode 26) — dependência do `screencapturekit`/`apple-metal`
- Opcional: [Ollama](https://ollama.com) rodando localmente para os recursos de IA

### Desenvolvimento

```bash
npm install
npm run tauri dev
```

### Build de produção

```bash
# Script recomendado: carrega a chave de assinatura do updater e builda
./build.sh                 # build nativo (Apple Silicon), assinado
./build.sh -t universal    # binário universal (arm64 + x86_64)
./build.sh -d              # build debug rápido (sem assinatura)

# Equivalente direto pelo Tauri:
npm run tauri build
```

> A assinatura do updater usa `~/.tauri/titus-notes.key` (chave minisign). O `build.sh`
> carrega a chave automaticamente; para CI, defina os secrets
> `TAURI_SIGNING_PRIVATE_KEY` e `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`.

### Releases (CI)

Um push de tag `v*` dispara o workflow [`release.yml`](.github/workflows/release.yml), que
builda no runner **macOS 26**, assina e publica o `.dmg` + artefatos do updater
(`latest.json`) automaticamente.

```bash
git tag v0.11.2 && git push origin v0.11.2
```

## 📁 Estrutura do projeto

```
titus-notes-ov/
├── src/                      # Frontend React
│   ├── views/                # Telas: Dashboard, Notes, People, Projects,
│   │                         #        Tasks, Calendar, Organograma, Settings
│   ├── components/           # Editor, Sidebar, busca, chats de IA, lexical/
│   ├── context/              # Estado global (AppContext)
│   └── types.ts
├── src-tauri/                # Backend Rust (Tauri 2)
│   ├── src/                  # lib.rs, recorder.rs, transcriber.rs, mic_monitor.rs
│   ├── capabilities/         # Permissões do Tauri
│   └── icons/                # Ícones do app
└── .github/workflows/        # release.yml
```

## 📦 Instalação (usuários)

Baixe o `.dmg` mais recente em **[Releases](../../releases/latest)**, abra e arraste para
Aplicativos. O app é assinado para o updater, porém **não é notarizado pela Apple** — na
primeira abertura use clique-direito → **Abrir** para liberar no Gatekeeper. Atualizações
seguintes chegam automaticamente pelo updater.

## 🗺️ Roadmap

- [ ] Exportação de notas (PDF / Markdown)
- [ ] Tema escuro
- [x] Tags e categorias
- [ ] Notarização Apple (remover o aviso do Gatekeeper)

## 📝 Licença

Projeto pessoal. Sugestões e issues são bem-vindas.

---

<div align="center">

**Feito com ❤️ usando Tauri + React + TypeScript**

</div>
