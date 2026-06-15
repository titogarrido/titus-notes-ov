# Design System - Notes GR

Sistema de design completo do aplicativo Notes GR, inspirado no Notion.

## 🎨 Filosofia de Design

O Notes GR segue uma filosofia de design minimalista e funcional, priorizando:
- **Clareza** - Interface limpa e sem distrações
- **Consistência** - Padrões visuais uniformes
- **Eficiência** - Acesso rápido às funcionalidades
- **Elegância** - Estética profissional e moderna

---

## 📐 Fundamentos

### Tipografia

#### Famílias de Fonte
```css
--font-sans: 'Inter', -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif
--font-title: 'Outfit', var(--font-sans)
--font-mono: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace
```

#### Hierarquia Tipográfica
- **H1 (Títulos principais)**: 26px, weight 800, Outfit
- **H2 (Seções)**: 20px, weight 700, Outfit
- **H3 (Subtítulos)**: 18px, weight 600, Outfit
- **Body (Texto padrão)**: 14px, weight 400, Inter
- **Small (Metadados)**: 12px, weight 400, Inter
- **Tiny (Labels)**: 10px, weight 500, Inter

#### Pesos de Fonte
- Light: 300
- Regular: 400
- Medium: 500
- Semibold: 600
- Bold: 700
- Extrabold: 800

---

## 🎨 Paleta de Cores

### Cores Principais

#### Backgrounds
```css
--bg-sidebar: #f8f7f4        /* Fundo da sidebar */
--bg-main: #ffffff           /* Fundo principal */
--bg-card: #ffffff           /* Fundo de cards */
--bg-card-hover: #fafafa     /* Hover em cards */
```

#### Texto
```css
--color-text-main: #37352f   /* Texto principal */
--color-text-muted: #7c7b77  /* Texto secundário */
--color-text-link: #2b2b2b   /* Links */
```

#### Bordas
```css
--border-color: #e9e9e6      /* Bordas padrão */
--border-color-dark: #dfdfdb /* Bordas escuras */
```

### Cores de Destaque

#### Accent (Laranja Dourado)
```css
--accent-orange: #df6a16     /* Cor principal de destaque */
--bg-active-sidebar: #efebe4 /* Fundo ativo na sidebar */
--bg-hover-sidebar: #efebe466 /* Hover na sidebar */
--bg-active-border: #e68a00  /* Borda ativa */
```

### Cores Semânticas

#### Status e Labels
```css
/* Azul - Informação */
--bg-badge-blue: #e8f4fc
--color-badge-blue: #0969da

/* Laranja - Atenção */
--bg-badge-orange: #fdf1e8
--color-badge-orange: #bc4c00

/* Cinza - Neutro */
--bg-badge-gray: #f1f1ef
--color-badge-gray: #4b4a47

/* Verde - Sucesso */
--bg-badge-green: #eef8f2
--color-badge-green: #1f883d
```

#### Estados
- **Hover**: Opacidade 0.9 ou background levemente mais escuro
- **Active**: Background com cor de destaque
- **Disabled**: Opacidade 0.4
- **Focus**: Border com cor de destaque + box-shadow

---

## 📏 Espaçamento

### Sistema de Espaçamento (8px base)
```
4px   - Espaçamento mínimo (gaps pequenos)
8px   - Espaçamento pequeno (padding interno)
12px  - Espaçamento médio (gaps entre elementos)
16px  - Espaçamento padrão (padding de containers)
24px  - Espaçamento grande (margens de seções)
32px  - Espaçamento extra grande (separação de blocos)
40px  - Espaçamento de página (padding vertical)
60px  - Espaçamento de página (padding horizontal)
```

### Aplicações Comuns
- **Padding de botões**: 8px 12px
- **Padding de cards**: 16px 20px
- **Gap entre elementos**: 8px - 16px
- **Margens de seção**: 24px - 32px

---

## 🔲 Componentes

### Botões

