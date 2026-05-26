# Notes GR - Aplicativo de Meeting Notes

Aplicativo desktop para macOS de gerenciamento de notas de reunião, projetos e tarefas, funcionando 100% offline.

## 🎯 Visão Geral

Notes GR é um aplicativo mono-usuário, auto-contido e completamente offline para gerenciar seu dia-a-dia profissional. Inspirado no Notion, oferece uma interface limpa e intuitiva para organizar notas de reunião, projetos, pessoas e tarefas.

## ✨ Características Principais

### 🔒 Privacidade e Autonomia
- **100% Offline** - Funciona completamente sem internet
- **Sem Login** - Não requer autenticação ou cadastro
- **Mono-usuário** - Dados armazenados localmente no seu Mac
- **Auto-contido** - Todos os dados ficam no seu dispositivo

### 📋 Funcionalidades Implementadas

#### 1. **Dashboard Inteligente**
- Visão geral do workspace
- Notas recentes com preview de conteúdo
- Tarefas pendentes
- Perfis recentes
- Saudação contextual (Bom dia/Boa tarde/Boa noite)

#### 2. **Notas de Reunião**
- Editor de texto rico (Lexical)
- Formatação avançada (negrito, itálico, listas, títulos, código)
- Menções a pessoas com @
- Comandos rápidos com /
- Associação com projetos
- Marcação de participantes
- Preview de conteúdo na listagem
- Propriedades compactas (data, projeto, participantes)

#### 3. **Gestão de Pessoas**
- Cadastro completo de perfis
- Avatar com iniciais
- Informações de contato (email, telefone)
- Cargo e departamento
- Notas pessoais
- Visualização de notas relacionadas

#### 4. **Projetos**
- Criação e gerenciamento de projetos
- Descrição editável
- Status do projeto
- Associação com múltiplas pessoas
- Vinculação com notas de reunião
- Timeline e datas importantes

#### 5. **Tarefas**
- Lista de tarefas com checkbox
- Atribuição a pessoas
- Vinculação com projetos
- Data de vencimento
- Status de conclusão
- Filtros e organização

#### 6. **Organograma**
- Visualização hierárquica da equipe
- Estrutura organizacional
- Relações entre pessoas

#### 7. **Calendário**
- Visualização de eventos
- Integração com notas e tarefas
- Navegação por datas

#### 8. **Busca Global**
- Atalho rápido (⌘K)
- Busca em notas, pessoas, projetos e tarefas
- Resultados instantâneos

## 🎨 Interface

- **Design inspirado no Notion** - Interface limpa e moderna
- **Sidebar de navegação** - Acesso rápido a todas as seções
- **Tema claro** - Paleta de cores suave e profissional
- **Responsivo** - Layout adaptável
- **Animações suaves** - Transições fluidas

## 🛠️ Tecnologias

- **Tauri** - Framework para aplicativos desktop nativos
- **React** - Biblioteca para interface de usuário
- **TypeScript** - Tipagem estática
- **Lexical** - Editor de texto rico da Meta
- **Lucide React** - Ícones modernos
- **Vite** - Build tool rápido

## 🚀 Como Executar

### Pré-requisitos
- Node.js (v16 ou superior)
- Rust (para compilar o Tauri)
- macOS (para desenvolvimento e execução)

### Instalação

```bash
# Instalar dependências
npm install

# Executar em modo desenvolvimento
npm run tauri dev

# Build para produção
npm run tauri build
```

## 📁 Estrutura do Projeto

```
notes-gr/
├── src/
│   ├── components/        # Componentes React reutilizáveis
│   │   ├── lexical/      # Plugins do editor Lexical
│   │   ├── RichTextEditor.tsx
│   │   ├── Sidebar.tsx
│   │   └── SearchModal.tsx
│   ├── views/            # Páginas/Views principais
│   │   ├── Dashboard.tsx
│   │   ├── NotesView.tsx
│   │   ├── PeopleView.tsx
│   │   ├── ProjectsView.tsx
│   │   ├── TasksView.tsx
│   │   ├── CalendarView.tsx
│   │   └── OrganogramaView.tsx
│   ├── context/          # Context API para estado global
│   │   └── AppContext.tsx
│   ├── types.ts          # Definições de tipos TypeScript
│   └── App.tsx           # Componente principal
├── src-tauri/            # Código Rust do Tauri
└── public/               # Assets estáticos
```

## 💾 Armazenamento de Dados

Os dados são armazenados localmente usando o sistema de arquivos do Tauri, garantindo:
- Persistência entre sessões
- Privacidade total
- Acesso rápido
- Backup simples (basta copiar os arquivos)

## 🎯 Roadmap

- [ ] Exportação de notas (PDF, Markdown)
- [ ] Temas (claro/escuro)
- [ ] Atalhos de teclado customizáveis
- [ ] Tags e categorias
- [ ] Anexos de arquivos
- [ ] Gráficos e estatísticas
- [ ] Backup automático

## 📝 Licença

Este é um projeto pessoal para uso individual.

## 🤝 Contribuindo

Este é um projeto pessoal, mas sugestões são bem-vindas!

---

**Desenvolvido com ❤️ usando Tauri + React + TypeScript**