#### Primário
```css
background: #ffffff
border: 1px solid var(--border-color)
padding: 8px 12px
border-radius: 8px
font-size: 13px
font-weight: 500
box-shadow: 0 1px 2px rgba(15, 15, 15, 0.04)
```

#### Secundário
```css
background: transparent
border: 1px solid var(--border-color)
padding: 8px 12px
border-radius: 8px
```

#### Ícone
```css
width: 32px
height: 32px
border-radius: 4px
background: transparent
```

### Cards

#### Card Padrão
```css
background: #ffffff
border: 1px solid var(--border-color)
border-radius: 8px
padding: 16px 20px
box-shadow: 0 1px 2px rgba(15, 15, 15, 0.04)
transition: all 0.15s cubic-bezier(0.16, 1, 0.3, 1)
```

#### Card Hover
```css
background: #fafafa
box-shadow: 0 2px 4px rgba(15, 15, 15, 0.04), 0 6px 16px rgba(15, 15, 15, 0.03)
transform: translateY(-1px)
```

### Inputs

#### Input de Texto
```css
border: 1px solid var(--border-color)
border-radius: 8px
padding: 8px 12px
font-size: 14px
background: #ffffff
transition: border-color 0.15s, box-shadow 0.15s
```

#### Input Focus
```css
border-color: var(--color-text-main)
box-shadow: 0 0 0 3px rgba(55, 53, 47, 0.08)
outline: none
```

### Badges/Tags

#### Badge Padrão
```css
padding: 4px 8px
border-radius: 4px
font-size: 11px
font-weight: 500
display: inline-flex
align-items: center
gap: 4px
```

#### Variações
- **Projeto**: background azul, texto azul escuro
- **Pessoa**: background laranja, texto laranja escuro
- **Status**: background verde, texto verde escuro

### Avatar

#### Avatar com Iniciais
```css
width: 32px
height: 32px
border-radius: 50%
background: linear-gradient(135deg, #667eea 0%, #764ba2 100%)
color: #ffffff
font-size: 12px
font-weight: 600
display: flex
align-items: center
justify-content: center
```

---

## 🎭 Sombras

### Sistema de Sombras
```css
--shadow-sm: 0 1px 2px rgba(15, 15, 15, 0.04)
--shadow-md: 0 2px 4px rgba(15, 15, 15, 0.04), 0 6px 16px rgba(15, 15, 15, 0.03)
--shadow-lg: 0 12px 24px rgba(15, 15, 15, 0.05), 0 4px 8px rgba(15, 15, 15, 0.03)
```

### Aplicações
- **Cards**: shadow-sm
- **Dropdowns**: shadow-lg
- **Modais**: shadow-lg
- **Hover em cards**: shadow-md

---

## 📐 Border Radius

### Sistema de Arredondamento
```css
--border-radius-sm: 4px   /* Elementos pequenos (badges, ícones) */
--border-radius-md: 8px   /* Padrão (cards, inputs, botões) */
--border-radius-lg: 12px  /* Elementos grandes (modais) */
```

### Aplicações
- **Botões e inputs**: 8px
- **Cards**: 8px
- **Badges**: 4px
- **Avatar**: 50% (circular)
- **Chips de participantes**: 12px

---

## ⚡ Animações e Transições

### Curvas de Transição
```css
--transition-fast: 0.15s cubic-bezier(0.16, 1, 0.3, 1)
--transition-normal: 0.25s cubic-bezier(0.16, 1, 0.3, 1)
```

### Animações Comuns

#### Fade In
```css
@keyframes fadeIn {
  from { 
    opacity: 0; 
    transform: translateY(4px); 
  }
  to { 
    opacity: 1; 
    transform: translateY(0); 
  }
}
```

#### Spin (Loading)
```css
@keyframes spin {
  to { transform: rotate(360deg); }
}
```

### Propriedades Animadas
- **Hover**: background-color, box-shadow, transform
- **Focus**: border-color, box-shadow
- **Active**: background-color, opacity

---

## 📱 Layout

### Estrutura Principal

#### Sidebar
```css
width: 240px
background: #f8f7f4
border-right: 1px solid var(--border-color)
padding: 16px 12px
```

#### Main Content
```css
flex: 1
background: #ffffff
overflow-y: auto
```

#### View Container
```css
padding: 40px 60px
max-width: 1100px
margin: 0 auto
```

### Grid System

#### Dashboard Grid
```css
display: grid
grid-template-columns: 2fr 1fr
gap: 32px
```

#### Notes Grid
```css
display: grid
grid-template-columns: repeat(2, 1fr)
gap: 16px
```

---

## 🎯 Componentes Específicos

### Editor de Texto Rico

#### Toolbar
```css
background: #f8f9fa
border-bottom: 1px solid var(--border-color)
padding: 8px 12px
display: flex
gap: 4px
```

#### Botão da Toolbar
```css
width: 32px
height: 32px
border-radius: 4px
background: transparent
transition: all 0.15s ease
```

#### Área de Edição
```css
padding: 24px 32px
font-size: 15px
line-height: 1.7
min-height: 300px
```

### Barra de Propriedades Compacta

```css
display: flex
gap: 12px
padding: 10px 24px
background: #f8f9fa
border-bottom: 1px solid var(--border-color)
flex-wrap: wrap
align-items: center
```

### Chips de Participantes

```css
display: flex
align-items: center
gap: 4px
padding: 3px 8px
background: #e8eaed
border-radius: 12px
font-size: 11px
font-weight: 500
```

---

## 🔍 Estados Interativos

### Hover
- Mudança sutil de background
- Elevação com shadow
- Transform translateY(-1px) em cards

### Active/Selected
- Background com cor de destaque
- Border com cor de destaque
- Ícone ou indicador visual

### Focus
- Border destacada
- Box-shadow suave
- Outline removido (acessibilidade via border)

### Disabled
- Opacity: 0.4
- Cursor: not-allowed
- Sem interações de hover

---

## ♿ Acessibilidade

### Contraste
- Texto principal: 13:1 (AAA)
- Texto secundário: 7:1 (AA)
- Elementos interativos: mínimo 4.5:1

### Foco
- Sempre visível via border + box-shadow
- Nunca remover outline sem alternativa
- Ordem de tabulação lógica

### Semântica
- Uso correto de tags HTML
- ARIA labels quando necessário
- Hierarquia de headings respeitada

---

## 📦 Ícones

### Biblioteca
**Lucide React** - Ícones modernos e consistentes

### Tamanhos Padrão
- **Small**: 14px (metadados, badges)
- **Medium**: 18px (títulos de seção)
- **Large**: 24px (títulos principais)

### Estilo
- Stroke width: 2px
- Cor: herda do texto ou var(--color-text-muted)
- Sempre alinhados verticalmente com texto

---

## 🎨 Temas Futuros

### Dark Mode (Planejado)
```css
/* Cores invertidas mantendo contraste */
--bg-main: #1a1a1a
--bg-sidebar: #2d2d2d
--color-text-main: #e8e6e3
--color-text-muted: #9b9a97
--border-color: #3a3a3a
```

---

## 📝 Boas Práticas

### CSS
1. Usar variáveis CSS para valores reutilizáveis
2. Seguir convenção de nomenclatura BEM quando apropriado
3. Evitar !important
4. Preferir flexbox/grid sobre floats
5. Mobile-first quando aplicável

### Componentes
1. Manter componentes pequenos e focados
2. Reutilizar estilos via classes
3. Documentar variações de componentes
4. Testar estados interativos

### Performance
1. Minimizar repaints com transform/opacity
2. Usar will-change com cuidado
3. Otimizar animações para 60fps
4. Lazy load quando possível

---

**Design System v1.0 - Notes GR**  
*Última atualização: Maio 2026*